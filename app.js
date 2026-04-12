// ============================================
// PRIVA Platform - JavaScript v7.0
// Dashboard multi-modules simultanés
// ============================================

// ==================== CONFIGURATION ====================
const CONFIG = {
  COMMAND_API_URL: 'https://script.google.com/macros/s/AKfycbwA53tJWrpVpd6WeoAA09FYVe63aFvwy-liD_rQgb2gr_HZ2bYHC1sKajJ4wzwshMC6aA/exec',
  AGRICULTURE_CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQwJjy2KpJJ5X--C87zVuPjykAg9Fyc79zIxpdk1Dt0FvrxYw1Onfzt5wSHOVagvLry9uyyohzeN3h4/pub?output=csv",
  SECURITY_CSV_URL: "https://docs.google.com/spreadsheets/d/12x5LRuFBaKeAfkSxc53uR-6Q3Xcu-OxZt2plY0GZSko/export?format=csv&gid=2127989880",
  PROXY: 'https://api.allorigins.win/raw?url=',
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
  activeModules: new Set(),   // modules ouverts simultanément
  currentView: 'dashboard',   // 'dashboard' | 'deviceManager'
  moduleIntervals: {},         // { deviceId: intervalId } — un interval par appareil
  climateCharts: {},           // { deviceId: chartInstance }
  airCharts: {},               // { deviceId: chartInstance }
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
      online:     { color: '#00a651', text: 'En ligne',     loading: false },
      offline:    { color: '#e63946', text: 'Hors ligne',   loading: true  },
      connecting: { color: '#f77f00', text: 'Connexion...', loading: true  },
      fallback:   { color: '#3b82f6', text: 'Mode photo',   loading: false }
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

    // Mettre à jour aussi la mini-carte du dashboard
    const miniDot = document.getElementById(`dash-cam-dot-${camId}`);
    if (miniDot) miniDot.style.background = cfg.color;
  }
};

