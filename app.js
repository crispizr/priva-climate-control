// ============================================
// PRIVA Platform - JavaScript avec IA v4.0
// Updated: no prompt() on device promotion; uses EventBus to open pre-filled add-camera modal
// ============================================

// CONFIG
const CONFIG = {
  COMMAND_API_URL: 'https://script.google.com/macros/s/AKfycbwA53tJWrpVpd6WeoAA09FYVe63aFvwy-liD_rQgb2gr_HZ2bYHC1sKajJ4wzwshMC6aA/exec',
  AGRICULTURE_CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQwJjy2KpJJ5X--C87zVuPjykAg9Fyc79zIxpdk1Dt0FvrxYw1Onfzt5wSHOVagvLry9uyyohzeN3h4/pub?output=csv",
  SECURITY_CSV_URL: "https://docs.google.com/spreadsheets/d/12x5LRuFBaKeAfkSxc53uR-6Q3Xcu-OxZt2plY0GZSko/export?format=csv&gid=2127989880",
  PROXY: 'https://api.allorigins.win/raw?url=',
  AI_SERVER_URL: 'https://priva-climate-control.onrender.com',
  CAMERA_REFRESH_RATE: 500,
  MAX_CAPTURES: 100,
  FETCH_TIMEOUT: 5000,
  ESP32_PORT: 81,
  AI_AUTO_DETECT: false,
  AI_AUTH_TOKEN: '',
  MAX_UPLOAD_RETRIES: 3,
  RESIZE_MAX_WIDTH: 640,
  PHONE_CAPTURE_QUALITY: 0.8
};

// STATE
const State = {
  allAgriData: [],
  allSecurityData: [],
  devices: {},
  securityCameras: {},
  securityCaptures: [],
  currentModule: 'agriculture',
  isInitialized: false
};

// EventBus
const EventBus = (typeof window !== 'undefined' && typeof window.EventTarget === 'function') ? new window.EventTarget() : (() => {
  const bus = { _listeners: {} };
  bus.addEventListener = (t,f) => (bus._listeners[t] = bus._listeners[t]||[]).push(f);
  bus.dispatchEvent = (e) => { (bus._listeners[e.type]||[]).forEach(f=>{try{f(e)}catch{} }); return true; };
  return bus;
})();

// Storage
const StorageAdapter = {
  async get(k, def=null){ try{ if(typeof localStorage!=='undefined'){ const d=localStorage.getItem(k); return d?JSON.parse(d):def } return def }catch(e){return def} },
  async set(k,v){ try{ if(typeof localStorage!=='undefined'){ localStorage.setItem(k,JSON.stringify(v)); return true } return false }catch(e){return false} }
};

