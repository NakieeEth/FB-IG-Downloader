const listEl = document.getElementById("list");
const searchEl = document.getElementById("search");
const statusTextEl = document.getElementById("statusText");
const countPillEl = document.getElementById("countPill");
const selPillEl = document.getElementById("selPill");
const siteChipEl = document.getElementById("siteChip");
const subtitleEl = document.getElementById("subtitle");

const btnLiveStart = document.getElementById("liveStart");
const btnLiveStop = document.getElementById("liveStop");
const btnCapturedPreview = document.getElementById("capturedPreview");
const btnCapturedClear = document.getElementById("capturedClear");

const btnSelectAll = document.getElementById("selectAll");
const btnSelectNone = document.getElementById("selectNone");
const btnDownloadSelected = document.getElementById("downloadSelected");
const btnDownloadAll = document.getElementById("downloadAll");
const btnDownloadSelected2 = document.getElementById("downloadSelected2");
const btnDownloadAll2 = document.getElementById("downloadAll2");

let allItems = [];
let viewItems = [];
let tabCache = null;

function setStatus(msg){ statusTextEl.textContent = msg; }
function setCount(n){ countPillEl.textContent = String(n); }
function setSelectedCount(n){ selPillEl.textContent = String(n); }

function normalizeSite(tabUrl){
  try{
    const host = new URL(tabUrl).hostname;
    if (host.includes("instagram.com")) return "Instagram";
    if (host.includes("facebook.com")) return "Facebook";
    return host.replace(/^www\./,"");
  }catch{ return "FB/IG"; }
}

function renderSkeletons(){
  listEl.className = "grid";
  listEl.innerHTML = "";
  for (let i = 0; i < 15; i++){
    const sk = document.createElement("div");
    sk.className = "skeleton";
    listEl.appendChild(sk);
  }
  setCount(0);
  setSelectedCount(0);
}

function renderEmpty(msg){
  listEl.className = "";
  listEl.innerHTML = `<div class="empty">${msg}</div>`;
  setCount(0);
  setSelectedCount(0);
}

function updateSelectedCount(){
  const checks = listEl.querySelectorAll('input[type="checkbox"][data-idx]');
  let c = 0;
  for (const cb of checks) if (cb.checked) c++;
  setSelectedCount(c);
}

function render(){
  listEl.innerHTML = "";

  if (!viewItems.length){
    return renderEmpty("No preview yet. Use Live ON and scroll, then Build Preview (Captured).");
  }

  listEl.className = "grid";
  setCount(viewItems.length);

  viewItems.forEach((it, idx) => {
    const card = document.createElement("div");
    card.className = "card selected";
    card.style.setProperty("--i", idx);

    const glow = document.createElement("div");
    glow.className = "selGlow";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "check";
    cb.checked = true;
    cb.dataset.idx = String(idx);

    const wrap = document.createElement("div");
    wrap.className = "thumbWrap";

    const img = document.createElement("img");
    img.className = "thumb";
    img.loading = "lazy";
    img.src = it.url;

    const overlay = document.createElement("div");
    overlay.className = "overlay";

    const meta = document.createElement("div");
    meta.className = "meta";

    const badgeL = document.createElement("div");
    badgeL.className = "badge";
    badgeL.textContent = it.mimeGuess ? it.mimeGuess.replace("image/","").toUpperCase() : "IMG";

    const badgeR = document.createElement("div");
    badgeR.className = "badge";
    badgeR.textContent = (it.w && it.h) ? `${it.w}×${it.h}` : "—";

    meta.appendChild(badgeL);
    meta.appendChild(badgeR);

    wrap.appendChild(img);

    card.appendChild(glow);
    card.appendChild(cb);
    card.appendChild(wrap);
    card.appendChild(overlay);
    card.appendChild(meta);

    card.addEventListener("click", (e) => {
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      card.classList.toggle("selected", cb.checked);
      updateSelectedCount();
    });

    cb.addEventListener("change", () => {
      card.classList.toggle("selected", cb.checked);
      updateSelectedCount();
    });

    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: it.url });
    });

    listEl.appendChild(card);
  });

  updateSelectedCount();
}

function applyFilter(){
  const q = (searchEl.value || "").trim().toLowerCase();
  if (!q) viewItems = allItems.slice();
  else viewItems = allItems.filter(it => (it.url || "").toLowerCase().includes(q));
  render();
}

function getSelectedUrls(){
  const urls = [];
  const checks = listEl.querySelectorAll('input[type="checkbox"][data-idx]');
  for (const cb of checks){
    if (!cb.checked) continue;
    const idx = Number(cb.dataset.idx);
    const it = viewItems[idx];
    if (it?.url) urls.push(it.url);
  }
  return urls;
}

