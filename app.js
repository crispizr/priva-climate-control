// ============================================
// PRIVA Platform - JavaScript avec IA v4.0
// Complete app.js (devices, ESP32 fixes, phone camera upload to Render)
// ============================================

// ==================== CONFIGURATION ====================
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
  AI_AUTH_TOKEN: '', // optional Bearer token for /upload on Render
  MAX_UPLOAD_RETRIES: 3,
  RESIZE_MAX_WIDTH: 640,
  PHONE_CAPTURE_QUALITY: 0.8
};

// ==================== ÉTAT GLOBAL ====================
const State = {
  allAgriData: [],
  allSecurityData: [],
  devices: {},
  securityCameras: {},
  securityCaptures: [],
  currentModule: 'agriculture',
  climateChart: null,
  airChart: null,
  dataUpdateInterval: null,
  moduleUpdateInterval: null,
  isInitialized: false
};

// ==================== EventBus ====================
const EventBus = (typeof window !== 'undefined' && typeof window.EventTarget === 'function')
  ? new window.EventTarget()
  : (() => {
      const bus = { _listeners: {} };
      bus.addEventListener = (type, cb) => { (bus._listeners[type] = bus._listeners[type] || []).push(cb); };
      bus.removeEventListener = (type, cb) => { bus._listeners[type] = (bus._listeners[type] || []).filter(x => x !== cb); };
      bus.dispatchEvent = (evt) => { const l = bus._listeners[evt.type] || []; l.forEach(cb => { try { cb(evt); } catch(e){console.error(e);} }); return true; };
      return bus;
    })();

// ==================== Storage Adapter ====================
const StorageAdapter = {
  async get(key, defaultValue = null) {
    try {
      if (typeof localStorage !== 'undefined') {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : defaultValue;
      } else if (typeof AsyncStorage !== 'undefined' && AsyncStorage.getItem) {
        const data = await AsyncStorage.getItem(key);
        return data ? JSON.parse(data) : defaultValue;
      } else {
        return defaultValue;
      }
    } catch (err) {
      console.error('StorageAdapter.get error', err);
      return defaultValue;
    }
  },

  async set(key, value) {
    try {
      const str = JSON.stringify(value);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, str);
      } else if (typeof AsyncStorage !== 'undefined' && AsyncStorage.setItem) {
        await AsyncStorage.setItem(key, str);
      } else {
        // noop
      }
      return true;
    } catch (err) {
      console.error('StorageAdapter.set error', err);
      return false;
    }
  }
};

// ==================== UTILITAIRES ====================
const Utils = {
  async fetchWithTimeout(url, options = {}, timeout = CONFIG.FETCH_TIMEOUT) {
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const signal = controller ? controller.signal : undefined;
    let timeoutId;
    if (controller) timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, { ...options, signal });
      if (controller) clearTimeout(timeoutId);
      return response;
    } catch (error) {
      if (controller) clearTimeout(timeoutId);
      throw error;
    }
  },

  formatDateTime(dateStr) {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  },

  saveToStorage(key, data) {
    StorageAdapter.set(key, data).catch(err => console.error('saveToStorage error', err));
  },

  loadFromStorage(key, defaultValue = null) {
    return StorageAdapter.get(key, defaultValue);
  },

  validateIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    const s = ip.trim();
    const withoutProto = s.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const hostPort = withoutProto.split('/')[0];
    const parts = hostPort.split(':');
    const host = parts[0];
    const port = parts[1];

    if (port) {
      const pnum = parseInt(port, 10);
      if (isNaN(pnum) || pnum <= 0 || pnum > 65535) return false;
    }

    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Regex.test(host)) {
      return host.split('.').every(o => {
        const n = parseInt(o, 10);
        return !isNaN(n) && n >= 0 && n <= 255;
      });
    }

    const hostnamePart = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
    if (host.split('.').every(part => hostnamePart.test(part))) return true;

    return false;
  },

  buildCameraUrl(ip, endpoint = 'capture') {
    if (!ip) return '';
    const s = ip.trim();
    if (/^https?:\/\//i.test(s)) {
      return `${s.replace(/\/+$/, '')}/${endpoint}?t=${Date.now()}`;
    }
    const withoutSlash = s.replace(/\/+$/, '');
    if (withoutSlash.includes(':')) {
      return `http://${withoutSlash}/${endpoint}?t=${Date.now()}`;
    }
    return `http://${withoutSlash}:${CONFIG.ESP32_PORT}/${endpoint}?t=${Date.now()}`;
  },

  buildCameraEndpoint(ip, endpoint = '') {
    if (!ip) return '';
    const s = ip.trim();
    if (/^https?:\/\//i.test(s)) {
      const base = s.replace(/\/+$/, '');
      return endpoint ? `${base}/${endpoint}` : base;
    }
    const withoutSlash = s.replace(/\/+$/, '');
    if (withoutSlash.includes(':')) {
      return `http://${withoutSlash}${endpoint ? ('/' + endpoint) : ''}`;
    }
    return `http://${withoutSlash}:${CONFIG.ESP32_PORT}${endpoint ? ('/' + endpoint) : ''}`;
  }
};

