// ============================================
// PRIVA Platform - JavaScript v8.0 FIXED
// Dashboard multi-modules simultanés
// ✅ Correction graphiques agriculture appliquée
// ============================================

// ==================== CONFIGURATION ====================

const CONFIG = {
  COMMAND_API_URL: 'https://script.google.com/macros/s/AKfycbwA53tJWrpVpd6WeoAA09FYVe63aFvwy-liD_rQgb2gr_HZ2bYHC1sKajJ4wzwshMC6aA/exec',
  AGRICULTURE_CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQwJjy2KpJJ5X--C87zVuPjykAg9Fyc79zIxpdk1Dt0FvrxYw1Onfzt5wSHOVagvLry9uyyohzeN3h4/pub?output=csv",
  SECURITY_CSV_URL: "https://docs.google.com/spreadsheets/d/12x5LRuFBaKeAfkSxc53uR-6Q3Xcu-OxZt2plY0GZSko/export?format=csv&gid=2127989880",
  PROXIES: [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
    'https://thingproxy.freeboard.io/fetch/',
  ],
  RENDER_URL: 'https://sagitaimage.onrender.com/analyser',
  HF_TOKEN: '',
  HF_MODEL: 'google/vit-base-patch16-224',
  STREAM_TIMEOUT: 8000,
  FALLBACK_REFRESH: 800,
  CAPTURE_QUALITY: 0.85,
  MAX_CAPTURES: 100,
  FETCH_TIMEOUT: 5000,
  ESP32_PORT: 81,
  AI_AUTO_DETECT: false
};

// ==================== ÉTAT GLOBAL ====================

const State = {
  allAgriData: [],
  allSecurityData: [],
  devices: {},
  securityCameras: {},
  securityCaptures: [],
  activeModules: new Set(),
  currentView: 'dashboard',
  moduleIntervals: {},
  climateCharts: {},
  airCharts: {},
  dataUpdateInterval: null,
  isInitialized: false
};

// ==================== UTILITAIRES ====================

const Utils = {
  getNgrokHeaders(url = '') {
    const isNgrok = url.includes('ngrok') || url.includes('.dev') || url.includes('.app') || url.includes('.io');
    return isNgrok ? { 'ngrok-skip-browser-warning': 'true' } : {};
  },

  async fetchWithTimeout(url, options = {}, timeout = CONFIG.FETCH_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const ngrokHeaders = this.getNgrokHeaders(url);
    const mergedOptions = {
      ...options,
      headers: { ...ngrokHeaders, ...(options.headers || {}) },
      signal: controller.signal
    };
    try {
      const response = await fetch(url, mergedOptions);
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  },

  formatDateTime(dateStr) {
    try {
      return new Date(dateStr).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
    } catch { return dateStr; }
  },

  saveToLocalStorage(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); return true; }
    catch (e) { console.error('Erreur localStorage:', e); return false; }
  },

  loadFromLocalStorage(key, defaultValue = null) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultValue;
    } catch (e) { return defaultValue; }
  },

  validateIP(ip) {
    if (!ip) return false;
    if (ip.includes('ngrok') || ip.includes('.dev') || ip.includes('.app') || ip.includes('.io')) return true;
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) return false;
    return ip.split('.').every(o => { const n = parseInt(o, 10); return n >= 0 && n <= 255; });
  },

  buildUrl(ip, endpoint, useStream = false) {
    const isNgrok = ip.includes('ngrok') || ip.includes('.dev') || ip.includes('.app') || ip.includes('.io');
    const protocol = isNgrok ? 'https' : 'http';
    const port = isNgrok ? '' : `:${CONFIG.ESP32_PORT}`;
    const ts = useStream ? '' : `?t=${Date.now()}`;
    return `${protocol}://${ip}${port}/${endpoint}${ts}`;
  }
};

// ==================== STREAM MANAGER ====================

