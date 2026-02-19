(() => {
  if (window.__SID_CONTENT_LOADED__) return;
  window.__SID_CONTENT_LOADED__ = true;

  var MIN_W = 400;
  var MIN_H = 400;

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

  // ===== Floating LIVE badge =====
  const BADGE_ID = "__sid_live_badge__";
  function ensureBadge() {
    let el = document.getElementById(BADGE_ID);
    if (el) return el;

    el = document.createElement("div");
    el.id = BADGE_ID;
    el.style.cssText = `
      position: fixed; right: 14px; bottom: 14px; z-index: 2147483647;
      padding: 10px 12px; border-radius: 14px;
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(0,0,0,.35);
      backdrop-filter: blur(12px);
      color: rgba(255,255,255,.92);
      font: 600 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
      box-shadow: 0 20px 60px rgba(0,0,0,.55);
      display: none; align-items: center; gap: 10px; user-select:none;
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
    style.textContent = `@keyframes __sid_pulse { 0%,100%{ transform:scale(1); opacity:.82 } 50%{ transform:scale(1.15); opacity:1 } }`;
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(el);
    return el;
  }
  function showBadge(on) { ensureBadge().style.display = on ? "flex" : "none"; }
  function setBadgeCount(n) {
    const el = document.getElementById("__sid_badge_count");
    if (el) el.textContent = `${n} urls captured`;
  }

  // ===== Live capture engine =====
  const LIVE_KEY = "__sid_live_capture_state__";
  function liveState() {
    if (!window[LIVE_KEY]) window[LIVE_KEY] = { on:false, obs:null, timer:null, lastSent:0, tabId:null };
    return window[LIVE_KEY];
  }

  async function sendCapturedBatch(tabId) {
    const urls = collectUrlsFast();
    if (!urls.length) return;
    const res = await chrome.runtime.sendMessage({ type: "CAPTURE_ADD", tabId, urls });
    setBadgeCount(res?.count ?? urls.length);
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

  // ===== Progressive batch verification =====
  function measureUrl(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = url;
    });
  }

  function buildDomMap() {
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
    return domMap;
  }

  async function verifyBatch({ urls, start, batchSize, maxProbe }) {
    const unique = Array.from(new Set(urls));
    const end = Math.min(start + batchSize, unique.length);
    const slice = unique.slice(start, end);

    const domMap = buildDomMap();
    const results = [];
    let probed = 0;

    for (const url of slice) {
      if (!looksLikeImage(url)) continue;

      const dom = domMap.get(url);
      if (dom) {
        if (dom.w >= MIN_W && dom.h >= MIN_H) {
          results.push({ url, w: dom.w, h: dom.h, mimeGuess: guessMime(url), source: "cap-dom" });
        }
        continue;
      }

      if (probed >= maxProbe) continue;
      probed++;

      const { w, h } = await measureUrl(url);
      if (w >= MIN_W && h >= MIN_H) {
        results.push({ url, w, h, mimeGuess: guessMime(url), source: "cap-verify" });
      }
    }

    return {
      items: results,
      nextStart: end,
      done: end >= unique.length,
      total: unique.length
    };
  }

  // ===== Messages =====
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const t = msg?.type;

    if (t === "PING_SID") {
      sendResponse({ ok: true });
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

    if (t === "VERIFY_CAPTURED_URLS_BATCH") {
      (async () => {
        const urls = Array.isArray(msg.urls) ? msg.urls : [];
        const start = Number(msg.start ?? 0);
        const batchSize = Number(msg.batchSize ?? 260);
        const maxProbe = Number(msg.maxProbe ?? 220);
        const res = await verifyBatch({ urls, start, batchSize, maxProbe });
        sendResponse(res);
      })();
      return true;
    }
  });

})();
