// ============================================
// PRIVA Platform - JavaScript v5.0
// Optimisé: Stream MJPEG + IA + Sécurité/Agriculture
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

  // Stream settings
  STREAM_TIMEOUT: 8000,       // Timeout avant fallback en ms
  FALLBACK_REFRESH: 1500,     // Refresh en ms si MJPEG échoue
  CAPTURE_QUALITY: 0.85,      // Qualité des captures JPEG
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
  currentModule: 'agriculture',
  climateChart: null,
  airChart: null,
  dataUpdateInterval: null,
  moduleUpdateInterval: null,
  isInitialized: false
};

// ==================== UTILITAIRES ====================
const Utils = {
  async fetchWithTimeout(url, options = {}, timeout = CONFIG.FETCH_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
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

  // Accepte IP locale ET URL ngrok
  validateIP(ip) {
    if (!ip) return false;
    if (ip.includes('ngrok') || ip.includes('.dev') || ip.includes('.app') || ip.includes('.io')) return true;
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) return false;
    return ip.split('.').every(o => { const n = parseInt(o, 10); return n >= 0 && n <= 255; });
  },

  // Construit l'URL correcte selon le type (ngrok ou IP locale)
  buildUrl(ip, endpoint, useStream = false) {
    const isNgrok = ip.includes('ngrok') || ip.includes('.dev') || ip.includes('.app') || ip.includes('.io');
    const protocol = isNgrok ? 'https' : 'http';
    const port = isNgrok ? '' : `:${CONFIG.ESP32_PORT}`;
    const ts = useStream ? '' : `?t=${Date.now()}`;
    return `${protocol}://${ip}${port}/${endpoint}${ts}`;
  }
};

// ==================== GESTIONNAIRE STREAM CAMERA ====================
const StreamManager = {
  streams: {},      // { camId: { mode: 'mjpeg'|'fallback', interval, failCount } }

  // Démarre le stream pour une caméra
  start(camId, ip) {
    if (!Utils.validateIP(ip)) {
      console.error(`IP invalide: ${ip}`);
      return;
    }
    this.stop(camId);
    this.streams[camId] = { mode: null, interval: null, failCount: 0, ip };
    this._tryMJPEG(camId, ip);
  },

  // Tente d'abord le stream MJPEG natif (le plus fluide)
  _tryMJPEG(camId, ip) {
    const img = document.getElementById(`stream-${camId}`);
    if (!img) return;

    const streamUrl = Utils.buildUrl(ip, 'stream', true);
    console.log(`Tentative MJPEG: ${streamUrl}`);

    this._updateStatus(camId, 'connecting');

    // Timeout: si pas de réponse en X secondes → fallback
    const timeout = setTimeout(() => {
      console.warn(`MJPEG timeout pour ${camId}, passage en fallback`);
      this._startFallback(camId, ip);
    }, CONFIG.STREAM_TIMEOUT);

    img.onload = () => {
      clearTimeout(timeout);
      // Si l'image se charge, MJPEG fonctionne
      this.streams[camId].mode = 'mjpeg';
      this._updateStatus(camId, 'online');
      console.log(`MJPEG actif: ${camId}`);
    };

    img.onerror = () => {
      clearTimeout(timeout);
      console.warn(`MJPEG échoué pour ${camId}, passage en fallback`);
      this._startFallback(camId, ip);
    };

    img.src = streamUrl;
    this.streams[camId].mode = 'mjpeg';
  },

  // Fallback: refresh d'image JPEG toutes les X ms
  _startFallback(camId, ip) {
    const img = document.getElementById(`stream-${camId}`);
    if (!img) return;

    this.streams[camId].mode = 'fallback';
    console.log(`Mode fallback activé pour ${camId}`);

    let consecutiveErrors = 0;
    const MAX_ERRORS = 5;

    const refresh = () => {
      // Vérifier que la caméra est toujours active
      if (!this.streams[camId]) return;

      const captureUrl = Utils.buildUrl(ip, 'capture');
      const testImg = new Image();

      testImg.onload = () => {
        consecutiveErrors = 0;
        img.src = captureUrl;
        this._updateStatus(camId, 'online');
        this._updateFPS(camId);
      };

      testImg.onerror = () => {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_ERRORS) {
          this._updateStatus(camId, 'offline');
          console.error(`Caméra ${camId} hors ligne`);
        }
      };

      testImg.src = captureUrl;
    };

    refresh();
    this.streams[camId].interval = setInterval(refresh, CONFIG.FALLBACK_REFRESH);
    this._updateStatus(camId, 'fallback');
  },

  // Capture une image depuis le flux actuel
  async capture(camId, ip) {
    try {
      const captureUrl = Utils.buildUrl(ip, 'capture');
      const response = await fetch(captureUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      return blob;
    } catch (error) {
      console.error(`Erreur capture ${camId}:`, error);
      throw error;
    }
  },

  // Arrête le stream d'une caméra
  stop(camId) {
    if (this.streams[camId]) {
      if (this.streams[camId].interval) {
        clearInterval(this.streams[camId].interval);
      }
      // Réinitialiser l'image pour couper le MJPEG
      const img = document.getElementById(`stream-${camId}`);
      if (img) img.src = '';
      delete this.streams[camId];
      console.log(`Stream arrêté: ${camId}`);
    }
  },

  // Arrête tous les streams
  stopAll() {
    Object.keys(this.streams).forEach(id => this.stop(id));
    console.log('Tous les streams arrêtés');
  },

  // Redémarre un stream (ex: après reconnexion)
  restart(camId, ip) {
    this.stop(camId);
    setTimeout(() => this.start(camId, ip), 500);
  },

  // FPS counter
  _fpsData: {},
  _updateFPS(camId) {
    if (!this._fpsData[camId]) this._fpsData[camId] = { count: 0, lastTime: Date.now() };
    this._fpsData[camId].count++;
    const now = Date.now();
    const elapsed = now - this._fpsData[camId].lastTime;
    if (elapsed >= 1000) {
      const fps = Math.round(this._fpsData[camId].count * 1000 / elapsed);
      const el = document.getElementById(`fps-${camId}`);
      if (el) el.textContent = fps;
      this._fpsData[camId].count = 0;
      this._fpsData[camId].lastTime = now;
    }
  },

  // Met à jour l'indicateur de statut
  _updateStatus(camId, status) {
    const indicator = document.getElementById(`status-${camId}`);
    const card = document.getElementById(`sec-cam-${camId}`);
    const statusLabel = document.getElementById(`status-label-${camId}`);
    const loadingDiv = document.getElementById(`loading-${camId}`);

    const configs = {
      online:      { color: '#00a651', text: 'En ligne',     dot: 'online',   loading: false },
      offline:     { color: '#e63946', text: 'Hors ligne',   dot: 'offline',  loading: true  },
      connecting:  { color: '#f77f00', text: 'Connexion...', dot: 'warning',  loading: true  },
      fallback:    { color: '#3b82f6', text: 'Mode photo',   dot: 'fallback', loading: false }
    };

    const cfg = configs[status] || configs.offline;

    if (indicator) {
      indicator.style.background = cfg.color;
      indicator.title = cfg.text;
    }
    if (statusLabel) {
      statusLabel.textContent = cfg.text;
      statusLabel.style.color = cfg.color;
    }
    if (card) {
      card.classList.toggle('offline', status === 'offline');
    }
    if (loadingDiv) {
      loadingDiv.style.display = cfg.loading ? 'flex' : 'none';
      if (cfg.loading) loadingDiv.textContent = cfg.text;
    }
  }
};