const StreamManager = {
  streams: {},

  start(camId, ip) {
    if (!Utils.validateIP(ip)) return;
    this.stop(camId);
    this.streams[camId] = { mode: null, interval: null, failCount: 0, ip };
    this._tryMJPEG(camId, ip);
  },

  _tryMJPEG(camId, ip) {
    const img = document.getElementById(`stream-${camId}`);
    if (!img) return;
    const streamUrl = Utils.buildUrl(ip, 'stream', true);
    this._updateStatus(camId, 'connecting');
    const timeout = setTimeout(() => this._startFallback(camId, ip), CONFIG.STREAM_TIMEOUT);
    img.onload = () => { clearTimeout(timeout); this.streams[camId].mode = 'mjpeg'; this._updateStatus(camId, 'online'); };
    img.onerror = () => { clearTimeout(timeout); this._startFallback(camId, ip); };
    img.src = streamUrl;
  },

  _startFallback(camId, ip) {
    const img = document.getElementById(`stream-${camId}`);
    if (!img) return;
    this.streams[camId].mode = 'fallback';
    let consecutiveErrors = 0;
    const MAX_ERRORS = 5;
    const isNgrok = ip.includes('ngrok') || ip.includes('.dev') || ip.includes('.app') || ip.includes('.io');
    const refresh = async () => {
      if (!this.streams[camId]) return;
      try {
        if (isNgrok) {
          const response = await fetch(Utils.buildUrl(ip, 'capture'), {
            headers: { 'ngrok-skip-browser-warning': 'true' }
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
          img.src = objectUrl;
          consecutiveErrors = 0;
          this._updateStatus(camId, 'online');
          this._updateFPS(camId);
        } else {
          const testImg = new Image();
          const captureUrl = Utils.buildUrl(ip, 'capture');
          testImg.onload = () => { consecutiveErrors = 0; img.src = captureUrl; this._updateStatus(camId, 'online'); this._updateFPS(camId); };
          testImg.onerror = () => { consecutiveErrors++; if (consecutiveErrors >= MAX_ERRORS) this._updateStatus(camId, 'offline'); };
          testImg.src = captureUrl;
        }
      } catch {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_ERRORS) this._updateStatus(camId, 'offline');
      }
    };
    refresh();
    this.streams[camId].interval = setInterval(refresh, CONFIG.FALLBACK_REFRESH);
    this._updateStatus(camId, 'fallback');
  },

  async capture(camId, ip) {
    const captureUrl = Utils.buildUrl(ip, 'capture');
    const isNgrok = ip.includes('ngrok') || ip.includes('.dev') || ip.includes('.app') || ip.includes('.io');
    const response = await fetch(captureUrl, { headers: isNgrok ? { 'ngrok-skip-browser-warning': 'true' } : {} });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.blob();
  },

  stop(camId) {
    if (this.streams[camId]) {
      if (this.streams[camId].interval) clearInterval(this.streams[camId].interval);
      const img = document.getElementById(`stream-${camId}`);
      if (img) { if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src); img.src = ''; }
      delete this.streams[camId];
    }
  },

  stopAll() { Object.keys(this.streams).forEach(id => this.stop(id)); },
  restart(camId, ip) { this.stop(camId); setTimeout(() => this.start(camId, ip), 500); },

  _fpsData: {},

  _updateFPS(camId) {
    if (!this._fpsData[camId]) this._fpsData[camId] = { count: 0, lastTime: Date.now() };
    this._fpsData[camId].count++;
    const now = Date.now(), elapsed = now - this._fpsData[camId].lastTime;
    if (elapsed >= 1000) {
      const fps = Math.round(this._fpsData[camId].count * 1000 / elapsed);
      const el = document.getElementById(`fps-${camId}`);
      if (el) el.textContent = fps;
      this._fpsData[camId].count = 0;
      this._fpsData[camId].lastTime = now;
    }
  },

  _updateStatus(camId, status) {
    const configs = {
      online: { color: '#00a651', text: 'En ligne', loading: false },
      offline: { color: '#e63946', text: 'Hors ligne', loading: true },
      connecting: { color: '#f77f00', text: 'Connexion...', loading: true },
      fallback: { color: '#3b82f6', text: 'Mode photo', loading: false }
    };
    const cfg = configs[status] || configs.offline;
    const indicator = document.getElementById(`status-${camId}`);
    const label = document.getElementById(`status-label-${camId}`);
    const loading = document.getElementById(`loading-${camId}`);
    const card = document.getElementById(`sec-cam-${camId}`);
    if (indicator) { indicator.style.background = cfg.color; indicator.title = cfg.text; }
    if (label) { label.textContent = cfg.text; label.style.color = cfg.color; }
    if (card) card.classList.toggle('offline', status === 'offline');
    if (loading) { loading.style.display = cfg.loading ? 'flex' : 'none'; if (cfg.loading) loading.textContent = cfg.text; }
    const miniDot = document.getElementById(`dash-cam-dot-${camId}`);
    if (miniDot) miniDot.style.background = cfg.color;
  }
};

// ==================== DASHBOARD MANAGER ====================

