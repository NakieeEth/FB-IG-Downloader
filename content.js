const MIN_W = 200;
const MIN_H = 200;

function toAbs(url) {
  try { return new URL(url, location.href).href; } catch { return null; }
}

function guessMime(url) {
  const u = (url || "").toLowerCase();
  if (u.includes(".jpg") || u.includes(".jpeg")) return "image/jpeg";
  if (u.includes(".png")) return "image/png";
  if (u.includes(".webp")) return "image/webp";
  return null; // FB/IG often no extension
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

function extractCssBackgroundImages() {
  const urls = [];
  const all = document.querySelectorAll("*");
  for (const el of all) {
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === "none") continue;
    const matches = bg.matchAll(/url\(["']?(.*?)["']?\)/g);
    for (const m of matches) {
      const abs = toAbs(m[1]);
      if (abs && looksLikeImage(abs)) urls.push(abs);
    }
  }
  return urls;
}

function collectFromImgs() {
  const items = [];

  document.querySelectorAll("img").forEach(img => {
    const url = toAbs(img.currentSrc || img.getAttribute("src"));
    if (!url || !looksLikeImage(url)) return;

    // Use already-known dimensions (NO re-fetch)
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;

    // Some images report 0 until loaded
    if (w >= MIN_W && h >= MIN_H) {
      items.push({ url, w, h, mimeGuess: guessMime(url), source: "img" });
    }
  });

  return items;
}

// Only for background images we may need to load to measure
async function measureUrl(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = url;
  });
}

async function collectFromBackgrounds(maxToMeasure = 80) {
  const bgUrls = Array.from(new Set(extractCssBackgroundImages()));
  const sliced = bgUrls.slice(0, maxToMeasure);

  const out = [];
  for (const url of sliced) {
    const { w, h } = await measureUrl(url);
    if (w >= MIN_W && h >= MIN_H) out.push({ url, w, h, mimeGuess: guessMime(url), source: "bg" });
  }
  return out;
}

function dedupeByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
  }
  return out;
}

async function buildFilteredList() {
  // Collect <img> first (stable & fast)
  const imgItems = collectFromImgs();

  // Background images (optional, slower)
  const bgItems = await collectFromBackgrounds(80);

  const all = dedupeByUrl([...imgItems, ...bgItems]);

  // Provide scan stats for UI
  return {
    items: all,
    stats: {
      fromImg: imgItems.length,
      fromBg: bgItems.length,
      total: all.length
    }
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "COLLECT_SOCIAL_IMAGES") {
    (async () => {
      const res = await buildFilteredList();
      sendResponse(res);
    })();
    return true;
  }
});