async function getActiveTab(){
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  if (!tab?.id) throw new Error("No active tab found.");
  return tab;
}

async function ensureContent(tabId){
  await chrome.scripting.executeScript({ target:{ tabId }, files:["content.js"] });
}

async function liveStart(){
  const tab = await getActiveTab();
  tabCache = tab;

  const site = normalizeSite(tab.url);
  siteChipEl.innerHTML = `<strong>${site}</strong>`;
  subtitleEl.textContent = `${site} • Live capture • JPG/PNG/WEBP • skip <200×200`;

  await ensureContent(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type:"LIVE_START", tabId: tab.id });

  setStatus("Live ON — scroll the page, I’m capturing URLs…");
}

async function liveStop(){
  const tab = await getActiveTab();
  tabCache = tab;

  await ensureContent(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type:"LIVE_STOP" });

  setStatus("Live OFF.");
}

async function buildPreviewFromCaptured(){
  setStatus("Loading captured URLs…");
  renderSkeletons();

  const tab = await getActiveTab();
  tabCache = tab;

  const site = normalizeSite(tab.url);
  siteChipEl.innerHTML = `<strong>${site}</strong>`;
  subtitleEl.textContent = `${site} • Captured URLs • verifying >=200×200…`;

  const cap = await chrome.runtime.sendMessage({ type:"CAPTURE_GET", tabId: tab.id });
  const urls = cap?.urls || [];

  if (!urls.length) {
    renderEmpty("No captured URLs yet. Press Live ON and scroll first.");
    setStatus("No captured URLs.");
    return;
  }

  await ensureContent(tab.id);

  const res = await chrome.tabs.sendMessage(tab.id, {
    type: "VERIFY_CAPTURED_URLS",
    urls,
    maxVerify: 220
  });

  allItems = (res?.items || []);
  applyFilter();

  setStatus(`Ready — ${allItems.length} images (captured).`);
}

async function clearCaptured(){
  const tab = await getActiveTab();
  tabCache = tab;

  await chrome.runtime.sendMessage({ type:"CAPTURE_CLEAR", tabId: tab.id });
  allItems = [];
  viewItems = [];
  renderEmpty("Captured list cleared. Press Live ON and scroll.");
  setStatus("Captured list cleared.");
}

function setAllSelection(state){
  const cards = listEl.querySelectorAll(".card");
  const checks = listEl.querySelectorAll('input[type="checkbox"][data-idx]');
  for (let i=0;i<checks.length;i++){
    checks[i].checked = state;
    cards[i]?.classList.toggle("selected", state);
  }
  updateSelectedCount();
}

async function download(urls){
  if (!urls.length) return setStatus("Nothing selected.");
  const tab = tabCache || await getActiveTab();
  setStatus(`Starting ${urls.length} downloads…`);
  await chrome.runtime.sendMessage({ type:"DOWNLOAD_URLS", tabId: tab.id, urls });
  setStatus(`Started ${urls.length} downloads.`);
}

// Buttons
btnLiveStart.addEventListener("click", () => liveStart().catch(e => setStatus("Error: " + (e?.message || e))));
btnLiveStop.addEventListener("click", () => liveStop().catch(e => setStatus("Error: " + (e?.message || e))));
btnCapturedPreview.addEventListener("click", () => buildPreviewFromCaptured().catch(e => setStatus("Error: " + (e?.message || e))));
btnCapturedClear.addEventListener("click", () => clearCaptured().catch(e => setStatus("Error: " + (e?.message || e))));

btnSelectAll.addEventListener("click", () => setAllSelection(true));
btnSelectNone.addEventListener("click", () => setAllSelection(false));

btnDownloadSelected.addEventListener("click", () => download(getSelectedUrls()).catch(e => setStatus("Error: " + (e?.message || e))));
btnDownloadSelected2.addEventListener("click", () => download(getSelectedUrls()).catch(e => setStatus("Error: " + (e?.message || e))));
btnDownloadAll.addEventListener("click", () => download(allItems.map(x=>x.url)).catch(e => setStatus("Error: " + (e?.message || e))));
btnDownloadAll2.addEventListener("click", () => download(allItems.map(x=>x.url)).catch(e => setStatus("Error: " + (e?.message || e))));

searchEl.addEventListener("input", () => applyFilter());

// Start with an empty state (no auto scan)
renderEmpty("Press Live ON and scroll, then Build Preview (Captured).");
setStatus("Live mode ready. Press Live ON and scroll.");
