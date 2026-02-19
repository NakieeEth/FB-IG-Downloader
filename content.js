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

function countVisibleImageCandidates() {
  let count = 0;

  document.querySelectorAll("img").forEach(img => {
    const src = img.currentSrc || img.getAttribute("src");
    if (src) count++;
  });

  document.querySelectorAll("*").forEach(el => {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== "none" && bg.includes("url(")) count++;
  });

  return count;
}

async function smartScroll({
  stepPx = 950,
  delayMs = 700,
  maxScrolls = 120,
  settleRounds = 4
} = {}) {
  let noNewRounds = 0;
  let lastCount = countVisibleImageCandidates();

  for (let i = 0; i < maxScrolls; i++) {
    window.scrollBy({ top: stepPx, left: 0, behavior: "smooth" });
    await sleep(delayMs);
    await waitForImagesToSettle(2, 250);

    const now = countVisibleImageCandidates();
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

function collectFromImgs() {
  const items = [];

  document.querySelectorAll("img").forEach(img => {
    const url = toAbs(img.currentSrc || img.getAttribute("src"));
    if (!url || !looksLikeImage(url)) return;

    // Prefer natural size; if not loaded yet, fallback to rendered size
    let w = img.naturalWidth || 0;
    let h = img.naturalHeight || 0;
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

// Only for background images (optional; limited so it doesn't freeze)
function measureUrl(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = url;
  });
}

async function collectFromBackgrounds(maxToMeasure = 60) {
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
  const imgItems = collectFromImgs();
  const bgItems = await collectFromBackgrounds(60);
  const all = dedupeByUrl([...imgItems, ...bgItems]);
  return { items: all };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const t = msg?.type;

  if (t === "COLLECT_SOCIAL_IMAGES") {
    (async () => {
      await waitForImagesToSettle(3, 300);
      const res = await buildFilteredList();
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

      const res = await buildFilteredList();
      sendResponse(res);
    })();
    return true;
  }
});