// ==================== GESTIONNAIRE IA ====================
const AIManager = {
  isProcessing: false,
  history: [],

  async detectImage(imageBlob, cameraName, cameraId) {
    if (this.isProcessing) {
      showAlert('warning', '⏳ Détection déjà en cours...');
      return null;
    }

    if (!CONFIG.HF_TOKEN || CONFIG.HF_TOKEN === '') {
      showAlert('danger', '❌ Token Hugging Face manquant ! Saisissez-le dans le panneau IA.');
      return null;
    }

    this.isProcessing = true;
    this._showProcessing(cameraName);

    try {
      // Convertir blob → base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(imageBlob);
      });

      // Envoi vers Render → Hugging Face
      const response = await fetch(CONFIG.RENDER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: CONFIG.HF_TOKEN,
          modele: CONFIG.HF_MODEL,
          image: base64
        })
      });

      const donnees = await response.json();

      if (!response.ok) {
        const msg = donnees?.erreur || donnees?.error || 'Erreur serveur';
        if (msg.includes('loading') || msg.includes('currently loading')) {
          throw new Error('⏳ Modèle en chargement, réessayez dans 20 secondes.');
        }
        throw new Error(msg);
      }

      if (!Array.isArray(donnees) || donnees.length === 0) {
        throw new Error('Aucun résultat retourné');
      }

      const meilleur = donnees[0];
      const detection = {
        cameraId,
        cameraName,
        label: meilleur.label,
        confidence: Math.round((meilleur.score || 0) * 100),
        timestamp: new Date().toISOString(),
        allPredictions: donnees.slice(0, 5)
      };

      this.history.unshift(detection);
      if (this.history.length > 50) this.history = this.history.slice(0, 50);
      Utils.saveToLocalStorage('priva_ai_history', this.history);

      this._showResult(detection);
      this.updateLastResult(detection);
      this.updateAIStats();

      showAlert('success', `✅ ${detection.label} (${detection.confidence}%)`);
      return detection;

    } catch (error) {
      console.error('Erreur détection IA:', error);
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
    if (!proc) {
      proc = document.createElement('div');
      proc.id = 'ai-processing';
      proc.style.cssText = 'background:linear-gradient(135deg,#252836,#1a1d29);border:2px solid #667eea;padding:20px;border-radius:10px;text-align:center;margin:10px 0;';
      container.insertBefore(proc, container.firstChild);
    }
    proc.innerHTML = `
      <div style="font-size:36px;animation:spin 1s linear infinite;">🔄</div>
      <div style="margin-top:10px;color:#667eea;font-weight:bold;">Analyse IA en cours...</div>
      <div style="font-size:12px;opacity:0.6;margin-top:5px;">📹 ${cameraName}</div>
      <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
    `;
  },

  _hideProcessing() {
    const proc = document.getElementById('ai-processing');
    if (proc) proc.remove();
  },

  _showResult(detection) {
    const container = document.getElementById('ai-results-container');
    if (!container) return;

    const confidenceColor = detection.confidence >= 80 ? '#00a651' :
                            detection.confidence >= 60 ? '#f77f00' : '#e63946';

    // Top 3 prédictions
    const topPreds = (detection.allPredictions || []).slice(0, 3).map(p => {
      const pct = Math.round((p.score || 0) * 100);
      const color = pct >= 80 ? '#00a651' : pct >= 60 ? '#f77f00' : '#e63946';
      return `
        <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
          <span style="flex:1;font-size:13px;">${p.label}</span>
          <div style="width:80px;background:rgba(255,255,255,0.2);height:8px;border-radius:4px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:${color};"></div>
          </div>
          <span style="font-size:12px;color:${color};min-width:35px;text-align:right;">${pct}%</span>
        </div>`;
    }).join('');

    const resultDiv = document.createElement('div');
    resultDiv.style.cssText = 'background:linear-gradient(135deg,#667eea,#764ba2);padding:20px;border-radius:12px;margin:10px 0;transition:all 0.3s;box-shadow:0 4px 15px rgba(102,126,234,0.3);';
    resultDiv.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:15px;">
        <div style="font-size:50px;">🤖</div>
        <div style="flex:1;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-size:16px;">📹 ${detection.cameraName}</strong>
            <small style="opacity:0.7;">${new Date(detection.timestamp).toLocaleTimeString('fr-FR')}</small>
          </div>
          <div style="margin:10px 0;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;">
            <div style="font-size:22px;font-weight:bold;color:#fff;">🎯 ${detection.label}</div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:8px;">
              <div style="flex:1;background:rgba(255,255,255,0.2);height:16px;border-radius:8px;overflow:hidden;">
                <div style="width:${detection.confidence}%;height:100%;background:${confidenceColor};transition:width 0.5s;"></div>
              </div>
              <strong style="color:${confidenceColor};font-size:18px;">${detection.confidence}%</strong>
            </div>
          </div>
          ${detection.allPredictions && detection.allPredictions.length > 1 ? `
          <div style="font-size:11px;opacity:0.8;margin-top:5px;text-transform:uppercase;letter-spacing:1px;">Autres possibilités</div>
          <div style="margin-top:4px;">${topPreds}</div>` : ''}
        </div>
      </div>`;

    container.insertBefore(resultDiv, container.firstChild);

    // Auto-suppression après 20 secondes
    setTimeout(() => {
      resultDiv.style.opacity = '0';
      resultDiv.style.transform = 'translateX(100%)';
      setTimeout(() => resultDiv.remove(), 400);
    }, 20000);
  },

  updateLastResult(detection) {
    const lastResult = document.getElementById('ai-last-result');
    if (!lastResult) return;
    const confidenceColor = detection.confidence >= 80 ? '#00a651' :
                            detection.confidence >= 60 ? '#f77f00' : '#e63946';
    const labelEl = document.getElementById('ai-result-label');
    const confidenceEl = document.getElementById('ai-result-confidence');
    const cameraEl = document.getElementById('ai-result-camera');
    const timeEl = document.getElementById('ai-result-time');
    if (labelEl) labelEl.textContent = `🎯 ${detection.label}`;
    if (confidenceEl) { confidenceEl.textContent = `${detection.confidence}%`; confidenceEl.style.color = confidenceColor; }
    if (cameraEl) cameraEl.textContent = `📹 ${detection.cameraName}`;
    if (timeEl) timeEl.textContent = `⏰ ${new Date(detection.timestamp).toLocaleString('fr-FR')}`;
    lastResult.style.display = 'block';
  },

  updateAIStats() {
    const statsDiv = document.getElementById('ai-stats');
    if (!statsDiv) return;
    const total = this.history.length;
    if (total === 0) {
      statsDiv.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.6;">Aucune détection pour le moment</div>';
      return;
    }
    const labels = {};
    this.history.forEach(h => labels[h.label] = (labels[h.label] || 0) + 1);
    let html = `<div style="padding:15px;background:#1a1d29;border-radius:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;">📊 Statistiques IA</h3>
        <span style="background:#667eea;padding:3px 10px;border-radius:20px;font-size:12px;">${total} détections</span>
      </div>`;
    Object.entries(labels).sort((a,b) => b[1]-a[1]).forEach(([label, count]) => {
      const pct = (count / total * 100).toFixed(1);
      html += `
        <div style="margin:8px 0;">
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span>${label}</span>
            <span><strong>${count}</strong> (${pct}%)</span>
          </div>
          <div style="background:#0f1117;height:6px;border-radius:3px;overflow:hidden;margin-top:3px;">
            <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#667eea,#764ba2);"></div>
          </div>
        </div>`;
    });
    html += `</div>`;
    statsDiv.innerHTML = html;
  },

  loadHistory() {
    this.history = Utils.loadFromLocalStorage('priva_ai_history', []);
    this.updateAIStats();
  },

  clearHistory() {
    if (!confirm('Vider l\'historique des détections IA ?')) return;
    this.history = [];
    Utils.saveToLocalStorage('priva_ai_history', []);
    this.updateAIStats();
    const lastResult = document.getElementById('ai-last-result');
    if (lastResult) lastResult.style.display = 'none';
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

console.log('✅ PRIVA v5.0 - Partie 1/3 chargée');

// ============================================
// PARTIE 2/3 - Init, Graphiques, Données, Navigation
// ============================================

function init() {
  if (State.isInitialized) return;
  State.devices = Utils.loadFromLocalStorage('priva_devices', {});
  State.securityCameras = Utils.loadFromLocalStorage('priva_security_cameras', {});
  State.securityCaptures = Utils.loadFromLocalStorage('priva_security_captures', []);
  setupCharts();
  loadAgricultureData();
  loadSecurityData();
  State.dataUpdateInterval = setInterval(() => { loadAgricultureData(); loadSecurityData(); }, 10000);
  renderDevicesList();
  const agriDevice = Object.values(State.devices).find(d => d.type === 'agriculture' && d.active);
  if (agriDevice) { updateModuleConfig('agriculture'); startModuleUpdate('agriculture'); }
  State.isInitialized = true;
  showAlert('success', '✅ Système initialisé');
}

function initAI() {
  AIManager.loadHistory();
  chargerToken();
}

function setupCharts() {
  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#f8f9fa', font: { size: 12 } } } },
    scales: {
      x: { ticks: { color: '#9ca3af', maxRotation: 45, minRotation: 45 }, grid: { color: '#2d3142' } },
      y: { ticks: { color: '#9ca3af' }, grid: { color: '#2d3142' } }
    }
  };
  const climateCtx = document.getElementById('climateChart');
  const airCtx = document.getElementById('airChart');
  if (climateCtx) {
    State.climateChart = new Chart(climateCtx, {
      type: 'line',
      data: { labels: [], datasets: [
        { label: 'Température (°C)', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', tension: 0.4, borderWidth: 2, fill: true },
        { label: 'Humidité (%)', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.4, borderWidth: 2, fill: true }
      ]},
      options: chartOptions
    });
  }
  if (airCtx) {
    State.airChart = new Chart(airCtx, {
      type: 'line',
      data: { labels: [], datasets: [
        { label: 'CO2 (ppm)', data: [], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.4, borderWidth: 2, fill: true }
      ]},
      options: chartOptions
    });
  }
}

async function loadAgricultureData() {
  try {
    const res = await Utils.fetchWithTimeout(CONFIG.PROXY + encodeURIComponent(CONFIG.AGRICULTURE_CSV_URL));
    const csv = await res.text();
    const rows = csv.trim().split('\n').map(r => r.split(',').map(c => c.trim()));
    State.allAgriData = rows.slice(1).filter(r => r.length >= 3);
    if (State.allAgriData.length > 0) {
      updateCharts(); updateAgricultureTable();
      const el = document.getElementById('dataCount');
      if (el) el.textContent = State.allAgriData.length;
    }
  } catch (e) { console.error('Erreur agriculture:', e); }
}

function updateCharts() {
  if (!State.climateChart || !State.airChart) return;
  const data = State.allAgriData.slice(-50);
  State.climateChart.data.labels = data.map(r => Utils.formatDateTime(r[0]));
  State.climateChart.data.datasets[0].data = data.map(r => parseFloat(r[1]) || 0);
  State.climateChart.data.datasets[1].data = data.map(r => parseFloat(r[2]) || 0);
  State.climateChart.update('none');
  State.airChart.data.labels = data.map(r => Utils.formatDateTime(r[0]));
  State.airChart.data.datasets[0].data = data.map(r => parseFloat(r[3]) || 0);
  State.airChart.update('none');
}

function updateAgricultureTable() {
  const tbody = document.getElementById('dataTable');
  if (!tbody) return;
  const data = State.allAgriData.slice(-10).reverse();
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Aucune donnée</td></tr>'; return; }
  tbody.innerHTML = data.map(r => `<tr><td>${r[0]}</td><td>${parseFloat(r[1]).toFixed(1)}°C</td><td>${parseFloat(r[2]).toFixed(1)}%</td><td>${parseFloat(r[3]).toFixed(0)} ppm</td><td>${parseFloat(r[4]).toFixed(2)}V</td></tr>`).join('');
}

async function loadSecurityData() {
  try {
    const res = await Utils.fetchWithTimeout(CONFIG.PROXY + encodeURIComponent(CONFIG.SECURITY_CSV_URL));
    const csv = await res.text();
    const rows = csv.trim().split('\n').map(r => r.split(',').map(c => c.trim()));
    State.allSecurityData = rows.slice(1).filter(r => r.length >= 3);
    if (State.allSecurityData.length > 0) updateSecurityTable();
  } catch (e) { console.error('Erreur sécurité:', e); }
}

function updateSecurityTable() {
  const tbody = document.getElementById('securityTable');
  if (!tbody) return;
  const data = State.allSecurityData.slice(-10).reverse();
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Aucune donnée</td></tr>'; return; }
  tbody.innerHTML = data.map(r => {
    const auth = r[4] === 'Oui';
    return `<tr><td>${r[0]}</td><td>${r[1]||'--'}</td><td>${r[2]||'--'}</td><td>${r[3]||'--'}</td><td style="color:${auth?'#00a651':'#e63946'};font-weight:bold;">${r[4]||'--'}</td><td>${r[5]||'--'}</td></tr>`;
  }).join('');
}

function switchModule(module) {
  if (State.moduleUpdateInterval) { clearInterval(State.moduleUpdateInterval); State.moduleUpdateInterval = null; }
  if (State.currentModule === 'security') StreamManager.stopAll();
  State.currentModule = module;
  document.querySelectorAll('.module').forEach(m => m.style.display = 'none');
  const dm = document.getElementById('deviceManager');
  if (dm) dm.style.display = 'none';
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  const btn = document.querySelector(`.tab-btn[onclick*="switchModule('${module}')"]`);
  if (btn) btn.classList.add('active');
  if (module === 'agriculture' || module === 'security') {
    const div = document.getElementById(module);
    if (div) div.style.display = 'block';
    updateModuleConfig(module);
    startModuleUpdate(module);
    if (module === 'security') setTimeout(() => initSecurityCameras(), 100);
    showAlert('success', `📱 Module ${module === 'agriculture' ? 'Agriculture' : 'Sécurité'} activé`);
  }
}

function showDeviceManager() {
  if (State.moduleUpdateInterval) { clearInterval(State.moduleUpdateInterval); State.moduleUpdateInterval = null; }
  StreamManager.stopAll();
  document.querySelectorAll('.module').forEach(m => m.style.display = 'none');
  const dm = document.getElementById('deviceManager');
  if (dm) dm.style.display = 'block';
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  const btn = document.querySelector('.tab-btn[onclick*="showDeviceManager"]');
  if (btn) btn.classList.add('active');
  renderDevicesList();
}

function updateModuleConfig(module) {
  const device = Object.values(State.devices).find(d => d.type === module && d.active);
  const configDiv = document.getElementById(module === 'agriculture' ? 'agri-device-info' : 'sec-device-info');
  if (!configDiv) return;
  if (!device) { configDiv.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.6;">Aucun appareil actif. Ajoutez un ESP32 via "🎛️ Appareils"</div>'; return; }
  configDiv.innerHTML = `
    <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
      <div style="flex:1;"><strong>${device.name}</strong><br><small style="opacity:0.7;">${device.location}</small></div>
      <div style="flex:2;display:flex;gap:8px;align-items:center;">
        <input type="text" id="edit-ip-${module}" value="${device.ip}" style="flex:1;padding:8px;background:#0f1117;border:1px solid #2d3142;border-radius:5px;color:white;">
        <button class="btn btn-success btn-small" onclick="updateDeviceIP('${module}')">💾</button>
        <button class="btn btn-primary btn-small" onclick="testActiveDevice('${module}')">🔍</button>
      </div>
    </div>`;
}

function updateDeviceIP(module) {
  const device = Object.values(State.devices).find(d => d.type === module && d.active);
  if (!device) return;
  const newIP = document.getElementById(`edit-ip-${module}`)?.value.trim();
  if (!newIP || !Utils.validateIP(newIP)) { showAlert('warning', '⚠️ IP invalide'); return; }
  device.ip = newIP;
  Utils.saveToLocalStorage('priva_devices', State.devices);
  showAlert('success', `✅ IP mise à jour: ${newIP}`);
  if (State.moduleUpdateInterval) clearInterval(State.moduleUpdateInterval);
  startModuleUpdate(module);
}

async function testActiveDevice(module) {
  const device = Object.values(State.devices).find(d => d.type === module && d.active);
  if (!device) return;
  showAlert('warning', '🔍 Test de connexion...');
  try { await Utils.fetchWithTimeout(`http://${device.ip}/`); showAlert('success', '✅ Connexion réussie'); }
  catch { showAlert('danger', '❌ Connexion échouée'); }
}