// ==================== DASHBOARD MANAGER ====================
// Gère les cartes réduites du tableau de bord central
const DashboardManager = {

  // Rendu complet du dashboard
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

    // Grouper par type
    const agriDevices = devices.filter(([,d]) => d.type === 'agriculture');
    const secDevices  = devices.filter(([,d]) => d.type === 'security');

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

    // Section caméras si existantes
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

    // Démarrer les mini-streams pour les caméras
    cameras.forEach(([id, cam]) => {
      const miniImg = document.getElementById(`mini-stream-${id}`);
      if (miniImg) this._startMiniStream(id, cam.ip, miniImg);
    });

    // Démarrer les mises à jour pour tous les appareils actifs
    this.startAllUpdates();
  },

  // Carte réduite Agriculture
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

        <!-- Métriques clés visibles en permanence -->
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

        <!-- Panneau expandé (Agriculture) -->
        <div class="dash-panel" id="panel-agri-${id}" style="display:${isOpen ? 'block' : 'none'}">
          ${this._renderAgriPanel(id, dev)}
        </div>

        <div class="dash-card-footer">
          📍 ${dev.location} •
          <span id="dash-mode-${id}" style="color:#10b981;font-weight:bold;">--</span>
        </div>
      </div>`;
  },

  // Panneau agriculture expandé
  _renderAgriPanel(id, dev) {
    return `
      <div class="module-panel">
        <!-- IP éditable -->
        <div class="panel-ip-row">
          <input type="text" id="panel-ip-${id}" value="${dev.ip}"
                 placeholder="IP ou URL ngrok"
                 style="flex:1;padding:6px 10px;background:#0f1117;border:1px solid #2d3142;border-radius:5px;color:white;font-size:12px;">
          <button class="btn btn-small btn-success" onclick="updateDeviceIPDash('${id}')">💾</button>
          <button class="btn btn-small btn-primary" onclick="testDeviceConnectionDash('${id}')">🔍</button>
        </div>

        <!-- Actionneurs -->
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

        <!-- Modes -->
        <div class="panel-section-title">🎮 Modes</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-small btn-success" onclick="setMode('auto','${id}')">🤖 Auto</button>
          <button class="btn btn-small btn-primary" onclick="setMode('manuel','${id}')">✋ Manuel</button>
          <button class="btn btn-small btn-danger" onclick="emergencyStop('${id}')">🛑 Urgence</button>
        </div>

        <!-- Mini graphique temp -->
        <div class="panel-section-title">📊 Températures (dernières mesures)</div>
        <div style="height:120px;position:relative;">
          <canvas id="mini-chart-${id}"></canvas>
        </div>
      </div>`;
  },

  // Carte réduite Sécurité
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

        <!-- Métriques sécurité -->
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

        <!-- Panneau expandé (Sécurité) -->
        <div class="dash-panel" id="panel-sec-${id}" style="display:${isOpen ? 'block' : 'none'}">
          ${this._renderSecPanel(id, dev)}
        </div>

        <div class="dash-card-footer">📍 ${dev.location}</div>
      </div>`;
  },

  // Panneau sécurité expandé
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

  // Mini caméra dans le dashboard
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

  // Stream réduit pour mini-caméras
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

  // Démarrer les mises à jour pour tous les appareils actifs
  startAllUpdates() {
    // Nettoyer les anciens intervals
    Object.values(State.moduleIntervals).forEach(iv => clearInterval(iv));
    State.moduleIntervals = {};

    Object.entries(State.devices).forEach(([id, dev]) => {
      if (!dev.active) return;
      const update = dev.type === 'agriculture'
        ? () => this._updateAgriCard(id, dev.ip)
        : () => this._updateSecCard(id, dev.ip);
      update(); // Appel immédiat
      State.moduleIntervals[id] = setInterval(update, 3000);
    });
  },

  // Met à jour les métriques d'une carte agriculture
  async _updateAgriCard(id, ip) {
    try {
      const res = await Utils.fetchWithTimeout(Utils.buildUrl(ip, 'status'), { mode: 'cors' });
      const data = await res.json();

      // Métriques dashboard
      const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.textContent = val; };
      setVal(`dash-temp-${id}`, parseFloat(data.temperature).toFixed(1));
      setVal(`dash-hum-${id}`,  parseFloat(data.humidity).toFixed(1));
      setVal(`dash-gas-${id}`,  parseFloat(data.gas).toFixed(0));
      setVal(`dash-dc-${id}`,   parseFloat(data.dc).toFixed(2));
      setVal(`dash-mode-${id}`, data.mode?.toUpperCase() || '--');

      // Indicateur connecté
      const dot = document.getElementById(`dash-dot-${id}`);
      if (dot) { dot.classList.remove('dot-inactive'); dot.classList.add('dot-active'); }

      // Actionneurs (si panneau ouvert)
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

  // Met à jour les métriques d'une carte sécurité
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
      setVal(`dash-door-${id}`,   data.doorOpen ? 'OUVERTE' : 'FERMÉE', doorColor);
      setVal(`dash-motion-${id}`, data.motionDetected ? 'DÉTECTÉ' : 'AUCUN', motionColor);
      setVal(`dash-badge-${id}`,  data.lastBadge || '--');

      const dot = document.getElementById(`dash-dot-${id}`);
      if (dot) { dot.classList.remove('dot-inactive'); dot.classList.add('dot-active'); }

      if (State.activeModules.has(`sec-${id}`)) {
        ['lock','alarm','lights'].forEach(d => updateDeviceUIDash(d, data.devices?.[d], id));
        // Log d'accès
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
  const btn   = document.getElementById(`btn-toggle-${type}-${deviceId}`);
  if (!panel) return;

  if (State.activeModules.has(key)) {
    // Fermer
    State.activeModules.delete(key);
    panel.style.display = 'none';
    if (btn) btn.textContent = '▶ Ouvrir';

    // Stopper mini-chart si agriculture
    if (type === 'agri' && State.climateCharts[deviceId]) {
      State.climateCharts[deviceId].destroy();
      delete State.climateCharts[deviceId];
    }
  } else {
    // Ouvrir
    State.activeModules.add(key);
    panel.style.display = 'block';
    if (btn) btn.textContent = '▼ Réduire';

    // Initialiser mini-chart agriculture
    if (type === 'agri') {
      setTimeout(() => initMiniChart(deviceId), 100);
    }
    // Initialiser les caméras sécurité si nécessaire
    if (type === 'sec') {
      initSecurityCameras();
    }
  }
}

// Mini graphique temperature par appareil
function initMiniChart(deviceId) {
  const canvas = document.getElementById(`mini-chart-${deviceId}`);
  if (!canvas) return;
  if (State.climateCharts[deviceId]) State.climateCharts[deviceId].destroy();

  State.climateCharts[deviceId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Temp °C', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', tension: 0.4, borderWidth: 1.5, fill: true, pointRadius: 0 },
        { label: 'Humidité %', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.4, borderWidth: 1.5, fill: true, pointRadius: 0 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: '#9ca3af', font: { size: 10 }, boxWidth: 10 } } },
      scales: {
        x: { ticks: { color: '#9ca3af', maxRotation: 0, font: { size: 9 } }, grid: { color: '#2d3142' } },
        y: { ticks: { color: '#9ca3af', font: { size: 9 } }, grid: { color: '#2d3142' } }
      }
    }
  });
}