const DashboardManager = {
  render() {
    const container = document.getElementById('dashboard-modules');
    if (!container) return;

    const devices = Object.entries(State.devices);

    if (!devices.length) {
      container.innerHTML = `
        <div class="dashboard-empty">
          <div style="font-size:60px;margin-bottom:20px;">📡</div>
          <h3>Aucun appareil configuré</h3>
          <p style="opacity:0.6;margin-bottom:20px;">Ajoutez votre premier ESP32 pour commencer</p>
          <button class="btn btn-primary" onclick="showDeviceManager()">➕ Ajouter un appareil</button>
        </div>`;
      return;
    }

    const agriDevices = devices.filter(([,d]) => d.type === 'agriculture');
    const secDevices = devices.filter(([,d]) => d.type === 'security');

    let html = '';

    if (agriDevices.length) {
      html += `<div class="dashboard-section">
        <div class="dashboard-section-title">🌱 Agriculture <span class="badge">${agriDevices.length}</span></div>
        <div class="dashboard-cards-row">
        ${agriDevices.map(([id, dev]) => this._renderAgriCard(id, dev)).join('')}
        </div>
      </div>`;
    }

    if (secDevices.length) {
      html += `<div class="dashboard-section">
        <div class="dashboard-section-title">🔒 Sécurité <span class="badge">${secDevices.length}</span></div>
        <div class="dashboard-cards-row">
        ${secDevices.map(([id, dev]) => this._renderSecCard(id, dev)).join('')}
        </div>
      </div>`;
    }

    const cameras = Object.entries(State.securityCameras).filter(([,c]) => c.active);

    if (cameras.length) {
      html += `<div class="dashboard-section">
        <div class="dashboard-section-title">📹 Caméras <span class="badge">${cameras.length}</span>
        <button class="btn btn-small btn-primary" onclick="openCameraView()" style="margin-left:10px;">Voir toutes</button>
        </div>
        <div class="dashboard-cameras-mini">
        ${cameras.map(([id, cam]) => this._renderMiniCam(id, cam)).join('')}
        </div>
      </div>`;
    }

    container.innerHTML = html;

    cameras.forEach(([id, cam]) => {
      const miniImg = document.getElementById(`mini-stream-${id}`);
      if (miniImg) this._startMiniStream(id, cam.ip, miniImg);
    });

    this.startAllUpdates();
  },

  _renderAgriCard(id, dev) {
    const isOpen = State.activeModules.has(`agri-${id}`);

    return `
      <div class="dash-card dash-card-agri ${dev.active ? '' : 'dash-card-inactive'}" id="dash-card-${id}">
        <div class="dash-card-header">
          <div>
            <span class="dash-card-icon">🌱</span>
            <strong>${dev.name}</strong>
            <span class="dash-status-dot ${dev.active ? 'dot-active' : 'dot-inactive'}"
              id="dash-dot-${id}"></span>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-small btn-success"
              onclick="toggleModulePanel('agri', '${id}')"
              id="btn-toggle-agri-${id}">
              ${isOpen ? '▼ Réduire' : '▶ Ouvrir'}
            </button>
          </div>
        </div>

        <div class="dash-metrics" id="dash-metrics-${id}">
          <div class="dash-metric">
            <span class="metric-icon">🌡️</span>
            <span class="metric-val" id="dash-temp-${id}">--</span>
            <span class="metric-unit">°C</span>
          </div>
          <div class="dash-metric">
            <span class="metric-icon">💧</span>
            <span class="metric-val" id="dash-hum-${id}">--</span>
            <span class="metric-unit">%</span>
          </div>
          <div class="dash-metric">
            <span class="metric-icon">💨</span>
            <span class="metric-val" id="dash-gas-${id}">--</span>
            <span class="metric-unit">ppm</span>
          </div>
          <div class="dash-metric">
            <span class="metric-icon">⚡</span>
            <span class="metric-val" id="dash-dc-${id}">--</span>
            <span class="metric-unit">V</span>
          </div>
        </div>

        <div class="dash-panel" id="panel-agri-${id}" style="display:${isOpen ? 'block' : 'none'}">
          ${this._renderAgriPanel(id, dev)}
        </div>

        <div class="dash-card-footer">
          📍 ${dev.location} •
          <span id="dash-mode-${id}" style="color:#10b981;font-weight:bold;">--</span>
        </div>
      </div>`;
  },

  _renderAgriPanel(id, dev) {
    return `
      <div class="module-panel">
        <div class="panel-ip-row">
          <input type="text" id="panel-ip-${id}" value="${dev.ip}"
            placeholder="IP ou URL ngrok"
            style="flex:1;padding:6px 10px;background:#0f1117;border:1px solid #2d3142;border-radius:5px;color:white;font-size:12px;">
          <button class="btn btn-small btn-success" onclick="updateDeviceIPDash('${id}')">💾</button>
          <button class="btn btn-small btn-primary" onclick="testDeviceConnectionDash('${id}')">🔍</button>
        </div>

        <div class="panel-section-title">⚡ Actionneurs</div>
        <div class="actuators-grid-mini">
          ${['pompe','brumisateur','ventilateur','chauffage','eclairage','electrovanne'].map(d => `
            <div class="actuator-mini ${d}Card-${id}" id="${d}Card-${id}">
              <span>${{pompe:'💧',brumisateur:'💦',ventilateur:'🌀',chauffage:'🔥',eclairage:'💡',electrovanne:'🚰'}[d]}</span>
              <span style="font-size:10px;">${d}</span>
              <button class="actuator-btn" onclick="toggleDevice('agriculture','${d}','${id}')">
                <span id="${d}Status-${id}">Arrêté</span>
              </button>
            </div>`).join('')}
        </div>

        <div class="panel-section-title">🎮 Modes</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-small btn-success" onclick="setMode('auto','${id}')">🤖 Auto</button>
          <button class="btn btn-small btn-primary" onclick="setMode('manuel','${id}')">✋ Manuel</button>
          <button class="btn btn-small btn-danger" onclick="emergencyStop('${id}')">🛑 Urgence</button>
        </div>

        <div class="panel-section-title">📊 Températures (dernières mesures)</div>
        <div style="height:200px;position:relative;margin:10px 0;border:1px solid #2d3142;border-radius:8px;padding:5px;">
          <canvas id="mini-chart-${id}" style="display:block;"></canvas>
        </div>
      </div>`;
  },

  _renderSecCard(id, dev) {
    const isOpen = State.activeModules.has(`sec-${id}`);

    return `
      <div class="dash-card dash-card-sec ${dev.active ? '' : 'dash-card-inactive'}" id="dash-card-${id}">
        <div class="dash-card-header">
          <div>
            <span class="dash-card-icon">🔒</span>
            <strong>${dev.name}</strong>
            <span class="dash-status-dot ${dev.active ? 'dot-active' : 'dot-inactive'}"
              id="dash-dot-${id}"></span>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-small btn-primary"
              onclick="toggleModulePanel('sec', '${id}')"
              id="btn-toggle-sec-${id}">
              ${isOpen ? '▼ Réduire' : '▶ Ouvrir'}
            </button>
          </div>
        </div>

        <div class="dash-metrics" id="dash-metrics-${id}">
          <div class="dash-metric">
            <span class="metric-icon">🚪</span>
            <span class="metric-val metric-small" id="dash-door-${id}">--</span>
          </div>
          <div class="dash-metric">
            <span class="metric-icon">👤</span>
            <span class="metric-val metric-small" id="dash-motion-${id}">--</span>
          </div>
          <div class="dash-metric">
            <span class="metric-icon">🔑</span>
            <span class="metric-val metric-small" id="dash-badge-${id}">--</span>
          </div>
        </div>

        <div class="dash-panel" id="panel-sec-${id}" style="display:${isOpen ? 'block' : 'none'}">
          ${this._renderSecPanel(id, dev)}
        </div>

        <div class="dash-card-footer">📍 ${dev.location}</div>
      </div>`;
  },

  _renderSecPanel(id, dev) {
    return `
      <div class="module-panel">
        <div class="panel-ip-row">
          <input type="text" id="panel-ip-${id}" value="${dev.ip}"
            placeholder="IP ou URL ngrok"
            style="flex:1;padding:6px 10px;background:#0f1117;border:1px solid #2d3142;border-radius:5px;color:white;font-size:12px;">
          <button class="btn btn-small btn-success" onclick="updateDeviceIPDash('${id}')">💾</button>
          <button class="btn btn-small btn-primary" onclick="testDeviceConnectionDash('${id}')">🔍</button>
        </div>

        <div class="panel-section-title">🔐 Accès & Sécurité</div>
        <div class="actuators-grid-mini">
          ${['lock','alarm','lights'].map(d => `
            <div class="actuator-mini" id="${d}Card-${id}">
              <span>${{lock:'🔒',alarm:'🚨',lights:'💡'}[d]}</span>
              <span style="font-size:10px;">${d}</span>
              <button class="actuator-btn" onclick="toggleDevice('security','${d}','${id}')">
                <span id="${d}Status-${id}">${{lock:'Verrouillée',alarm:'Désactivée',lights:'Éteintes'}[d]}</span>
              </button>
            </div>`).join('')}
        </div>

        <div class="panel-section-title">📋 Derniers accès</div>
        <div id="sec-access-log-${id}" style="font-size:11px;max-height:100px;overflow-y:auto;opacity:0.8;">
          Chargement...
        </div>
      </div>`;
  },

  _renderMiniCam(id, cam) {
    return `
      <div class="mini-cam-card" onclick="openCameraFullscreen('${id}','${cam.name}','${cam.ip}')">
        <div class="mini-cam-overlay">
          <span class="mini-cam-dot" id="dash-cam-dot-${id}"></span>
          <span style="font-size:11px;">${cam.name}</span>
        </div>
        <img id="mini-stream-${id}" style="width:100%;height:100%;object-fit:cover;" alt="${cam.name}">
        <div class="mini-cam-buttons" onclick="event.stopPropagation()">
          <button onclick="captureCamera('${id}','${cam.name}','${cam.ip}')">📸</button>
          <button onclick="captureCameraAndDetect('${id}','${cam.name}','${cam.ip}')">🤖</button>
        </div>
      </div>`;
  },

  _miniStreams: {},

  _startMiniStream(id, ip, imgEl) {
    if (this._miniStreams[id]) clearInterval(this._miniStreams[id]);

    const isNgrok = ip.includes('ngrok') || ip.includes('.dev') || ip.includes('.app') || ip.includes('.io');

    if (!isNgrok) {
      imgEl.src = Utils.buildUrl(ip, 'stream', true);
      imgEl.onerror = () => {
        imgEl.onerror = null;
        this._miniStreams[id] = setInterval(() => { imgEl.src = Utils.buildUrl(ip, 'capture'); }, 2000);
      };
    } else {
      const refresh = async () => {
        try {
          const res = await fetch(Utils.buildUrl(ip, 'capture'), { headers: { 'ngrok-skip-browser-warning': 'true' } });
          if (!res.ok) return;
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          if (imgEl.src.startsWith('blob:')) URL.revokeObjectURL(imgEl.src);
          imgEl.src = url;
          const dot = document.getElementById(`dash-cam-dot-${id}`);
          if (dot) dot.style.background = '#00a651';
        } catch {}
      };
      refresh();
      this._miniStreams[id] = setInterval(refresh, 2000);
    }
  },

  stopMiniStreams() {
    Object.values(this._miniStreams).forEach(iv => clearInterval(iv));
    this._miniStreams = {};
  },

  startAllUpdates() {
    Object.values(State.moduleIntervals).forEach(iv => clearInterval(iv));
    State.moduleIntervals = {};

    Object.entries(State.devices).forEach(([id, dev]) => {
      if (!dev.active) return;

      const update = dev.type === 'agriculture'
        ? () => this._updateAgriCard(id, dev.ip)
        : () => this._updateSecCard(id, dev.ip);

      update();
      State.moduleIntervals[id] = setInterval(update, 3000);
    });
  },

  async _updateAgriCard(id, ip) {
    try {
      const res = await Utils.fetchWithTimeout(Utils.buildUrl(ip, 'status'), { mode: 'cors' });
      const data = await res.json();

      const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.textContent = val; };

      setVal(`dash-temp-${id}`, parseFloat(data.temperature).toFixed(1));
      setVal(`dash-hum-${id}`, parseFloat(data.humidity).toFixed(1));
      setVal(`dash-gas-${id}`, parseFloat(data.gas).toFixed(0));
      setVal(`dash-dc-${id}`, parseFloat(data.dc).toFixed(2));
      setVal(`dash-mode-${id}`, data.mode?.toUpperCase() || '--');

      const dot = document.getElementById(`dash-dot-${id}`);
      if (dot) { dot.classList.remove('dot-inactive'); dot.classList.add('dot-active'); }

      if (State.activeModules.has(`agri-${id}`)) {
        ['pompe','brumisateur','ventilateur','chauffage','eclairage','electrovanne'].forEach(d => {
          updateDeviceUIDash(d, data.devices?.[d], id);
        });
        updateMiniChart(id, data);
      }
    } catch {
      const dot = document.getElementById(`dash-dot-${id}`);
      if (dot) { dot.classList.remove('dot-active'); dot.classList.add('dot-inactive'); }
    }
  },

  async _updateSecCard(id, ip) {
    try {
      const res = await Utils.fetchWithTimeout(Utils.buildUrl(ip, 'status'), { mode: 'cors' });
      const data = await res.json();

      const setVal = (elId, val, color) => {
        const el = document.getElementById(elId);
        if (el) { el.textContent = val; if (color) el.style.color = color; }
      };

      const doorColor = data.doorOpen ? '#e63946' : '#00a651';
      const motionColor = data.motionDetected ? '#f77f00' : '#00a651';

      setVal(`dash-door-${id}`, data.doorOpen ? 'OUVERTE' : 'FERMÉE', doorColor);
      setVal(`dash-motion-${id}`, data.motionDetected ? 'DÉTECTÉ' : 'AUCUN', motionColor);
      setVal(`dash-badge-${id}`, data.lastBadge || '--');

      const dot = document.getElementById(`dash-dot-${id}`);
      if (dot) { dot.classList.remove('dot-inactive'); dot.classList.add('dot-active'); }

      if (State.activeModules.has(`sec-${id}`)) {
        ['lock','alarm','lights'].forEach(d => updateDeviceUIDash(d, data.devices?.[d], id));

        const log = document.getElementById(`sec-access-log-${id}`);
        if (log && data.lastBadge) {
          log.innerHTML = `<div>🔑 ${data.lastBadge} — ${new Date(data.lastAccess).toLocaleTimeString('fr-FR')}</div>`;
        }
      }
    } catch {
      const dot = document.getElementById(`dash-dot-${id}`);
      if (dot) { dot.classList.remove('dot-active'); dot.classList.add('dot-inactive'); }
    }
  }
};

