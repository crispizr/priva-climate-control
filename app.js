// ============================================
// PRIVA Platform - JavaScript avec IA v4.0
// PARTIE 1/2 - Configuration & Gestionnaires
// Refactor mobile-friendly: storage adapter, event bus, exports
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

// ==================== EventBus (browser or fallback) ====================
const EventBus = (typeof window !== 'undefined' && typeof window.EventTarget === 'function')
  ? new window.EventTarget()
  : (() => {
      const bus = { _listeners: {} };
      bus.addEventListener = (type, cb) => { (bus._listeners[type] = bus._listeners[type] || []).push(cb); };
      bus.removeEventListener = (type, cb) => { bus._listeners[type] = (bus._listeners[type] || []).filter(x => x !== cb); };
      bus.dispatchEvent = (evt) => {
        const l = bus._listeners[evt.type] || [];
        l.forEach(cb => { try { cb(evt); } catch(e){console.error(e);} });
        return true;
      };
      return bus;
    })();

// ==================== Storage Adapter (localStorage or React Native AsyncStorage) ====================
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
        // no-op fallback
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

  // save (async, fire-and-forget safe)
  saveToStorage(key, data) {
    StorageAdapter.set(key, data).catch(err => console.error('saveToStorage error', err));
  },

  // load (async)
  loadFromStorage(key, defaultValue = null) {
    return StorageAdapter.get(key, defaultValue);
  },

  validateIP(ip) {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) return false;
    return ip.split('.').every(octet => {
      const num = parseInt(octet, 10);
      return num >= 0 && num <= 255;
    });
  },

  buildCameraUrl(ip, endpoint = 'capture') {
    return `http://${ip}:${CONFIG.ESP32_PORT}/${endpoint}?t=${Date.now()}`;
  }
};