function startModuleUpdate(module) {
  const device = Object.values(State.devices).find(d => d.type === module && d.active);
  if (!device) return;
  const fn = module === 'agriculture' ? updateAgricultureData : updateSecurityData;
  fn(device.ip);
  State.moduleUpdateInterval = setInterval(() => fn(device.ip), 3000);
}

async function updateAgricultureData(ip) {
  try {
    const res = await Utils.fetchWithTimeout(`http://${ip}/status`, { mode: 'cors' });
    const data = await res.json();
    ['tempValue','humidValue','gasValue','dcValue'].forEach((id, i) => {
      const el = document.getElementById(id);
      const vals = [data.temperature, data.humidity, data.gas, data.dc];
      const decimals = [1, 1, 0, 2];
      if (el) el.textContent = vals[i].toFixed(decimals[i]);
    });
    const md = document.getElementById('modeDisplay');
    if (md) md.textContent = data.mode.toUpperCase();
    ['pompe','brumisateur','ventilateur','chauffage','eclairage','electrovanne'].forEach(d => updateDeviceUI(d, data.devices[d]));
    updateConnectionStatus('connected', 'Agriculture');
  } catch { updateConnectionStatus('disconnected'); }
}

async function updateSecurityData(ip) {
  try {
    const res = await Utils.fetchWithTimeout(`http://${ip}/status`, { mode: 'cors' });
    const data = await res.json();
    const doorEl = document.getElementById('sec-door');
    const motionEl = document.getElementById('sec-motion');
    if (doorEl) { doorEl.textContent = data.doorOpen ? 'OUVERTE' : 'FERMÉE'; doorEl.style.color = data.doorOpen ? '#e63946' : '#00a651'; }
    if (motionEl) { motionEl.textContent = data.motionDetected ? 'DÉTECTÉ' : 'AUCUN'; motionEl.style.color = data.motionDetected ? '#f77f00' : '#00a651'; }
    const badgeEl = document.getElementById('sec-badge');
    const timeEl = document.getElementById('sec-time');
    if (badgeEl) badgeEl.textContent = data.lastBadge || '--';
    if (timeEl && data.lastAccess > 0) timeEl.textContent = new Date(data.lastAccess).toLocaleTimeString();
    ['lock','alarm','lights'].forEach(d => updateDeviceUI(d, data.devices[d]));
    updateConnectionStatus('connected', 'Sécurité');
  } catch { updateConnectionStatus('disconnected'); }
}