// ==================== TOGGLE PANNEAU ====================

function toggleModulePanel(type, deviceId) {
  const key = `${type}-${deviceId}`;
  const panel = document.getElementById(`panel-${type}-${deviceId}`);
  const btn = document.getElementById(`btn-toggle-${type}-${deviceId}`);

  if (!panel) return;

  if (State.activeModules.has(key)) {
    // Fermer
    State.activeModules.delete(key);
    panel.style.display = 'none';
    if (btn) btn.textContent = '▶ Ouvrir';

    // Détruire graphique agriculture
    if (type === 'agri' && State.climateCharts[deviceId]) {
      try {
        State.climateCharts[deviceId].destroy();
        delete State.climateCharts[deviceId];
        console.log(`[CHART] Destroyed chart for ${deviceId}`);
      } catch (e) {
        console.warn(`[CHART] Error destroying chart:`, e.message);
      }
    }
  } else {
    // Ouvrir
    State.activeModules.add(key);
    panel.style.display = 'block';
    if (btn) btn.textContent = '▼ Réduire';

    // ✅ PATCH: Augmenter le délai à 300ms pour laisser le temps au canvas de se render
    if (type === 'agri') {
      console.log(`[CHART] Opening panel for device: ${deviceId}, initializing chart in 300ms...`);
      setTimeout(() => {
        initMiniChart(deviceId);
      }, 300);
    }

    if (type === 'sec') {
      initSecurityCameras();
    }
  }
}