// Utils
const Utils = {
  async fetchWithTimeout(url, options={}, timeout=CONFIG.FETCH_TIMEOUT){
    const controller = (typeof AbortController!=='undefined')? new AbortController():null;
    const signal = controller ? controller.signal : undefined;
    let id;
    if (controller) id = setTimeout(()=>controller.abort(), timeout);
    try{ const r = await fetch(url, {...options, signal}); if(controller) clearTimeout(id); return r }catch(e){ if(controller) clearTimeout(id); throw e }
  },
  formatDateTime(s){ try{ const d=new Date(s); return d.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) }catch{ return s } },
  saveToStorage(k,v){ StorageAdapter.set(k,v).catch(console.error) },
  loadFromStorage(k,def=null){ return StorageAdapter.get(k,def) },
  validateIP(ip){
    if(!ip||typeof ip!=='string') return false;
    const s = ip.trim().replace(/^https?:\/\//i,'').replace(/\/+$/,'');
    const hostPort = s.split('/')[0];
    const parts = hostPort.split(':');
    const host = parts[0];
    const port = parts[1];
    if(port){ const p = parseInt(port,10); if(isNaN(p)||p<=0||p>65535) return false; }
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    if(ipv4.test(host)) return host.split('.').every(o=>{ const n=parseInt(o,10); return !isNaN(n)&&n>=0&&n<=255 });
    const hostPart = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
    return host.split('.').every(p=>hostPart.test(p));
  },
  buildCameraUrl(ip, endpoint='capture'){
    if(!ip) return '';
    const s = ip.trim();
    if(/^https?:\/\//i.test(s)) return `${s.replace(/\/+$/,'')}/${endpoint}?t=${Date.now()}`;
    const noSlash = s.replace(/\/+$/,'');
    if(noSlash.includes(':')) return `http://${noSlash}/${endpoint}?t=${Date.now()}`;
    return `http://${noSlash}:${CONFIG.ESP32_PORT}/${endpoint}?t=${Date.now()}`;
  },
  buildCameraEndpoint(ip, endpoint=''){
    if(!ip) return '';
    const s = ip.trim();
    if(/^https?:\/\//i.test(s)){ const base=s.replace(/\/+$/,''); return endpoint?`${base}/${endpoint}`:base }
    const noSlash = s.replace(/\/+$/,'');
    if(noSlash.includes(':')) return `http://${noSlash}${endpoint?('/'+endpoint):''}`;
    return `http://${noSlash}:${CONFIG.ESP32_PORT}${endpoint?('/'+endpoint):''}`;
  }
};

// Alerts
function showAlert(type,msg){
  if(typeof document!=='undefined' && document.getElementById){
    const c = document.getElementById('alertContainer');
    if(c){ const el = document.createElement('div'); el.className='alert '+type; el.textContent = msg; c.appendChild(el); setTimeout(()=>el.remove(),5000); }
  }
  try{ EventBus.dispatchEvent(new CustomEvent('priva:alert',{detail:{type,msg}})) }catch(e){}
}

// Upload utils (resize + xhr)
async function resizeBlob(blob,maxWidth=CONFIG.RESIZE_MAX_WIDTH,mime='image/jpeg',quality=CONFIG.PHONE_CAPTURE_QUALITY){
  const img = await new Promise((res,rej)=>{ const url=URL.createObjectURL(blob); const i=new Image(); i.onload=()=>{URL.revokeObjectURL(url); res(i)}; i.onerror=(e)=>{URL.revokeObjectURL(url); rej(e)}; i.src=url });
  const ratio = img.width/img.height||1; const w=Math.min(maxWidth,img.width); const h=Math.round(w/ratio)||Math.round(maxWidth/(ratio||1));
  const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h; const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  return await new Promise(resolve=>canvas.toBlob(resolve,mime,quality));
}
function uploadWithXHR(url,formData,headers={},timeoutMs=30000){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest(); let timed=false; const timer=setTimeout(()=>{ timed=true; xhr.abort(); reject(new Error('timeout')) }, timeoutMs);
    xhr.open('POST',url,true); Object.entries(headers||{}).forEach(([k,v])=>{ try{xhr.setRequestHeader(k,v)}catch{} });
    xhr.onreadystatechange=()=>{ if(xhr.readyState!==4) return; clearTimeout(timer); if(timed) return; if(xhr.status>=200 && xhr.status<300){ try{ resolve(JSON.parse(xhr.responseText)) }catch(e){ resolve({success:true,raw:xhr.responseText}) } } else reject(new Error('status='+xhr.status)) };
    xhr.onerror=()=>{ clearTimeout(timer); reject(new Error('xhr error')) };
    try{ xhr.send(formData) }catch(e){ clearTimeout(timer); reject(e) }
  });
}
async function sendBlobToAI(blob,cameraName='Téléphone',cameraId='phone_cam'){
  if(!blob) return null;
  let resized = blob;
  try{ resized = await resizeBlob(blob, CONFIG.RESIZE_MAX_WIDTH, 'image/jpeg', CONFIG.PHONE_CAPTURE_QUALITY); }catch(e){ console.warn('resize failed', e) }
  const fd = new FormData(); fd.append('file', resized, `capture_${cameraId}_${Date.now()}.jpg`); fd.append('cameraName', cameraName); fd.append('cameraId', cameraId);
  const headers = {}; if (CONFIG.AI_AUTH_TOKEN) headers['Authorization'] = `Bearer ${CONFIG.AI_AUTH_TOKEN}`;
  const uploadUrl = `${CONFIG.AI_SERVER_URL.replace(/\/+$/,'')}/upload`;
  try{ EventBus.dispatchEvent(new CustomEvent('priva:upload-start',{detail:{cameraId,cameraName,url:uploadUrl}})) }catch(e){}
  const max = Number.isInteger(CONFIG.MAX_UPLOAD_RETRIES) ? CONFIG.MAX_UPLOAD_RETRIES : 3;
  for(let attempt=1; attempt<=max; attempt++){
    try{
      if(attempt>1) await new Promise(r=>setTimeout(r,700*Math.pow(2,attempt-2)));
      const json = await uploadWithXHR(uploadUrl, fd, headers, CONFIG.FETCH_TIMEOUT * 6);
      if(json && json.success){ try{ EventBus.dispatchEvent(new CustomEvent('priva:detection',{detail:{cameraId,cameraName,label:json.prediction?.label,confidence:json.prediction?.confidence,timestamp:new Date().toISOString(),allPredictions:json.all_predictions}})) }catch(e){}; return json }
      else throw new Error(json && json.error ? json.error : 'no success');
    }catch(err){
      console.warn('upload attempt failed', attempt, err);
      if(attempt>=max){ showAlert('danger','❌ Échec upload vers serveur IA'); return null } else showAlert('warning',`Tentative ${attempt} échouée, nouvelle tentative...`);
    }
  }
  return null;
}

