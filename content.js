const MIN_W = 200;
const MIN_H = 200;

function toAbs(url) {
  try { return new URL(url, location.href).href; } catch { return null; }
}

function guessMime(url) {
  const u = url.toLowerCase();
  if (u.includes(".jpg") || u.includes(".jpeg")) return "image/jpeg";
  if (u.includes(".png")) return "image/png";
  if (u.includes(".webp")) return "image/webp";
  return null;
}

function isAllowed(url) {
  const u = url.toLowerCase();
  // Many FB/IG URLs don't end with extension; still allow if looks like image CDN path:
  // We'll accept if it contains typical image hints OR a known extension.
  const hasExt = u.includes(".jpg") || u.includes(".jpeg") || u.includes(".png") || u.includes(".webp");
  const looksLikeImage =
    u.includes("/image") || u.includes("fbcdn") || u.includes("cdninstagram") || u.includes("scontent") || u.includes("igcdn");

  // Reject obvious non-image formats
  if (u.includes(".gif") || u.includes(".svg") || u.includes(".mp4") || u.includes(".webm")) return false;

  return hasExt || looksLikeImage;
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
      if (abs) urls.push(abs);
    }
  }
  return urls;
}

function collectCandidateUrls() {
  const urls = [];

  // <img> tags
  document.querySelectorAll("img").forEach(img => {
    const c = img.currentSrc || img.getAttribute("src");
    if (c) {
      const abs = toAbs(c);
      if (abs) urls.push(abs);
    }
  });

  // CSS background images (FB sometimes uses background-image in thumbnails)
  extractCssBackgroundImages().forEach(u => urls.push(u));

  // Dedupe early
  return Array.from(new Set(urls)).filter(u => isAllowed(u));
}

async function getImageSize(url) {
  // Create an <img> to measure size
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = "no-referrer"; // helps some CDNs
    img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = url;
  });
}

async function buildFilteredList() {
  const candidates = collectCandidateUrls();

  // Limit to prevent freezing on huge pages
  const LIMIT = 250;
  const sliced = candidates.slice(0, LIMIT);

  const out = [];
  for (const url of sliced) {
    const { w, h } = await getImageSize(url);
    if (w >= MIN_W && h >= MIN_H) {
      // Only keep jpg/png/webp if we can guess; but FB/IG URLs may not include extension.
      // We'll keep if allowed + size, and downloads will still work.
      const mimeGuess = guessMime(url);
      // If user wants strict formats only, enforce here:
      const strictOk = mimeGuess ? true : true; // keep true for FB/IG non-ext URLs
      if (strictOk) out.push({ url, w, h, mimeGuess });
    }
  }

  // Final dedupe
  const seen = new Set();
  const unique = [];
  for (const it of out) {
    if (!seen.has(it.url)) {
      seen.add(it.url);
      unique.push(it);
    }
  }
  return unique;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "COLLECT_SOCIAL_IMAGES") {
    (async () => {
      const items = await buildFilteredList();
      sendResponse({ items });
    })();
    return true;
  }
});