// ✅ PATCH: Initialisation robuste du graphique avec validation complète
function initMiniChart(deviceId) {
  console.log(`[CHART] Attempting to initialize chart for ${deviceId}...`);
  
  const canvas = document.getElementById(`mini-chart-${deviceId}`);
  if (!canvas) {
    console.error(`[CHART ERROR] Canvas mini-chart-${deviceId} not found in DOM`);
    return false;
  }

  console.log(`[CHART] Canvas found, checking Chart.js library...`);

  // Vérifier que Chart.js est chargé
  if (typeof Chart === 'undefined') {
    console.error('[CHART ERROR] Chart.js library not loaded');
    return false;
  }

  // Obtenir le contexte 2D
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error(`[CHART ERROR] Cannot get 2D context for canvas mini-chart-${deviceId}`);
    return false;
  }

  console.log(`[CHART] Canvas and context valid, destroying old chart if exists...`);

  // Détruire l'ancien graphique
  if (State.climateCharts[deviceId]) {
    try {
      State.climateCharts[deviceId].destroy();
      delete State.climateCharts[deviceId];
      console.log(`[CHART] Old chart destroyed successfully`);
    } catch (e) {
      console.warn('[CHART] Old chart destruction warning:', e.message);
    }
  }

  try {
    console.log(`[CHART] Creating new Chart instance...`);
    
    State.climateCharts[deviceId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Temp °C',
            data: [],
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.1)',
            tension: 0.4,
            borderWidth: 2,
            fill: true,
            pointRadius: 3,
            pointBackgroundColor: '#ef4444',
            pointBorderColor: '#ef4444'
          },
          {
            label: 'Humidité %',
            data: [],
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.1)',
            tension: 0.4,
            borderWidth: 2,
            fill: true,
            pointRadius: 3,
            pointBackgroundColor: '#3b82f6',
            pointBorderColor: '#3b82f6'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 0 // ✅ Pas d'animation pour la performance
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              color: '#9ca3af',
              font: { size: 12 },
              boxWidth: 12,
              padding: 15
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.8)',
            padding: 12,
            cornerRadius: 8,
            titleColor: '#fff',
            bodyColor: '#fff'
          }
        },
        scales: {
          x: {
            ticks: {
              color: '#9ca3af',
              maxRotation: 45,
              font: { size: 10 }
            },
            grid: {
              color: '#2d3142',
              drawBorder: false
            }
          },
          y: {
            ticks: {
              color: '#9ca3af',
              font: { size: 10 }
            },
            grid: {
              color: '#2d3142',
              drawBorder: false
            },
            beginAtZero: false
          }
        }
      }
    });

    console.log(`[CHART] ✅ Chart successfully initialized for device: ${deviceId}`);
    return true;
  } catch (error) {
    console.error(`[CHART ERROR] Failed to create Chart for ${deviceId}:`, error.message, error.stack);
    return false;
  }
}