// AI Manager
const AIManager = {
  isProcessing:false, history:[],
  async detectImage(blob, cameraName, cameraId){
    if(this.isProcessing){ showAlert('warning','⏳ Détection en cours...'); return null }
    this.isProcessing=true; showAlert('warning','🤖 Analyse IA en cours...');
    try{
      const res = await sendBlobToAI(blob, cameraName, cameraId);
      if(res && res.success && res.prediction){
        const d = { cameraId, cameraName, label: res.prediction.label, confidence: res.prediction.confidence, timestamp: new Date().toISOString(), allPredictions: res.all_predictions||[] };
        this.history.unshift(d); if(this.history.length>50) this.history=this.history.slice(0,50);
        Utils.saveToStorage('priva_ai_history', this.history); try{ EventBus.dispatchEvent(new CustomEvent('priva:detection',{detail:d})) }catch{}; this.updateAIStats(); showAlert('success',`✅ ${d.label} (${d.confidence}%)`); return d;
      } else throw new Error('no prediction');
    }catch(e){ console.error(e); showAlert('danger',`❌ Erreur IA: ${e.message}`); return null } finally { this.isProcessing=false }
  },
  async detectWithESP32(cameraIp,cameraName,cameraId){
    showAlert('warning','🔍 Détection directe ESP32...');
    try{
      const url = Utils.buildCameraEndpoint(cameraIp,'detect'); const r = await Utils.fetchWithTimeout(url); const j = await r.json();
      if(j && j.success){ const d={cameraId,cameraName,label:j.detected||j.label,confidence:j.confidence||0,timestamp:new Date().toISOString(),source:'esp32'}; this.history.unshift(d); if(this.history.length>50) this.history=this.history.slice(0,50); Utils.saveToStorage('priva_ai_history',this.history); try{ EventBus.dispatchEvent(new CustomEvent('priva:detection',{detail:d})) }catch{}; this.updateAIStats(); showAlert('success',`✅ ${d.label} (${d.confidence})`); return d } else showAlert('warning','Aucune détection via ESP32');
    }catch(e){ console.error(e); showAlert('danger','❌ Erreur détection ESP32'); return null }
  },
  async loadHistory(){ this.history = await Utils.loadFromStorage('priva_ai_history',[]) || []; if(!Array.isArray(this.history)) this.history=[]; this.updateAIStats() },
  updateAIStats(){ const total=this.history.length; const stats={total,labels:{}}; this.history.forEach(h=>stats.labels[h.label]=(stats.labels[h.label]||0)+1); try{ EventBus.dispatchEvent(new CustomEvent('priva:ai-stats',{detail:stats})) }catch{}; if(typeof document!=='undefined'){ const el=document.getElementById('ai-stats'); if(el){ if(total===0) el.innerHTML='<div style="text-align:center;padding:12px;opacity:0.6;">Aucune détection</div>'; else{ let html=`<div style="padding:8px;background:#0b1220;border-radius:6px;">Total: <strong>${total}</strong><div style="margin-top:8px;">`; Object.entries(stats.labels).forEach(([lab,c])=>{ const p=(c/total*100).toFixed(1); html+=`<div style="display:flex;justify-content:space-between;font-size:13px;"><span>${lab}</span><span>${c} (${p}%)</span></div>` }); html+='</div></div>'; el.innerHTML=html } } } },
  clearHistory(){ this.history=[]; Utils.saveToStorage('priva_ai_history',[]); this.updateAIStats(); showAlert('success','🗑️ Historique vidé') },
  showDetectionResult(d){ try{ EventBus.dispatchEvent(new CustomEvent('priva:detection',{detail:d})) }catch{}; if(typeof document!=='undefined'){ const c=document.getElementById('ai-results-container')||document.getElementById('alertContainer'); if(c){ const el=document.createElement('div'); el.style='background:#111827;color:#fff;padding:10px;border-radius:8px;margin:6px 0;'; el.innerHTML=`<strong>${d.cameraName}</strong> — ${d.label} (${(d.confidence||0).toFixed(1)}%)<br><small>${new Date(d.timestamp).toLocaleString()}</small>`; c.insertBefore(el,c.firstChild); setTimeout(()=>el.remove(),15000) } } }
};

