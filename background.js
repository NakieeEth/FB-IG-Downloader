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
    base = base.trim();
    if (!base) base = "Facebook";
  }

  if (host.includes("instagram.com")) {
    base = base.replace(/\s*•\s*Instagram.*$/i, "").trim();
    if (!base) base = "Instagram";
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
  return "jpg"; // FB/IG often no extension
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "DOWNLOAD_URLS") return;

  (async () => {
    const urls = msg.urls || [];
    const tab = await chrome.tabs.get(msg.tabId);
    const folder = inferFolderFromTitle(tab.url, tab.title);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const ext = guessExt(url);
      const filename = `${folder}/img_${String(i + 1).padStart(4, "0")}.${ext}`;

      chrome.downloads.download({
        url,
        filename,
        conflictAction: "uniquify",
        saveAs: false
      });
    }

    sendResponse({ ok: true, count: urls.length, folder });
  })();

  return true;
});
