async function getCaptured(tabId) {
  const key = `cap_${tabId}`;
  const data = await chrome.storage.local.get(key);
  return new Set(data[key] || []);
}

async function setCaptured(tabId, set) {
  const key = `cap_${tabId}`;
  await chrome.storage.local.set({ [key]: Array.from(set) });
}

async function addCaptured(tabId, urls) {
  const set = await getCaptured(tabId);
  for (const u of urls) set.add(u);
  await setCaptured(tabId, set);
  return set.size;
}

async function clearCaptured(tabId) {
  const key = `cap_${tabId}`;
  await chrome.storage.local.remove(key);
}

function sanitize(name) {
  return (name || "images")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function inferFolderFromTitle(url, title) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  let base = title || "images";

  if (host.includes("facebook.com")) {
    base = base.replace(/\s*\|\s*Facebook\s*$/i, "");
    base = base.replace(/\s*-\s*Home\s*$/i, "");
    base = base.trim() || "Facebook";
  }

  if (host.includes("instagram.com")) {
    base = base.replace(/\s*•\s*Instagram.*$/i, "").trim() || "Instagram";
  }

  return sanitize(base);
}

function guessExt(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    if (p.includes(".jpeg") || p.includes(".jpg")) return "jpg";
    if (p.includes(".png")) return "png";
    if (p.includes(".webp")) return "webp";
  } catch {}
  return "jpg";
}

const MAX_FILES_PER_CLICK = 200; // safety cap
const GAP_MS = 160;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const t = msg?.type;

    if (t === "CAPTURE_ADD") {
      const tabId = msg.tabId;
      const urls = Array.isArray(msg.urls) ? msg.urls : [];
      const size = await addCaptured(tabId, urls);
      sendResponse({ ok: true, count: size });
      return;
    }

    if (t === "CAPTURE_GET") {
      const tabId = msg.tabId;
      const set = await getCaptured(tabId);
      sendResponse({ ok: true, urls: Array.from(set) });
      return;
    }

    if (t === "CAPTURE_CLEAR") {
      await clearCaptured(msg.tabId);
      sendResponse({ ok: true });
      return;
    }

    if (t === "DOWNLOAD_URLS") {
      const raw = Array.isArray(msg.urls) ? msg.urls : [];
      const urls = Array.from(new Set(raw)).slice(0, MAX_FILES_PER_CLICK);

      const tab = await chrome.tabs.get(msg.tabId);
      const folder = inferFolderFromTitle(tab.url, tab.title);

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const ext = guessExt(url);
        const filename = `${folder}/img_${String(i + 1).padStart(4, "0")}.${ext}`;

        try {
          chrome.downloads.download({
            url,
            filename,
            conflictAction: "uniquify",
            saveAs: false
          });
        } catch {}

        await sleep(GAP_MS);
      }

      sendResponse({
        ok: true,
        count: urls.length,
        capped: raw.length > urls.length,
        cap: MAX_FILES_PER_CLICK,
        folder
      });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message" });
  })().catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));

  return true;
});