// Camera Manager (simplified)
const CameraManager = {
  intervals:{}, frameCounters:{}, isActive:false,
  init(){ this.isActive=false; this.stopAll() },
  startRefresh(id,ip){ if(!Utils.validateIP(ip)){ console.error('IP invalide',ip); return } this.stopRefresh(id); if(!this.isActive) return; let errorCount=0,MAX_ERRORS=3; this.frameCounters[id]={count:0,lastTime:Date.now()}; const refresh=async()=>{ if(!this.isActive){ this.stopRefresh(id); return } try{ const src = Utils.buildCameraUrl(ip,'capture'); if(typeof document!=='undefined'){ const img=document.getElementById(`stream-${id}`); if(!img){ this.stopRefresh(id); return } const t=new Image(); t.onload=()=>{ img.src=src; errorCount=0; CameraManager.updateCameraStatus(id,'online'); CameraManager.updateFPS(id) }; t.onerror=()=>{ errorCount++; if(errorCount>=MAX_ERRORS){ CameraManager.updateCameraStatus(id,'offline'); CameraManager.stopRefresh(id) } }; t.src=src } else { try{ EventBus.dispatchEvent(new CustomEvent('priva:camera-frame',{detail:{id,url:src}})) }catch{} CameraManager.updateCameraStatus(id,'online'); CameraManager.updateFPS(id) } }catch(e){ errorCount++; if(errorCount>=MAX_ERRORS) CameraManager.stopRefresh(id) } }; refresh(); this.intervals[id]=setInterval(refresh,CONFIG.CAMERA_REFRESH_RATE) },
  stopRefresh(id){ if(this.intervals[id]){ clearInterval(this.intervals[id]); delete this.intervals[id] } },
  stopAll(){ Object.keys(this.intervals).forEach(id=>this.stopRefresh(id)); this.frameCounters={} },
  updateCameraStatus(id,status){ if(typeof document!=='undefined'){ const ind=document.getElementById(`status-${id}`); const card=document.getElementById(`sec-cam-${id}`); if(status==='online'){ ind?.classList.remove('offline'); card?.classList.remove('offline') } else { ind?.classList.add('offline'); card?.classList.add('offline') } } try{ EventBus.dispatchEvent(new CustomEvent('priva:camera-status',{detail:{id,status}})) }catch{} },
  updateFPS(id){ const c=this.frameCounters[id]; if(!c) return; c.count++; const now=Date.now(); if(now-c.lastTime>=1000){ const fps=Math.round(c.count*1000/(now-c.lastTime)); const el=document.getElementById(`fps-${id}`); if(el) el.textContent=fps; try{ EventBus.dispatchEvent(new CustomEvent('priva:camera-fps',{detail:{id,fps}})) }catch{}; c.count=0; c.lastTime=now } }
};