// ✅ PATCH: Mise à jour sécurisée du graphique
function updateMiniChart(deviceId, data) {
  const chart = State.climateCharts[deviceId];
  if (!chart) {
    console.debug(`[CHART] Chart not found for ${deviceId} - skipping update`);
    return false;
  }

  try {
    const now = new Date().toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const temp = parseFloat(data.temperature) || 0;
    const hum = parseFloat(data.humidity) || 0;

    // Vérifier que les datasets existent et sont valides
    if (!chart.data.datasets || !chart.data.datasets[0] || !chart.data.datasets[1]) {
      console.error(`[CHART] Invalid datasets structure for ${deviceId}`);
      return false;
    }

    chart.data.labels.push(now);
    chart.data.datasets[0].data.push(temp);
    chart.data.datasets[1].data.push(hum);

    // ✅ PATCH: Garder max 30 points pour meilleure lisibilité
    if (chart.data.labels.length > 30) {
      chart.data.labels.shift();
      chart.data.datasets.forEach(ds => {
        if (ds.data && ds.data.length > 0) {
          ds.data.shift();
        }
      });
    }

    chart.update('none'); // Sans animation pour la performance
    return true;
  } catch (error) {
    console.error(`[CHART] Error updating chart for ${deviceId}:`, error.message);
    return false;
  }
}

// ==================== ACTIONNEUR DASHBOARD ====================

