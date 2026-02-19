const listEl = document.getElementById("list");
const statusEl = document.getElementById("statusText");
const subtitleEl = document.getElementById("subtitle");

const siteNameEl = document.getElementById("siteName");
const siteDotEl = document.getElementById("siteDot");
const liveDotEl = document.getElementById("liveDot");
const capCountEl = document.getElementById("capCount");

const shownCountEl = document.getElementById("shownCount");
const selCountEl = document.getElementById("selCount");

const btnLiveToggle = document.getElementById("liveToggle");
const btnBuildPreview = document.getElementById("buildPreview");
const btnSelectAll = document.getElementById("selectAll");
const btnSelectNone = document.getElementById("selectNone");
const btnClearCaptured = document.getElementById("clearCaptured");
const btnDownloadSelected = document.getElementById("downloadSelected");
const btnDownloadAll = document.getElementById("downloadAll");

const toastEl = document.getElementById("toast");
let buildingPreview = false;
let stopPreview = false;

function dedupeAppend(allItems, newItems){
  const seen = new Set(allItems.map(x => x.url));
  for (const it of newItems){
    if (!it?.url) continue;
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    allItems.push(it);
  }
}


let tabCache = null;
let allItems = [];
let liveOn = false;
let pollTimer = null;

function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1200);
}

function setStatus(msg){ statusEl.textContent = msg; }

function normalizeSite(tabUrl){
  try{
    const host = new URL(tabUrl).hostname;
    if (host.includes("instagram.com")) return "Instagram";
    if (host.includes("facebook.com")) return "Facebook";
    return host.replace(/^www\./,"");
  }catch{ return "FB/IG"; }
}

async function getActiveTab(){
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  if (!tab?.id) throw new Error("No active tab.");
  return tab;
}

async function ensureContent(tabId){
  await chrome.scripting.executeScript({ target:{ tabId }, files:["content.js"] });
}

function renderSkeletons(){
  listEl.innerHTML = "";
  for (let i=0;i<15;i++){
    const sk = document.createElement("div");
    sk.className = "skeleton";
    listEl.appendChild(sk);
  }
  shownCountEl.textContent = "0";
  selCountEl.textContent = "0";
}

function updateCounts(){
  shownCountEl.textContent = String(allItems.length);
  const checks = listEl.querySelectorAll('input[type="checkbox"][data-idx]');
  let sel = 0;
  for (const cb of checks) if (cb.checked) sel++;
  selCountEl.textContent = String(sel);
}

function render(){
  listEl.innerHTML = "";

  if (!allItems.length){
    listEl.innerHTML = `<div style="opacity:.6; padding:16px; border:1px dashed rgba(255,255,255,.14); border-radius:16px; background:rgba(255,255,255,.02); text-align:center;">
      No preview yet.<br/>Press <b>Live ON</b>, scroll, then <b>Build Preview</b>.
    </div>`;
    updateCounts();
    return;
  }

  allItems.forEach((it, idx) => {
    const card = document.createElement("div");
    card.className = "card selected";
    card.style.setProperty("--i", idx);

    const glow = document.createElement("div");
    glow.className = "glow";

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

    const meta = document.createElement("div");
    meta.className = "meta";

    const b1 = document.createElement("div");
    b1.className = "badge";
    b1.textContent = it.mimeGuess ? it.mimeGuess.replace("image/","").toUpperCase() : "IMG";

    const b2 = document.createElement("div");
    b2.className = "badge";
    b2.textContent = (it.w && it.h) ? `${it.w}×${it.h}` : "—";

    meta.appendChild(b1);
    meta.appendChild(b2);

    wrap.appendChild(img);
    card.appendChild(glow);
    card.appendChild(cb);
    card.appendChild(wrap);
    card.appendChild(meta);

    card.addEventListener("click", (e) => {
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      card.classList.toggle("selected", cb.checked);
      updateCounts();
    });

    cb.addEventListener("change", () => {
      card.classList.toggle("selected", cb.checked);
      updateCounts();
    });

    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: it.url });
    });

    listEl.appendChild(card);
  });

  updateCounts();
}

function setAllSelection(state){
  const cards = listEl.querySelectorAll(".card");
  const checks = listEl.querySelectorAll('input[type="checkbox"][data-idx]');
  for (let i=0;i<checks.length;i++){
    checks[i].checked = state;
    cards[i]?.classList.toggle("selected", state);
  }
  updateCounts();
}

function getSelectedUrls(){
  const urls = [];
  const checks = listEl.querySelectorAll('input[type="checkbox"][data-idx]');
  for (const cb of checks){
    if (!cb.checked) continue;
    const idx = Number(cb.dataset.idx);
    const it = allItems[idx];
    if (it?.url) urls.push(it.url);
  }
  return urls;
}

function setLiveUi(on){
  liveOn = on;
  liveDotEl.classList.toggle("live", on);
  btnLiveToggle.textContent = on ? "Live OFF" : "Live ON";
  btnLiveToggle.classList.toggle("bad", on);
  btnLiveToggle.classList.toggle("good", !on);
}

