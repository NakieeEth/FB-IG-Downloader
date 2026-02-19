const listEl = document.getElementById("list");
const statusTextEl = document.getElementById("statusText");

const btnLiveStart = document.getElementById("liveStart");
const btnLiveStop = document.getElementById("liveStop");
const btnCapturedPreview = document.getElementById("capturedPreview");
const btnCapturedClear = document.getElementById("capturedClear");

const btnDownloadSelected = document.getElementById("downloadSelected");
const btnDownloadAll = document.getElementById("downloadAll");

let allItems = [];
let tabCache = null;

function setStatus(msg){ statusTextEl.textContent = msg; }

function render(){
  listEl.innerHTML = "";

  if(!allItems.length){
    listEl.innerHTML = "<div style='opacity:.6'>No preview yet.</div>";
    return;
  }

  allItems.forEach((it, idx)=>{
    const card = document.createElement("div");
    card.className="card";

    const cb=document.createElement("input");
    cb.type="checkbox";
    cb.className="check";
    cb.checked=true;
    cb.dataset.idx=idx;

    const wrap=document.createElement("div");
    wrap.className="thumbWrap";

    const img=document.createElement("img");
    img.className="thumb";
    img.src=it.url;

    wrap.appendChild(img);
    card.appendChild(cb);
    card.appendChild(wrap);
    listEl.appendChild(card);
  });
}

function getSelectedUrls(){
  const urls=[];
  const checks=listEl.querySelectorAll('input[type="checkbox"]');
  checks.forEach(cb=>{
    if(cb.checked){
      const idx=Number(cb.dataset.idx);
      urls.push(allItems[idx].url);
    }
  });
  return urls;
}

async function getActiveTab(){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  return tab;
}

async function ensureContent(tabId){
  await chrome.scripting.executeScript({
    target:{tabId},
    files:["content.js"]
  });
}

async function liveStart(){
  const tab=await getActiveTab();
  tabCache=tab;

  await ensureContent(tab.id);
  await chrome.tabs.sendMessage(tab.id,{type:"LIVE_START",tabId:tab.id});

  setStatus("Live ON — scroll page.");
}

async function liveStop(){
  const tab=await getActiveTab();
  tabCache=tab;

  await ensureContent(tab.id);
  await chrome.tabs.sendMessage(tab.id,{type:"LIVE_STOP"});

  setStatus("Live OFF.");
}

async function buildPreview(){
  setStatus("Building preview…");

  const tab=await getActiveTab();
  tabCache=tab;

  const cap=await chrome.runtime.sendMessage({
    type:"CAPTURE_GET",
    tabId:tab.id
  });

  const urls=cap?.urls||[];

  if(!urls.length){
    setStatus("No captured images.");
    return;
  }

  await ensureContent(tab.id);

  const res=await chrome.tabs.sendMessage(tab.id,{
    type:"VERIFY_CAPTURED_URLS",
    urls
  });

  allItems=res?.items||[];
  render();

  setStatus(`Ready — ${allItems.length} images`);
}

async function clearCaptured(){
  const tab=await getActiveTab();
  await chrome.runtime.sendMessage({
    type:"CAPTURE_CLEAR",
    tabId:tab.id
  });
  allItems=[];
  render();
  setStatus("Captured cleared.");
}

async function download(urls){
  if(!urls.length) return;

  const tab=tabCache||await getActiveTab();

  await chrome.runtime.sendMessage({
    type:"DOWNLOAD_URLS",
    tabId:tab.id,
    urls
  });

  setStatus(`Downloading ${urls.length} images`);
}

btnLiveStart.onclick=()=>liveStart();
btnLiveStop.onclick=()=>liveStop();
btnCapturedPreview.onclick=()=>buildPreview();
btnCapturedClear.onclick=()=>clearCaptured();

btnDownloadSelected.onclick=()=>download(getSelectedUrls());
btnDownloadAll.onclick=()=>download(allItems.map(x=>x.url));

render();