// ==================== UI helpers ====================
function showAlert(type, msg) {
  if (typeof document !== 'undefined' && document.getElementById) {
    const alert = document.createElement('div');
    alert.className = `alert ${type}`;
    alert.textContent = msg;
    const container = document.getElementById('alertContainer');
    if (container) {
      container.appendChild(alert);
      setTimeout(() => alert.remove(), 5000);
    }
  }
  try {
    const ev = (typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:alert', { detail: { type, msg } }) : { type: 'priva:alert', detail: { type, msg } };
    EventBus.dispatchEvent(ev);
  } catch (err) {
    console.log(`[${type}] ${msg}`);
  }
}

// ==================== UPLOAD / RESIZE (Render server) ====================
async function resizeBlob(blob, maxWidth = CONFIG.RESIZE_MAX_WIDTH, mime = 'image/jpeg', quality = CONFIG.PHONE_CAPTURE_QUALITY) {
  const img = await new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); res(i); };
    i.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
    i.src = url;
  });
  const ratio = img.width / img.height || 1;
  const w = Math.min(maxWidth, img.width);
  const h = Math.round(w / ratio) || Math.round(maxWidth / (ratio || 1));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise(resolve => canvas.toBlob(resolve, mime, quality));
}

function uploadWithXHR(url, formData, headers = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; xhr.abort(); reject(new Error('timeout')); }, timeoutMs);
    xhr.open('POST', url, true);
    Object.entries(headers || {}).forEach(([k, v]) => { try { xhr.setRequestHeader(k, v); } catch (e) {} });
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      clearTimeout(timer);
      if (timedOut) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try { const json = JSON.parse(xhr.responseText); resolve(json); } catch (e) { resolve({ success: true, raw: xhr.responseText }); }
      } else reject(new Error('upload failed status=' + xhr.status));
    };
    xhr.onerror = (e) => { clearTimeout(timer); reject(new Error('xhr error')); };
    try { xhr.send(formData); } catch (err) { clearTimeout(timer); reject(err); }
  });
}

async function sendBlobToAI(blob, cameraName = 'Téléphone', cameraId = 'phone_cam') {
  if (!blob) return null;

  // Resize to reduce bandwidth
  let resized = blob;
  try { resized = await resizeBlob(blob, CONFIG.RESIZE_MAX_WIDTH, 'image/jpeg', CONFIG.PHONE_CAPTURE_QUALITY); } catch (e) { console.warn('resize failed', e); }

  const fd = new FormData();
  fd.append('file', resized, `capture_${cameraId}_${Date.now()}.jpg`);
  fd.append('cameraName', cameraName);
  fd.append('cameraId', cameraId);

  const headers = {};
  if (CONFIG.AI_AUTH_TOKEN) headers['Authorization'] = `Bearer ${CONFIG.AI_AUTH_TOKEN}`;

  const uploadUrl = `${CONFIG.AI_SERVER_URL.replace(/\/+$/, '')}/upload`;
  if (EventBus) { try { EventBus.dispatchEvent(new CustomEvent('priva:upload-start', { detail: { cameraId, cameraName, url: uploadUrl } })); } catch(e){} }

  const maxAttempts = Number.isInteger(CONFIG.MAX_UPLOAD_RETRIES) ? CONFIG.MAX_UPLOAD_RETRIES : 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        const backoff = 700 * Math.pow(2, attempt - 2);
        await new Promise(r => setTimeout(r, backoff));
      }
      const json = await uploadWithXHR(uploadUrl, fd, headers, CONFIG.FETCH_TIMEOUT * 6);
      if (json && json.success) {
        try { EventBus.dispatchEvent(new CustomEvent('priva:detection', { detail: { cameraId, cameraName, label: json.prediction?.label, confidence: json.prediction?.confidence, timestamp: new Date().toISOString(), allPredictions: json.all_predictions } })); } catch(e){}
        return json;
      } else {
        const err = (json && json.error) ? json.error : 'upload returned no success';
        throw new Error(err);
      }
    } catch (err) {
      console.warn('sendBlobToAI attempt failed', attempt, err);
      if (attempt >= maxAttempts) {
        showAlert('danger', '❌ Échec upload vers serveur IA');
        return null;
      } else {
        showAlert('warning', `Tentative ${attempt} échouée, nouvelle tentative...`);
      }
    }
  }
  return null;
}