// ==================== UI-safe helpers ====================
function showAlert(type, msg) {
  // If DOM exists, keep existing behavior
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
  // Dispatch event for mobile UI
  try {
    const ev = (typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:alert', { detail: { type, msg } }) : { type: 'priva:alert', detail: { type, msg } };
    EventBus.dispatchEvent(ev);
  } catch (err) {
    console.log(`[${type}] ${msg}`);
  }
}

// ==================== GESTIONNAIRE IA ====================
const AIManager = {
  isProcessing: false,
  history: [],

  async detectImage(imageBlob, cameraName, cameraId) {
    if (this.isProcessing) {
      showAlert('warning', '⏳ Détection en cours...');
      return null;
    }

    this.isProcessing = true;
    showAlert('warning', '🤖 Analyse IA en cours...');

    try {
      const formData = new FormData();
      formData.append('file', imageBlob, `capture_${cameraId}_${Date.now()}.jpg`);

      const response = await Utils.fetchWithTimeout(
        `${CONFIG.AI_SERVER_URL}/upload`,
        { method: 'POST', body: formData },
        30000
      );

      if (!response.ok) throw new Error(`Erreur serveur: ${response.status}`);

      const result = await response.json();

      if (result.success) {
        const detection = {
          cameraId,
          cameraName,
          label: result.prediction.label,
          confidence: result.prediction.confidence,
          timestamp: new Date().toISOString(),
          allPredictions: result.all_predictions
        };

        this.history.unshift(detection);
        if (this.history.length > 50) this.history = this.history.slice(0, 50);

        Utils.saveToStorage('priva_ai_history', this.history);
        this.showDetectionResult(detection);
        this.updateAIStats();

        showAlert('success', `✅ ${result.prediction.label} (${result.prediction.confidence}%)`);
        return detection;
      } else {
        throw new Error(result.error || 'Erreur inconnue');
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
      const response = await Utils.fetchWithTimeout(`http://${cameraIp}:81/detect`);
      const result = await response.json();

      if (result.success) {
        const detection = {
          cameraId, cameraName,
          label: result.detected,
          confidence: result.confidence,
          timestamp: new Date().toISOString(),
          source: 'esp32'
        };

        this.history.unshift(detection);
        this.showDetectionResult(detection);
        showAlert('success', `✅ ${result.detected} (${result.confidence.toFixed(1)}%)`);
        return detection;
      }
    } catch (error) {
      console.error('❌ Erreur détection ESP32:', error);
      showAlert('danger', '❌ Erreur détection ESP32');
      return null;
    }
  },

  showDetectionResult(detection) {
    // Keep previous DOM rendering if page available
    if (typeof document !== 'undefined' && document.getElementById) {
      const resultDiv = document.createElement('div');
      resultDiv.style.cssText = `
        background: linear-gradient(135deg, #667eea, #764ba2);
        padding: 15px; border-radius: 10px; margin: 10px 0;
        animation: slideIn 0.3s; transition: all 0.3s;
      `;
      const confidenceColor = detection.confidence >= 80 ? '#00a651' :
        detection.confidence >= 60 ? '#f77f00' : '#e63946';

      resultDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 15px;">
          <div style="font-size: 48px;">🤖</div>
          <div style="flex: 1;">
            <strong style="font-size: 18px;">📹 ${detection.cameraName}</strong><br>
            <div style="margin: 8px 0;">
              🎯 Détection: <strong style="font-size: 20px; color: #fff;">${detection.label}</strong>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              📊 Confiance:
              <div style="flex: 1; background: rgba(255,255,255,0.2); height: 20px; border-radius: 10px; overflow: hidden;">
                <div style="width: ${detection.confidence}%; height: 100%; background: ${confidenceColor}; transition: width 0.3s;"></div>
              </div>
              <strong style="color: ${confidenceColor};">${detection.confidence.toFixed(1)}%</strong>
            </div>
            <small style="opacity: 0.8;">⏰ ${new Date(detection.timestamp).toLocaleString('fr-FR')}</small>
          </div>
        </div>
      `;
      const container = document.getElementById('ai-results-container') || document.getElementById('alertContainer');
      if (container) {
        container.insertBefore(resultDiv, container.firstChild);
        setTimeout(() => {
          resultDiv.style.opacity = '0';
          resultDiv.style.transform = 'translateX(100%)';
          setTimeout(() => resultDiv.remove(), 300);
        }, 15000);
      }
    }

    // Always dispatch event for app UI
    const ev = (typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:detection', { detail: detection }) : { type: 'priva:detection', detail: detection };
    EventBus.dispatchEvent(ev);
  },

  updateAIStats() {
    const total = this.history.length;
    const stats = { total, labels: {} };
    this.history.forEach(h => stats.labels[h.label] = (stats.labels[h.label] || 0) + 1);

    // Keep DOM update if available
    if (typeof document !== 'undefined' && document.getElementById) {
      const statsDiv = document.getElementById('ai-stats');
      if (statsDiv) {
        if (total === 0) {
          statsDiv.innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.6;">Aucune détection pour le moment</div>';
        } else {
          let html = `<div style="padding: 15px; background: #1a1d29; border-radius: 10px;">
            <h3 style="margin-top: 0;">📊 Statistiques IA</h3>
            <p>Total détections: <strong>${total}</strong></p>
            <div style="margin-top: 10px;">`;
          Object.entries(stats.labels).forEach(([label, count]) => {
            const percentage = (count / total * 100).toFixed(1);
            html += `
              <div style="margin: 5px 0;">
                <div style="display: flex; justify-content: space-between;">
                  <span>${label}</span>
                  <span><strong>${count}</strong> (${percentage}%)</span>
                </div>
                <div style="background: #0f1117; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 3px;">
                  <div style="width: ${percentage}%; height: 100%; background: #667eea;"></div>
                </div>
              </div>`;
          });
          html += `</div></div>`;
          statsDiv.innerHTML = html;
        }
      }
    }

    // Always dispatch event for mobile UI
    const ev = (typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:ai-stats', { detail: stats }) : { type: 'priva:ai-stats', detail: stats };
    EventBus.dispatchEvent(ev);
  },

  async loadHistory() {
    this.history = await Utils.loadFromStorage('priva_ai_history', []);
    if (!Array.isArray(this.history)) this.history = [];
    this.updateAIStats();
  },

  clearHistory() {
    // UI confirmation should be performed by caller (mobile UI)
    this.history = [];
    Utils.saveToStorage('priva_ai_history', []);
    this.updateAIStats();
    showAlert('success', '🗑️ Historique vidé');
  }
};

// ==================== GESTIONNAIRE CAMÉRAS ====================
const CameraManager = {
  intervals: {},
  fullscreenInterval: null,
  isActive: false,
  frameCounters: {},

  init() {
    console.log('📹 Initialisation CameraManager');
    this.isActive = false;
    this.stopAll();
  },

  startRefresh(id, ip) {
    if (!Utils.validateIP(ip)) {
      console.error(`❌ IP invalide pour caméra ${id}: ${ip}`);
      return;
    }

    this.stopRefresh(id);

    if (!this.isActive) {
      console.log('⏸️ CameraManager inactif, refresh non démarré');
      return;
    }

    console.log(`📹 Démarrage refresh caméra: ${id}`);

    let errorCount = 0;
    const MAX_ERRORS = 3;
    this.frameCounters[id] = { count: 0, lastTime: Date.now() };

    const refreshFrame = async () => {
      if (!this.isActive) {
        this.stopRefresh(id);
        return;
      }

      // If DOM exists we will update the <img>, else dispatch event for UI to fetch image
      try {
        const newSrc = Utils.buildCameraUrl(ip, 'capture');

        if (typeof document !== 'undefined' && document.getElementById) {
          const img = document.getElementById(`stream-${id}`);
          if (!img) {
            this.stopRefresh(id);
            return;
          }

          const testImg = new Image();
          testImg.onload = () => {
            img.src = newSrc;
            errorCount = 0;
            this.updateCameraStatus(id, 'online');
            this.updateFPS(id);
          };
          testImg.onerror = () => {
            errorCount++;
            if (errorCount >= MAX_ERRORS) {
              this.updateCameraStatus(id, 'offline');
              this.stopRefresh(id);
            }
          };
          testImg.src = newSrc;
        } else {
          // dispatch event so mobile UI can load image
          const ev = (typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:camera-frame', { detail: { id, url: newSrc } }) : { type: 'priva:camera-frame', detail: { id, url: newSrc } };
          EventBus.dispatchEvent(ev);
          this.updateCameraStatus(id, 'online'); // assume online when we can build url
          this.updateFPS(id);
        }
      } catch (error) {
        errorCount++;
        if (errorCount >= MAX_ERRORS) this.stopRefresh(id);
      }
    };

    refreshFrame();
    this.intervals[id] = setInterval(refreshFrame, CONFIG.CAMERA_REFRESH_RATE);
  },

  stopRefresh(id) {
    if (this.intervals[id]) {
      clearInterval(this.intervals[id]);
      delete this.intervals[id];
    }
  },

  stopAll() {
    Object.keys(this.intervals).forEach(id => this.stopRefresh(id));
    if (this.fullscreenInterval) {
      clearInterval(this.fullscreenInterval);
      this.fullscreenInterval = null;
    }
    this.frameCounters = {};
  },

  updateCameraStatus(id, status) {
    if (typeof document !== 'undefined' && document.getElementById) {
      const indicator = document.getElementById(`status-${id}`);
      const card = document.getElementById(`sec-cam-${id}`);
      const loading = document.getElementById(`loading-${id}`);
      if (status === 'online') {
        indicator?.classList.remove('offline');
        card?.classList.remove('offline');
        if (loading) loading.style.display = 'none';
      } else {
        indicator?.classList.add('offline');
        card?.classList.add('offline');
        if (loading) {
          loading.style.display = 'block';
          loading.textContent = '❌ Hors ligne';
        }
      }
    }
    // Dispatch event for UI
    const ev = (typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:camera-status', { detail: { id, status } }) : { type: 'priva:camera-status', detail: { id, status } };
    EventBus.dispatchEvent(ev);
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
      const ev = (typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:camera-fps', { detail: { id, fps } }) : { type: 'priva:camera-fps', detail: { id, fps } };
      EventBus.dispatchEvent(ev);
      counter.count = 0;
      counter.lastTime = now;
    }
  }
};

// ==================== Fonctions DOM/Logique (compatibilité) ====================
// Many functions keep previous behavior if DOM exists, otherwise they dispatch events.
// Only changed storage usage to async-safe where needed.

async function captureCamera(id, name, ip) {
  if (!Utils.validateIP(ip)) {
    showAlert('danger', '❌ IP invalide');
    return;
  }

  showAlert('warning', '📸 Capture en cours...');

  try {
    const captureUrl = Utils.buildCameraUrl(ip, 'capture');
    const response = await fetch(captureUrl);
    const blob = await response.blob();

    const capture = {
      id: 'cap_' + Date.now(),
      cameraId: id,
      name: name,
      timestamp: new Date().toISOString(),
      url: captureUrl
    };

    State.securityCaptures.unshift(capture);
    if (State.securityCaptures.length > CONFIG.MAX_CAPTURES) {
      State.securityCaptures = State.securityCaptures.slice(0, CONFIG.MAX_CAPTURES);
    }

    Utils.saveToStorage('priva_security_captures', State.securityCaptures);

    // If DOM available, render; else dispatch event
    if (typeof document !== 'undefined' && document.getElementById) {
      renderSecurityCaptures();
      showAlert('success', `✅ Photo capturée: ${name}`);
    } else {
      EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:capture', { detail: capture }) : { type: 'priva:capture', detail: capture });
      showAlert('success', `✅ Photo capturée: ${name}`);
    }

    // Détection auto si activée
    if (CONFIG.AI_AUTO_DETECT) {
      await AIManager.detectImage(blob, name, id);
    }

  } catch (error) {
    console.error('❌ Erreur capture:', error);
    showAlert('danger', '❌ Erreur capture');
  }
}

async function captureCameraAndDetect(id, name, ip) {
  showAlert('warning', '📸 Capture + Détection IA...');

  try {
    const captureUrl = Utils.buildCameraUrl(ip, 'capture');
    const response = await fetch(captureUrl);
    const blob = await response.blob();

    const capture = {
      id: 'cap_' + Date.now(),
      cameraId: id,
      name: name,
      timestamp: new Date().toISOString(),
      url: captureUrl
    };

    State.securityCaptures.unshift(capture);
    if (State.securityCaptures.length > CONFIG.MAX_CAPTURES) {
      State.securityCaptures = State.securityCaptures.slice(0, CONFIG.MAX_CAPTURES);
    }

    Utils.saveToStorage('priva_security_captures', State.securityCaptures);

    if (typeof document !== 'undefined' && document.getElementById) {
      renderSecurityCaptures();
    } else {
      EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:capture', { detail: capture }) : { type: 'priva:capture', detail: capture });
    }

    await AIManager.detectImage(blob, name, id);

  } catch (error) {
    console.error('❌ Erreur:', error);
    showAlert('danger', '❌ Erreur capture/détection');
  }
}

async function detectWithESP32Camera(id, name, ip) {
  await AIManager.detectWithESP32(ip, name, id);
}

function captureAllCameras() {
  const active = Object.entries(State.securityCameras).filter(([id, cam]) => cam.active);

  if (active.length === 0) {
    showAlert('warning', '⚠️ Aucune caméra active');
    return;
  }

  showAlert('warning', `📸 Capture de ${active.length} caméra(s)...`);
  active.forEach(([id, cam], idx) => {
    setTimeout(() => captureCamera(id, cam.name, cam.ip), idx * 500);
  });
}

async function testAIServer() {
  showAlert('warning', '🔍 Test serveur IA...');

  try {
    const response = await Utils.fetchWithTimeout(`${CONFIG.AI_SERVER_URL}/health`);
    const data = await response.json();

    if (data.status === 'healthy') {
      showAlert('success', `✅ Serveur IA opérationnel`);
      console.log('📊 Infos serveur:', data);
      return true;
    }
  } catch (error) {
    showAlert('danger', '❌ Serveur IA injoignable');
    console.error('Erreur:', error);
    return false;
  }
}

async function getAIModelInfo() {
  try {
    const response = await Utils.fetchWithTimeout(`${CONFIG.AI_SERVER_URL}/info`);
    const data = await response.json();

    console.log('🤖 Infos modèle IA:', data);
    // dispatch event
    EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:ai-model-info', { detail: data }) : { type: 'priva:ai-model-info', detail: data });

    if (typeof document !== 'undefined' && document.getElementById) {
      const infoDiv = document.getElementById('ai-model-info');
      if (infoDiv) {
        infoDiv.innerHTML = `
          <div style="padding: 10px; background: #1a1d29; border-radius: 8px; font-size: 12px;">
            <strong>Modèle:</strong> ${data.model_name}<br>
            <strong>Classes:</strong> ${data.classes.join(', ')}<br>
            <strong>Input:</strong> ${data.input_shape.join('x')}<br>
            <strong>Version:</strong> ${data.version}
          </div>
        `;
      }
    }

    return data;
  } catch (error) {
    console.error('Erreur infos modèle:', error);
    showAlert('danger', '❌ Erreur récupération infos modèle');
    return null;
  }
}

function toggleAutoDetect() {
  CONFIG.AI_AUTO_DETECT = !CONFIG.AI_AUTO_DETECT;
  if (typeof document !== 'undefined' && document.getElementById) {
    const btn = document.getElementById('toggle-auto-detect-btn');
    if (btn) {
      btn.textContent = CONFIG.AI_AUTO_DETECT ? '🤖 Auto: ON' : '🤖 Auto: OFF';
      btn.className = CONFIG.AI_AUTO_DETECT ? 'btn btn-success btn-small' : 'btn btn-secondary btn-small';
    }
  }
  showAlert(
    CONFIG.AI_AUTO_DETECT ? 'success' : 'warning',
    CONFIG.AI_AUTO_DETECT ? '✅ Détection auto activée' : '⏸️ Détection auto désactivée'
  );
}

// ==================== CAMÉRAS ====================
function renderSecurityCameras() {
  // If DOM present, render old UI; otherwise dispatch cameras list
  const camerasList = Object.entries(State.securityCameras).filter(([id, cam]) => cam.active).map(([id, cam]) => ({ id, ...cam }));

  if (typeof document !== 'undefined' && document.getElementById) {
    const grid = document.getElementById('security-cameras-grid');
    if (!grid) return;

    CameraManager.stopAll();

    if (camerasList.length === 0) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.6;">Aucune caméra configurée. Cliquez sur "➕ Ajouter Caméra"</div>';
      return;
    }

    grid.innerHTML = camerasList.map(cam => `
      <div class="security-camera-card" id="sec-cam-${cam.id}">
        <div class="camera-header">
          <div class="camera-name">
            📹 ${cam.name}
            <div class="camera-status-indicator" id="status-${cam.id}"></div>
          </div>
          <button class="btn btn-small btn-danger" onclick="removeSecurityCamera('${cam.id}')">🗑️</button>
        </div>

        <div style="position: relative; background: #000; border-radius: 8px; min-height: 250px; overflow: hidden;">
          <img class="camera-stream-img"
               id="stream-${cam.id}"
               src="${Utils.buildCameraUrl(cam.ip, 'capture')}"
               onclick="openCameraFullscreen('${cam.id}', '${cam.name}', '${cam.ip}')"
               alt="${cam.name}"
               style="width: 100%; height: 100%; object-fit: cover; cursor: pointer;">

          <div id="loading-${cam.id}" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; display: none;">
            ⏳ Chargement...
          </div>
        </div>

        <div class="camera-controls">
          <button class="btn btn-small btn-success" onclick="captureCamera('${cam.id}', '${cam.name}', '${cam.ip}')">📸</button>
          <button class="btn btn-small btn-warning" onclick="captureCameraAndDetect('${cam.id}', '${cam.name}', '${cam.ip}')" style="background: linear-gradient(135deg, #667eea, #764ba2);">🤖 IA</button>
          <button class="btn btn-small btn-info" onclick="detectWithESP32Camera('${cam.id}', '${cam.name}', '${cam.ip}')">🔍 ESP32</button>
          <button class="btn btn-small btn-primary" onclick="toggleFlash('${cam.id}', '${cam.ip}')">💡</button>
          <button class="btn btn-small btn-primary" onclick="openCameraFullscreen('${cam.id}', '${cam.name}', '${cam.ip}')">🔍</button>
        </div>

        <div class="camera-info">
          📍 ${cam.location} • 🔗 ${cam.ip} •
          <span style="font-size: 10px; opacity: 0.6;">FPS: <span id="fps-${cam.id}">--</span></span>
        </div>
      </div>
    `).join('');

    if (CameraManager.isActive) {
      camerasList.forEach(cam => CameraManager.startRefresh(cam.id, cam.ip));
    }
  } else {
    EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:render-cameras', { detail: camerasList }) : { type: 'priva:render-cameras', detail: camerasList });
  }
}

function renderSecurityCaptures() {
  if (typeof document !== 'undefined' && document.getElementById) {
    const gallery = document.getElementById('security-captures-gallery');
    if (!gallery) return;

    if (State.securityCaptures.length === 0) {
      gallery.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.6;">Aucune capture</div>';
      return;
    }

    gallery.innerHTML = State.securityCaptures.slice(0, 20).map((cap, idx) => {
      const date = new Date(cap.timestamp);
      return `
        <div class="capture-item" onclick="viewCapture(${idx})">
          <img src="${cap.url}" alt="${cap.name}" loading="lazy">
          <div class="capture-info">
            <div>📹 ${cap.name}</div>
            <div>⏰ ${date.toLocaleTimeString('fr-FR')}</div>
          </div>
          <button class="capture-delete" onclick="event.stopPropagation(); deleteCapture(${idx})">✖</button>
        </div>
      `;
    }).join('');
  } else {
    EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:render-captures', { detail: State.securityCaptures }) : { type: 'priva:render-captures', detail: State.securityCaptures });
  }
}

function openAddCameraModal() {
  if (typeof document !== 'undefined' && document.getElementById) {
    const modal = document.getElementById('addCameraModal');
    if (modal) modal.classList.add('active');
  } else {
    EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:open-add-camera') : { type: 'priva:open-add-camera' });
  }
}

function closeAddCameraModal() {
  if (typeof document !== 'undefined' && document.getElementById) {
    const modal = document.getElementById('addCameraModal');
    if (modal) modal.classList.remove('active');
  } else {
    EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:close-add-camera') : { type: 'priva:close-add-camera' });
  }
}

function addSecurityCameraFromParams(name, ip, location = 'Non spécifié') {
  const id = 'cam_' + Date.now();
  State.securityCameras[id] = {
    name,
    ip,
    location: location || 'Non spécifié',
    active: true,
    addedAt: new Date().toISOString()
  };
  Utils.saveToStorage('priva_security_cameras', State.securityCameras);
  renderSecurityCameras();
  showAlert('success', `✅ ${name} ajoutée`);
  return id;
}

function addSecurityCamera() {
  if (typeof document === 'undefined' || !document.getElementById) {
    showAlert('warning', 'Ajout via UI mobile : utilisez Priva.addSecurityCamera({name, ip, location})');
    return;
  }
  const name = document.getElementById('newCameraName')?.value.trim();
  const ip = document.getElementById('newCameraIP')?.value.trim();
  const location = document.getElementById('newCameraLocation')?.value.trim();

  if (!name || !ip) {
    showAlert('warning', '⚠️ Nom et IP requis');
    return;
  }

  if (!Utils.validateIP(ip)) {
    showAlert('warning', '⚠️ Format IP invalide');
    return;
  }

  addSecurityCameraFromParams(name, ip, location);

  ['newCameraName', 'newCameraIP', 'newCameraLocation'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function removeSecurityCamera(id) {
  const cam = State.securityCameras[id];
  if (!cam) return;

  // For mobile, caller should confirm before calling this function
  if (typeof document !== 'undefined' && document.getElementById) {
    if (!confirm(`Supprimer "${cam.name}" ?`)) return;
  }

  CameraManager.stopRefresh(id);
  delete State.securityCameras[id];
  Utils.saveToStorage('priva_security_cameras', State.securityCameras);
  renderSecurityCameras();
  showAlert('success', `🗑️ ${cam.name} supprimée`);
}

async function toggleFlash(id, ip) {
  try {
    await Utils.fetchWithTimeout(`http://${ip}:${CONFIG.ESP32_PORT}/flash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'state=1'
    });

    setTimeout(async () => {
      await Utils.fetchWithTimeout(`http://${ip}:${CONFIG.ESP32_PORT}/flash`, { method: 'POST', body: 'state=0' });
    }, 200);

    showAlert('success', '💡 Flash activé');
  } catch (err) {
    showAlert('danger', '❌ Erreur flash');
  }
}

function refreshAllCameras() {
  Object.entries(State.securityCameras).forEach(([id, cam]) => {
    if (typeof document !== 'undefined' && document.getElementById) {
      const img = document.getElementById(`stream-${id}`);
      if (img) img.src = Utils.buildCameraUrl(cam.ip, 'capture');
    }
    // mobile: dispatch an event for each frame
    EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:camera-frame', { detail: { id, url: Utils.buildCameraUrl(cam.ip, 'capture') } }) : { type: 'priva:camera-frame', detail: { id, url: Utils.buildCameraUrl(cam.ip, 'capture') } });
  });
  showAlert('success', '🔄 Caméras rafraîchies');
}

function setCameraView(mode) {
  if (typeof document !== 'undefined' && document.getElementById) {
    const grid = document.getElementById('security-cameras-grid');
    if (!grid) return;
    grid.className = mode === 'single' ? 'cameras-single' : 'cameras-grid';
    showAlert('success', `📺 Vue ${mode === 'single' ? 'simple' : 'grille'}`);
  } else {
    EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:set-camera-view', { detail: { mode } }) : { type: 'priva:set-camera-view', detail: { mode } });
  }
}

function viewCapture(idx) {
  const cap = State.securityCaptures[idx];
  if (!cap) return;
  openCameraFullscreen(null, cap.name, null, cap.url);
}

function deleteCapture(idx) {
  State.securityCaptures.splice(idx, 1);
  Utils.saveToStorage('priva_security_captures', State.securityCaptures);
  renderSecurityCaptures();
  showAlert('success', '🗑️ Capture supprimée');
}

function clearSecurityCaptures() {
  // For mobile, confirm externally, then call
  State.securityCaptures = [];
  Utils.saveToStorage('priva_security_captures', State.securityCaptures);
  renderSecurityCaptures();
  showAlert('success', '🗑️ Galerie vidée');
}

function openCameraFullscreen(id, name, ip, captureUrl = null) {
  if (typeof document !== 'undefined' && document.getElementById) {
    const modal = document.getElementById('cameraFullscreenModal');
    const img = document.getElementById('fullscreen-camera-img');
    const title = document.getElementById('fullscreen-camera-name');
    if (!modal || !img || !title) return;
    title.textContent = `📹 ${name}`;
    if (captureUrl) {
      img.src = captureUrl;
    } else if (ip) {
      img.src = Utils.buildCameraUrl(ip, 'capture');
      CameraManager.startFullscreen && CameraManager.startFullscreen(ip);
    }
    modal.classList.add('active');
  } else {
    EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:open-fullscreen', { detail: { id, name, ip, captureUrl } }) : { type: 'priva:open-fullscreen', detail: { id, name, ip, captureUrl } });
  }
}

function closeCameraFullscreen() {
  if (typeof document !== 'undefined' && document.getElementById) {
    const modal = document.getElementById('cameraFullscreenModal');
    if (modal) modal.classList.remove('active');
    if (CameraManager.fullscreenInterval) {
      clearInterval(CameraManager.fullscreenInterval);
      CameraManager.fullscreenInterval = null;
    }
  } else {
    EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:close-fullscreen') : { type: 'priva:close-fullscreen' });
  }
}

function captureFromFullscreen() {
  if (typeof document !== 'undefined' && document.getElementById) {
    const img = document.getElementById('fullscreen-camera-img');
    if (!img || !img.src) return;
    const active = Object.entries(State.securityCameras).find(([id, cam]) => img.src.includes(cam.ip));
    if (active) {
      const [id, cam] = active;
      captureCamera(id, cam.name, cam.ip);
    }
  } else {
    EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:capture-fullscreen') : { type: 'priva:capture-fullscreen' });
  }
}

function toggleFlashFullscreen() {
  if (typeof document !== 'undefined' && document.getElementById) {
    const img = document.getElementById('fullscreen-camera-img');
    if (!img || !img.src) return;
    const active = Object.entries(State.securityCameras).find(([id, cam]) => img.src.includes(cam.ip));
    if (active) {
      const [id, cam] = active;
      toggleFlash(id, cam.ip);
    }
  } else {
    EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:toggle-flash-fullscreen') : { type: 'priva:toggle-flash-fullscreen' });
  }
}

function downloadCapture() {
  if (typeof document !== 'undefined' && document.getElementById) {
    const img = document.getElementById('fullscreen-camera-img');
    if (!img || !img.src) return;
    const link = document.createElement('a');
    link.href = img.src;
    link.download = `capture_${Date.now()}.jpg`;
    link.click();
    showAlert('success', '⬇️ Téléchargement...');
  } else {
    EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:download-capture') : { type: 'priva:download-capture' });
  }
}

// ==================== INITIALISATION ====================
async function init() {
  if (State.isInitialized) {
    console.log('⚠️ Application déjà initialisée');
    return;
  }

  console.log('🚀 Initialisation PRIVA...');

  State.devices = await Utils.loadFromStorage('priva_devices', {}) || {};
  State.securityCameras = await Utils.loadFromStorage('priva_security_cameras', {}) || {};
  State.securityCaptures = await Utils.loadFromStorage('priva_security_captures', []) || [];

  State.isInitialized = true;
  showAlert('success', '✓ Système initialisé');
  console.log('✅ PRIVA initialisé');

  // dispatch ready event
  EventBus.dispatchEvent((typeof CustomEvent !== 'undefined') ? new CustomEvent('priva:ready', { detail: { state: State } }) : { type: 'priva:ready', detail: { state: State } });
}

async function initAI() {
  console.log('🤖 Initialisation module IA');
  await AIManager.loadHistory();
}

// ==================== ÉVÉNEMENTS ====================
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && CameraManager.isActive && State.currentModule === 'security') {
      console.log('👁️ Page visible - Relance refresh caméras');
      const active = Object.entries(State.securityCameras).filter(([id, cam]) => cam.active);
      active.forEach(([id, cam]) => {
        if (!CameraManager.intervals[id]) {
          CameraManager.startRefresh(id, cam.ip);
        }
      });
    }
  });

  window.addEventListener('beforeunload', () => {
    if (State.dataUpdateInterval) clearInterval(State.dataUpdateInterval);
    if (State.moduleUpdateInterval) clearInterval(State.moduleUpdateInterval);
    CameraManager.stopAll();
  });
}

// ==================== Export / UMD-ish ====================
const Priva = {
  CONFIG,
  State,
  EventBus,
  Utils,
  AIManager,
  CameraManager,
  // exported functions
  init,
  initAI,
  captureCamera,
  captureCameraAndDetect,
  detectWithESP32Camera,
  captureAllCameras,
  testAIServer,
  getAIModelInfo,
  toggleAutoDetect,
  initSecurityCameras,
  renderSecurityCameras,
  renderSecurityCaptures,
  openAddCameraModal,
  closeAddCameraModal,
  addSecurityCameraFromParams,
  addSecurityCamera,
  removeSecurityCamera,
  toggleFlash,
  refreshAllCameras,
  setCameraView,
  viewCapture,
  deleteCapture,
  clearSecurityCaptures,
  openCameraFullscreen,
  closeCameraFullscreen,
  captureFromFullscreen,
  toggleFlashFullscreen,
  downloadCapture,
  showAlert // small helper
};

// Node/CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Priva;
} else if (typeof define === 'function' && define.amd) {
  define(() => Priva);
} else if (typeof window !== 'undefined') {
  window.Priva = Priva;
}

console.log('✅ PRIVA JavaScript Partie 2/2 chargée - Version IA Complète 4.0 (mobile-friendly)');