async function pollCapturedCount(){
  if (!tabCache?.id) return;
  try{
    const cap = await chrome.runtime.sendMessage({ type:"CAPTURE_GET", tabId: tabCache.id });
    const n = (cap?.urls || []).length;
    capCountEl.textContent = String(n);
  }catch{}
}

function startPolling(){
  stopPolling();
  pollTimer = setInterval(pollCapturedCount, 1200);
  pollCapturedCount().catch(()=>{});
}
function stopPolling(){
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function liveToggle(){
  const tab = await getActiveTab();
  tabCache = tab;

  const site = normalizeSite(tab.url);
  siteNameEl.textContent = site;
  subtitleEl.textContent = `${site} • Live capture • JPG/PNG/WEBP • skip <400×400`;

  await ensureContent(tab.id);

  if (!liveOn){
    await chrome.tabs.sendMessage(tab.id, { type:"LIVE_START", tabId: tab.id });
    setLiveUi(true);
    setStatus("Live ON — scroll the page. Capturing in background…");
    toast("Live capture ON");
  } else {
    await chrome.tabs.sendMessage(tab.id, { type:"LIVE_STOP" });
    setLiveUi(false);
    setStatus("Live OFF.");
    toast("Live capture OFF");
  }

  startPolling();
}

async function buildPreview(){
  // Click again to stop (no new UI needed)
  if (buildingPreview){
    stopPreview = true;
    setStatus(`Stopping… (current: ${allItems.length})`);
    return;
  }

  buildingPreview = true;
  stopPreview = false;

  setStatus("Building preview… (progressive)");
  renderSkeletons?.(); // if you have it; safe if not
  allItems = [];
  render();

  const tab = await getActiveTab();
  tabCache = tab;

  const cap = await chrome.runtime.sendMessage({ type:"CAPTURE_GET", tabId: tab.id });
  const urls = cap?.urls || [];

  if (!urls.length){
    allItems = [];
    render();
    setStatus("No captured URLs yet. Turn Live ON and scroll first.");
    buildingPreview = false;
    return;
  }

  await ensureContent(tab.id);

  // Tune these:
  const batchSize = 260;  // how many urls processed per step
  const maxProbe  = 220;  // how many off-DOM size checks per step

  let start = 0;
  let total = urls.length;

  while (!stopPreview){
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: "VERIFY_CAPTURED_URLS_BATCH",
      urls,
      start,
      batchSize,
      maxProbe
    });

    total = res.total || total;

    dedupeAppend(allItems, res.items || []);
    render();

    start = res.nextStart ?? (start + batchSize);

    setStatus(`Preview: ${allItems.length} • Processed ${Math.min(start, total)}/${total}`);

    if (res.done) break;

    // small breathing room so popup stays smooth
    await new Promise(r => setTimeout(r, 40));
  }

  if (stopPreview){
    setStatus(`Stopped • Preview: ${allItems.length}`);
  } else {
    setStatus(`Done • Preview: ${allItems.length} images (>=400×400)`);
  }

  buildingPreview = false;
}


async function clearCaptured(){
  const tab = await getActiveTab();
  tabCache = tab;

  await chrome.runtime.sendMessage({ type:"CAPTURE_CLEAR", tabId: tab.id });
  capCountEl.textContent = "0";
  allItems = [];
  render();
  setStatus("Captured list cleared.");
  toast("Cleared");
}

async function download(urls){
  if (!urls.length){
    toast("Nothing selected");
    return;
  }
  const tab = tabCache || await getActiveTab();
  setStatus(`Starting ${urls.length} downloads…`);
  await chrome.runtime.sendMessage({ type:"DOWNLOAD_URLS", tabId: tab.id, urls });
  setStatus(`Started ${urls.length} downloads.`);
  toast(`Downloading ${urls.length}`);
}

async function init(){
  const tab = await getActiveTab();
  tabCache = tab;

  const site = normalizeSite(tab.url);
  siteNameEl.textContent = site;
  siteDotEl.style.background = "rgba(255,255,255,.22)";

  setLiveUi(false);
  render();
  startPolling();
}

btnLiveToggle.addEventListener("click", () => liveToggle().catch(e => setStatus("Error: " + (e?.message || e))));
btnBuildPreview.addEventListener("click", () => buildPreview().catch(e => setStatus("Error: " + (e?.message || e))));
btnSelectAll.addEventListener("click", () => setAllSelection(true));
btnSelectNone.addEventListener("click", () => setAllSelection(false));
btnClearCaptured.addEventListener("click", () => clearCaptured().catch(e => setStatus("Error: " + (e?.message || e))));
btnDownloadSelected.addEventListener("click", () => download(getSelectedUrls()).catch(e => setStatus("Error: " + (e?.message || e))));
btnDownloadAll.addEventListener("click", () => download(allItems.map(x => x.url)).catch(e => setStatus("Error: " + (e?.message || e))));

init().catch(e => setStatus("Error: " + (e?.message || e)));