// ==================== AI MANAGER ====================
const AIManager = {
  isProcessing: false,
  history: [],

  async detectImage(imageBlob, cameraName, cameraId) {
    if (this.isProcessing) { showAlert('warning', '⏳ Détection en cours...'); return null; }
    this.isProcessing = true;
    showAlert('warning', '🤖 Analyse IA en cours...');

    try {
      const res = await sendBlobToAI(imageBlob, cameraName, cameraId);
      if (res && res.success && res.prediction) {
        const detection = {
          cameraId,
          cameraName,
          label: res.prediction.label,
          confidence: res.prediction.confidence,
          timestamp: new Date().toISOString(),
          allPredictions: res.all_predictions || []
        };
        this.history.unshift(detection);
        if (this.history.length > 50) this.history = this.history.slice(0, 50);
        Utils.saveToStorage('priva_ai_history', this.history);
        this.showDetectionResult(detection);
        this.updateAIStats();
        showAlert('success', `✅ ${detection.label} (${detection.confidence}%)`);
        return detection;
      } else {
        throw new Error('No prediction from server');
      }
    } catch (error) {
      console.error('❌ Erreur détection IA:', error);
      showAlert('danger', `❌ Erreur IA: ${error.message}`);
      return null;
    } finally {
      this.isProcessing = false;
    }
  },

  async detectWithESP32(cameraIp, cameraName, cameraId) {
    showAlert('warning', '🔍 Détection directe ESP32...');
    try {
      const url = Utils.buildCameraEndpoint(cameraIp, 'detect');
      const resp = await Utils.fetchWithTimeout(url);
      const result = await resp.json();
      if (result && result.success) {
        const detection = {
          cameraId, cameraName,
          label: result.detected || result.label,
          confidence: result.confidence || 0,
          timestamp: new Date().toISOString(),
          source: 'esp32'
        };
        this.history.unshift(detection);
        if (this.history.length > 50) this.history = this.history.slice(0, 50);
        Utils.saveToStorage('priva_ai_history', this.history);
        this.showDetectionResult(detection);
        showAlert('success', `✅ ${detection.label} (${detection.confidence}%)`);
        return detection;
      } else {
        showAlert('warning', 'Aucune détection via ESP32');
        return null;
      }
    } catch (err) {
      console.error('detectWithESP32 error', err);
      showAlert('danger', '❌ Erreur détection ESP32');
      return null;
    }
  },

  showDetectionResult(detection) {
    if (typeof document !== 'undefined' && document.getElementById) {
      const container = document.getElementById('ai-results-container') || document.getElementById('alertContainer');
      if (container) {
        const el = document.createElement('div');
        el.style = 'background:#111827;color:#fff;padding:10px;border-radius:8px;margin:6px 0;';
        el.innerHTML = `<strong>${detection.cameraName}</strong> — ${detection.label} (${(detection.confidence||0).toFixed(1)}%)<br><small>${new Date(detection.timestamp).toLocaleString()}</small>`;
        container.insertBefore(el, container.firstChild);
        setTimeout(() => el.remove(), 15000);
      }
    }
    try { EventBus.dispatchEvent(new CustomEvent('priva:detection', { detail: detection })); } catch(e){}
  },

  updateAIStats() {
    const total = this.history.length;
    const stats = { total, labels: {} };
    this.history.forEach(h => stats.labels[h.label] = (stats.labels[h.label] || 0) + 1);

    if (typeof document !== 'undefined' && document.getElementById) {
      const statsDiv = document.getElementById('ai-stats');
      if (statsDiv) {
        if (total === 0) {
          statsDiv.innerHTML = '<div style="text-align:center;padding:12px;opacity:0.6;">Aucune détection</div>';
        } else {
          let html = `<div style="padding:8px;background:#0b1220;border-radius:6px;">Total: <strong>${total}</strong><div style="margin-top:8px;">`;
          Object.entries(stats.labels).forEach(([label, count]) => {
            const percentage = (count / total * 100).toFixed(1);
            html += `<div style="display:flex;justify-content:space-between;font-size:13px;"><span>${label}</span><span>${count} (${percentage}%)</span></div>`;
          });
          html += `</div></div>`;
          statsDiv.innerHTML = html;
        }
      }
    }
    try { EventBus.dispatchEvent(new CustomEvent('priva:ai-stats', { detail: stats })); } catch(e){}
  },

  async loadHistory() {
    this.history = await Utils.loadFromStorage('priva_ai_history', []) || [];
    if (!Array.isArray(this.history)) this.history = [];
    this.updateAIStats();
  },

  clearHistory() {
    this.history = [];
    Utils.saveToStorage('priva_ai_history', []);
    this.updateAIStats();
    showAlert('success', '🗑️ Historique vidé');
  }
};