function updateMiniChart(deviceId, data) {
  const chart = State.climateCharts[deviceId];
  if (!chart) return;
  const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  chart.data.labels.push(now);
  chart.data.datasets[0].data.push(parseFloat(data.temperature) || 0);
  chart.data.datasets[1].data.push(parseFloat(data.humidity) || 0);
  // Garder max 20 points
  if (chart.data.labels.length > 20) {
    chart.data.labels.shift();
    chart.data.datasets.forEach(ds => ds.shift && ds.shift() || ds.data.shift());
  }
  chart.update('none');
}

// ==================== ACTIONNEUR DASHBOARD ====================
function updateDeviceUIDash(device, state, deviceId) {
  const card = document.getElementById(`${device}Card-${deviceId}`);
  const status = document.getElementById(`${device}Status-${deviceId}`);
  if (!card || !status) return;
  const labels = {
    active:   { pompe:'Actif', brumisateur:'Actif', ventilateur:'Actif', chauffage:'Actif', eclairage:'Allumé', electrovanne:'Ouverte', lock:'Déverrouillée', alarm:'Activée', lights:'Allumées' },
    inactive: { pompe:'Arrêté', brumisateur:'Arrêté', ventilateur:'Arrêté', chauffage:'Arrêté', eclairage:'Éteint', electrovanne:'Fermée', lock:'Verrouillée', alarm:'Désactivée', lights:'Éteintes' }
  };
  if (state) { card.classList.add('active'); status.textContent = labels.active[device] || 'Actif'; }
  else { card.classList.remove('active'); status.textContent = labels.inactive[device] || 'Arrêté'; }
}

