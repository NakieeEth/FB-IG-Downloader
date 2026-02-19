const MIN_W = 200;
const MIN_H = 200;

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function toAbs(url) {
  try { return new URL(url, location.href).href; } catch { return null; }
}

function guessMime(url) {
  const u = (url || "").toLowerCase();
  if (u.includes(".jpg") || u.includes(".jpeg")) return "image/jpeg";
  if (u.includes(".png")) return "image/png";
  if (u.includes(".webp")) return "image/webp";
  return null; // many FB/IG URLs have no extension
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

function extractCssBackgroundUrlsFast(limit = 1200) {
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

async function waitForImagesToSettle(rounds = 3, gapMs = 300) {
  let stable = 0;
  let prevLoaded = -1;

  for (let i = 0; i < rounds * 8; i++) {
    const loaded = Array.from(document.images)
      .filter(im => im.complete && (im.naturalWidth || 0) > 0).length;

    if (loaded === prevLoaded) stable++;
    else stable = 0;

    prevLoaded = loaded;
    if (stable >= rounds) return;

    await sleep(gapMs);
  }
}

function countCandidatesFast() {
  let c = 0;
  document.querySelectorAll("img").forEach(img => {
    const src = img.currentSrc || img.getAttribute("src");
    if (src) c++;
  });
  // quick-ish background count
  document.querySelectorAll("*").forEach(el => {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== "none" && bg.includes("url(")) c++;
  });
  return c;
}

async function smartScroll({ stepPx=950, delayMs=700, maxScrolls=70, settleRounds=4 } = {}) {
  let noNewRounds = 0;
  let lastCount = countCandidatesFast();

  for (let i = 0; i < maxScrolls; i++) {
    window.scrollBy({ top: stepPx, left: 0, behavior: "smooth" });
    await sleep(delayMs);
    await waitForImagesToSettle(2, 250);

    const now = countCandidatesFast();
    if (now > lastCount + 2) {
      lastCount = now;
      noNewRounds = 0;
    } else {
      noNewRounds++;
      if (noNewRounds >= settleRounds) break;
    }
  }

  await waitForImagesToSettle(3, 300);
}

// ===== Normal scan (strict filter >=200x200) =====
function collectFromImgsStrict() {
  const items = [];
  document.querySelectorAll("img").forEach(img => {
    const url = toAbs(img.currentSrc || img.getAttribute("src"));
    if (!url || !looksLikeImage(url)) return;

    let w = img.naturalWidth || 0;
    let h = img.naturalHeight || 0;

    // fallback to rendered size if not loaded yet
    if (!w || !h) {
      const rect = img.getBoundingClientRect();
      w = Math.round(rect.width);
      h = Math.round(rect.height);
    }

    if (w >= MIN_W && h >= MIN_H) {
      items.push({ url, w, h, mimeGuess: guessMime(url), source: "img" });
    }
  });
  return items;
}

function measureUrl(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = url;
  });
}

async function collectFromBackgroundsStrict(maxToMeasure = 60) {
  const urls = Array.from(new Set(extractCssBackgroundUrlsFast(1200))).slice(0, maxToMeasure);
  const out = [];
  for (const url of urls) {
    const { w, h } = await measureUrl(url);
    if (w >= MIN_W && h >= MIN_H) out.push({ url, w, h, mimeGuess: guessMime(url), source: "bg" });
  }
  return out;
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

async function buildStrictList() {
  const imgItems = collectFromImgsStrict();
  const bgItems = await collectFromBackgroundsStrict(60);
  return { items: dedupeItems([...imgItems, ...bgItems]) };
}

// ===== Live capture engine =====
const LIVE_KEY = "__sid_live_capture_state__";

function liveState() {
  if (!window[LIVE_KEY]) window[LIVE_KEY] = { on: false, obs: null, timer: null, lastSent: 0 };
  return window[LIVE_KEY];
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

async function sendCapturedBatch(tabId) {
  const urls = collectUrlsFast();
  if (!urls.length) return;
  await chrome.runtime.sendMessage({ type: "CAPTURE_ADD", tabId, urls });
}

function startLive(tabId) {
  const st = liveState();
  if (st.on) return;

  st.on = true;

  // Watch DOM changes (FB/IG virtualize)
  st.obs = new MutationObserver(() => {
    const now = Date.now();
    // throttle bursty updates
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

  // Also poll periodically (backup)
  st.timer = setInterval(() => {
    sendCapturedBatch(tabId).catch(() => {});
  }, 1500);

  // initial push
  sendCapturedBatch(tabId).catch(() => {});
}

function stopLive() {
  const st = liveState();
  st.on = false;
  if (st.obs) { try { st.obs.disconnect(); } catch {} }
  st.obs = null;
  if (st.timer) { try { clearInterval(st.timer); } catch {} }
  st.timer = null;
}

// Verify captured URLs into strict list (>=200×200) using a capped measure pass.
// This makes preview more consistent for “captured” mode.
async function verifyCapturedStrict(urls, maxVerify = 220) {
  const unique = Array.from(new Set(urls)).slice(0, 3000);

  const results = [];
  let verified = 0;

  // fast path: if URL already exists in DOM <img>, use its size (no re-fetch)
  const domMap = new Map();
  document.querySelectorAll("img").forEach(img => {
    const url = toAbs(img.currentSrc || img.getAttribute("src"));
    if (!url) return;
    const w = img.naturalWidth || Math.round(img.getBoundingClientRect().width) || 0;
    const h = img.naturalHeight || Math.round(img.getBoundingClientRect().height) || 0;
    if (w && h) domMap.set(url, { w, h });
  });

  for (const url of unique) {
    if (!looksLikeImage(url)) continue;

    const dom = domMap.get(url);
    if (dom) {
      if (dom.w >= MIN_W && dom.h >= MIN_H) {
        results.push({ url, w: dom.w, h: dom.h, mimeGuess: guessMime(url), source: "cap-dom" });
      }
      continue;
    }

    // limited verification by loading
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

  if (t === "LIVE_START") {
    const tabId = msg.tabId;
    startLive(tabId);
    sendResponse({ ok: true });
    return true;
  }

  if (t === "LIVE_STOP") {
    stopLive();
    sendResponse({ ok: true });
    return true;
  }

  if (t === "COLLECT_SOCIAL_IMAGES") {
    (async () => {
      await waitForImagesToSettle(3, 300);
      const res = await buildStrictList();
      sendResponse(res);
    })();
    return true;
  }

  if (t === "SMART_SCROLL_AND_COLLECT") {
    (async () => {
      await smartScroll({
        stepPx: Number(msg.stepPx ?? 950),
        delayMs: Number(msg.delayMs ?? 700),
        maxScrolls: Number(msg.maxScrolls ?? 70),
        settleRounds: Number(msg.settleRounds ?? 4)
      });

      const res = await buildStrictList();
      sendResponse(res);
    })();
    return true;
  }

  // Build preview list from already captured URLs (strict verification)
  if (t === "VERIFY_CAPTURED_URLS") {
    (async () => {
      const urls = Array.isArray(msg.urls) ? msg.urls : [];
      const res = await verifyCapturedStrict(urls, Number(msg.maxVerify ?? 220));
      sendResponse(res);
    })();
    return true;
  }
});
