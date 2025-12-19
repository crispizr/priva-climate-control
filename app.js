// ============================================
// PRIVA Platform - JavaScript Optimisé v3.0
// ============================================

// ==================== CONFIGURATION ====================
const CONFIG = {
  COMMAND_API_URL: 'https://script.google.com/macros/s/AKfycbwA53tJWrpVpd6WeoAA09FYVe63aFvwy-liD_rQgb2gr_HZ2bYHC1sKajJ4wzwshMC6aA/exec',
  AGRICULTURE_CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQwJjy2KpJJ5X--C87zVuPjykAg9Fyc79zIxpdk1Dt0FvrxYw1Onfzt5wSHOVagvLry9uyyohzeN3h4/pub?output=csv",
  SECURITY_CSV_URL: "https://docs.google.com/spreadsheets/d/12x5LRuFBaKeAfkSxc53uR-6Q3Xcu-OxZt2plY0GZSko/export?format=csv&gid=2127989880",
  PROXY: 'https://api.allorigins.win/raw?url=',
  CAMERA_REFRESH_RATE: 800,
  MAX_CAPTURES: 100,
  FETCH_TIMEOUT: 5000,
  ESP32_PORT: 81
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
  
  saveToLocalStorage(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Erreur sauvegarde localStorage:', error);
      return false;
    }
  },
  
  loadFromLocalStorage(key, defaultValue = null) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultValue;
    } catch (error) {
      console.error('Erreur chargement localStorage:', error);
      return defaultValue;
    }
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
        console.log(`⏸️ Module inactif, arrêt refresh ${id}`);
        this.stopRefresh(id);
        return;
      }
      
      const img = document.getElementById(`stream-${id}`);
      if (!img) {
        console.log(`❌ Image ${id} introuvable, arrêt refresh`);
        this.stopRefresh(id);
        return;
      }
      
      try {
        const newSrc = Utils.buildCameraUrl(ip, 'capture');
        const testImg = new Image();
        
        testImg.onload = () => {
          img.src = newSrc;
          errorCount = 0;
          this.updateCameraStatus(id, 'online');
          this.updateFPS(id);
        };
        
        testImg.onerror = () => {
          errorCount++;
          console.warn(`⚠️ Erreur chargement ${id} (${errorCount}/${MAX_ERRORS})`);
          
          if (errorCount >= MAX_ERRORS) {
            console.error(`❌ Trop d'erreurs pour ${id}, arrêt refresh`);
            this.updateCameraStatus(id, 'offline');
            this.stopRefresh(id);
          }
        };
        
        testImg.src = newSrc;
        
      } catch (error) {
        console.error(`❌ Erreur refresh ${id}:`, error);
        errorCount++;
        
        if (errorCount >= MAX_ERRORS) {
          this.stopRefresh(id);
        }
      }
    };
    
    refreshFrame();
    this.intervals[id] = setInterval(refreshFrame, CONFIG.CAMERA_REFRESH_RATE);
  },
  
  stopRefresh(id) {
    if (this.intervals[id]) {
      clearInterval(this.intervals[id]);
      delete this.intervals[id];
      console.log(`🛑 Arrêt refresh: ${id}`);
    }
  },
  
  stopAll() {
    console.log('🛑 Arrêt de tous les refresh caméras');
    
    Object.keys(this.intervals).forEach(id => this.stopRefresh(id));
    
    if (this.fullscreenInterval) {
      clearInterval(this.fullscreenInterval);
      this.fullscreenInterval = null;
    }
    
    this.frameCounters = {};
  },
  
  startFullscreen(ip) {
    if (this.fullscreenInterval) {
      clearInterval(this.fullscreenInterval);
    }
    
    const img = document.getElementById('fullscreen-camera-img');
    if (!img) return;
    
    const refresh = () => {
      const modal = document.getElementById('cameraFullscreenModal');
      if (!modal || !modal.classList.contains('active')) {
        clearInterval(this.fullscreenInterval);
        this.fullscreenInterval = null;
        return;
      }
      
      img.src = Utils.buildCameraUrl(ip, 'capture');
    };
    
    refresh();
    this.fullscreenInterval = setInterval(refresh, CONFIG.CAMERA_REFRESH_RATE);
  },
  
  updateCameraStatus(id, status) {
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
  },
  
  updateFPS(id) {
    const counter = this.frameCounters[id];
    if (!counter) return;
    
    counter.count++;
    const now = Date.now();
    
    if (now - counter.lastTime >= 1000) {
      const fps = Math.round(counter.count * 1000 / (now - counter.lastTime));
      const fpsElement = document.getElementById(`fps-${id}`);
      if (fpsElement) fpsElement.textContent = fps;
      
      counter.count = 0;
      counter.lastTime = now;
    }
  },
  
  async detectWithCamera(ip) {
    if (!Utils.validateIP(ip)) {
      showAlert('danger', '❌ IP invalide');
      return null;
    }
    
    showAlert('warning', '🔍 Détection en cours...');
    
    try {
      const res = await Utils.fetchWithTimeout(Utils.buildCameraUrl(ip, 'detect'));
      const data = await res.json();
      
      if (data.success) {
        const message = `✅ ${data.detected} (${data.confidence.toFixed(1)}%)`;
        showAlert('success', message);
        return data;
      } else {
        showAlert('warning', '⚠️ Aucune détection');
        return null;
      }
    } catch (error) {
      console.error('Erreur détection:', error);
      showAlert('danger', '❌ Erreur de connexion');
      return null;
    }
  }
};

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