// ==================== CAMERA MANAGER (unchanged logic but robust URLs) ====================
const CameraManager = {
  intervals: {},
  fullscreenInterval: null,
  isActive: false,
  frameCounters: {},

  init() {
    this.isActive = false;
    this.stopAll();
  },

  startRefresh(id, ip) {
    if (!Utils.validateIP(ip)) {
      console.error(`❌ IP invalide pour caméra ${id}: ${ip}`);
      return;
    }
    this.stopRefresh(id);
    if (!this.isActive) return;
    let errorCount = 0;
    const MAX_ERRORS = 3;
    this.frameCounters[id] = { count: 0, lastTime: Date.now() };
    const refreshFrame = async () => {
      if (!this.isActive) { this.stopRefresh(id); return; }
      try {
        const newSrc = Utils.buildCameraUrl(ip, 'capture');
        if (typeof document !== 'undefined' && document.getElementById) {
          const img = document.getElementById(`stream-${id}`);
          if (!img) { this.stopRefresh(id); return; }
          const testImg = new Image();
          testImg.onload = () => { img.src = newSrc; errorCount = 0; this.updateCameraStatus(id, 'online'); this.updateFPS(id); };
          testImg.onerror = () => { errorCount++; if (errorCount >= MAX_ERRORS) { this.updateCameraStatus(id, 'offline'); this.stopRefresh(id); } };
          testImg.src = newSrc;
        } else {
          EventBus.dispatchEvent(new CustomEvent('priva:camera-frame', { detail: { id, url: newSrc } }));
          this.updateCameraStatus(id, 'online');
          this.updateFPS(id);
        }
      } catch (err) {
        errorCount++;
        if (errorCount >= MAX_ERRORS) this.stopRefresh(id);
      }
    };
    refreshFrame();
    this.intervals[id] = setInterval(refreshFrame, CONFIG.CAMERA_REFRESH_RATE);
  },

  stopRefresh(id) {
    if (this.intervals[id]) { clearInterval(this.intervals[id]); delete this.intervals[id]; }
  },

  stopAll() {
    Object.keys(this.intervals).forEach(id => this.stopRefresh(id));
    if (this.fullscreenInterval) { clearInterval(this.fullscreenInterval); this.fullscreenInterval = null; }
    this.frameCounters = {};
  },

  updateCameraStatus(id, status) {
    if (typeof document !== 'undefined' && document.getElementById) {
      const indicator = document.getElementById(`status-${id}`);
      const card = document.getElementById(`sec-cam-${id}`);
      const loading = document.getElementById(`loading-${id}`);
      if (status === 'online') { indicator?.classList.remove('offline'); card?.classList.remove('offline'); if (loading) loading.style.display = 'none'; }
      else { indicator?.classList.add('offline'); card?.classList.add('offline'); if (loading) { loading.style.display = 'block'; loading.textContent = '❌ Hors ligne'; } }
    }
    try { EventBus.dispatchEvent(new CustomEvent('priva:camera-status', { detail: { id, status } })); } catch(e){}
  },

  updateFPS(id) {
    const counter = this.frameCounters[id];
    if (!counter) return;
    counter.count++;
    const now = Date.now();
    if (now - counter.lastTime >= 1000) {
      const fps = Math.round(counter.count * 1000 / (now - counter.lastTime));
      if (typeof document !== 'undefined' && document.getElementById) {
        const fpsElement = document.getElementById(`fps-${id}`);
        if (fpsElement) fpsElement.textContent = fps;
      }
      try { EventBus.dispatchEvent(new CustomEvent('priva:camera-fps', { detail: { id, fps } })); } catch(e){}
      counter.count = 0; counter.lastTime = now;
    }
  }
};

