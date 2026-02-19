(() => {
  // Prevent multiple injections
  if (window.__SID_CONTENT_LOADED__) return;
  window.__SID_CONTENT_LOADED__ = true;

  // ✅ UPDATED SIZE FILTER
  const MIN_W = 300;
  const MIN_H = 300;

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

  async function verifyCapturedStrict(urls, maxVerify = 1000) {
    const unique = Array.from(new Set(urls)).slice(0, 5000);

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
          results.push({ url, w: dom.w, h: dom.h, mimeGuess: guessMime(url) });
        }
        continue;
      }

      if (verified >= maxVerify) continue;
      verified++;

      const { w, h } = await measureUrl(url);
      if (w >= MIN_W && h >= MIN_H) {
        results.push({ url, w, h, mimeGuess: guessMime(url) });
      }
    }

    return { items: dedupeItems(results) };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const t = msg?.type;

    if (t === "PING") {
      sendResponse({ ok: true });
      return true;
    }

    if (t === "VERIFY_CAPTURED_URLS") {
      (async () => {
        const urls = Array.isArray(msg.urls) ? msg.urls : [];
        const res = await verifyCapturedStrict(urls, Number(msg.maxVerify ?? 1000));
        sendResponse(res);
      })();
      return true;
    }
  });
})();
