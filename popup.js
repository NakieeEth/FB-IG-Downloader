const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const btnRefresh = document.getElementById("refresh");
const btnSelectAll = document.getElementById("selectAll");
const btnSelectNone = document.getElementById("selectNone");
const btnDownloadSelected = document.getElementById("downloadSelected");
const btnDownloadAll = document.getElementById("downloadAll");

let items = []; // {url, w, h, mimeGuess}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function render() {
  listEl.innerHTML = "";
  if (!items.length) {
    listEl.innerHTML = `<div style="padding:10px; font-size:13px;">No images found (or all were filtered out). Try scrolling and Refresh.</div>`;
    return;
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const row = document.createElement("div");
    row.className = "item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.dataset.idx = String(i);

    const img = document.createElement("img");
    img.className = "thumb";
    img.src = it.url;

    const meta = document.createElement("div");
    meta.className = "meta";

    const dim = document.createElement("div");
    dim.className = "dim";
    dim.textContent = `${it.w}×${it.h}`;

    const url = document.createElement("div");
    url.className = "url";
    url.textContent = it.url;

    meta.appendChild(dim);
    meta.appendChild(url);

    row.appendChild(cb);
    row.appendChild(img);
    row.appendChild(meta);

    listEl.appendChild(row);
  }

  setStatus(`Found ${items.length} images (>=200x200, JPG/PNG/WEBP).`);
}

function getSelectedUrls() {
  const selected = [];
  const checks = listEl.querySelectorAll('input[type="checkbox"][data-idx]');
  for (const cb of checks) {
    if (cb.checked) {
      const idx = Number(cb.dataset.idx);
      if (items[idx]) selected.push(items[idx].url);
    }
  }
  return selected;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  return tab;
}

async function refresh() {
  try {
    setStatus("Scanning page…");
    listEl.innerHTML = `<div style="padding:10px; font-size:13px;">Scanning…</div>`;

    const tab = await getActiveTab();

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });

    const res = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_SOCIAL_IMAGES" });
    items = (res?.items || []);

    render();
  } catch (e) {
    setStatus("Error: " + (e?.message || e));
    listEl.innerHTML = `<div style="padding:10px; font-size:13px;">Error. Open FB/IG tab and try again.</div>`;
  }
}

btnRefresh.addEventListener("click", refresh);

btnSelectAll.addEventListener("click", () => {
  const checks = listEl.querySelectorAll('input[type="checkbox"][data-idx]');
  for (const cb of checks) cb.checked = true;
});

btnSelectNone.addEventListener("click", () => {
  const checks = listEl.querySelectorAll('input[type="checkbox"][data-idx]');
  for (const cb of checks) cb.checked = false;
});

btnDownloadSelected.addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    const urls = getSelectedUrls();
    if (!urls.length) return setStatus("Nothing selected.");

    setStatus(`Downloading ${urls.length} selected…`);
    await chrome.runtime.sendMessage({ type: "DOWNLOAD_URLS", tabId: tab.id, urls });
    setStatus(`Started ${urls.length} downloads.`);
  } catch (e) {
    setStatus("Error: " + (e?.message || e));
  }
});

btnDownloadAll.addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    if (!items.length) return setStatus("No images to download.");
    setStatus(`Downloading ${items.length} images…`);
    await chrome.runtime.sendMessage({ type: "DOWNLOAD_URLS", tabId: tab.id, urls: items.map(x => x.url) });
    setStatus(`Started ${items.length} downloads.`);
  } catch (e) {
    setStatus("Error: " + (e?.message || e));
  }
});

// auto scan when popup opens
refresh();