// ==================== INITIALISATION ====================
function init() {
  if (State.isInitialized) {
    console.log('⚠️ Application déjà initialisée');
    return;
  }
  
  console.log('🚀 Initialisation PRIVA...');
  
  State.devices = Utils.loadFromLocalStorage('priva_devices', {});
  State.securityCameras = Utils.loadFromLocalStorage('priva_security_cameras', {});
  State.securityCaptures = Utils.loadFromLocalStorage('priva_security_captures', []);
  
  setupCharts();
  loadAgricultureData();
  loadSecurityData();
  
  State.dataUpdateInterval = setInterval(() => {
    loadAgricultureData();
    loadSecurityData();
  }, 10000);
  
  renderDevicesList();
  
  const agriDevice = Object.values(State.devices).find(d => d.type === 'agriculture' && d.active);
  if (agriDevice) {
    updateModuleConfig('agriculture');
    startModuleUpdate('agriculture');
  }
  
  State.isInitialized = true;
  showAlert('success', '✓ Système initialisé');
  
  console.log('✅ PRIVA initialisé');
}

// ==================== GRAPHIQUES ====================
function setupCharts() {
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { 
      legend: { 
        labels: { 
          color: '#f8f9fa', 
          font: { size: 12 } 
        } 
      } 
    },
    scales: {
      x: { 
        ticks: { color: '#9ca3af', maxRotation: 45, minRotation: 45 }, 
        grid: { color: '#2d3142' } 
      },
      y: { 
        ticks: { color: '#9ca3af' }, 
        grid: { color: '#2d3142' } 
      }
    }
  };

  const climateCtx = document.getElementById('climateChart');
  const airCtx = document.getElementById('airChart');
  
  if (climateCtx) {
    State.climateChart = new Chart(climateCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { 
            label: 'Température (°C)', 
            data: [], 
            borderColor: '#ef4444', 
            backgroundColor: 'rgba(239, 68, 68, 0.1)', 
            tension: 0.4, 
            borderWidth: 3, 
            fill: true 
          },
          { 
            label: 'Humidité (%)', 
            data: [], 
            borderColor: '#3b82f6', 
            backgroundColor: 'rgba(59, 130, 246, 0.1)', 
            tension: 0.4, 
            borderWidth: 3, 
            fill: true 
          }
        ]
      },
      options: chartOptions
    });
  }

  if (airCtx) {
    State.airChart = new Chart(airCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { 
            label: 'CO2 (ppm)', 
            data: [], 
            borderColor: '#10b981', 
            backgroundColor: 'rgba(16, 185, 129, 0.1)', 
            tension: 0.4, 
            borderWidth: 3, 
            fill: true 
          }
        ]
      },
      options: chartOptions
    });
  }
}

// ==================== DONNÉES AGRICULTURE ====================
async function loadAgricultureData() {
  try {
    const res = await Utils.fetchWithTimeout(
      CONFIG.PROXY + encodeURIComponent(CONFIG.AGRICULTURE_CSV_URL)
    );
    const csv = await res.text();
    const rows = csv.trim().split('\n').map(r => r.split(',').map(c => c.trim()));
    
    State.allAgriData = rows.slice(1).filter(row => row.length >= 3);
    
    if (State.allAgriData.length > 0) {
      updateCharts();
      updateAgricultureTable();
      
      const dataCount = document.getElementById('dataCount');
      if (dataCount) dataCount.textContent = State.allAgriData.length;
    }
  } catch (err) {
    console.error('❌ Erreur chargement agriculture:', err);
  }
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
  const tableBody = document.getElementById('dataTable');
  if (!tableBody) return;
  
  const recentData = State.allAgriData.slice(-10).reverse();
  
  if (recentData.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Aucune donnée</td></tr>';
    return;
  }
  
  tableBody.innerHTML = recentData.map(r => `
    <tr>
      <td>${r[0]}</td>
      <td>${parseFloat(r[1]).toFixed(1)}°C</td>
      <td>${parseFloat(r[2]).toFixed(1)}%</td>
      <td>${parseFloat(r[3]).toFixed(0)} ppm</td>
      <td>${parseFloat(r[4]).toFixed(2)}V</td>
    </tr>
  `).join('');
}