// ==================== DEVICES (add/remove/assign/render) ====================
function addDeviceFromParams(name, type = 'sensor', module = null, config = {}) {
  const id = 'dev_' + Date.now();
  State.devices[id] = { name: name || `Appareil ${id}`, type, module: module || null, config: config || {}, addedAt: new Date().toISOString() };
  Utils.saveToStorage('priva_devices', State.devices);
  renderDevices();
  showAlert('success', `✅ Appareil "${name}" ajouté`);
  try { EventBus.dispatchEvent(new CustomEvent('priva:render-devices', { detail: Object.entries(State.devices).map(([id, d]) => ({ id, ...d })) })); } catch(e){}
  return id;
}

function removeDevice(id) {
  if (!State.devices[id]) return;
  delete State.devices[id];
  Utils.saveToStorage('priva_devices', State.devices);
  renderDevices();
  showAlert('success', '🗑️ Appareil supprimé');
  try { EventBus.dispatchEvent(new CustomEvent('priva:render-devices', { detail: Object.entries(State.devices).map(([id, d]) => ({ id, ...d })) })); } catch(e){}
}

function assignDeviceModule(id, module) {
  if (!State.devices[id]) return;
  State.devices[id].module = module;
  Utils.saveToStorage('priva_devices', State.devices);
  renderDevices();
  showAlert('success', `✅ Appareil assigné au module "${module}"`);
  try { EventBus.dispatchEvent(new CustomEvent('priva:render-devices', { detail: Object.entries(State.devices).map(([id, d]) => ({ id, ...d })) })); } catch(e){}
}

function renderDevices() {
  const container = document.getElementById('devices-list');
  const list = Object.entries(State.devices || {}).map(([id, d]) => ({ id, ...d }));
  try { EventBus.dispatchEvent(new CustomEvent('priva:render-devices', { detail: list })); } catch(e){}
  if (!container) return;
  container.innerHTML = '';
  if (list.length === 0) { container.innerHTML = '<div style="opacity:0.6">Aucun appareil</div>'; return; }
  list.forEach(dev => {
    const el = document.createElement('div');
    el.className = 'panel';
    el.style.marginBottom = '8px';
    el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;">
      <div><strong>${dev.name}</strong><div style="font-size:12px;color:#9fb0cc">${dev.type} • ${dev.module || 'non assigné'}</div></div>
      <div style="display:flex;gap:8px;">
        <select id="assign_${dev.id}">
          <option value="">-- assign --</option>
          <option value="agriculture">Agriculture</option>
          <option value="security">Sécurité</option>
        </select>
        <button class="btn" id="remove_${dev.id}">✖</button>
      </div>
    </div>`;
    container.appendChild(el);
    const sel = document.getElementById(`assign_${dev.id}`);
    if (sel) { sel.value = dev.module || ''; sel.addEventListener('change', (e) => assignDeviceModule(dev.id, e.target.value || null)); }
    const btn = document.getElementById(`remove_${dev.id}`);
    if (btn) btn.addEventListener('click', () => { if (confirm(`Supprimer "${dev.name}" ?`)) removeDevice(dev.id); });
  });
}

// ==================== CAMÉRAS / CAPTURES RENDER ====================
function renderSecurityCameras() {
  const camerasList = Object.entries(State.securityCameras || {}).filter(([id, cam]) => cam.active).map(([id, cam]) => ({ id, ...cam }));
  try { EventBus.dispatchEvent(new CustomEvent('priva:render-cameras', { detail: camerasList })); } catch(e){}
  const grid = document.getElementById('security-cameras-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (camerasList.length === 0) { grid.innerHTML = '<div style="opacity:0.6">Aucune caméra configurée.</div>'; return; }
  camerasList.forEach(cam => {
    const card = document.createElement('div');
    card.className = 'panel';
    card.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">
      <div style="font-weight:600">${cam.name}</div>
      <div style="font-size:12px;color:#9fb0cc">${cam.location} • ${cam.ip}</div>
      <img src="${Utils.buildCameraUrl(cam.ip,'capture')}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;" />
      <div style="display:flex;gap:6px;">
        <button class="btn" onclick="captureCamera('${cam.id}','${cam.name}','${cam.ip}')">📸</button>
        <button class="btn" onclick="captureCameraAndDetect('${cam.id}','${cam.name}','${cam.ip}')">🤖</button>
        <button class="btn" onclick="detectWithESP32Camera('${cam.id}','${cam.name}','${cam.ip}')">🔍 ESP32</button>
      </div>
    </div>`;
    grid.appendChild(card);
  });
}

