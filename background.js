// background.js (MV3 service worker)

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
  const host = (() => {
    try { return new URL(url).hostname; } catch { return ""; }
  })();
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

// =====================
// Download throttling
// =====================
const MAX_FILES_PER_CLICK = 200; // safety cap
const GAP_MS = 160;              // throttle
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================
// ZIP builder (no compression / STORE)
// Pure JS, no external libs.
// =====================
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

async function fetchAsBytes(url){
  const res = await fetch(url, { credentials:"omit", cache:"no-store" });
  if(!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

async function buildZipFromUrls(urls, folderName){
  const limited = Array.from(new Set(urls)).slice(0, MAX_FILES_PER_CLICK);
  const files = [];

  for(let i=0;i<limited.length;i++){
    const url = limited[i];
    const ext = guessExt(url);
    const name = `${sanitize(folderName)}/img_${String(i+1).padStart(4,"0")}.${ext}`;
    const data = await fetchAsBytes(url);
    files.push({ name, data });
    if(i % 10 === 0) await sleep(0);
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
      u16(0),
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

  const zipBytes = concatBytes([...localParts, centralDir, eocd]);
  return { zipBytes, count: files.length, capped: urls.length > files.length };
}

async function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  try{
    await chrome.downloads.download({
      url,
      filename,
      conflictAction:"uniquify",
      saveAs:false
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

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

      for (let i=0;i<urls.length;i++){
        const url = urls[i];
        const ext = guessExt(url);
        const filename = `${folder}/img_${String(i+1).padStart(4,"0")}.${ext}`;

        try{
          chrome.downloads.download({
            url,
            filename,
            conflictAction:"uniquify",
            saveAs:false
          });
        }catch{}

        await sleep(GAP_MS);
      }

      sendResponse({
        ok:true,
        count: urls.length,
        capped: raw.length > urls.length,
        cap: MAX_FILES_PER_CLICK,
        folder
      });
      return;
    }

    if (t === "DOWNLOAD_ZIP") {
      const raw = Array.isArray(msg.urls) ? msg.urls : [];
      const tab = await chrome.tabs.get(msg.tabId);
      const folder = inferFolderFromTitle(tab.url, tab.title);

      const { zipBytes, count, capped } = await buildZipFromUrls(raw, folder);
      const zipBlob = new Blob([zipBytes], { type:"application/zip" });
      const zipName = `${sanitize(folder)}.zip`;

      await downloadBlob(zipBlob, zipName);

      sendResponse({ ok:true, count, capped, cap: MAX_FILES_PER_CLICK, zip: zipName });
      return;
    }

    sendResponse({ ok:false, error:"Unknown message" });
  })().catch((e) => {
    sendResponse({ ok:false, error:String(e?.message || e) });
  });

  return true;
});