function updateDeviceUIDash(device, state, deviceId) {
  const card = document.getElementById(`${device}Card-${deviceId}`);
  const status = document.getElementById(`${device}Status-${deviceId}`);

  if (!card || !status) return;

  const labels = {
    active: { pompe:'Actif', brumisateur:'Actif', ventilateur:'Actif', chauffage:'Actif', eclairage:'Allumé', electrovanne:'Ouverte', lock:'Déverrouillée', alarm:'Activée', lights:'Allumées' },
    inactive: { pompe:'Arrêté', brumisateur:'Arrêté', ventilateur:'Arrêté', chauffage:'Arrêté', eclairage:'Éteint', electrovanne:'Fermée', lock:'Verrouillée', alarm:'Désactivée', lights:'Éteintes' }
  };

  if (state) {
    card.classList.add('active');
    status.textContent = labels.active[device] || 'Actif';
  } else {
    card.classList.remove('active');
    status.textContent = labels.inactive[device] || 'Arrêté';
  }
}

async function updateDeviceIPDash(deviceId) {
  const dev = State.devices[deviceId];
  if (!dev) return;

  const newIP = document.getElementById(`panel-ip-${deviceId}`)?.value.trim();

  if (!newIP || !Utils.validateIP(newIP)) {
    showAlert('warning', '⚠️ IP invalide');
    return;
  }

  dev.ip = newIP;
  Utils.saveToLocalStorage('priva_devices', State.devices);

  showAlert('success', `✅ IP mise à jour: ${newIP}`);

  if (State.moduleIntervals[deviceId]) clearInterval(State.moduleIntervals[deviceId]);
  DashboardManager.startAllUpdates();
}

async function testDeviceConnectionDash(deviceId) {
  const dev = State.devices[deviceId];
  if (!dev) return;

  showAlert('warning', `🔍 Test ${dev.name}...`);

  try {
    await Utils.fetchWithTimeout(Utils.buildUrl(dev.ip, ''));
    showAlert('success', `✅ ${dev.name} répond`);
  } catch {
    showAlert('danger', `❌ ${dev.name} ne répond pas`);
  }
}

// ==================== ACTIONNEURS ====================