function renderSecurityCaptures() {
  try { EventBus.dispatchEvent(new CustomEvent('priva:render-captures', { detail: State.securityCaptures || [] })); } catch(e){}
  const gallery = document.getElementById('security-captures-gallery');
  if (!gallery) return;
  gallery.innerHTML = '';
  if (!Array.isArray(State.securityCaptures) || State.securityCaptures.length === 0) { gallery.innerHTML = '<div style="opacity:0.6">Aucune capture</div>'; return; }
  State.securityCaptures.slice(0,20).forEach(cap => {
    const el = document.createElement('div');
    el.className = 'panel';
    el.innerHTML = `<img src="${cap.url}" style="width:100%;height:120px;object-fit:cover;border-radius:6px;"/><div style="font-size:12px;margin-top:6px;">${cap.name} • ${(new Date(cap.timestamp)).toLocaleTimeString()}</div>`;
    gallery.appendChild(el);
  });
}

// ==================== CAMÉRA / CAPTURE FUNCTIONS ====================
async function captureCamera(id, name, ip) {
  if (!Utils.validateIP(ip)) { showAlert('danger', '❌ IP invalide'); return; }
  showAlert('warning', '📸 Capture en cours...');
  try {
    const captureUrl = Utils.buildCameraUrl(ip, 'capture');
    const response = await fetch(captureUrl);
    const blob = await response.blob();
    const capture = { id: 'cap_' + Date.now(), cameraId: id, name, timestamp: new Date().toISOString(), url: captureUrl };
    State.securityCaptures.unshift(capture);
    if (State.securityCaptures.length > CONFIG.MAX_CAPTURES) State.securityCaptures = State.securityCaptures.slice(0, CONFIG.MAX_CAPTURES);
    Utils.saveToStorage('priva_security_captures', State.securityCaptures);
    renderSecurityCaptures();
    showAlert('success', `✅ Photo capturée: ${name}`);
    if (CONFIG.AI_AUTO_DETECT) await AIManager.detectImage(blob, name, id);
  } catch (err) {
    console.error('captureCamera error', err);
    showAlert('danger', '❌ Erreur capture');
  }
}

async function captureCameraAndDetect(id, name, ip) {
  showAlert('warning', '📸 Capture + Détection IA...');
  try {
    const captureUrl = Utils.buildCameraUrl(ip, 'capture');
    const response = await fetch(captureUrl);
    const blob = await response.blob();
    const capture = { id: 'cap_' + Date.now(), cameraId: id, name, timestamp: new Date().toISOString(), url: captureUrl };
    State.securityCaptures.unshift(capture);
    if (State.securityCaptures.length > CONFIG.MAX_CAPTURES) State.securityCaptures = State.securityCaptures.slice(0, CONFIG.MAX_CAPTURES);
    Utils.saveToStorage('priva_security_captures', State.securityCaptures);
    renderSecurityCaptures();
    await AIManager.detectImage(blob, name, id);
  } catch (err) {
    console.error('captureCameraAndDetect error', err);
    showAlert('danger', '❌ Erreur capture/détection');
  }
}

async function detectWithESP32Camera(id, name, ip) {
  await AIManager.detectWithESP32(ip, name, id);
}

function captureAllCameras() {
  const active = Object.entries(State.securityCameras || {}).filter(([id, cam]) => cam.active);
  if (active.length === 0) { showAlert('warning', '⚠️ Aucune caméra active'); return; }
  showAlert('warning', `📸 Capture de ${active.length} caméra(s)...`);
  active.forEach(([id, cam], idx) => setTimeout(() => captureCamera(id, cam.name, cam.ip), idx * 500));
}

// ==================== FLASH TOGGLE (ESP32) ====================
async function toggleFlash(id, ip) {
  try {
    const urlOn = Utils.buildCameraEndpoint(ip, 'flash');
    await Utils.fetchWithTimeout(urlOn, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'state=1' });
    setTimeout(async () => { await Utils.fetchWithTimeout(Utils.buildCameraEndpoint(ip, 'flash'), { method: 'POST', body: 'state=0' }); }, 200);
    showAlert('success', '💡 Flash activé');
  } catch (err) {
    // fallback GET
    try {
      await Utils.fetchWithTimeout(Utils.buildCameraEndpoint(ip, 'flash?state=1'));
      setTimeout(async () => { await Utils.fetchWithTimeout(Utils.buildCameraEndpoint(ip, 'flash?state=0')); }, 200);
      showAlert('success', '💡 Flash activé (fallback)');
    } catch (e) {
      console.error('toggleFlash failed', err, e);
      showAlert('danger', '❌ Erreur flash');
    }
  }
}