function updateConnectionStatus(status, module = '') {
  const dot = document.getElementById('connectionStatus');
  const txt = document.getElementById('connectionText');
  if (dot) dot.className = `status-dot ${status === 'connected' ? 'connected' : 'disconnected'}`;
  if (txt) txt.textContent = status === 'connected' ? `Connecté (${module})` : 'Déconnecté';
}

console.log('✅ PRIVA v5.0 - Partie 2/3 chargée');

// ============================================
// PARTIE 3/3 - Actionneurs, Appareils, Caméras
// ============================================

function updateDeviceUI(device, state) {
  const card = document.getElementById(device + 'Card');
  const status = document.getElementById(device + 'Status');
  if (!card || !status) return;
  const active = { pompe:'Actif', brumisateur:'Actif', ventilateur:'Actif', chauffage:'Actif', eclairage:'Allumé', electrovanne:'Ouverte', lock:'Déverrouillée', alarm:'Activée', lights:'Allumées' };
  const inactive = { pompe:'Arrêté', brumisateur:'Arrêté', ventilateur:'Arrêté', chauffage:'Arrêté', eclairage:'Éteint', electrovanne:'Fermée', lock:'Verrouillée', alarm:'Désactivée', lights:'Éteintes' };
  if (state) { card.classList.add('active'); status.textContent = active[device] || 'Actif'; }
  else { card.classList.remove('active'); status.textContent = inactive[device] || 'Arrêté'; }
}