// ==================== DONNÉES SÉCURITÉ ====================
async function loadSecurityData() {
  try {
    const res = await Utils.fetchWithTimeout(
      CONFIG.PROXY + encodeURIComponent(CONFIG.SECURITY_CSV_URL)
    );
    const csv = await res.text();
    const rows = csv.trim().split('\n').map(r => r.split(',').map(c => c.trim()));
    
    State.allSecurityData = rows.slice(1).filter(row => row.length >= 3);
    
    if (State.allSecurityData.length > 0) {
      updateSecurityTable();
    }
  } catch (err) {
    console.error('❌ Erreur chargement sécurité:', err);
  }
}

function updateSecurityTable() {
  const tableBody = document.getElementById('securityTable');
  if (!tableBody) return;
  
  const recentData = State.allSecurityData.slice(-10).reverse();
  
  if (recentData.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Aucune donnée</td></tr>';
    return;
  }
  
  tableBody.innerHTML = recentData.map(r => {
    const authorized = r[4] === 'Oui';
    const authColor = authorized ? '#00a651' : '#e63946';
    return `
      <tr>
        <td>${r[0]}</td>
        <td>${r[1] || '--'}</td>
        <td>${r[2] || '--'}</td>
        <td>${r[3] || '--'}</td>
        <td style="color: ${authColor}; font-weight: bold;">${r[4] || '--'}</td>
        <td>${r[5] || '--'}</td>
      </tr>
    `;
  }).join('');
}

// ==================== NAVIGATION ====================
function switchModule(module) {
  console.log(`🔄 Changement module: ${State.currentModule} → ${module}`);
  
  if (State.moduleUpdateInterval) {
    clearInterval(State.moduleUpdateInterval);
    State.moduleUpdateInterval = null;
  }
  
  if (State.currentModule === 'security') {
    CameraManager.isActive = false;
    CameraManager.stopAll();
  }
  
  State.currentModule = module;
  
  document.querySelectorAll('.module').forEach(m => m.style.display = 'none');
  document.getElementById('deviceManager').style.display = 'none';
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  
  const btn = event?.target || document.querySelector(`.tab-btn[onclick*="${module}"]`);
  if (btn) btn.classList.add('active');
  
  if (module === 'agriculture' || module === 'security') {
    const moduleDiv = document.getElementById(module);
    if (moduleDiv) moduleDiv.style.display = 'block';
    
    updateModuleConfig(module);
    startModuleUpdate(module);
    
    if (module === 'security') {
      setTimeout(() => {
        CameraManager.isActive = true;
        initSecurityCameras();
      }, 100);
    }
    
    showAlert('success', `📱 Module ${module === 'agriculture' ? 'Agriculture' : 'Sécurité'} activé`);
  }
}

function showDeviceManager() {
  if (State.moduleUpdateInterval) {
    clearInterval(State.moduleUpdateInterval);
    State.moduleUpdateInterval = null;
  }
  
  CameraManager.isActive = false;
  CameraManager.stopAll();
  
  document.querySelectorAll('.module').forEach(m => m.style.display = 'none');
  document.getElementById('deviceManager').style.display = 'block';
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  
  if (event?.target) event.target.classList.add('active');
  
  renderDevicesList();
}

// ==================== CONFIGURATION MODULE ====================
function updateModuleConfig(module) {
  const device = Object.values(State.devices).find(d => d.type === module && d.active);
  const configId = module === 'agriculture' ? 'agri-device-info' : 'sec-device-info';
  const configDiv = document.getElementById(configId);
  
  if (!configDiv) return;
  
  if (!device) {
    configDiv.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.6;">Aucun appareil actif. Ajoutez un ESP32 via "🎛️ Appareils"</div>';
    return;
  }
  
  const icon = module === 'agriculture' ? '🌱' : '🔒';
  
  configDiv.innerHTML = `
    <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
      <div style="flex:1;">
        <div style="font-weight:600;margin-bottom:5px;">${icon} ${device.name}</div>
        <div style="font-size:12px;opacity:0.7;">📍 ${device.location}</div>
      </div>
      <div style="flex:2;display:flex;gap:10px;align-items:center;">
        <label style="font-weight:600;">📡 IP:</label>
        <input type="text" id="edit-ip-${module}" value="${device.ip}" 
               style="flex:1;padding:8px;background:#0f1117;border:1px solid #2d3142;border-radius:5px;color:white;">
        <button class="btn btn-success btn-small" onclick="updateDeviceIP('${module}')">💾</button>
        <button class="btn btn-primary btn-small" onclick="testActiveDevice('${module}')">🔍</button>
      </div>
    </div>
  `;
}