// ==================== INIT / LOAD STATE ====================
async function loadInitialState() {
  State.devices = await Utils.loadFromStorage('priva_devices', {}) || {};
  State.securityCameras = await Utils.loadFromStorage('priva_security_cameras', {}) || {};
  State.securityCaptures = await Utils.loadFromStorage('priva_security_captures', []) || [];
  // load ai history
  await AIManager.loadHistory();
  // render
  renderDevices();
  renderSecurityCameras();
  renderSecurityCaptures();
}

async function init() {
  if (State.isInitialized) { console.log('⚠️ Application déjà initialisée'); return; }
  console.log('🚀 Initialisation PRIVA...');
  await loadInitialState();
  State.isInitialized = true;
  showAlert('success', '✓ Système initialisé');
  EventBus.dispatchEvent(new CustomEvent('priva:ready', { detail: { state: State } }));
  console.log('✅ PRIVA initialisé');
}

function initAI() { AIManager.loadHistory(); }

// ==================== PHONE CAMERA (client capture + upload) ====================
const PhoneCamera = {
  stream: null,
  track: null,
  intervalId: null,

  async start(constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }) {
    const video = document.getElementById('phone-camera-video');
    if (!video) { showAlert('danger', 'Élément vidéo introuvable'); return; }
    if (this.stream) { try { video.srcObject = this.stream; } catch(e){} showAlert('warning','Caméra déjà démarrée'); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      this.stream = s; this.track = s.getVideoTracks()[0];
      video.srcObject = s; await video.play();
      showAlert('success','✅ Caméra démarrée');
    } catch (err) {
      console.error('start phone camera', err);
      showAlert('danger','Accès caméra échoué (permissions / HTTPS?)');
    }
  },

  stop() {
    const video = document.getElementById('phone-camera-video');
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; this.track = null; if (video) video.srcObject = null; showAlert('success','⏹️ Caméra arrêtée'); }
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
  },

  async captureBlob() {
    const video = document.getElementById('phone-camera-video');
    if (!video || !this.stream) { showAlert('warning','Caméra non démarrée'); return null; }
    const canvas = document.getElementById('phone-camera-canvas') || document.createElement('canvas');
    canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', CONFIG.PHONE_CAPTURE_QUALITY));
    const preview = document.getElementById('phone-camera-preview');
    if (preview) {
      const url = URL.createObjectURL(blob);
      preview.innerHTML = `<img src="${url}" style="width:160px;border-radius:6px" />`;
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    return blob;
  },

  async captureAndDetect() {
    const blob = await this.captureBlob();
    if (!blob) return null;
    return await sendBlobToAI(blob, 'Téléphone', 'phone_cam');
  },

  startAutoDetect(intervalMs = 2000) {
    if (!this.stream) { showAlert('warning','Démarre la caméra d\'abord'); return; }
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(async () => { await this.captureAndDetect(); }, intervalMs);
    showAlert('success','🔁 Détection auto activée');
  },

  stopAutoDetect() {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    showAlert('success','⏸️ Détection auto désactivée');
  }
};

// ==================== EVENTS ====================
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && CameraManager.isActive && State.currentModule === 'security') {
      const active = Object.entries(State.securityCameras).filter(([id, cam]) => cam.active);
      active.forEach(([id, cam]) => { if (!CameraManager.intervals[id]) CameraManager.startRefresh(id, cam.ip); });
    }
  });

  window.addEventListener('beforeunload', () => {
    if (State.dataUpdateInterval) clearInterval(State.dataUpdateInterval);
    if (State.moduleUpdateInterval) clearInterval(State.moduleUpdateInterval);
    CameraManager.stopAll();
  });
}