async function toggleDevice(module, device) {
  const activeDevice = Object.values(State.devices).find(d => d.type === module && d.active);
  const card = document.getElementById(device + 'Card');
  const newState = !card?.classList.contains('active');
  if (activeDevice) {
    try {
      const res = await Utils.fetchWithTimeout(`http://${activeDevice.ip}/control`, { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: `device=${device}&state=${newState?1:0}` });
      if (res.ok) { updateDeviceUI(device, newState); showAlert('success', `✅ ${device} ${newState?'activé':'désactivé'}`); return; }
    } catch {}
  }
  try {
    const res = await fetch(CONFIG.COMMAND_API_URL, { method: 'POST', headers: {'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({ cible: module, actionneur: device, etat: newState?1:0 }) });
    const result = await res.json();
    if (result.status === 'success') { updateDeviceUI(device, newState); showAlert('success', `✅ ${device} (cloud)`); }
  } catch { showAlert('danger', '❌ Erreur commande'); }
}

async function setMode(mode) {
  const dev = Object.values(State.devices).find(d => d.type === 'agriculture' && d.active);
  if (dev) {
    try {
      const res = await Utils.fetchWithTimeout(`http://${dev.ip}/mode`, { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: `mode=${mode}` });
      if (res.ok) { const el = document.getElementById('modeDisplay'); if (el) el.textContent = mode.toUpperCase(); showAlert('success', `✅ Mode ${mode}`); return; }
    } catch {}
  }
  showAlert('warning', '⚠️ Connectez un ESP32');
}

async function emergencyStop() {
  if (!confirm('⚠️ CONFIRMER L\'ARRÊT D\'URGENCE ?')) return;
  const dev = Object.values(State.devices).find(d => d.type === 'agriculture' && d.active);
  if (dev) {
    try { await Utils.fetchWithTimeout(`http://${dev.ip}/emergency`, {method:'POST'}); } catch {}
  }
  ['pompe','brumisateur','ventilateur','chauffage','eclairage','electrovanne'].forEach(d => updateDeviceUI(d, false));
  showAlert('danger', '🛑 ARRÊT D\'URGENCE');
}

async function saveSettings() {
  const dev = Object.values(State.devices).find(d => d.type === 'agriculture' && d.active);
  const s = { tempMin: document.getElementById('tempMin')?.value, tempMax: document.getElementById('tempMax')?.value, humMin: document.getElementById('humidMin')?.value, humMax: document.getElementById('humidMax')?.value };
  if (dev) {
    try {
      await Utils.fetchWithTimeout(`http://${dev.ip}/settings`, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:`tempMin=${s.tempMin}&tempMax=${s.tempMax}&humMin=${s.humMin}&humMax=${s.humMax}` });
      showAlert('success', '💾 Paramètres enregistrés'); return;
    } catch {}
  }
  showAlert('warning', '⚠️ Connectez un ESP32');
}

function updateSlider(id, val, unit) {
  const el = document.getElementById(id + 'Val');
  if (el) el.textContent = val + unit;
}

// ==================== APPAREILS ====================
function renderDevicesList() {
  const list = document.getElementById('devicesList');
  if (!list) return;
  if (!Object.keys(State.devices).length) { list.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.6;">Aucun appareil. Cliquez sur "Ajouter"</div>'; return; }
  list.innerHTML = Object.entries(State.devices).map(([id, dev]) => `
    <div class="device-item">
      <div class="device-info">
        <div class="device-name">${dev.type === 'agriculture' ? '🌱' : '🔒'} ${dev.name}</div>
        <div class="device-details">📡 ${dev.ip} • 📍 ${dev.location} • <span style="color:${dev.active?'#00a651':'#e63946'};font-weight:bold;">${dev.active?'✓ Actif':'○ Inactif'}</span></div>
      </div>
      <div class="device-actions">
        <button class="btn btn-small ${dev.active?'btn-danger':'btn-success'}" onclick="toggleDeviceActive('${id}')">${dev.active?'⏸️':'▶️'}</button>
        <button class="btn btn-small btn-primary" onclick="testDeviceConnection('${id}')">🔍</button>
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
  Object.entries(State.devices).forEach(([k,d]) => { if (d.type === type) d.active = false; });
  State.devices[id] = { name, ip, type, location: location || 'Non spécifié', active: true, addedAt: new Date().toISOString() };
  Utils.saveToLocalStorage('priva_devices', State.devices);
  closeAddDeviceModal();
  renderDevicesList();
  showAlert('success', `✅ ${name} ajouté`);
  ['newDeviceName','newDeviceIP','newDeviceLocation'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
  setTimeout(() => { document.querySelector(`.tab-btn[onclick*="switchModule('${type}')"]`)?.click(); }, 500);
}

function toggleDeviceActive(id) {
  const device = State.devices[id];
  if (!device) return;
  if (!device.active) {
    Object.entries(State.devices).forEach(([k,d]) => { if (d.type === device.type) d.active = false; });
    device.active = true;
    showAlert('success', `✅ ${device.name} activé`);
    if (State.currentModule === device.type) { if (State.moduleUpdateInterval) clearInterval(State.moduleUpdateInterval); updateModuleConfig(device.type); startModuleUpdate(device.type); }
  } else { device.active = false; showAlert('warning', `⏸️ ${device.name} désactivé`); if (State.moduleUpdateInterval) clearInterval(State.moduleUpdateInterval); }
  Utils.saveToLocalStorage('priva_devices', State.devices);
  renderDevicesList();
}

async function testDeviceConnection(id) {
  const dev = State.devices[id];
  if (!dev) return;
  showAlert('warning', `🔍 Test ${dev.name}...`);
  try { await Utils.fetchWithTimeout(`http://${dev.ip}/`); showAlert('success', `✅ ${dev.name} répond`); }
  catch { showAlert('danger', `❌ ${dev.name} ne répond pas`); }
}

function deleteDevice(id) {
  const dev = State.devices[id];
  if (!dev || !confirm(`Supprimer "${dev.name}" ?`)) return;
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
  const cameras = Object.entries(State.securityCameras).filter(([id, cam]) => cam.active);
  if (!cameras.length) {
    grid.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.6;">Aucune caméra configurée. Cliquez sur "➕ Ajouter Caméra"</div>';
    return;
  }
  grid.innerHTML = cameras.map(([id, cam]) => `
    <div class="security-camera-card" id="sec-cam-${id}">
      <div class="camera-header">
        <div class="camera-name">
          📹 ${cam.name}
          <div class="camera-status-indicator" id="status-${id}" title="Connexion..."></div>
          <span id="status-label-${id}" style="font-size:10px;opacity:0.7;margin-left:5px;">Connexion...</span>
        </div>
        <button class="btn btn-small btn-danger" onclick="removeSecurityCamera('${id}')">🗑️</button>
      </div>

      <div style="position:relative;background:#000;border-radius:8px;min-height:250px;overflow:hidden;">
        <img id="stream-${id}"
             style="width:100%;height:100%;object-fit:cover;cursor:pointer;display:block;"
             onclick="openCameraFullscreen('${id}','${cam.name}','${cam.ip}')"
             alt="${cam.name}">
        <div id="loading-${id}" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:white;background:rgba(0,0,0,0.6);padding:10px 20px;border-radius:8px;display:flex;align-items:center;gap:8px;">
          <div style="width:16px;height:16px;border:2px solid #667eea;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></div>
          Connexion...
        </div>
      </div>

      <div class="camera-controls" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
        <button class="btn btn-small btn-success" onclick="captureCamera('${id}','${cam.name}','${cam.ip}')">📸 Capturer</button>
        <button class="btn btn-small" onclick="captureCameraAndDetect('${id}','${cam.name}','${cam.ip}')"
                style="background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;padding:6px 10px;border-radius:5px;cursor:pointer;">🤖 IA</button>
        <button class="btn btn-small btn-primary" onclick="toggleFlash('${id}','${cam.ip}')">💡 Flash</button>
        <button class="btn btn-small btn-primary" onclick="StreamManager.restart('${id}','${cam.ip}')">🔄 Restart</button>
        <button class="btn btn-small btn-primary" onclick="openCameraFullscreen('${id}','${cam.name}','${cam.ip}')">🔲 Plein écran</button>
      </div>

      <div class="camera-info" style="font-size:11px;opacity:0.6;margin-top:5px;">
        📍 ${cam.location} • 🔗 ${cam.ip} • FPS: <span id="fps-${id}">--</span>
      </div>
    </div>
  `).join('');

  // Démarrer les streams
  cameras.forEach(([id, cam]) => StreamManager.start(id, cam.ip));
}

function renderSecurityCaptures() {
  const gallery = document.getElementById('security-captures-gallery');
  if (!gallery) return;
  if (!State.securityCaptures.length) { gallery.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.6;">Aucune capture</div>'; return; }
  gallery.innerHTML = State.securityCaptures.slice(0, 20).map((cap, idx) => `
    <div class="capture-item" onclick="viewCapture(${idx})">
      <img src="${cap.url}" alt="${cap.name}" loading="lazy">
      <div class="capture-info">
        <div>📹 ${cap.name}</div>
        <div>⏰ ${new Date(cap.timestamp).toLocaleTimeString('fr-FR')}</div>
      </div>
      <button class="capture-delete" onclick="event.stopPropagation();deleteCapture(${idx})">✖</button>
    </div>`).join('');
}

async function captureCamera(id, name, ip) {
  showAlert('warning', '📸 Capture en cours...');
  try {
    const blob = await StreamManager.capture(id, ip);
    const captureUrl = Utils.buildUrl(ip, `capture`);
    const capture = { id: 'cap_' + Date.now(), cameraId: id, name, timestamp: new Date().toISOString(), url: captureUrl };
    State.securityCaptures.unshift(capture);
    if (State.securityCaptures.length > CONFIG.MAX_CAPTURES) State.securityCaptures.length = CONFIG.MAX_CAPTURES;
    Utils.saveToLocalStorage('priva_security_captures', State.securityCaptures);
    renderSecurityCaptures();
    showAlert('success', `✅ Capturée: ${name}`);
    if (CONFIG.AI_AUTO_DETECT) await AIManager.detectImage(blob, name, id);
  } catch (e) { showAlert('danger', '❌ Erreur capture'); }
}

async function captureCameraAndDetect(id, name, ip) {
  showAlert('warning', '📸 Capture + Analyse IA...');
  try {
    const blob = await StreamManager.capture(id, ip);
    const captureUrl = Utils.buildUrl(ip, 'capture');
    State.securityCaptures.unshift({ id: 'cap_' + Date.now(), cameraId: id, name, timestamp: new Date().toISOString(), url: captureUrl });
    if (State.securityCaptures.length > CONFIG.MAX_CAPTURES) State.securityCaptures.length = CONFIG.MAX_CAPTURES;
    Utils.saveToLocalStorage('priva_security_captures', State.securityCaptures);
    renderSecurityCaptures();
    await AIManager.detectImage(blob, name, id);
  } catch (e) { showAlert('danger', '❌ Erreur capture/détection'); }
}

function captureAllCameras() {
  const cams = Object.entries(State.securityCameras).filter(([id, c]) => c.active);
  if (!cams.length) { showAlert('warning', '⚠️ Aucune caméra active'); return; }
  cams.forEach(([id, cam], i) => setTimeout(() => captureCamera(id, cam.name, cam.ip), i * 600));
}

async function toggleFlash(id, ip) {
  try {
    const url = Utils.buildUrl(ip, 'flash');
    await Utils.fetchWithTimeout(url, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:'state=1' });
    setTimeout(async () => { try { await fetch(url, { method:'POST', body:'state=0' }); } catch {} }, 300);
    showAlert('success', '💡 Flash activé');
  } catch { showAlert('danger', '❌ Erreur flash'); }
}

function refreshAllCameras() {
  Object.entries(State.securityCameras).filter(([id,c]) => c.active).forEach(([id, cam]) => StreamManager.restart(id, cam.ip));
  showAlert('success', '🔄 Caméras redémarrées');
}

function setCameraView(mode) {
  const grid = document.getElementById('security-cameras-grid');
  if (grid) grid.className = mode === 'single' ? 'cameras-single' : 'cameras-grid';
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
  renderSecurityCameras();
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

function viewCapture(idx) {
  const cap = State.securityCaptures[idx];
  if (!cap) return;
  openCameraFullscreen(null, cap.name, null, cap.url);
}

function deleteCapture(idx) {
  State.securityCaptures.splice(idx, 1);
  Utils.saveToLocalStorage('priva_security_captures', State.securityCaptures);
  renderSecurityCaptures();
}

function clearSecurityCaptures() {
  if (!confirm('Vider toutes les captures ?')) return;
  State.securityCaptures = [];
  Utils.saveToLocalStorage('priva_security_captures', State.securityCaptures);
  renderSecurityCaptures();
  showAlert('success', '🗑️ Galerie vidée');
}

// ==================== PLEIN ÉCRAN ====================
let fullscreenStreamInterval = null;

function openCameraFullscreen(id, name, ip, captureUrl = null) {
  const modal = document.getElementById('cameraFullscreenModal');
  const img = document.getElementById('fullscreen-camera-img');
  const title = document.getElementById('fullscreen-camera-name');
  if (!modal || !img || !title) return;
  title.textContent = `📹 ${name}`;
  if (captureUrl) {
    img.src = captureUrl;
  } else if (ip) {
    // Essayer MJPEG en plein écran
    const streamUrl = Utils.buildUrl(ip, 'stream', true);
    img.src = streamUrl;
    img.onerror = () => {
      // Fallback refresh
      img.onerror = null;
      const refresh = () => { img.src = Utils.buildUrl(ip, 'capture'); };
      refresh();
      fullscreenStreamInterval = setInterval(refresh, CONFIG.FALLBACK_REFRESH);
    };
  }
  modal.classList.add('active');
}

function closeCameraFullscreen() {
  document.getElementById('cameraFullscreenModal')?.classList.remove('active');
  if (fullscreenStreamInterval) { clearInterval(fullscreenStreamInterval); fullscreenStreamInterval = null; }
  const img = document.getElementById('fullscreen-camera-img');
  if (img) img.src = '';
}

function captureFromFullscreen() {
  const img = document.getElementById('fullscreen-camera-img');
  if (!img?.src) return;
  const cam = Object.entries(State.securityCameras).find(([id, c]) => img.src.includes(c.ip));
  if (cam) captureCamera(cam[0], cam[1].name, cam[1].ip);
}

function toggleFlashFullscreen() {
  const img = document.getElementById('fullscreen-camera-img');
  if (!img?.src) return;
  const cam = Object.entries(State.securityCameras).find(([id, c]) => img.src.includes(c.ip));
  if (cam) toggleFlash(cam[0], cam[1].ip);
}

function downloadCapture() {
  const img = document.getElementById('fullscreen-camera-img');
  if (!img?.src) return;
  const link = document.createElement('a');
  link.href = img.src;
  link.download = `capture_${Date.now()}.jpg`;
  link.click();
  showAlert('success', '⬇️ Téléchargement...');
}

// ==================== FONCTIONS IA ====================
async function testAIServer() {
  showAlert('warning', '🔍 Test serveur IA...');
  try {
    const res = await Utils.fetchWithTimeout('https://sagitaimage.onrender.com/');
    const data = await res.json();
    showAlert('success', '✅ Serveur Render opérationnel');
  } catch { showAlert('danger', '❌ Serveur IA injoignable (peut être en veille, réessayez dans 30s)'); }
}

function getAIModelInfo() {
  const infoDiv = document.getElementById('ai-model-info');
  if (infoDiv) {
    infoDiv.innerHTML = `
      <div style="padding:12px;background:#1a1d29;border-radius:8px;font-size:12px;line-height:1.8;">
        <div>🤖 <strong>Modèle:</strong> ${CONFIG.HF_MODEL}</div>
        <div>🔗 <strong>Serveur:</strong> sagitaimage.onrender.com</div>
        <div>🔑 <strong>Token:</strong> ${CONFIG.HF_TOKEN ? '✅ Configuré' : '❌ Non configuré'}</div>
        <div>📊 <strong>Détections:</strong> ${AIManager.history.length}</div>
      </div>`;
  }
}

function toggleAutoDetect() {
  CONFIG.AI_AUTO_DETECT = !CONFIG.AI_AUTO_DETECT;
  const btn = document.getElementById('toggle-auto-detect-btn');
  if (btn) { btn.textContent = `🤖 Auto: ${CONFIG.AI_AUTO_DETECT ? 'ON' : 'OFF'}`; btn.className = `btn btn-small ${CONFIG.AI_AUTO_DETECT ? 'btn-success' : 'btn-secondary'}`; }
  showAlert(CONFIG.AI_AUTO_DETECT ? 'success' : 'warning', `Détection auto ${CONFIG.AI_AUTO_DETECT ? 'activée' : 'désactivée'}`);
}

// ==================== TOKEN HUGGING FACE ====================
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
  if (token) {
    CONFIG.HF_TOKEN = token;
    const input = document.getElementById('hf-token-input');
    if (input) input.value = token;
    console.log('✅ Token HF chargé');
  }
}

// ==================== ÉVÉNEMENTS ====================
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && State.currentModule === 'security') {
    Object.entries(State.securityCameras).filter(([id,c]) => c.active).forEach(([id, cam]) => {
      if (!StreamManager.streams[id]) StreamManager.start(id, cam.ip);
    });
  }
});

window.addEventListener('beforeunload', () => {
  if (State.dataUpdateInterval) clearInterval(State.dataUpdateInterval);
  if (State.moduleUpdateInterval) clearInterval(State.moduleUpdateInterval);
  StreamManager.stopAll();
});

console.log('✅ PRIVA v5.0 - Toutes fonctionnalités chargées');