function updateDeviceIP(module) {
  const device = Object.values(State.devices).find(d => d.type === module && d.active);
  if (!device) return;
  
  const input = document.getElementById(`edit-ip-${module}`);
  const newIP = input?.value.trim();
  
  if (!newIP || !Utils.validateIP(newIP)) {
    showAlert('warning', '⚠️ IP invalide');
    return;
  }
  
  device.ip = newIP;
  Utils.saveToLocalStorage('priva_devices', State.devices);
  showAlert('success', `✓ IP mise à jour: ${newIP}`);
  
  if (State.moduleUpdateInterval) {
    clearInterval(State.moduleUpdateInterval);
  }
  startModuleUpdate(module);
}

async function testActiveDevice(module) {
  const device = Object.values(State.devices).find(d => d.type === module && d.active);
  if (!device) return;
  
  showAlert('warning', `🔍 Test de connexion...`);
  
  try {
    await Utils.fetchWithTimeout(`http://${device.ip}/`, { mode: 'cors' });
    showAlert('success', `✓ Connexion réussie`);
  } catch (err) {
    showAlert('danger', `❌ Connexion échouée`);
  }
}

// ==================== MISE À JOUR ESP32 ====================
function startModuleUpdate(module) {
  const device = Object.values(State.devices).find(d => d.type === module && d.active);
  if (!device) return;
  
  if (module === 'agriculture') {
    updateAgricultureData(device.ip);
    State.moduleUpdateInterval = setInterval(() => updateAgricultureData(device.ip), 3000);
  } else if (module === 'security') {
    updateSecurityData(device.ip);
    State.moduleUpdateInterval = setInterval(() => updateSecurityData(device.ip), 3000);
  }
}

async function updateAgricultureData(ip) {
  try {
    const res = await Utils.fetchWithTimeout(`http://${ip}/status`, { mode: 'cors' });
    const data = await res.json();
    
    const tempValue = document.getElementById('tempValue');
    const humidValue = document.getElementById('humidValue');
    const gasValue = document.getElementById('gasValue');
    const dcValue = document.getElementById('dcValue');
    const modeDisplay = document.getElementById('modeDisplay');
    
    if (tempValue) tempValue.textContent = data.temperature.toFixed(1);
    if (humidValue) humidValue.textContent = data.humidity.toFixed(1);
    if (gasValue) gasValue.textContent = data.gas.toFixed(0);
    if (dcValue) dcValue.textContent = data.dc.toFixed(2);
    if (modeDisplay) modeDisplay.textContent = data.mode.toUpperCase();
    
    ['pompe', 'brumisateur', 'ventilateur', 'chauffage', 'eclairage', 'electrovanne'].forEach(d => 
      updateDeviceUI(d, data.devices[d])
    );
    
    updateConnectionStatus('connected', 'Agriculture');
  } catch (err) {
    updateConnectionStatus('disconnected');
  }
}

async function updateSecurityData(ip) {
  try {
    const res = await Utils.fetchWithTimeout(`http://${ip}/status`, { mode: 'cors' });
    const data = await res.json();
    
    const doorEl = document.getElementById('sec-door');
    const motionEl = document.getElementById('sec-motion');
    const badgeEl = document.getElementById('sec-badge');
    const timeEl = document.getElementById('sec-time');
    
    if (doorEl) {
      doorEl.textContent = data.doorOpen ? 'OUVERTE' : 'FERMÉE';
      doorEl.style.color = data.doorOpen ? '#e63946' : '#00a651';
    }
    
    if (motionEl) {
      motionEl.textContent = data.motionDetected ? 'DÉTECTÉ' : 'AUCUN';
      motionEl.style.color = data.motionDetected ? '#f77f00' : '#00a651';
    }
    
    if (badgeEl) badgeEl.textContent = data.lastBadge || '--';
    
    if (timeEl && data.lastAccess > 0) {
      const date = new Date(data.lastAccess);
      timeEl.textContent = date.toLocaleTimeString();
    }
    
    updateDeviceUI('lock', data.devices.lock);

  // ==================== SUITE DE app.js (PARTIE 2) ====================

// Continuation de updateSecurityData()
    updateDeviceUI('alarm', data.devices.alarm);
    updateDeviceUI('lights', data.devices.lights);
    
    updateConnectionStatus('connected', 'Sécurité');
  } catch (err) {
    updateConnectionStatus('disconnected');
  }
}