async function updateDeviceIPDash(deviceId) {
  const dev = State.devices[deviceId];
  if (!dev) return;
  const newIP = document.getElementById(`panel-ip-${deviceId}`)?.value.trim();
  if (!newIP || !Utils.validateIP(newIP)) { showAlert('warning', '⚠️ IP invalide'); return; }
  dev.ip = newIP;
  Utils.saveToLocalStorage('priva_devices', State.devices);
  showAlert('success', `✅ IP mise à jour: ${newIP}`);
  // Relancer l'update pour cet appareil
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

// ==================== GESTIONNAIRE IA ====================
const AIManager = {
  isProcessing: false,
  history: [],

  async detectImage(imageBlob, cameraName, cameraId) {
    if (this.isProcessing) { showAlert('warning', '⏳ Détection déjà en cours...'); return null; }
    if (!CONFIG.HF_TOKEN) { showAlert('danger', '❌ Token Hugging Face manquant !'); return null; }
    this.isProcessing = true;
    this._showProcessing(cameraName);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(imageBlob);
      });
      const response = await fetch(CONFIG.RENDER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: CONFIG.HF_TOKEN, modele: CONFIG.HF_MODEL, image: base64 })
      });
      const donnees = await response.json();
      if (!response.ok) {
        const msg = donnees?.erreur || donnees?.error || 'Erreur serveur';
        if (msg.includes('loading')) throw new Error('⏳ Modèle en chargement, réessayez dans 20s.');
        throw new Error(msg);
      }
      if (!Array.isArray(donnees) || !donnees.length) throw new Error('Aucun résultat');
      const meilleur = donnees[0];
      const detection = {
        cameraId, cameraName, label: meilleur.label,
        confidence: Math.round((meilleur.score || 0) * 100),
        timestamp: new Date().toISOString(),
        allPredictions: donnees.slice(0, 5)
      };
      this.history.unshift(detection);
      if (this.history.length > 50) this.history = this.history.slice(0, 50);
      Utils.saveToLocalStorage('priva_ai_history', this.history);
      this._showResult(detection);
      this.updateAIStats();
      showAlert('success', `✅ ${detection.label} (${detection.confidence}%)`);
      return detection;
    } catch (error) {
      showAlert('danger', `❌ ${error.message}`);
      return null;
    } finally {
      this.isProcessing = false;
      this._hideProcessing();
    }
  },

  _showProcessing(cameraName) {
    const container = document.getElementById('ai-results-container');
    if (!container) return;
    let proc = document.getElementById('ai-processing');
    if (!proc) { proc = document.createElement('div'); proc.id = 'ai-processing'; container.insertBefore(proc, container.firstChild); }
    proc.style.cssText = 'background:linear-gradient(135deg,#252836,#1a1d29);border:2px solid #667eea;padding:20px;border-radius:10px;text-align:center;margin:10px 0;';
    proc.innerHTML = `<div style="font-size:36px;animation:spin 1s linear infinite;">🔄</div><div style="margin-top:10px;color:#667eea;font-weight:bold;">Analyse IA en cours...</div><div style="font-size:12px;opacity:0.6;">📹 ${cameraName}</div><style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>`;
  },

  _hideProcessing() { document.getElementById('ai-processing')?.remove(); },

  _showResult(detection) {
    const container = document.getElementById('ai-results-container');
    if (!container) return;
    const cc = detection.confidence >= 80 ? '#00a651' : detection.confidence >= 60 ? '#f77f00' : '#e63946';
    const topPreds = (detection.allPredictions || []).slice(0, 3).map(p => {
      const pct = Math.round((p.score || 0) * 100);
      const c = pct >= 80 ? '#00a651' : pct >= 60 ? '#f77f00' : '#e63946';
      return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;"><span style="flex:1;font-size:13px;">${p.label}</span><div style="width:80px;background:rgba(255,255,255,0.2);height:8px;border-radius:4px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${c};"></div></div><span style="font-size:12px;color:${c};min-width:35px;text-align:right;">${pct}%</span></div>`;
    }).join('');
    const resultDiv = document.createElement('div');
    resultDiv.style.cssText = 'background:linear-gradient(135deg,#667eea,#764ba2);padding:20px;border-radius:12px;margin:10px 0;box-shadow:0 4px 15px rgba(102,126,234,0.3);';
    resultDiv.innerHTML = `<div style="display:flex;align-items:flex-start;gap:15px;"><div style="font-size:50px;">🤖</div><div style="flex:1;"><div style="display:flex;justify-content:space-between;align-items:center;"><strong>${detection.cameraName}</strong><small style="opacity:0.7;">${new Date(detection.timestamp).toLocaleTimeString('fr-FR')}</small></div><div style="margin:10px 0;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;"><div style="font-size:22px;font-weight:bold;">🎯 ${detection.label}</div><div style="display:flex;align-items:center;gap:10px;margin-top:8px;"><div style="flex:1;background:rgba(255,255,255,0.2);height:16px;border-radius:8px;overflow:hidden;"><div style="width:${detection.confidence}%;height:100%;background:${cc};"></div></div><strong style="color:${cc};font-size:18px;">${detection.confidence}%</strong></div></div>${topPreds}</div></div>`;
    container.insertBefore(resultDiv, container.firstChild);
    setTimeout(() => { resultDiv.style.opacity = '0'; resultDiv.style.transition = 'opacity 0.4s'; setTimeout(() => resultDiv.remove(), 400); }, 20000);
  },

  updateAIStats() {
    const statsDiv = document.getElementById('ai-stats');
    if (!statsDiv) return;
    const total = this.history.length;
    if (!total) { statsDiv.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.6;">Aucune détection</div>'; return; }
    const labels = {};
    this.history.forEach(h => labels[h.label] = (labels[h.label] || 0) + 1);
    let html = `<div style="padding:15px;background:#1a1d29;border-radius:10px;"><div style="display:flex;justify-content:space-between;margin-bottom:10px;"><h3 style="margin:0;">📊 Statistiques IA</h3><span style="background:#667eea;padding:3px 10px;border-radius:20px;font-size:12px;">${total}</span></div>`;
    Object.entries(labels).sort((a,b) => b[1]-a[1]).forEach(([label, count]) => {
      const pct = (count / total * 100).toFixed(1);
      html += `<div style="margin:8px 0;"><div style="display:flex;justify-content:space-between;font-size:13px;"><span>${label}</span><span><strong>${count}</strong> (${pct}%)</span></div><div style="background:#0f1117;height:6px;border-radius:3px;overflow:hidden;margin-top:3px;"><div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#667eea,#764ba2);"></div></div></div>`;
    });
    statsDiv.innerHTML = html + '</div>';
  },

  loadHistory() { this.history = Utils.loadFromLocalStorage('priva_ai_history', []); this.updateAIStats(); },

  clearHistory() {
    if (!confirm('Vider l\'historique IA ?')) return;
    this.history = [];
    Utils.saveToLocalStorage('priva_ai_history', []);
    this.updateAIStats();
    const container = document.getElementById('ai-results-container');
    if (container) container.innerHTML = '';
    showAlert('success', '🗑️ Historique vidé');
  }
};

// ==================== ALERTES ====================
function showAlert(type, msg) {
  const alert = document.createElement('div');
  alert.className = `alert ${type}`;
  alert.textContent = msg;
  const container = document.getElementById('alertContainer');
  if (container) { container.appendChild(alert); setTimeout(() => alert.remove(), 5000); }
}

// ==================== INIT ====================
function init() {
  if (State.isInitialized) return;
  State.devices = Utils.loadFromLocalStorage('priva_devices', {});
  State.securityCameras = Utils.loadFromLocalStorage('priva_security_cameras', {});
  State.securityCaptures = Utils.loadFromLocalStorage('priva_security_captures', []);
  loadAgricultureData();
  loadSecurityData();
  State.dataUpdateInterval = setInterval(() => { loadAgricultureData(); loadSecurityData(); }, 10000);
  DashboardManager.render();
  State.isInitialized = true;
  showAlert('success', '✅ PRIVA v6.0 initialisé');
}