// ==================== EXPORT Priva ====================
const Priva = {
  CONFIG,
  State,
  EventBus,
  Utils,
  AIManager,
  CameraManager,
  PhoneCamera,
  // device API
  addDeviceFromParams,
  removeDevice,
  assignDeviceModule,
  renderDevices,
  // cameras & captures
  addSecurityCameraFromParams: function(name, ip, location = 'Non spécifié') {
    const id = 'cam_' + Date.now();
    State.securityCameras[id] = { name, ip, location: location || 'Non spécifié', active: true, addedAt: new Date().toISOString() };
    Utils.saveToStorage('priva_security_cameras', State.securityCameras);
    renderSecurityCameras();
    showAlert('success', `✅ ${name} ajoutée`);
    return id;
  },
  addSecurityCamera(name, ip, location = 'Non spécifié') { return this.addSecurityCameraFromParams(name, ip, location); },
  removeSecurityCamera: function(id) {
    const cam = State.securityCameras[id];
    if (!cam) return;
    CameraManager.stopRefresh(id);
    delete State.securityCameras[id];
    Utils.saveToStorage('priva_security_cameras', State.securityCameras);
    renderSecurityCameras();
    showAlert('success', `🗑️ ${cam.name} supprimée`);
  },
  renderSecurityCameras,
  renderSecurityCaptures,
  captureCamera,
  captureCameraAndDetect,
  detectWithESP32Camera,
  captureAllCameras,
  toggleFlash,
  refreshAllCameras: function() {
    Object.entries(State.securityCameras).forEach(([id, cam]) => {
      const img = document.getElementById(`stream-${id}`);
      if (img) img.src = Utils.buildCameraUrl(cam.ip, 'capture');
      EventBus.dispatchEvent(new CustomEvent('priva:camera-frame', { detail: { id, url: Utils.buildCameraUrl(cam.ip, 'capture') } }));
    });
    showAlert('success', '🔄 Caméras rafraîchies');
  },
  // AI
  testAIServer: async function() {
    showAlert('warning','🔍 Test serveur IA...');
    try {
      const res = await Utils.fetchWithTimeout(`${CONFIG.AI_SERVER_URL}/health`);
      const data = await res.json();
      if (data.status === 'healthy') { showAlert('success','✅ Serveur IA opérationnel'); return true; }
    } catch (e) { showAlert('danger','❌ Serveur IA injoignable'); console.error(e); return false; }
    return false;
  },
  getAIModelInfo: async function() {
    try {
      const res = await Utils.fetchWithTimeout(`${CONFIG.AI_SERVER_URL}/info`);
      const data = await res.json();
      try { EventBus.dispatchEvent(new CustomEvent('priva:ai-model-info', { detail: data })); } catch(e){}
      if (typeof document !== 'undefined' && document.getElementById) {
        const infoDiv = document.getElementById('ai-model-info');
        if (infoDiv) infoDiv.innerHTML = `<div style="padding:8px;background:#0b1220;border-radius:6px;"><strong>Modèle:</strong> ${data.model_name}<br><strong>Classes:</strong> ${data.classes?.join(', ')}<br><strong>Version:</strong> ${data.version}</div>`;
      }
      return data;
    } catch (e) { console.error(e); showAlert('danger','❌ Erreur récupération infos modèle'); return null; }
  },
  toggleAutoDetect: function() { CONFIG.AI_AUTO_DETECT = !CONFIG.AI_AUTO_DETECT; const btn = document.getElementById('toggle-auto-detect-btn'); if (btn) { btn.textContent = CONFIG.AI_AUTO_DETECT ? '🤖 Auto: ON' : '🤖 Auto: OFF'; } showAlert(CONFIG.AI_AUTO_DETECT ? 'success' : 'warning', CONFIG.AI_AUTO_DETECT ? '✅ Détection auto activée' : '⏸️ Détection auto désactivée'); },
  sendBlobToAI, // expose the upload helper
  // init
  init,
  initAI,
  // exports for phone camera convenience
  startPhoneCamera: function(opts) { return PhoneCamera.start(opts); },
  stopPhoneCamera: function() { return PhoneCamera.stop(); },
  capturePhoneCameraAndDetect: function() { return PhoneCamera.captureAndDetect(); },
  startPhoneCameraAutoDetect: function(ms) { return PhoneCamera.startAutoDetect(ms); },
  stopPhoneCameraAutoDetect: function() { return PhoneCamera.stopAutoDetect(); }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Priva;
} else if (typeof define === 'function' && define.amd) {
  define(() => Priva);
} else if (typeof window !== 'undefined') {
  window.Priva = Priva;
  window.Priva.EventBus = EventBus;
}

// Auto-init on load (non-blocking)
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => { if (!State.isInitialized) Priva.init(); });
}

console.log('✅ PRIVA app.js loaded (mobile-friendly, devices and phone camera support)');