function updateConnectionStatus(status, module = '') {
  const statusDot = document.getElementById('connectionStatus');
  const statusText = document.getElementById('connectionText');
  
  if (statusDot) {
    statusDot.className = status === 'connected' ? 'status-dot connected' : 'status-dot disconnected';
  }
  
  if (statusText) {
    statusText.textContent = status === 'connected' ? `Connecté (${module})` : 'Déconnecté';
  }
}

// ==================== UI ACTIONNEURS ====================
function updateDeviceUI(device, state) {
  const card = document.getElementById(device + 'Card');
  const status = document.getElementById(device + 'Status');
  if (!card || !status) return;
  
  const texts = {
    active: {
      pompe: 'Actif', brumisateur: 'Actif', ventilateur: 'Actif',
      chauffage: 'Actif', eclairage: 'Allumé', electrovanne: 'Ouverte',
      lock: 'Déverrouillée', alarm: 'Activée', lights: 'Allumées'
    },
    inactive: {
      pompe: 'Arrêté', brumisateur: 'Arrêté', ventilateur: 'Arrêté',
      chauffage: 'Arrêté', eclairage: 'Éteint', electrovanne: 'Fermée',
      lock: 'Verrouillée', alarm: 'Désactivée', lights: 'Éteintes'
    }
  };
  
  if (state) {
    card.classList.add('active');
    status.textContent = texts.active[device] || 'Actif';
  } else {
    card.classList.remove('active');
    status.textContent = texts.inactive[device] || 'Arrêté';
  }
}

// ==================== CONTRÔLE ACTIONNEURS ====================
async function toggleDevice(module, device) {
  const activeDevice = Object.values(State.devices).find(d => d.type === module && d.active);
  const card = document.getElementById(device + 'Card');
  const newState = !card?.classList.contains('active');
  
  if (activeDevice) {
    try {
      const res = await Utils.fetchWithTimeout(`http://${activeDevice.ip}/control`, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `device=${device}&state=${newState ? '1' : '0'}`
      });
      
      if (res.ok) {
        updateDeviceUI(device, newState);
        showAlert('success', `✓ ${device} ${newState ? 'activé' : 'désactivé'}`);
        return;
      }
    } catch (err) {
      console.error('Erreur contrôle local:', err);
    }
  }
  
  try {
    const response = await fetch(CONFIG.COMMAND_API_URL, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({
        cible: module,
        actionneur: device,
        etat: newState ? 1 : 0
      })
    });
    
    const result = await response.json();
    
    if (result.status === "success") {
      updateDeviceUI(device, newState);
      showAlert('success', `✓ ${device} ${newState ? 'activé' : 'désactivé'} (cloud)`);
    }
  } catch (err) {
    showAlert('danger', '❌ Erreur commande');
  }
}

async function setMode(mode) {
  const activeDevice = Object.values(State.devices).find(d => d.type === 'agriculture' && d.active);
  
  if (activeDevice) {
    try {
      const res = await Utils.fetchWithTimeout(`http://${activeDevice.ip}/mode`, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `mode=${mode}`
      });
      
      if (res.ok) {
        const modeDisplay = document.getElementById('modeDisplay');
        if (modeDisplay) modeDisplay.textContent = mode.toUpperCase();
        showAlert('success', `✓ Mode ${mode}`);
        return;
      }
    } catch (err) {
      console.error('Erreur setMode:', err);
    }
  }
  
  showAlert('warning', '⚠️ Connectez un ESP32');
}

async function emergencyStop() {
  if (!confirm('⚠️ CONFIRMER L\'ARRÊT D\'URGENCE ?')) return;
  
  const activeDevice = Object.values(State.devices).find(d => d.type === 'agriculture' && d.active);
  
  if (activeDevice) {
    try {
      await Utils.fetchWithTimeout(`http://${activeDevice.ip}/emergency`, {method: 'POST'});
      
      ['pompe', 'brumisateur', 'ventilateur', 'chauffage', 'eclairage', 'electrovanne'].forEach(d => 
        updateDeviceUI(d, false)
      );
      showAlert('danger', '🛑 ARRÊT D\'URGENCE');
      return;
    } catch (err) {
      console.error('Erreur emergencyStop:', err);
    }
  }
  
  showAlert('danger', '🛑 ARRÊT D\'URGENCE (cloud)');
}

