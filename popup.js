const listEl = document.getElementById("list");
const statusEl = document.getElementById("statusText");
const subtitleEl = document.getElementById("subtitle");

const siteNameEl = document.getElementById("siteName");
const siteDotEl = document.getElementById("siteDot");
const liveDotEl = document.getElementById("liveDot");
const capCountEl = document.getElementById("capCount");

const modeToggleBtn = document.getElementById("modeToggle");
const modeLabelEl = document.getElementById("modeLabel");

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

let tabCache = null;
let allItems = [];
let liveOn = false;
let pollTimer = null;

// Download mode: "auto" (default), "zip", "files"
const MODE_KEY = "sid_dl_mode";
const MODES = ["auto", "zip", "files"];
const ZIP_THRESHOLD = 50; // ✅ auto-switch to ZIP when >= 50
let dlMode = "auto";

function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1200);
}
function setStatus(msg){ statusEl.textContent = msg; }

function modeLabel(m){
  if (m === "zip") return "Mode: ZIP";
  if (m === "files") return "Mode: Files";
  return "Mode: Auto";
}

async function loadMode(){
  try{
    const data = await chrome.storage.local.get(MODE_KEY);
    const m = data?.[MODE_KEY];
    dlMode = MODES.includes(m) ? m : "auto";
  }catch{ dlMode = "auto"; }
  if (modeLabelEl) modeLabelEl.textContent = modeLabel(dlMode);
}

async function cycleMode(){
  const i = MODES.indexOf(dlMode);
  dlMode = MODES[(i + 1 + MODES.length) % MODES.length] || "auto";
  try{ await chrome.storage.local.set({ [MODE_KEY]: dlMode }); }catch{}
  if (modeLabelEl) modeLabelEl.textContent = modeLabel(dlMode);
  toast(modeLabel(dlMode).replace("Mode: ", ""));
}

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

// Smart ensure: ping first, inject only if missing
async function ensureContent(tabId){
  try{
    const res = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (res?.ok) return;
  }catch{}
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
  const tab = await getActiveTab();
  tabCache = tab;

  const site = normalizeSite(tab.url);
  siteNameEl.textContent = site;

  setStatus("Building preview from captured URLs…");
  renderSkeletons();

  const cap = await chrome.runtime.sendMessage({ type:"CAPTURE_GET", tabId: tab.id });
  const urls = cap?.urls || [];
  capCountEl.textContent = String(urls.length);

  if (!urls.length){
    allItems = [];
    render();
    setStatus("No captured URLs yet. Turn Live ON and scroll first.");
    toast("No captured URLs");
    return;
  }

  await ensureContent(tab.id);

  const res = await chrome.tabs.sendMessage(tab.id, {
    type: "VERIFY_CAPTURED_URLS",
    urls,
    maxVerify: 1000
  });

  allItems = (res?.items || []);
  render();
  setStatus(`Ready — ${allItems.length} images (>=400×400).`);
  toast(`Preview: ${allItems.length}`);
}

async function clearCaptured(){
  const tab = await getActiveTab();
  tabCache = tab;

  // stop live first so it doesn't instantly re-add URLs
  try{
    await ensureContent(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type:"LIVE_STOP" });
  }catch{}
  setLiveUi(false);

  await chrome.runtime.sendMessage({ type:"CAPTURE_CLEAR", tabId: tab.id });
  capCountEl.textContent = "0";
  allItems = [];
  render();
  setStatus("Captured list cleared.");
  toast("Cleared");
}

/* =========================
   ZIP builder in POPUP
   ========================= */

function u16(n){ const a=new Uint8Array(2); a[0]=n&255; a[1]=(n>>>8)&255; return a; }
function u32(n){ const a=new Uint8Array(4); a[0]=n&255; a[1]=(n>>>8)&255; a[2]=(n>>>16)&255; a[3]=(n>>>24)&255; return a; }

function concatBytes(parts){
  let total=0; for(const p of parts) total+=p.byteLength;
  const out=new Uint8Array(total);
  let off=0;
  for(const p of parts){ out.set(p, off); off+=p.byteLength; }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i=0;i<256;i++){
    let c=i;
    for(let k=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
    table[i]=c>>>0;
  }
  return table;
})();

function crc32(buf){
  let c=0xffffffff;
  for(let i=0;i<buf.length;i++) c = CRC_TABLE[(c^buf[i])&255] ^ (c>>>8);
  return (c^0xffffffff)>>>0;
}