async function toggleDevice(module, device, deviceId) {
  const dev = deviceId ? State.devices[deviceId] : Object.values(State.devices).find(d => d.type === module && d.active);
  const card = document.getElementById(`${device}Card-${deviceId || ''}`);
  const newState = !card?.classList.contains('active');

  if (dev) {
    try {
      const res = await Utils.fetchWithTimeout(
        Utils.buildUrl(dev.ip, 'control'),
        { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: `device=${device}&state=${newState?1:0}` }
      );

      if (res.ok) {
        updateDeviceUIDash(device, newState, deviceId);
        showAlert('success', `✅ ${device} ${newState?'activé':'désactivé'}`);
        return;
      }
    } catch {}
  }

  try {
    const res = await fetch(CONFIG.COMMAND_API_URL, {
      method: 'POST',
      headers: {'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({ cible: module, actionneur: device, etat: newState?1:0 })
    });

    const result = await res.json();
    if (result.status === 'success') {
      updateDeviceUIDash(device, newState, deviceId);
      showAlert('success', `✅ ${device} (cloud)`);
    }
  } catch {
    showAlert('danger', '❌ Erreur commande');
  }
}

async function setMode(mode, deviceId) {
  const dev = deviceId ? State.devices[deviceId] : Object.values(State.devices).find(d => d.type === 'agriculture' && d.active);

  if (dev) {
    try {
      const res = await Utils.fetchWithTimeout(
        Utils.buildUrl(dev.ip, 'mode'),
        { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: `mode=${mode}` }
      );

      if (res.ok) {
        const el = document.getElementById(`dash-mode-${deviceId}`);
        if (el) el.textContent = mode.toUpperCase();
        showAlert('success', `✅ Mode ${mode}`);
        return;
      }
    } catch {}
  }

  showAlert('warning', '⚠️ Connectez un ESP32');
}

async function emergencyStop(deviceId) {
  if (!confirm('⚠️ CONFIRMER L\'ARRÊT D\'URGENCE ?')) return;

  const dev = deviceId ? State.devices[deviceId] : Object.values(State.devices).find(d => d.type === 'agriculture' && d.active);
  if (dev) {
    try {
      await Utils.fetchWithTimeout(Utils.buildUrl(dev.ip, 'emergency'), {method:'POST'});
    } catch {}
  }

  showAlert('danger', '🛑 ARRÊT D\'URGENCE ACTIVÉ');
}

// ==================== ALERTES ====================

function showAlert(type, msg) {
  const alert = document.createElement('div');
  alert.className = `alert ${type}`;
  alert.textContent = msg;

  const container = document.getElementById('alertContainer');
  if (container) {
    container.appendChild(alert);
    setTimeout(() => alert.remove(), 5000);
  }
}

// ==================== DONNÉES ====================

async function fetchCSVWithFallback(csvUrl) {
  const proxies = CONFIG.PROXIES;

  for (let i = 0; i < proxies.length; i++) {
    const proxyUrl = proxies[i] + encodeURIComponent(csvUrl);

    try {
      const res = await Utils.fetchWithTimeout(proxyUrl, {}, 6000);

      if (res.ok) {
        const text = await res.text();
        if (text && !text.trim().startsWith('<') && text.includes(',')) {
          console.log('[CSV] Proxy ' + (i+1) + ' OK');
          return text;
        }
      }
    } catch (e) {
      console.warn('[CSV] Proxy ' + (i+1) + ' echoue:', e.message);
    }
  }

  throw new Error('Tous les proxies ont echoue');
}

async function loadAgricultureData() {
  try {
    const csv = await fetchCSVWithFallback(CONFIG.AGRICULTURE_CSV_URL);
    const rows = csv.trim().split('\n').map(r => r.split(',').map(c => c.trim()));

    State.allAgriData = rows.slice(1).filter(r => r.length >= 3);

    if (State.allAgriData.length > 0) {
      updateAgricultureTable();
      const el = document.getElementById('dataCount');
      if (el) el.textContent = State.allAgriData.length;
    }
  } catch (e) {
    console.error('[CSV] Agriculture impossible a charger:', e.message);
  }
}

async function loadSecurityData() {
  try {
    const csv = await fetchCSVWithFallback(CONFIG.SECURITY_CSV_URL);
    const rows = csv.trim().split('\n').map(r => r.split(',').map(c => c.trim()));

    State.allSecurityData = rows.slice(1).filter(r => r.length >= 3);

    if (State.allSecurityData.length > 0) updateSecurityTable();
  } catch (e) {
    console.error('[CSV] Securite impossible a charger:', e.message);
  }
}

function updateAgricultureTable() {
  const tbody = document.getElementById('dataTable');
  if (!tbody) return;

  const data = State.allAgriData.slice(-10).reverse();

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Aucune donnée</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(r => `<tr><td>${r[0]}</td><td>${parseFloat(r[1]).toFixed(1)}°C</td><td>${parseFloat(r[2]).toFixed(1)}%</td><td>${parseFloat(r[3]).toFixed(0)} ppm</td><td>${parseFloat(r[4]).toFixed(2)}V</td></tr>`).join('');
}

function updateSecurityTable() {
  const tbody = document.getElementById('securityTable');
  if (!tbody) return;

  const data = State.allSecurityData.slice(-10).reverse();

  tbody.innerHTML = data.map(r => {
    const auth = r[4] === 'Oui';
    return `<tr><td>${r[0]}</td><td>${r[1]||'--'}</td><td>${r[2]||'--'}</td><td>${r[3]||'--'}</td><td style="color:${auth?'#00a651':'#e63946'};font-weight:bold;">${r[4]||'--'}</td><td>${r[5]||'--'}</td></tr>`;
  }).join('');
}

// ==================== INIT ====================

function init() {
  if (State.isInitialized) return;

  console.log('[INIT] Starting PRIVA v8.0 FIXED...');
  console.log('[INIT] Chart.js version:', typeof Chart !== 'undefined' ? Chart.version : 'NOT LOADED');

  State.devices = Utils.loadFromLocalStorage('priva_devices', {});
  State.securityCameras = Utils.loadFromLocalStorage('priva_security_cameras', {});
  State.securityCaptures = Utils.loadFromLocalStorage('priva_security_captures', []);

  loadAgricultureData();
  loadSecurityData();

  State.dataUpdateInterval = setInterval(() => {
    loadAgricultureData();
    loadSecurityData();
  }, 10000);

  console.log('[INIT] Rendering dashboard...');
  DashboardManager.render();

  State.isInitialized = true;
  showAlert('success', '✅ PRIVA v8.0 FIXED initialisé');
  console.log('[INIT] Complete. Devices:', Object.keys(State.devices));
}

// ==================== NAVIGATION ====================

function showDashboard() {
  document.getElementById('dashboard')?.style.setProperty('display', 'block');
  document.getElementById('deviceManager')?.style.setProperty('display', 'none');
  document.getElementById('aiPanel')?.style.setProperty('display', 'none');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.tab-btn[onclick*="showDashboard"]')?.classList.add('active');
  DashboardManager.render();
}

function showDeviceManager() {
  document.getElementById('dashboard')?.style.setProperty('display', 'none');
  document.getElementById('deviceManager')?.style.setProperty('display', 'block');
  document.getElementById('aiPanel')?.style.setProperty('display', 'none');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.tab-btn[onclick*="showDeviceManager"]')?.classList.add('active');
}

function showAIPanel() {
  document.getElementById('dashboard')?.style.setProperty('display', 'none');
  document.getElementById('deviceManager')?.style.setProperty('display', 'none');
  document.getElementById('aiPanel')?.style.setProperty('display', 'block');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.tab-btn[onclick*="showAIPanel"]')?.classList.add('active');
}

function openCameraView() {
  document.getElementById('dashboard')?.style.setProperty('display', 'none');
  document.getElementById('cameraView')?.style.setProperty('display', 'block');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  setTimeout(() => initSecurityCameras(), 100);
}
