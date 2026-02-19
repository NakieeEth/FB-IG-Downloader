const listEl = document.getElementById("list");
const searchEl = document.getElementById("search");
const statusTextEl = document.getElementById("statusText");
const countPillEl = document.getElementById("countPill");
const domainPillEl = document.getElementById("domainPill");

const btnRefresh = document.getElementById("refresh");
const btnSelectAll = document.getElementById("selectAll");
const btnSelectNone = document.getElementById("selectNone");
const btnDownloadSelected = document.getElementById("downloadSelected");
const btnDownloadAll = document.getElementById("downloadAll");

let allItems = [];     // full set from scan
let viewItems = [];    // after search filter

function setStatus(msg) { statusTextEl.textContent = msg; }
function setCount(n) { countPillEl.textContent = String(n); }

function getSelectedUrls() {
  const selected = [];
  const checks = listEl.querySelectorAll('input[type="checkbox"][data-idx]');
  for (const cb of checks) {
    if (cb.checked) {
      const idx = Number(cb.dataset.idx);
      const it = viewItems[idx];
      if (it?.url) selected.push(it.url);
    }
  }
  return selected;
}

function render() {
  listEl.innerHTML = "";

  if (!viewItems.length) {
    listEl.className = "";
    listEl.innerHTML = `
      <div class="empty">
        No images found (or all filtered out).<br/>
        Try scrolling the page and press <b>Refresh</b>.
      </div>`;
    setCount(0);
    return;
  }

  listEl.className = "grid";
  setCount(viewItems.length);

  viewItems.forEach((it, idx) => {
    const card = document.createElement("div");
    card.className = "card";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "chk";
    cb.checked = true;
    cb.dataset.idx = String(idx);

    const wrap = document.createElement("div");
    wrap.className = "thumbWrap";

    const img = document.createElement("img");
    img.className = "thumb";
    img.src = it.url;

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = `${it.w}×${it.h}`;

    wrap.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "meta";

    const dim = document.createElement("div");
    dim.className = "dim";
    dim.textContent = it.mimeGuess ? it.mimeGuess.replace("image/", "").toUpperCase() : "IMG";

    meta.appendChild(dim);

    card.appendChild(cb);
    card.appendChild(wrap);
    card.appendChild(badge);
    card.appendChild(meta);

    // Click card to toggle selection
    card.addEventListener("click", (e) => {
      if (e.target.tagName.toLowerCase() === "input") return;
      cb.checked = !cb.checked;
    });

    listEl.appendChild(card);
  });
}

function applyFilter() {
  const q = (searchEl.value || "").trim().toLowerCase();
  if (!q) {
    viewItems = allItems.slice();
  } else {
    viewItems = allItems.filter(it => (it.url || "").toLowerCase().includes(q));
  }
  render();
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  return tab;
}

async function refresh() {
  setStatus("Scanning…");
  listEl.innerHTML = `<div class="empty">Scanning…</div>`;
  setCount(0);

  const tab = await getActiveTab();

  // Update domain pill
  try {
    const host = new URL(tab.url).hostname;
    domainPillEl.textContent = host.includes("instagram") ? "Instagram" : "Facebook";
  } catch {
    domainPillEl.textContent = "FB/IG";
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"]
  });

  const res = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_SOCIAL_IMAGES" });
  allItems = (res?.items || []);
  applyFilter();

  setStatus(`Ready — ${allItems.length} images.`);
}

btnRefresh.addEventListener("click", () => refresh().catch(e => setStatus("Error: " + (e?.message || e))));

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
    if (!allItems.length) return setStatus("No images.");
    setStatus(`Downloading ${allItems.length}…`);
    await chrome.runtime.sendMessage({ type: "DOWNLOAD_URLS", tabId: tab.id, urls: allItems.map(x => x.url) });
    setStatus(`Started ${allItems.length} downloads.`);
  } catch (e) {
    setStatus("Error: " + (e?.message || e));
  }
});

searchEl.addEventListener("input", () => applyFilter());

// auto scan on open
refresh().catch(e => setStatus("Error: " + (e?.message || e)));