function encodeUtf8(s){ return new TextEncoder().encode(s); }

function dosTimeDate(date=new Date()){
  const d=date;
  const time=((d.getHours()&31)<<11)|((d.getMinutes()&63)<<5)|((Math.floor(d.getSeconds()/2)&31));
  const year=d.getFullYear();
  const datePart=(((year-1980)&127)<<9)|(((d.getMonth()+1)&15)<<5)|(d.getDate()&31);
  return { time, date: datePart };
}

function sanitizeName(name) {
  return (name || "images")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
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

async function fetchAsBytes(url){
  const res = await fetch(url, { credentials:"omit", cache:"no-store" });
  if(!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

async function buildZipFromUrls(urls, folderName){
  const unique = Array.from(new Set(urls));
  const folder = sanitizeName(folderName);

  const files = [];
  for (let i=0;i<unique.length;i++){
    const url = unique[i];
    const ext = guessExt(url);
    const name = `${folder}/img_${String(i+1).padStart(4,"0")}.${ext}`;
    const data = await fetchAsBytes(url);
    files.push({ name, data });

    // Yield a bit to keep UI responsive
    if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
  }

  const now = dosTimeDate(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for(const f of files){
    const nameBytes = encodeUtf8(f.name);
    const crc = crc32(f.data);
    const size = f.data.byteLength;

    const localHeader = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),              // STORE (no compression)
      u16(now.time),
      u16(now.date),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.byteLength),
      u16(0),
      nameBytes
    ]);

    localParts.push(localHeader);
    localParts.push(f.data);

    const centralHeader = concatBytes([
      u32(0x02014b50),
      u16(0x031e),
      u16(20),
      u16(0),
      u16(0),
      u16(now.time),
      u16(now.date),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.byteLength),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes
    ]);

    centralParts.push(centralHeader);
    offset += localHeader.byteLength + f.data.byteLength;
  }

  const centralDir = concatBytes(centralParts);
  const eocd = concatBytes([
    u32(0x06054b50),
    u16(0), u16(0),
    u16(files.length), u16(files.length),
    u32(centralDir.byteLength),
    u32(offset),
    u16(0)
  ]);

  return concatBytes([...localParts, centralDir, eocd]);
}

async function inferZipNameFromTab(tab){
  const site = normalizeSite(tab.url);
  return sanitizeName(site || "images");
}

async function downloadZip(urls){
  const tab = tabCache || await getActiveTab();
  const base = await inferZipNameFromTab(tab);
  const zipFilename = `${base}.zip`;

  setStatus(`Building ZIP (${urls.length} files)…`);

  const zipBytes = await buildZipFromUrls(urls, base);
  const blob = new Blob([zipBytes], { type:"application/zip" });

  const blobUrl = URL.createObjectURL(blob);
  try{
    await chrome.downloads.download({
      url: blobUrl,
      filename: zipFilename,
      conflictAction: "uniquify",
      saveAs: false
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  }

  setStatus(`ZIP download started — ${urls.length} files.`);
  toast(`ZIP: ${urls.length} files`);
}

async function download(urls){
  if (!urls.length){
    toast("Nothing selected");
    return;
  }

  const tab = tabCache || await getActiveTab();
  const useZip = (dlMode === "zip") || (dlMode === "auto" && urls.length >= ZIP_THRESHOLD);

  if (useZip){
    await downloadZip(urls);
    return;
  }

  setStatus(`Starting ${urls.length} downloads…`);
  const res = await chrome.runtime.sendMessage({ type:"DOWNLOAD_URLS", tabId: tab.id, urls });
  const n = res?.count ?? urls.length;

  if (res?.capped){
    setStatus(`Started ${n} downloads (capped).`);
    toast(`Downloaded ${n} (cap)`);
  } else {
    setStatus(`Started ${n} downloads.`);
    toast(`Downloading ${n}`);
  }
}

async function init(){
  const tab = await getActiveTab();
  tabCache = tab;

  const site = normalizeSite(tab.url);
  siteNameEl.textContent = site;
  siteDotEl.style.background = "rgba(255,255,255,.22)";

  setLiveUi(false);
  await loadMode();
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

if (modeToggleBtn) modeToggleBtn.addEventListener("click", () => cycleMode().catch(()=>{}));

init().catch(e => setStatus("Error: " + (e?.message || e)));