async function saveSettings() {
  const activeDevice = Object.values(State.devices).find(d => d.type === 'agriculture' && d.active);
  
  const settings = {
    tempMin: document.getElementById('tempMin')?.value,
    tempMax: document.getElementById('tempMax')?.value,
    humMin: document.getElementById('humidMin')?.value,
    humMax: document.getElementById('humidMax')?.value
  };
  
  if (activeDevice) {
    try {
      await Utils.fetchWithTimeout(`http://${activeDevice.ip}/settings`, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `tempMin=${settings.tempMin}&tempMax=${settings.tempMax}&humMin=${settings.humMin}&humMax=${settings.humMax}`
      });
      
      showAlert('success', '💾 Paramètres enregistrés');
      return;
    } catch (err) {
      console.error('Erreur saveSettings:', err);
    }
  }
  
  showAlert('warning', '⚠️ Connectez un ESP32');
}

function updateSlider(id, val, unit) {
  const label = document.getElementById(id + 'Val');
  if (label) label.textContent = val + unit;
}

// ==================== GESTIONNAIRE APPAREILS ====================
function renderDevicesList() {
  const list = document.getElementById('devicesList');
  if (!list) return;
  
  if (Object.keys(State.devices).length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.6;">Aucun appareil. Cliquez sur "Ajouter"</div>';
    return;
  }
  
  list.innerHTML = Object.entries(State.devices).map(([id, dev]) => {
    const icon = dev.type === 'agriculture' ? '🌱' : dev.type === 'security' ? '🔒' : '📟';
    return `
      <div class="device-item">
        <div class="device-info">
          <div class="device-name">${icon} ${dev.name}</div>
          <div class="device-details">📡 ${dev.ip} • 📍 ${dev.location} • <span style="color:${dev.active ? '#00a651' : '#e63946'};font-weight:bold;">${dev.active ? '✓ Actif' : '○ Inactif'}</span></div>
        </div>
        <div class="device-actions">
          <button class="btn btn-small ${dev.active ? 'btn-danger' : 'btn-success'}" onclick="toggleDeviceActive('${id}')">${dev.active ? '⏸️' : '▶️'}</button>
          <button class="btn btn-small btn-primary" onclick="testDeviceConnection('${id}')">🔍</button>
          <button class="btn btn-small btn-danger" onclick="deleteDevice('${id}')">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function openAddDeviceModal() {
  const modal = document.getElementById('addDeviceModal');
  if (modal) modal.classList.add('active');
}

function closeAddDeviceModal() {
  const modal = document.getElementById('addDeviceModal');
  if (modal) modal.classList.remove('active');
}

function addDevice() {
  const name = document.getElementById('newDeviceName')?.value.trim();
  const ip = document.getElementById('newDeviceIP')?.value.trim();
  const type = document.getElementById('newDeviceType')?.value;
  const location = document.getElementById('newDeviceLocation')?.value.trim();
  
  if (!name || !ip) {
    showAlert('warning', '⚠️ Nom et IP requis');
    return;
  }
  
  if (!Utils.validateIP(ip)) {
    showAlert('warning', '⚠️ Format IP invalide');
    return;
  }
  
  const id = 'dev_' + Date.now();
  State.devices[id] = {
    name, 
    ip, 
    type,
    location: location || 'Non spécifié',
    active: true,
    addedAt: new Date().toISOString()
  };
  
  Object.entries(State.devices).forEach(([key, dev]) => {
    if (key !== id && dev.type === type) dev.active = false;
  });
  
  Utils.saveToLocalStorage('priva_devices', State.devices);
  
  closeAddDeviceModal();
  renderDevicesList();
  showAlert('success', `✓ ${name} ajouté`);
  
  ['newDeviceName', 'newDeviceIP', 'newDeviceLocation'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  
  if (type === 'agriculture' || type === 'security') {
    setTimeout(() => {
      const moduleBtn = document.querySelector(`.tab-btn[onclick*="switchModule('${type}')"]`);
      if (moduleBtn) moduleBtn.click();
    }, 500);
  }
}

function toggleDeviceActive(id) {
  const device = State.devices[id];
  if (!device) return;
  
  if (!device.active) {
    Object.entries(State.devices).forEach(([key, dev]) => {
      if (dev.type === device.type) dev.active = false;
    });
    device.active = true;
    showAlert('success', `✓ ${device.name} activé`);
    
    if (State.currentModule === device.type) {
      if (State.moduleUpdateInterval) clearInterval(State.moduleUpdateInterval);
      updateModuleConfig(device.type);
      startModuleUpdate(device.type);
    }
  } else {
    device.active = false;
    showAlert('warning', `⏸️ ${device.name} désactivé`);
    if (State.moduleUpdateInterval) clearInterval(State.moduleUpdateInterval);
  }
  
  Utils.saveToLocalStorage('priva_devices', State.devices);
  renderDevicesList();
}

async function testDeviceConnection(id) {
  const device = State.devices[id];
  if (!device) return;
  
  showAlert('warning', `🔍 Test ${device.name}...`);
  
  try {
    await Utils.fetchWithTimeout(`http://${device.ip}/`, {mode: 'cors'});
    showAlert('success', `✓ ${device.name} répond`);
  } catch (err) {
    showAlert('danger', `❌ ${device.name} ne répond pas`);
  }
}

function deleteDevice(id) {
  const device = State.devices[id];
  if (!device) return;
  
  if (!confirm(`Supprimer "${device.name}" ?`)) return;
  
  delete State.devices[id];
  Utils.saveToLocalStorage('priva_devices', State.devices);
  renderDevicesList();
  showAlert('success', `🗑️ ${device.name} supprimé`);
}

// ==================== CAMÉRAS ESP32-CAM ====================
function initSecurityCameras() {
  console.log('📹 Init caméras:', Object.keys(State.securityCameras).length);
  
  CameraManager.isActive = true;
  CameraManager.stopAll();
  
  renderSecurityCameras();
  renderSecurityCaptures();
}

function renderSecurityCameras() {
  const grid = document.getElementById('security-cameras-grid');
  if (!grid) return;
  
  CameraManager.stopAll();
  
  const active = Object.entries(State.securityCameras).filter(([id, cam]) => cam.active);
  
  if (active.length === 0) {
    grid.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.6;">Aucune caméra configurée. Cliquez sur "➕ Ajouter Caméra"</div>';
    return;
  }
  
  grid.innerHTML = active.map(([id, cam]) => `
    <div class="security-camera-card" id="sec-cam-${id}">
      <div class="camera-header">
        <div class="camera-name">
          📹 ${cam.name}
          <div class="camera-status-indicator" id="status-${id}"></div>
        </div>
        <button class="btn btn-small btn-danger" onclick="removeSecurityCamera('${id}')">🗑️</button>
      </div>
      
      <div style="position: relative; background: #000; border-radius: 8px; min-height: 250px; overflow: hidden;">
        <img class="camera-stream-img" 
             id="stream-${id}" 
             src="${Utils.buildCameraUrl(cam.ip, 'capture')}"
             onclick="openCameraFullscreen('${id}', '${cam.name}', '${cam.ip}')"
             alt="${cam.name}"
             style="width: 100%; height: 100%; object-fit: cover; cursor: pointer;">
        
        <div id="loading-${id}" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; display: none;">
          ⏳ Chargement...
        </div>
      </div>
      
      <div class="camera-controls">
        <button class="btn btn-small btn-success" onclick="captureCamera('${id}', '${cam.name}', '${cam.ip}')">📸</button>
        <button class="btn btn-small btn-primary" onclick="toggleFlash('${id}', '${cam.ip}')">💡</button>
        <button class="btn btn-small btn-primary" onclick="openCameraFullscreen('${id}', '${cam.name}', '${cam.ip}')">🔍</button>
        <button class="btn btn-small btn-warning" onclick="CameraManager.detectWithCamera('${cam.ip}')">🔍 Détecter</button>
      </div>
      
      <div class="camera-info">
        📍 ${cam.location} • 🔗 ${cam.ip} • 
        <span style="font-size: 10px; opacity: 0.6;">FPS: <span id="fps-${id}">--</span></span>
      </div>
    </div>
  `).join('');
  
  console.log('✅ Caméras rendues:', active.length);
  
  if (CameraManager.isActive) {
    active.forEach(([id, cam]) => {
      CameraManager.startRefresh(id, cam.ip);
    });
  }
}

function renderSecurityCaptures() {
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
}

function captureCamera(id, name, ip) {
  if (!Utils.validateIP(ip)) {
    showAlert('danger', '❌ IP invalide');
    return;
  }
  
  showAlert('warning', '📸 Capture en cours...');
  
  const captureUrl = Utils.buildCameraUrl(ip, 'capture');
  
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
  
  Utils.saveToLocalStorage('priva_security_captures', State.securityCaptures);
  renderSecurityCaptures();
  showAlert('success', `✅ Photo capturée: ${name}`);
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

async function toggleFlash(id, ip) {
  try {
    await Utils.fetchWithTimeout(`http://${ip}:${CONFIG.ESP32_PORT}/flash`, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: 'state=1'
    });
    
    setTimeout(async () => {
      await Utils.fetchWithTimeout(`http://${ip}:${CONFIG.ESP32_PORT}/flash`, {
        method: 'POST',
        body: 'state=0'
      });
    }, 200);
    
    showAlert('success', '💡 Flash activé');
  } catch (err) {
    showAlert('danger', '❌ Erreur flash');
  }
}

function refreshAllCameras() {
  Object.entries(State.securityCameras).forEach(([id, cam]) => {
    const img = document.getElementById(`stream-${id}`);
    if (img) {
      img.src = Utils.buildCameraUrl(cam.ip, 'capture');
    }
  });
  showAlert('success', '🔄 Caméras rafraîchies');
}

function openAddCameraModal() {
  const modal = document.getElementById('addCameraModal');
  if (modal) modal.classList.add('active');
}

function closeAddCameraModal() {
  const modal = document.getElementById('addCameraModal');
  if (modal) modal.classList.remove('active');
}

function addSecurityCamera() {
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
  
  const id = 'cam_' + Date.now();
  State.securityCameras[id] = {
    name,
    ip,
    location: location || 'Non spécifié',
    active: true,
    addedAt: new Date().toISOString()
  };
  
  Utils.saveToLocalStorage('priva_security_cameras', State.securityCameras);
  
  closeAddCameraModal();
  renderSecurityCameras();
  showAlert('success', `✅ ${name} ajoutée`);
  
  ['newCameraName', 'newCameraIP', 'newCameraLocation'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function removeSecurityCamera(id) {
  const cam = State.securityCameras[id];
  if (!cam) return;
  
  if (!confirm(`Supprimer "${cam.name}" ?`)) return;
  
  CameraManager.stopRefresh(id);
  
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
  showAlert('success', '🗑️ Capture supprimée');
}

function clearSecurityCaptures() {
  if (!confirm('Vider toutes les captures ?')) return;
  
  State.securityCaptures = [];
  Utils.saveToLocalStorage('priva_security_captures', State.securityCaptures);
  renderSecurityCaptures();
  showAlert('success', '🗑️ Galerie vidée');
}

function setCameraView(mode) {
  const grid = document.getElementById('security-cameras-grid');
  if (!grid) return;
  
  grid.className = mode === 'single' ? 'cameras-single' : 'cameras-grid';
  showAlert('success', `📺 Vue ${mode === 'single' ? 'simple' : 'grille'}`);
}

function openCameraFullscreen(id, name, ip, captureUrl = null) {
  const modal = document.getElementById('cameraFullscreenModal');
  const img = document.getElementById('fullscreen-camera-img');
  const title = document.getElementById('fullscreen-camera-name');
  
  if (!modal || !img || !title) return;
  
  title.textContent = `📹 ${name}`;
  
  if (captureUrl) {
    img.src = captureUrl;
  } else if (ip) {
    img.src = Utils.buildCameraUrl(ip, 'capture');
    CameraManager.startFullscreen(ip);
  }
  
  modal.classList.add('active');
}

function closeCameraFullscreen() {
  const modal = document.getElementById('cameraFullscreenModal');
  if (modal) modal.classList.remove('active');
  
  if (CameraManager.fullscreenInterval) {
    clearInterval(CameraManager.fullscreenInterval);
    CameraManager.fullscreenInterval = null;
  }
}

function captureFromFullscreen() {
  const img = document.getElementById('fullscreen-camera-img');
  if (!img || !img.src) return;
  
  const active = Object.entries(State.securityCameras).find(([id, cam]) => 
    img.src.includes(cam.ip)
  );
  
  if (active) {
    const [id, cam] = active;
    captureCamera(id, cam.name, cam.ip);
  }
}

function toggleFlashFullscreen() {
  const img = document.getElementById('fullscreen-camera-img');
  if (!img || !img.src) return;
  
  const active = Object.entries(State.securityCameras).find(([id, cam]) => 
    img.src.includes(cam.ip)
  );
  
  if (active) {
    const [id, cam] = active;
    toggleFlash(id, cam.ip);
  }
}

function downloadCapture() {
  const img = document.getElementById('fullscreen-camera-img');
  if (!img || !img.src) return;
  
  const link = document.createElement('a');
  link.href = img.src;
  link.download = `capture_${Date.now()}.jpg`;
  link.click();
  showAlert('success', '⬇️ Téléchargement...');
}

// ==================== ÉVÉNEMENTS ====================
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && CameraManager.isActive && State.currentModule === 'security') {
    console.log('👁️ Page visible - Relance refresh caméras');
    
    const active = Object.entries(State.securityCameras).filter(([id, cam]) => cam.active);
    
    active.forEach(([id, cam]) => {
      if (!CameraManager.intervals[id]) {
        console.log(`🔄 Relance refresh ${id}`);
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

console.log('✅ PRIVA JavaScript chargé - Version Optimisée 3.0');