// Devices
function addDeviceFromParams(name,type='sensor',module=null,config={}){ const id='dev_'+Date.now(); State.devices[id]={name,type,module:module||null,config:config||{},linkedCameraId:null,addedAt:new Date().toISOString()}; Utils.saveToStorage('priva_devices',State.devices); renderDevices(); try{ EventBus.dispatchEvent(new CustomEvent('priva:render-devices',{detail:Object.entries(State.devices).map(([id,d])=>({id,...d}))})) }catch{}; showAlert('success',`✅ Appareil "${name}" ajouté`); return id }
function removeDevice(id){ if(!State.devices[id]) return; delete State.devices[id]; Utils.saveToStorage('priva_devices',State.devices); renderDevices(); try{ EventBus.dispatchEvent(new CustomEvent('priva:render-devices',{detail:Object.entries(State.devices).map(([id,d])=>({id,...d}))})) }catch{}; showAlert('success','🗑️ Appareil supprimé') }
function assignDeviceModule(id,module){ if(!State.devices[id]) return; State.devices[id].module=module; Utils.saveToStorage('priva_devices',State.devices); renderDevices(); try{ EventBus.dispatchEvent(new CustomEvent('priva:render-devices',{detail:Object.entries(State.devices).map(([id,d])=>({id,...d}))})) }catch{}; showAlert('success',`✅ Assigné au module ${module}`) }
function renderDevices(){ try{ EventBus.dispatchEvent(new CustomEvent('priva:render-devices',{detail:Object.entries(State.devices).map(([id,d])=>({id,...d}))})) }catch{}; const c=document.getElementById('devices-list'); if(!c) return; c.innerHTML=''; const list=Object.entries(State.devices||{}); if(list.length===0){ c.innerHTML='<div style="opacity:0.6">Aucun appareil</div>'; return } list.forEach(([id,d])=>{ const el=document.createElement('div'); el.className='panel'; el.style.marginBottom='8px'; const promoteBtn = (d.type==='camera')?`<button class="btn" id="prom_${id}">➕ Vers Sécurité</button>`:''; el.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;"><div><strong>${d.name}</strong><div class="small">${d.type} • ${d.module||'non assigné'}</div></div><div style="display:flex;gap:8px;">${promoteBtn}<button class="btn" id="del_${id}">✖</button></div></div>`; c.appendChild(el); if(d.type==='camera'){ document.getElementById(`prom_${id}`)?.addEventListener('click', ()=> promoteDeviceToCamera(id)) } document.getElementById(`del_${id}`)?.addEventListener('click', ()=>{ if(confirm(`Supprimer ${d.name}?`)) removeDevice(id) }) }) }

// Promote device to camera: NO PROMPT — open add-camera modal prefilled
function promoteDeviceToCamera(deviceId){
  const dev = State.devices[deviceId];
  if(!dev) return;
  const prefill = {
    deviceId,
    name: dev.name || '',
    ip: dev.config?.ip || '',
    location: dev.config?.location || '',
    autoDetect: !!dev.config?.autoDetect
  };
  try{ EventBus.dispatchEvent(new CustomEvent('priva:open-add-camera',{detail: prefill})); }catch(e){}
}

// Security cameras & captures
function renderSecurityCameras(){ const list=Object.entries(State.securityCameras||{}).map(([id,c])=>({id,...c})); try{ EventBus.dispatchEvent(new CustomEvent('priva:render-cameras',{detail:list})) }catch{}; const grid=document.getElementById('security-cameras-grid'); if(!grid) return; grid.innerHTML=''; if(list.length===0){ grid.innerHTML='<div style="opacity:0.6">Aucune caméra configurée.</div>'; return } list.forEach(cam=>{ const card=document.createElement('div'); card.className='panel'; card.style.marginBottom='8px'; card.innerHTML=`<div style="display:flex;flex-direction:column;gap:8px;"><div style="display:flex;justify-content:space-between;align-items:center;"><div><strong id="cam-name-${cam.id}">${cam.name}</strong><br><span class="small" id="cam-location-${cam.id}">${cam.location}</span></div><div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;"><label class="small"><input type="checkbox" id="cam-active-${cam.id}" ${cam.active?'checked':''}/> Actif</label><button class="btn" id="cam-remove-${cam.id}">🗑️</button></div></div><img id="stream-${cam.id}" src="${Utils.buildCameraUrl(cam.ip,'capture')}" style="width:100%;height:160px;object-fit:cover;border-radius:6px;" /><div class="cam-settings"><div style="display:flex;gap:6px;"><input id="cam-ip-${cam.id}" value="${cam.ip||''}" style="flex:1;" /><button class="btn" id="cam-save-${cam.id}">💾</button></div><div style="display:flex;gap:6px;"><button class="btn" id="cam-capture-${cam.id}">📸</button><button class="btn" id="cam-ia-${cam.id}">🤖</button><button class="btn" id="cam-esp-${cam.id}">🔍 ESP32</button><button class="btn" id="cam-flash-${cam.id}">💡 Flash</button><label class="small" style="margin-left:8px;"><input type="checkbox" id="cam-autodetect-${cam.id}" ${cam.autoDetect?'checked':''}/> Auto détect</label></div></div></div>`; grid.appendChild(card);
  document.getElementById(`cam-save-${cam.id}`)?.addEventListener('click', ()=>{ const newIp=document.getElementById(`cam-ip-${cam.id}`).value.trim(); const newName=document.getElementById(`cam-name-${cam.id}`).textContent.trim(); const newLoc=document.getElementById(`cam-location-${cam.id}`).textContent.trim(); if(!newName||!newIp){ alert('Nom et IP requis'); return } State.securityCameras[cam.id].name=newName; State.securityCameras[cam.id].ip=newIp; State.securityCameras[cam.id].location=newLoc; Utils.saveToStorage('priva_security_cameras',State.securityCameras); showAlert('success','✅ Config sauvegardée'); renderSecurityCameras() });
  document.getElementById(`cam-capture-${cam.id}`)?.addEventListener('click', ()=> captureCamera(cam.id,cam.name,cam.ip));
  document.getElementById(`cam-ia-${cam.id}`)?.addEventListener('click', ()=> captureCameraAndDetect(cam.id,cam.name,cam.ip));
  document.getElementById(`cam-esp-${cam.id}`)?.addEventListener('click', ()=> detectWithESP32Camera(cam.id,cam.name,cam.ip));
  document.getElementById(`cam-flash-${cam.id}`)?.addEventListener('click', ()=> toggleFlash(cam.id,cam.ip));
  document.getElementById(`cam-remove-${cam.id}`)?.addEventListener('click', ()=>{ if(confirm(`Supprimer caméra ${cam.name}?`)){ delete State.securityCameras[cam.id]; Utils.saveToStorage('priva_security_cameras',State.securityCameras); renderSecurityCameras(); showAlert('success','🗑️ Caméra supprimée') } });
  document.getElementById(`cam-active-${cam.id}`)?.addEventListener('change',(e)=>{ State.securityCameras[cam.id].active=e.target.checked; Utils.saveToStorage('priva_security_cameras',State.securityCameras); if(e.target.checked) CameraManager.startRefresh(cam.id,State.securityCameras[cam.id].ip); else CameraManager.stopRefresh(cam.id) });
  document.getElementById(`cam-autodetect-${cam.id}`)?.addEventListener('change',(e)=>{ State.securityCameras[cam.id].autoDetect=e.target.checked; Utils.saveToStorage('priva_security_cameras',State.securityCameras); showAlert('success', e.target.checked? 'Auto-detect activé':'Auto-detect désactivé') });
  }) }
function renderSecurityCaptures(){ const g=document.getElementById('security-captures-gallery'); if(!g) return; g.innerHTML=''; if(!Array.isArray(State.securityCaptures)||State.securityCaptures.length===0){ g.innerHTML='<div style="opacity:0.6">Aucune capture</div>'; return } State.securityCaptures.slice(0,20).forEach(cap=>{ const el=document.createElement('div'); el.className='panel'; el.innerHTML=`<img src="${cap.url}" style="width:100%;height:120px;object-fit:cover;border-radius:6px;"/><div class="small" style="margin-top:6px">${cap.name} • ${(new Date(cap.timestamp)).toLocaleTimeString()}</div>`; g.appendChild(el) }) }

// Capture functions
async function captureCamera(id,name,ip){ if(!Utils.validateIP(ip)){ showAlert('danger','❌ IP invalide'); return } showAlert('warning','📸 Capture en cours...'); try{ const url=Utils.buildCameraUrl(ip,'capture'); const r=await fetch(url); const blob=await r.blob(); const cap={id:'cap_'+Date.now(),cameraId:id,name,timestamp:new Date().toISOString(),url}; State.securityCaptures.unshift(cap); if(State.securityCaptures.length>CONFIG.MAX_CAPTURES) State.securityCaptures=State.securityCaptures.slice(0,CONFIG.MAX_CAPTURES); Utils.saveToStorage('priva_security_captures',State.securityCaptures); renderSecurityCaptures(); showAlert('success',`✅ Photo capturée: ${name}`); if(State.securityCameras[id]?.autoDetect || CONFIG.AI_AUTO_DETECT) await AIManager.detectImage(blob,name,id) }catch(e){ console.error(e); showAlert('danger','❌ Erreur capture') } }
async function captureCameraAndDetect(id,name,ip){ showAlert('warning','📸 Capture + Détection IA...'); try{ const url=Utils.buildCameraUrl(ip,'capture'); const r=await fetch(url); const blob=await r.blob(); const cap={id:'cap_'+Date.now(),cameraId:id,name,timestamp:new Date().toISOString(),url}; State.securityCaptures.unshift(cap); if(State.securityCaptures.length>CONFIG.MAX_CAPTURES) State.securityCaptures=State.securityCaptures.slice(0,CONFIG.MAX_CAPTURES); Utils.saveToStorage('priva_security_captures',State.securityCaptures); renderSecurityCaptures(); await AIManager.detectImage(blob,name,id) }catch(e){ console.error(e); showAlert('danger','❌ Erreur capture/détection') } }
async function detectWithESP32Camera(id,name,ip){ return AIManager.detectWithESP32(ip,name,id) }
async function toggleFlash(id,ip){ try{ await Utils.fetchWithTimeout(Utils.buildCameraEndpoint(ip,'flash'),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'state=1'}); setTimeout(async()=>{ await Utils.fetchWithTimeout(Utils.buildCameraEndpoint(ip,'flash'),{method:'POST',body:'state=0'}) },200); showAlert('success','💡 Flash activé') }catch(e){ try{ await Utils.fetchWithTimeout(Utils.buildCameraEndpoint(ip,'flash?state=1')); setTimeout(async()=>{ await Utils.fetchWithTimeout(Utils.buildCameraEndpoint(ip,'flash?state=0')) },200); showAlert('success','💡 Flash activé (fallback)') }catch(err){ console.error(err); showAlert('danger','❌ Erreur flash') } }

// Init
async function loadInitialState(){ State.devices = await Utils.loadFromStorage('priva_devices',{}) || {}; State.securityCameras = await Utils.loadFromStorage('priva_security_cameras',{}) || {}; State.securityCaptures = await Utils.loadFromStorage('priva_security_captures',[]) || []; await AIManager.loadHistory(); renderDevices(); renderSecurityCameras(); renderSecurityCaptures(); }
async function init(){ if(State.isInitialized) return; await loadInitialState(); State.isInitialized=true; showAlert('success','✓ Système initialisé'); try{ EventBus.dispatchEvent(new CustomEvent('priva:ready',{detail:{state:State}})) }catch{} }
function initAI(){ AIManager.loadHistory() }

// Phone camera integration
const PhoneCamera = {
  stream:null, intervalId:null,
  async start(constraints={video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}}){ const video=document.getElementById('phone-camera-video'); if(!video){ showAlert('danger','Élément video introuvable'); return } if(this.stream){ try{ video.srcObject=this.stream }catch{}; showAlert('warning','Caméra déjà démarrée'); return } try{ const s = await navigator.mediaDevices.getUserMedia(constraints); this.stream=s; video.srcObject=s; await video.play(); showAlert('success','✅ Caméra démarrée') }catch(e){ console.error(e); showAlert('danger','Accès caméra échoué (permissions/HTTPS?)') } },
  stop(){ const video=document.getElementById('phone-camera-video'); if(this.stream){ this.stream.getTracks().forEach(t=>t.stop()); this.stream=null; if(video) video.srcObject=null; showAlert('success','⏹️ Caméra arrêtée') } if(this.intervalId){ clearInterval(this.intervalId); this.intervalId=null } },
  async captureBlob(){ const video=document.getElementById('phone-camera-video'); if(!video||!this.stream){ showAlert('warning','Caméra non démarrée'); return null } const canvas=document.getElementById('phone-camera-canvas')||document.createElement('canvas'); canvas.width=video.videoWidth||640; canvas.height=video.videoHeight||480; const ctx=canvas.getContext('2d'); ctx.drawImage(video,0,0,canvas.width,canvas.height); const blob=await new Promise(res=>canvas.toBlob(res,'image/jpeg',CONFIG.PHONE_CAPTURE_QUALITY)); const preview=document.getElementById('phone-camera-preview'); if(preview){ const url=URL.createObjectURL(blob); preview.innerHTML=`<img src="${url}" style="width:160px;border-radius:6px"/>`; setTimeout(()=>URL.revokeObjectURL(url),5000) } return blob },
  async captureAndDetect(){ const b=await this.captureBlob(); if(!b) return null; return await sendBlobToAI(b,'Téléphone','phone_cam') },
  startAuto(ms=2000){ if(!this.stream){ showAlert('warning','Démarre la caméra d\'abord'); return } if(this.intervalId) clearInterval(this.intervalId); this.intervalId=setInterval(async()=>{ await this.captureAndDetect() }, ms); showAlert('success','🔁 Détection auto activée') },
  stopAuto(){ if(this.intervalId){ clearInterval(this.intervalId); this.intervalId=null } showAlert('success','⏸️ Détection auto désactivée') }
};

// Expose Priva
const Priva = {
  CONFIG, State, EventBus, Utils, AIManager, CameraManager, PhoneCamera,
  addDeviceFromParams, removeDevice, assignDeviceModule, renderDevices, promoteDeviceToCamera,
  addSecurityCameraFromParams:function(name,ip,location='Non spécifié'){ const id='cam_'+Date.now(); State.securityCameras[id]={name,ip,location,active:true,autoDetect:false,addedAt:new Date().toISOString()}; Utils.saveToStorage('priva_security_cameras',State.securityCameras); renderSecurityCameras(); showAlert('success',`✅ ${name} ajoutée`); return id },
  removeSecurityCamera:function(id){ if(!State.securityCameras[id]) return; delete State.securityCameras[id]; Utils.saveToStorage('priva_security_cameras',State.securityCameras); renderSecurityCameras(); showAlert('success','🗑️ Caméra supprimée') },
  renderSecurityCameras, renderSecurityCaptures, captureCamera, captureCameraAndDetect, detectWithESP32Camera, captureAllCameras, toggleFlash,
  refreshAllCameras:function(){ Object.entries(State.securityCameras).forEach(([id,cam])=>{ const img=document.getElementById(`stream-${id}`); if(img) img.src = Utils.buildCameraUrl(cam.ip,'capture'); try{ EventBus.dispatchEvent(new CustomEvent('priva:camera-frame',{detail:{id,url:Utils.buildCameraUrl(cam.ip,'capture')}})) }catch{} }); showAlert('success','🔄 Caméras rafraîchies') },
  testAIServer: async function(){ showAlert('warning','🔍 Test serveur IA...'); try{ const r=await Utils.fetchWithTimeout(`${CONFIG.AI_SERVER_URL}/health`); const j=await r.json(); if(j.status==='healthy'){ showAlert('success','✅ Serveur IA opérationnel'); return true } }catch(e){ showAlert('danger','❌ Serveur IA injoignable'); console.error(e); return false } return false },
  getAIModelInfo: async function(){ try{ const r=await Utils.fetchWithTimeout(`${CONFIG.AI_SERVER_URL}/info`); const j=await r.json(); try{ EventBus.dispatchEvent(new CustomEvent('priva:ai-model-info',{detail:j})) }catch{} if(document.getElementById('ai-model-info')) document.getElementById('ai-model-info').innerHTML=`<div class="small">Modèle: ${j.model_name}<br>Classes: ${j.classes?.join(', ')}<br>Version: ${j.version}</div>`; return j }catch(e){ console.error(e); showAlert('danger','❌ Erreur récupération infos modèle'); return null } },
  toggleAutoDetect:function(){ CONFIG.AI_AUTO_DETECT = !CONFIG.AI_AUTO_DETECT; showAlert(CONFIG.AI_AUTO_DETECT?'success':'warning', CONFIG.AI_AUTO_DETECT? '✅ Détection auto activée' : '⏸️ Détection auto désactivée') },
  sendBlobToAI,
  startPhoneCamera: (opts)=>PhoneCamera.start(opts), stopPhoneCamera: ()=>PhoneCamera.stop(), capturePhoneCameraAndDetect: ()=>PhoneCamera.captureAndDetect(), startPhoneCameraAutoDetect: (ms)=>PhoneCamera.startAuto(ms), stopPhoneCameraAutoDetect: ()=>PhoneCamera.stopAuto(),
  init, initAI
};
Priva.promoteDeviceToCamera = promoteDeviceToCamera;
if(typeof window!=='undefined'){ window.Priva = Priva; window.Priva.EventBus = EventBus; window.addEventListener('load', ()=>{ if(!State.isInitialized) Priva.init() }) }

console.log('✅ PRIVA loaded — no prompt on promotion; uses modal prefill flow');