function initAI() { AIManager.loadHistory(); chargerToken(); }

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
  renderDevicesList();
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

// ==================== DONNÉES FEUILLES ====================
async function loadAgricultureData() {
  try {
    const res = await Utils.fetchWithTimeout(CONFIG.PROXY + encodeURIComponent(CONFIG.AGRICULTURE_CSV_URL));
    const csv = await res.text();
    const rows = csv.trim().split('\n').map(r => r.split(',').map(c => c.trim()));
    State.allAgriData = rows.slice(1).filter(r => r.length >= 3);
    if (State.allAgriData.length > 0) {
      updateAgricultureTable();
      const el = document.getElementById('dataCount');
      if (el) el.textContent = State.allAgriData.length;
    }
  } catch (e) { console.error('Erreur agriculture CSV:', e); }
}

async function loadSecurityData() {
  try {
    const res = await Utils.fetchWithTimeout(CONFIG.PROXY + encodeURIComponent(CONFIG.SECURITY_CSV_URL));
    const csv = await res.text();
    const rows = csv.trim().split('\n').map(r => r.split(',').map(c => c.trim()));
    State.allSecurityData = rows.slice(1).filter(r => r.length >= 3);
    if (State.allSecurityData.length > 0) updateSecurityTable();
  } catch (e) { console.error('Erreur sécurité CSV:', e); }
}

function updateAgricultureTable() {
  const tbody = document.getElementById('dataTable');
  if (!tbody) return;
  const data = State.allAgriData.slice(-10).reverse();
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Aucune donnée</td></tr>'; return; }
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
      if (res.ok) { updateDeviceUIDash(device, newState, deviceId); showAlert('success', `✅ ${device} ${newState?'activé':'désactivé'}`); return; }
    } catch {}
  }

  // Fallback cloud
  try {
    const res = await fetch(CONFIG.COMMAND_API_URL, {
      method: 'POST',
      headers: {'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({ cible: module, actionneur: device, etat: newState?1:0 })
    });
    const result = await res.json();
    if (result.status === 'success') { updateDeviceUIDash(device, newState, deviceId); showAlert('success', `✅ ${device} (cloud)`); }
  } catch { showAlert('danger', '❌ Erreur commande'); }
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
  if (dev) { try { await Utils.fetchWithTimeout(Utils.buildUrl(dev.ip, 'emergency'), {method:'POST'}); } catch {} }
  ['pompe','brumisateur','ventilateur','chauffage','eclairage','electrovanne'].forEach(d => updateDeviceUIDash(d, false, deviceId));
  showAlert('danger', '🛑 ARRÊT D\'URGENCE');
}

// ==================== APPAREILS ====================
function renderDevicesList() {
  const list = document.getElementById('devicesList');
  if (!list) return;
  if (!Object.keys(State.devices).length) {
    list.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.6;">Aucun appareil. Cliquez sur "Ajouter"</div>';
    return;
  }
  list.innerHTML = Object.entries(State.devices).map(([id, dev]) => `
    <div class="device-item">
      <div class="device-info">
        <div class="device-name">${dev.type === 'agriculture' ? '🌱' : '🔒'} ${dev.name}</div>
        <div class="device-details">📡 ${dev.ip} • 📍 ${dev.location} • <span style="color:${dev.active?'#00a651':'#e63946'};font-weight:bold;">${dev.active?'✓ Actif':'○ Inactif'}</span></div>
      </div>
      <div class="device-actions">
        <button class="btn btn-small ${dev.active?'btn-danger':'btn-success'}" onclick="toggleDeviceActive('${id}')">${dev.active?'⏸️':'▶️'}</button>
        <button class="btn btn-small btn-primary" onclick="testDeviceConnectionDash('${id}')">🔍</button>
        <button class="btn btn-small btn-danger" onclick="deleteDevice('${id}')">🗑️</button>
      </div>
    </div>`).join('');
}

function openAddDeviceModal() { document.getElementById('addDeviceModal')?.classList.add('active'); }
function closeAddDeviceModal() { document.getElementById('addDeviceModal')?.classList.remove('active'); }

