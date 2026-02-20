// content.js
(() => {
  // Prevent multiple injections from redeclaring const/let
  if (window.__SID_CONTENT_LOADED__) return;
  window.__SID_CONTENT_LOADED__ = true;

  const MIN_W = 400;
  const MIN_H = 400;

  function toAbs(url) {
    try { return new URL(url, location.href).href; } catch { return null; }
  }

  function guessMime(url) {
    const u = (url || "").toLowerCase();
    if (u.includes(".jpg") || u.includes(".jpeg")) return "image/jpeg";
    if (u.includes(".png")) return "image/png";
    if (u.includes(".webp")) return "image/webp";
    return null;
  }

  function isBlockedType(url) {
    const u = (url || "").toLowerCase();
    return u.includes(".gif") || u.includes(".svg") || u.includes(".mp4") || u.includes(".webm");
  }

  function looksLikeImage(url) {
    const u = (url || "").toLowerCase();
    const hasExt = u.includes(".jpg") || u.includes(".jpeg") || u.includes(".png") || u.includes(".webp");
    const cdnHint = u.includes("fbcdn") || u.includes("cdninstagram") || u.includes("scontent") || u.includes("igcdn");
    return (hasExt || cdnHint) && !isBlockedType(url);
  }

  function extractCssBackgroundUrlsFast(limit = 900) {
    const out = [];
    const all = document.querySelectorAll("*");
    let seen = 0;

    for (const el of all) {
      if (seen++ > limit) break;
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === "none" || !bg.includes("url(")) continue;
      const matches = bg.matchAll(/url\(["']?(.*?)["']?\)/g);
      for (const m of matches) {
        const abs = toAbs(m[1]);
        if (abs && looksLikeImage(abs)) out.push(abs);
      }
    }
    return out;
  }

  function collectUrlsFast() {
    const urls = [];
    document.querySelectorAll("img").forEach(img => {
      const u = img.currentSrc || img.getAttribute("src");
      const abs = u ? toAbs(u) : null;
      if (abs && looksLikeImage(abs)) urls.push(abs);
    });
    extractCssBackgroundUrlsFast(900).forEach(u => urls.push(u));
    return Array.from(new Set(urls));
  }

  // ===== Floating LIVE badge (page overlay) =====
  const BADGE_ID = "__sid_live_badge__";

  function ensureBadge() {
    let el = document.getElementById(BADGE_ID);
    if (el) return el;

    el = document.createElement("div");
    el.id = BADGE_ID;
    el.style.cssText = `
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 2147483647;
      padding: 10px 12px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(0,0,0,.35);
      backdrop-filter: blur(12px);
      color: rgba(255,255,255,.92);
      font: 600 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
      box-shadow: 0 20px 60px rgba(0,0,0,.55);
      display: none;
      align-items: center;
      gap: 10px;
      user-select:none;
    `;

    const dot = document.createElement("div");
    dot.style.cssText = `
      width:10px; height:10px; border-radius:999px;
      background: #2fe08a;
      box-shadow: 0 0 0 6px rgba(47,224,138,.14);
      animation: __sid_pulse 1.2s ease-in-out infinite;
    `;

    const text = document.createElement("div");
    text.innerHTML = `<div style="font-weight:900; letter-spacing:.2px">LIVE CAPTURE</div>
                      <div style="opacity:.65; font-weight:700; font-size:11px; margin-top:1px" id="__sid_badge_count">capturing…</div>`;

    el.appendChild(dot);
    el.appendChild(text);

    const style = document.createElement("style");
    style.textContent = `
      @keyframes __sid_pulse { 0%,100%{ transform:scale(1); opacity:.82 } 50%{ transform:scale(1.15); opacity:1 } }
    `;
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(el);
    return el;
  }

  function showBadge(on) {
    const el = ensureBadge();
    el.style.display = on ? "flex" : "none";
  }

  function setBadgeCount(n) {
    const el = document.getElementById("__sid_badge_count");
    if (el) el.textContent = `${n} urls captured`;
  }

  // ===== Live capture engine =====
  const LIVE_KEY = "__sid_live_capture_state__";
  function liveState() {
    if (!window[LIVE_KEY]) window[LIVE_KEY] = { on:false, obs:null, timer:null, lastSent:0, tabId:null, lastCount:0 };
    return window[LIVE_KEY];
  }

  async function sendCapturedBatch(tabId) {
    const urls = collectUrlsFast();
    if (!urls.length) return;
    const res = await chrome.runtime.sendMessage({ type: "CAPTURE_ADD", tabId, urls });
    const count = res?.count ?? urls.length;
    const st = liveState();
    st.lastCount = count;
    setBadgeCount(count);
  }

  function startLive(tabId) {
    const st = liveState();
    if (st.on) return;
    st.on = true;
    st.tabId = tabId;
    showBadge(true);

    st.obs = new MutationObserver(() => {
      const now = Date.now();
      if (now - st.lastSent < 650) return;
      st.lastSent = now;
      sendCapturedBatch(tabId).catch(() => {});
    });

    st.obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "style"]
    });

    st.timer = setInterval(() => {
      sendCapturedBatch(tabId).catch(() => {});
    }, 1500);

    sendCapturedBatch(tabId).catch(() => {});
  }

  function stopLive() {
    const st = liveState();
    st.on = false;
    st.tabId = null;
    if (st.obs) { try { st.obs.disconnect(); } catch {} }
    st.obs = null;
    if (st.timer) { try { clearInterval(st.timer); } catch {} }
    st.timer = null;
    showBadge(false);
  }

  // ===== Instagram Auto Fetch (open posts + swipe carousels) =====
  const AUTO_KEY = "__sid_auto_fetch_state__";
  function autoState(){
    if (!window[AUTO_KEY]) window[AUTO_KEY] = { running:false, stop:false };
    return window[AUTO_KEY];
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function isInstagram(){
    return location.hostname.includes("instagram.com");
  }

  function getProfilePostAnchors(){
    // Profile grid posts are usually /p/..., reels /reel/... (we still open because some reels have cover images)
    const as = Array.from(document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]'));
    return as.filter(a => a.querySelector("img"));
  }

  function dialogEl(){
    return document.querySelector('div[role="dialog"]');
  }

  function closeBtn(){
    const dlg = dialogEl();
    if (!dlg) return null;
    return dlg.querySelector('button[aria-label="Close"]')
      || dlg.querySelector('svg[aria-label="Close"]')?.closest('button')
      || document.querySelector('button[aria-label="Close"]');
  }

  function carouselNextBtn(){
    const dlg = dialogEl();
    if (!dlg) return null;
    const btn = dlg.querySelector('button[aria-label="Next"]');
    if (!btn || btn.disabled) return null;
    return btn;
  }

  async function waitForDialog(timeoutMs = 6500){
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs){
      const d = dialogEl();
      if (d) return d;
      await sleep(120);
    }
    return null;
  }

  async function harvestInstagramProfile({ tabId, maxPosts = 80, maxSlides = 30 } = {}){
    if (!isInstagram()) return;
    const st = autoState();
    if (st.running) return;
    st.running = true;
    st.stop = false;

    // Ensure live capture is ON for URL collection
    if (!liveState().on && tabId) startLive(tabId);

    // Collect post hrefs while scrolling
    const hrefs = new Set();
    let noNewRounds = 0;

    while (!st.stop && hrefs.size < maxPosts && noNewRounds < 10){
      const before = hrefs.size;
      for (const a of getProfilePostAnchors()){
        const href = a.getAttribute('href');
        if (href) hrefs.add(href);
      }

      // scroll to load more tiles
      window.scrollBy(0, Math.round(window.innerHeight * 0.9));
      await sleep(900);

      const after = hrefs.size;
      noNewRounds = (after === before) ? (noNewRounds + 1) : 0;
    }

    const list = Array.from(hrefs).slice(0, maxPosts);

    // Open each post (modal) and swipe carousel slides
    for (const href of list){
      if (st.stop) break;

      let a = document.querySelector(`a[href="${CSS.escape(href)}"]`);
      if (!a){
        window.scrollBy(0, Math.round(window.innerHeight * 0.6));
        await sleep(400);
        a = document.querySelector(`a[href="${CSS.escape(href)}"]`);
      }
      if (!a) continue;

      a.scrollIntoView({ block: 'center' });
      await sleep(180);
      a.click();

      const dlg = await waitForDialog(6500);
      if (!dlg){
        try { history.back(); } catch {}
        await sleep(900);
        continue;
      }

      // Let first slide load
      await sleep(700);
      if (tabId) await sendCapturedBatch(tabId).catch(()=>{});

      // Swipe through carousel if Next exists
      for (let i = 0; i < maxSlides && !st.stop; i++){
        const next = carouselNextBtn();
        if (!next) break;
        next.click();
        await sleep(650);
        if (tabId) await sendCapturedBatch(tabId).catch(()=>{});
      }

      // Close modal
      const c = closeBtn();
      if (c) c.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', code:'Escape', bubbles:true }));
      await sleep(520);
    }

    st.running = false;
    st.stop = false;
  }

  // ===== Verify captured URLs into preview items (>= MIN) =====
  function measureUrl(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = url;
    });
  }

  function dedupeItems(items) {
    const seen = new Set();
    const out = [];
    for (const it of items) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      out.push(it);
    }
    return out;
  }

  async function verifyCapturedStrict(urls, maxVerify = 260) {
    const unique = Array.from(new Set(urls)).slice(0, 3000);

    const domMap = new Map();
    document.querySelectorAll("img").forEach(img => {
      const url = toAbs(img.currentSrc || img.getAttribute("src"));
      if (!url) return;
      let w = img.naturalWidth || 0;
      let h = img.naturalHeight || 0;
      if (!w || !h) {
        const r = img.getBoundingClientRect();
        w = Math.round(r.width);
        h = Math.round(r.height);
      }
      if (w && h) domMap.set(url, { w, h });
    });

    const results = [];
    let verified = 0;

    for (const url of unique) {
      if (!looksLikeImage(url)) continue;

      const dom = domMap.get(url);
      if (dom) {
        if (dom.w >= MIN_W && dom.h >= MIN_H) {
          results.push({ url, w: dom.w, h: dom.h, mimeGuess: guessMime(url), source: "cap-dom" });
        }
        continue;
      }

      if (verified >= maxVerify) continue;
      verified++;

      const { w, h } = await measureUrl(url);
      if (w >= MIN_W && h >= MIN_H) {
        results.push({ url, w, h, mimeGuess: guessMime(url), source: "cap-verify" });
      }
    }

    return { items: dedupeItems(results) };
  }

  // ===== Messages =====
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const t = msg?.type;

    // Let popup detect if content script is already alive (prevents reinject)
    if (t === "PING") {
      sendResponse({ ok: true, loaded: true });
      return true;
    }

    if (t === "LIVE_START") {
      startLive(msg.tabId);
      sendResponse({ ok: true });
      return true;
    }

    if (t === "LIVE_STOP") {
      stopLive();
      sendResponse({ ok: true });
      return true;
    }

    if (t === "VERIFY_CAPTURED_URLS") {
      (async () => {
        const urls = Array.isArray(msg.urls) ? msg.urls : [];
        const res = await verifyCapturedStrict(urls, Number(msg.maxVerify ?? 260));
        sendResponse(res);
      })();
      return true;
    }

    if (t === "AUTO_FETCH_START") {
      (async () => {
        const tabId = msg.tabId;
        const maxPosts = Number(msg.maxPosts ?? 80);
        const maxSlides = Number(msg.maxSlides ?? 30);
        harvestInstagramProfile({ tabId, maxPosts, maxSlides }).catch(() => {});
        sendResponse({ ok: true, started: true });
      })();
      return true;
    }

    if (t === "AUTO_FETCH_STOP") {
      const st = autoState();
      st.stop = true;
      sendResponse({ ok: true, stopping: true });
      return true;
    }
  });
})();