function addDevice() {
  const name = document.getElementById('newDeviceName')?.value.trim();
  const ip = document.getElementById('newDeviceIP')?.value.trim();
  const type = document.getElementById('newDeviceType')?.value;
  const location = document.getElementById('newDeviceLocation')?.value.trim();
  if (!name || !ip) { showAlert('warning', '⚠️ Nom et IP requis'); return; }
  if (!Utils.validateIP(ip)) { showAlert('warning', '⚠️ Format IP invalide'); return; }
  const id = 'dev_' + Date.now();
  State.devices[id] = { name, ip, type, location: location || 'Non spécifié', active: true, addedAt: new Date().toISOString() };
  Utils.saveToLocalStorage('priva_devices', State.devices);
  closeAddDeviceModal();
  renderDevicesList();
  showAlert('success', `✅ ${name} ajouté`);
  ['newDeviceName','newDeviceIP','newDeviceLocation'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
  // Rafraîchir le dashboard
  setTimeout(() => showDashboard(), 500);
}

function toggleDeviceActive(id) {
  const device = State.devices[id];
  if (!device) return;
  device.active = !device.active;
  Utils.saveToLocalStorage('priva_devices', State.devices);
  renderDevicesList();
  showAlert(device.active ? 'success' : 'warning', `${device.active ? '✅' : '⏸️'} ${device.name} ${device.active ? 'activé' : 'désactivé'}`);
  DashboardManager.startAllUpdates();
}

function deleteDevice(id) {
  const dev = State.devices[id];
  if (!dev || !confirm(`Supprimer "${dev.name}" ?`)) return;
  if (State.moduleIntervals[id]) { clearInterval(State.moduleIntervals[id]); delete State.moduleIntervals[id]; }
  delete State.devices[id];
  Utils.saveToLocalStorage('priva_devices', State.devices);
  renderDevicesList();
  showAlert('success', `🗑️ ${dev.name} supprimé`);
}

// ==================== CAMÉRAS ====================
function initSecurityCameras() {
  StreamManager.stopAll();
  renderSecurityCameras();
  renderSecurityCaptures();
}

function renderSecurityCameras() {
  const grid = document.getElementById('security-cameras-grid');
  if (!grid) return;
  StreamManager.stopAll();
  const cameras = Object.entries(State.securityCameras).filter(([,c]) => c.active);
  if (!cameras.length) {
    grid.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.6;">Aucune caméra configurée.</div>';
    return;
  }
  grid.innerHTML = cameras.map(([id, cam]) => `
    <div class="security-camera-card" id="sec-cam-${id}">
      <div class="camera-header">
        <div class="camera-name">📹 ${cam.name}
          <div class="camera-status-indicator" id="status-${id}"></div>
          <span id="status-label-${id}" style="font-size:10px;opacity:0.7;margin-left:5px;">Connexion...</span>
        </div>
        <button class="btn btn-small btn-danger" onclick="removeSecurityCamera('${id}')">🗑️</button>
      </div>
      <div style="position:relative;background:#000;border-radius:8px;min-height:250px;overflow:hidden;">
        <img id="stream-${id}" style="width:100%;height:100%;object-fit:cover;cursor:pointer;display:block;"
             onclick="openCameraFullscreen('${id}','${cam.name}','${cam.ip}')" alt="${cam.name}">
        <div id="loading-${id}" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:white;background:rgba(0,0,0,0.6);padding:10px 20px;border-radius:8px;display:flex;align-items:center;gap:8px;">
          <div style="width:16px;height:16px;border:2px solid #667eea;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></div>Connexion...
        </div>
      </div>
      <div class="camera-controls" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
        <button class="btn btn-small btn-success" onclick="captureCamera('${id}','${cam.name}','${cam.ip}')">📸 Capturer</button>
        <button class="btn btn-small" onclick="captureCameraAndDetect('${id}','${cam.name}','${cam.ip}')" style="background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;padding:6px 10px;border-radius:5px;cursor:pointer;">🤖 IA</button>
        <button class="btn btn-small btn-primary" onclick="toggleFlash('${id}','${cam.ip}')">💡 Flash</button>
        <button class="btn btn-small btn-primary" onclick="StreamManager.restart('${id}','${cam.ip}')">🔄</button>
        <button class="btn btn-small btn-primary" onclick="openCameraFullscreen('${id}','${cam.name}','${cam.ip}')">🔲</button>
      </div>
      <div style="font-size:11px;opacity:0.6;margin-top:5px;">📍 ${cam.location} • FPS: <span id="fps-${id}">--</span></div>
    </div>`).join('');

  cameras.forEach(([id, cam]) => StreamManager.start(id, cam.ip));
}

function renderSecurityCaptures() {
  const gallery = document.getElementById('security-captures-gallery');
  if (!gallery) return;
  if (!State.securityCaptures.length) { gallery.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.6;">Aucune capture</div>'; return; }
  gallery.innerHTML = State.securityCaptures.slice(0, 20).map((cap, idx) => `
    <div class="capture-item" onclick="viewCapture(${idx})">
      <img src="${cap.url}" alt="${cap.name}" loading="lazy">
      <div class="capture-info"><div>📹 ${cap.name}</div><div>⏰ ${new Date(cap.timestamp).toLocaleTimeString('fr-FR')}</div></div>
      <button class="capture-delete" onclick="event.stopPropagation();deleteCapture(${idx})">✖</button>
    </div>`).join('');
}

async function captureCamera(id, name, ip) {
  showAlert('warning', '📸 Capture...');
  try {
    const blob = await StreamManager.capture(id, ip);
    const captureUrl = Utils.buildUrl(ip, 'capture');
    State.securityCaptures.unshift({ id: 'cap_' + Date.now(), cameraId: id, name, timestamp: new Date().toISOString(), url: captureUrl });
    if (State.securityCaptures.length > CONFIG.MAX_CAPTURES) State.securityCaptures.length = CONFIG.MAX_CAPTURES;
    Utils.saveToLocalStorage('priva_security_captures', State.securityCaptures);
    renderSecurityCaptures();
    showAlert('success', `✅ ${name}`);
    if (CONFIG.AI_AUTO_DETECT) await AIManager.detectImage(blob, name, id);
  } catch { showAlert('danger', '❌ Erreur capture'); }
}

async function captureCameraAndDetect(id, name, ip) {
  showAlert('warning', '📸 Capture + IA...');
  try {
    const blob = await StreamManager.capture(id, ip);
    State.securityCaptures.unshift({ id: 'cap_' + Date.now(), cameraId: id, name, timestamp: new Date().toISOString(), url: Utils.buildUrl(ip, 'capture') });
    if (State.securityCaptures.length > CONFIG.MAX_CAPTURES) State.securityCaptures.length = CONFIG.MAX_CAPTURES;
    Utils.saveToLocalStorage('priva_security_captures', State.securityCaptures);
    renderSecurityCaptures();
    await AIManager.detectImage(blob, name, id);
  } catch { showAlert('danger', '❌ Erreur'); }
}

function captureAllCameras() {
  const cams = Object.entries(State.securityCameras).filter(([,c]) => c.active);
  if (!cams.length) { showAlert('warning', '⚠️ Aucune caméra active'); return; }
  cams.forEach(([id, cam], i) => setTimeout(() => captureCamera(id, cam.name, cam.ip), i * 600));
}

async function toggleFlash(id, ip) {
  try {
    const url = Utils.buildUrl(ip, 'flash');
    await Utils.fetchWithTimeout(url, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:'state=1' });
    setTimeout(async () => { try { await fetch(url, { method:'POST', body:'state=0' }); } catch {} }, 300);
    showAlert('success', '💡 Flash');
  } catch { showAlert('danger', '❌ Flash'); }
}

function openAddCameraModal() { document.getElementById('addCameraModal')?.classList.add('active'); }
function closeAddCameraModal() { document.getElementById('addCameraModal')?.classList.remove('active'); }

function addSecurityCamera() {
  const name = document.getElementById('newCameraName')?.value.trim();
  const ip = document.getElementById('newCameraIP')?.value.trim();
  const location = document.getElementById('newCameraLocation')?.value.trim();
  if (!name || !ip) { showAlert('warning', '⚠️ Nom et IP requis'); return; }
  if (!Utils.validateIP(ip)) { showAlert('warning', '⚠️ Format IP invalide'); return; }
  const id = 'cam_' + Date.now();
  State.securityCameras[id] = { name, ip, location: location || 'Non spécifié', active: true, addedAt: new Date().toISOString() };
  Utils.saveToLocalStorage('priva_security_cameras', State.securityCameras);
  closeAddCameraModal();
  DashboardManager.render(); // Rafraîchir le dashboard avec la nouvelle caméra
  showAlert('success', `✅ ${name} ajoutée`);
  ['newCameraName','newCameraIP','newCameraLocation'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
}

function removeSecurityCamera(id) {
  const cam = State.securityCameras[id];
  if (!cam || !confirm(`Supprimer "${cam.name}" ?`)) return;
  StreamManager.stop(id);
  delete State.securityCameras[id];
  Utils.saveToLocalStorage('priva_security_cameras', State.securityCameras);
  renderSecurityCameras();
  showAlert('success', `🗑️ ${cam.name} supprimée`);
}

function viewCapture(idx) { const cap = State.securityCaptures[idx]; if (cap) openCameraFullscreen(null, cap.name, null, cap.url); }
function deleteCapture(idx) { State.securityCaptures.splice(idx, 1); Utils.saveToLocalStorage('priva_security_captures', State.securityCaptures); renderSecurityCaptures(); }
function clearSecurityCaptures() { if (!confirm('Vider toutes les captures ?')) return; State.securityCaptures = []; Utils.saveToLocalStorage('priva_security_captures', State.securityCaptures); renderSecurityCaptures(); showAlert('success', '🗑️ Galerie vidée'); }

// ==================== PLEIN ÉCRAN ====================
let fullscreenStreamInterval = null;

function openCameraFullscreen(id, name, ip, captureUrl = null) {
  const modal = document.getElementById('cameraFullscreenModal');
  const img = document.getElementById('fullscreen-camera-img');
  const title = document.getElementById('fullscreen-camera-name');
  if (!modal || !img || !title) return;
  title.textContent = `📹 ${name}`;
  if (captureUrl) { img.src = captureUrl; }
  else if (ip) {
    const isNgrok = ip.includes('ngrok') || ip.includes('.dev') || ip.includes('.app') || ip.includes('.io');
    if (isNgrok) {
      const refresh = async () => {
        try {
          const res = await fetch(Utils.buildUrl(ip, 'capture'), { headers: { 'ngrok-skip-browser-warning': 'true' } });
          if (!res.ok) return;
          const blob = await res.blob();
          if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
          img.src = URL.createObjectURL(blob);
        } catch {}
      };
      refresh();
      fullscreenStreamInterval = setInterval(refresh, CONFIG.FALLBACK_REFRESH);
    } else {
      img.src = Utils.buildUrl(ip, 'stream', true);
      img.onerror = () => {
        img.onerror = null;
        const refresh = () => { img.src = Utils.buildUrl(ip, 'capture'); };
        refresh();
        fullscreenStreamInterval = setInterval(refresh, CONFIG.FALLBACK_REFRESH);
      };
    }
  }
  modal.classList.add('active');
}

function closeCameraFullscreen() {
  document.getElementById('cameraFullscreenModal')?.classList.remove('active');
  if (fullscreenStreamInterval) { clearInterval(fullscreenStreamInterval); fullscreenStreamInterval = null; }
  const img = document.getElementById('fullscreen-camera-img');
  if (img) { if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src); img.src = ''; }
}

function downloadCapture() {
  const img = document.getElementById('fullscreen-camera-img');
  if (!img?.src) return;
  const link = document.createElement('a');
  link.href = img.src;
  link.download = `priva_capture_${Date.now()}.jpg`;
  link.click();
}

// ==================== IA PANEL ====================
async function testAIServer() {
  showAlert('warning', '🔍 Test serveur IA...');
  try { await Utils.fetchWithTimeout('https://sagitaimage.onrender.com/'); showAlert('success', '✅ Serveur Render opérationnel'); }
  catch { showAlert('danger', '❌ Serveur IA injoignable (peut être en veille, réessayez dans 30s)'); }
}

function toggleAutoDetect() {
  CONFIG.AI_AUTO_DETECT = !CONFIG.AI_AUTO_DETECT;
  const btn = document.getElementById('toggle-auto-detect-btn');
  if (btn) { btn.textContent = `🤖 Auto: ${CONFIG.AI_AUTO_DETECT ? 'ON' : 'OFF'}`; btn.className = `btn btn-small ${CONFIG.AI_AUTO_DETECT ? 'btn-success' : 'btn-secondary'}`; }
  showAlert(CONFIG.AI_AUTO_DETECT ? 'success' : 'warning', `Détection auto ${CONFIG.AI_AUTO_DETECT ? 'activée' : 'désactivée'}`);
}

function sauvegarderToken() {
  const token = document.getElementById('hf-token-input')?.value.trim();
  if (!token) { showAlert('danger', '❌ Token vide'); return; }
  if (!token.startsWith('hf_')) { showAlert('danger', '❌ Token invalide — doit commencer par hf_'); return; }
  CONFIG.HF_TOKEN = token;
  Utils.saveToLocalStorage('priva_hf_token', token);
  showAlert('success', '✅ Token sauvegardé !');
}

function chargerToken() {
  const token = Utils.loadFromLocalStorage('priva_hf_token', '');
  if (token) { CONFIG.HF_TOKEN = token; const input = document.getElementById('hf-token-input'); if (input) input.value = token; }
}

// ==================== ÉVÉNEMENTS ====================
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    // Relancer les streams des caméras visibles
    Object.entries(State.securityCameras).filter(([,c]) => c.active).forEach(([id, cam]) => {
      if (!StreamManager.streams[id]) StreamManager.start(id, cam.ip);
    });
  }
});

window.addEventListener('beforeunload', () => {
  Object.values(State.moduleIntervals).forEach(iv => clearInterval(iv));
  if (State.dataUpdateInterval) clearInterval(State.dataUpdateInterval);
  DashboardManager.stopMiniStreams();
  StreamManager.stopAll();
});

console.log('✅ PRIVA v6.0 - Dashboard multi-modules chargé');
