// ============================================
// PRIVA Platform - JavaScript Complet CORRIGÉ
// ============================================

const COMMAND_API_URL = 'https://script.google.com/macros/s/AKfycbwA53tJWrpVpd6WeoAA09FYVe63aFvwy-liD_rQgb2gr_HZ2bYHC1sKajJ4wzwshMC6aA/exec';
const AGRICULTURE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQwJjy2KpJJ5X--C87zVuPjykAg9Fyc79zIxpdk1Dt0FvrxYw1Onfzt5wSHOVagvLry9uyyohzeN3h4/pub?output=csv";
const SECURITY_CSV_URL = "https://docs.google.com/spreadsheets/d/12x5LRuFBaKeAfkSxc53uR-6Q3Xcu-OxZt2plY0GZSko/export?format=csv&gid=2127989880";
const PROXY = 'https://api.allorigins.win/raw?url=';

// ==================== VARIABLES GLOBALES ====================
let climateChart, airChart;
let allAgriData = [];
let allSecurityData = [];
let devices = {};
let currentModule = 'agriculture';
let updateInterval;

// Gestion ESP32-CAM
let securityCameras = {};
let securityCaptures = [];
let currentFullscreenCamera = null;

// Charger données sauvegardées
const savedDevices = localStorage.getItem('priva_devices');
if (savedDevices) devices = JSON.parse(savedDevices);

const savedCameras = localStorage.getItem('priva_security_cameras');
if (savedCameras) securityCameras = JSON.parse(savedCameras);

const savedCaptures = localStorage.getItem('priva_security_captures');
if (savedCaptures) securityCaptures = JSON.parse(savedCaptures);

// ==================== INITIALISATION ====================
function init() {
  console.log('🚀 Initialisation PRIVA...');
  setupCharts();
  loadAgricultureData();
  loadSecurityData();
  
  setInterval(() => {
    loadAgricultureData();
    loadSecurityData();
  }, 10000);
  
  renderDevicesList();
  
  const agriDevice = Object.values(devices).find(d => d.type === 'agriculture' && d.active);
  if (agriDevice) {
    updateModuleConfig('agriculture');
    startModuleUpdate('agriculture');
  }
  
  showAlert('success', '✓ Système initialisé');
}

// ==================== GRAPHIQUES ====================
function setupCharts() {
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#f8f9fa', font: { size: 12 } } } },
    scales: {
      x: { ticks: { color: '#9ca3af', maxRotation: 45, minRotation: 45 }, grid: { color: '#2d3142' } },
      y: { ticks: { color: '#9ca3af' }, grid: { color: '#2d3142' } }
    }
  };

  climateChart = new Chart(document.getElementById('climateChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Température (°C)', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', tension: 0.4, borderWidth: 3, fill: true },
        { label: 'Humidité (%)', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', tension: 0.4, borderWidth: 3, fill: true }
      ]
    },
    options: chartOptions
  });

  airChart = new Chart(document.getElementById('airChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{ label: 'CO2 (ppm)', data: [], borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', tension: 0.4, borderWidth: 3, fill: true }]
    },
    options: chartOptions
  });
}

// ==================== DONNÉES AGRICULTURE ====================
async function loadAgricultureData() {
  try {
    const res = await fetch(PROXY + encodeURIComponent(AGRICULTURE_CSV_URL));
    const csv = await res.text();
    const rows = csv.trim().split('\n').map(r => r.split(',').map(c => c.trim()));
    
    allAgriData = rows.slice(1).filter(row => row.length >= 3);
    
    if (allAgriData.length > 0) {
      updateCharts();
      updateAgricultureTable();
      document.getElementById('dataCount').textContent = allAgriData.length;
    }
  } catch (err) {
    console.error('❌ Erreur agriculture:', err);
  }
}

function updateCharts() {
  const data = allAgriData.slice(-50);
  
  climateChart.data.labels = data.map(r => formatDateTime(r[0]));
  climateChart.data.datasets[0].data = data.map(r => parseFloat(r[1]) || 0);
  climateChart.data.datasets[1].data = data.map(r => parseFloat(r[2]) || 0);
  climateChart.update('none');

  airChart.data.labels = data.map(r => formatDateTime(r[0]));
  airChart.data.datasets[0].data = data.map(r => parseFloat(r[3]) || 0);
  airChart.update('none');
}

function updateAgricultureTable() {
  const tableBody = document.getElementById('dataTable');
  const recentData = allAgriData.slice(-10).reverse();
  
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
    const res = await fetch(PROXY + encodeURIComponent(SECURITY_CSV_URL));
    const csv = await res.text();
    const rows = csv.trim().split('\n').map(r => r.split(',').map(c => c.trim()));
    
    allSecurityData = rows.slice(1).filter(row => row.length >= 3);
    
    if (allSecurityData.length > 0) {
      updateSecurityTable();
    }
  } catch (err) {
    console.error('❌ Erreur sécurité:', err);
  }
}

function updateSecurityTable() {
  const tableBody = document.getElementById('securityTable');
  const recentData = allSecurityData.slice(-10).reverse();
  
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
  currentModule = module;
  document.querySelectorAll('.module').forEach(m => m.style.display = 'none');
  document.getElementById('deviceManager').style.display = 'none';
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  
  if (module !== 'devices') {
    document.getElementById(module).style.display = 'block';
    if (updateInterval) clearInterval(updateInterval);
    updateModuleConfig(module);
    startModuleUpdate(module);
    
    // IMPORTANT : Initialiser les caméras si module sécurité
    if (module === 'security') {
      setTimeout(() => {
        initSecurityCameras();
      }, 100);
    }
  }
  
  showAlert('success', `📱 Module ${module === 'agriculture' ? 'Agriculture' : 'Sécurité'} activé`);
}

// ==================== CONFIGURATION MODULE ====================
function updateModuleConfig(module) {
  const device = Object.values(devices).find(d => d.type === module && d.active);
  const configId = module === 'agriculture' ? 'agri-device-info' : 'sec-device-info';
  const configDiv = document.getElementById(configId);
  
  if (!configDiv) return;
  
  if (!device) {
    configDiv.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.6;">Aucun appareil actif. Ajoutez un ESP32 via "🎛️ Appareils"</div>';
    return;
  }
  
  configDiv.innerHTML = `
    <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
      <div style="flex:1;">
        <div style="font-weight:600;margin-bottom:5px;">${getDeviceIcon(device.type)} ${device.name}</div>
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
  const device = Object.values(devices).find(d => d.type === module && d.active);
  if (!device) return;
  
  const newIP = document.getElementById(`edit-ip-${module}`).value.trim();
  if (!newIP) {
    showAlert('warning', '⚠️ IP invalide');
    return;
  }
  
  device.ip = newIP;
  localStorage.setItem('priva_devices', JSON.stringify(devices));
  showAlert('success', `✓ IP mise à jour: ${newIP}`);
  
  if (updateInterval) clearInterval(updateInterval);
  startModuleUpdate(module);
}

async function testActiveDevice(module) {
  const device = Object.values(devices).find(d => d.type === module && d.active);
  if (!device) return;
  
  showAlert('warning', `🔍 Test de connexion...`);
  
  try {
    const res = await fetch(`http://${device.ip}/`, {mode: 'cors'});
    await res.text();
    showAlert('success', `✓ Connexion réussie`);
  } catch (err) {
    showAlert('danger', `❌ Connexion échouée`);
  }
}

// ==================== MISE À JOUR ESP32 ====================
function startModuleUpdate(module) {
  const device = Object.values(devices).find(d => d.type === module && d.active);
  if (!device) return;
  
  if (module === 'agriculture') {
    updateAgricultureData(device.ip);
    updateInterval = setInterval(() => updateAgricultureData(device.ip), 3000);
  } else if (module === 'security') {
    updateSecurityData(device.ip);
    updateInterval = setInterval(() => updateSecurityData(device.ip), 3000);
  }
}

async function updateAgricultureData(ip) {
  try {
    const res = await fetch(`http://${ip}/status`, {mode: 'cors'});
    const data = await res.json();
    
    document.getElementById('tempValue').textContent = data.temperature.toFixed(1);
    document.getElementById('humidValue').textContent = data.humidity.toFixed(1);
    document.getElementById('gasValue').textContent = data.gas.toFixed(0);
    document.getElementById('dcValue').textContent = data.dc.toFixed(2);
    document.getElementById('modeDisplay').textContent = data.mode.toUpperCase();
    
    ['pompe', 'brumisateur', 'ventilateur', 'chauffage', 'eclairage', 'electrovanne'].forEach(d => 
      updateDeviceUI(d, data.devices[d])
    );
    
    document.getElementById('connectionStatus').className = 'status-dot connected';
    document.getElementById('connectionText').textContent = 'Connecté (Agriculture)';
  } catch (err) {
    document.getElementById('connectionStatus').className = 'status-dot disconnected';
    document.getElementById('connectionText').textContent = 'Déconnecté';
  }
}

async function updateSecurityData(ip) {
  try {
    const res = await fetch(`http://${ip}/status`, {mode: 'cors'});
    const data = await res.json();
    
    document.getElementById('sec-door').textContent = data.doorOpen ? 'OUVERTE' : 'FERMÉE';
    document.getElementById('sec-door').style.color = data.doorOpen ? '#e63946' : '#00a651';
    
    document.getElementById('sec-motion').textContent = data.motionDetected ? 'DÉTECTÉ' : 'AUCUN';
    document.getElementById('sec-motion').style.color = data.motionDetected ? '#f77f00' : '#00a651';
    
    document.getElementById('sec-badge').textContent = data.lastBadge || '--';
    
    if (data.lastAccess > 0) {
      const date = new Date(data.lastAccess);
      document.getElementById('sec-time').textContent = date.toLocaleTimeString();
    }
    
    updateDeviceUI('lock', data.devices.lock);
    updateDeviceUI('alarm', data.devices.alarm);
    updateDeviceUI('lights', data.devices.lights);
    
    document.getElementById('connectionStatus').className = 'status-dot connected';
    document.getElementById('connectionText').textContent = 'Connecté (Sécurité)';
  } catch (err) {
    document.getElementById('connectionStatus').className = 'status-dot disconnected';
    document.getElementById('connectionText').textContent = 'Déconnecté';
  }
}

// ==================== UI ACTIONNEURS ====================
function updateDeviceUI(device, state) {
  const card = document.getElementById(device + 'Card');
  const status = document.getElementById(device + 'Status');
  if (!card || !status) return;
  
  if (state) {
    card.classList.add('active');
    const activeTexts = {
      pompe: 'Actif', brumisateur: 'Actif', ventilateur: 'Actif',
      chauffage: 'Actif', eclairage: 'Allumé', electrovanne: 'Ouverte',
      lock: 'Déverrouillée', alarm: 'Activée', lights: 'Allumées'
    };
    status.textContent = activeTexts[device] || 'Actif';
  } else {
    card.classList.remove('active');
    const inactiveTexts = {
      pompe: 'Arrêté', brumisateur: 'Arrêté', ventilateur: 'Arrêté',
      chauffage: 'Arrêté', eclairage: 'Éteint', electrovanne: 'Fermée',
      lock: 'Verrouillée', alarm: 'Désactivée', lights: 'Éteintes'
    };
    status.textContent = inactiveTexts[device] || 'Arrêté';
  }
}

// ==================== CONTRÔLE ACTIONNEURS ====================
async function toggleDevice(module, device) {
  const activeDevice = Object.values(devices).find(d => d.type === module && d.active);
  const card = document.getElementById(device + 'Card');
  const newState = !card.classList.contains('active');
  
  if (activeDevice) {
    try {
      const res = await fetch(`http://${activeDevice.ip}/control`, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `device=${device}&state=${newState ? '1' : '0'}`
      });
      
      if (res.ok) {
        updateDeviceUI(device, newState);
        showAlert('success', `✓ ${device} ${newState ? 'activé' : 'désactivé'}`);
        return;
      }
    } catch (err) {}
  }
  
  try {
    const response = await fetch(COMMAND_API_URL, {
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
  const activeDevice = Object.values(devices).find(d => d.type === 'agriculture' && d.active);
  
  if (activeDevice) {
    try {
      const res = await fetch(`http://${activeDevice.ip}/mode`, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `mode=${mode}`
      });
      
      if (res.ok) {
        document.getElementById('modeDisplay').textContent = mode.toUpperCase();
        showAlert('success', `✓ Mode ${mode}`);
        return;
      }
    } catch (err) {}
  }
  
  showAlert('warning', '⚠️ Connectez un ESP32');
}

async function emergencyStop() {
  if (!confirm('⚠️ CONFIRMER L\'ARRÊT D\'URGENCE ?')) return;
  
  const activeDevice = Object.values(devices).find(d => d.type === 'agriculture' && d.active);
  
  if (activeDevice) {
    try {
      await fetch(`http://${activeDevice.ip}/emergency`, {method: 'POST'});
      
      ['pompe', 'brumisateur', 'ventilateur', 'chauffage', 'eclairage', 'electrovanne'].forEach(d => 
        updateDeviceUI(d, false)
      );
      showAlert('danger', '🛑 ARRÊT D\'URGENCE');
      return;
    } catch (err) {}
  }
  
  showAlert('danger', '🛑 ARRÊT D\'URGENCE (cloud)');
}

async function saveSettings() {
  const activeDevice = Object.values(devices).find(d => d.type === 'agriculture' && d.active);
  
  const settings = {
    tempMin: document.getElementById('tempMin').value,
    tempMax: document.getElementById('tempMax').value,
    humMin: document.getElementById('humidMin').value,
    humMax: document.getElementById('humidMax').value
  };
  
  if (activeDevice) {
    try {
      await fetch(`http://${activeDevice.ip}/settings`, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `tempMin=${settings.tempMin}&tempMax=${settings.tempMax}&humMin=${settings.humMin}&humMax=${settings.humMax}`
      });
      
      showAlert('success', '💾 Paramètres enregistrés');
      return;
    } catch (err) {}
  }
  
  showAlert('warning', '⚠️ Connectez un ESP32');
}

function updateSlider(id, val, unit) {
  document.getElementById(id + 'Val').textContent = val + unit;
}

// ==================== ALERTES ====================
function showAlert(type, msg) {
  const alert = document.createElement('div');
  alert.className = `alert ${type}`;
  alert.textContent = msg;
  document.getElementById('alertContainer').appendChild(alert);
  setTimeout(() => alert.remove(), 5000);
}

// ==================== GESTIONNAIRE APPAREILS ====================
function showDeviceManager() {
  document.querySelectorAll('.module').forEach(m => m.style.display = 'none');
  document.getElementById('deviceManager').style.display = 'block';
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  renderDevicesList();
}

function renderDevicesList() {
  const list = document.getElementById('devicesList');
  
  if (Object.keys(devices).length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.6;">Aucun appareil. Cliquez sur "Ajouter"</div>';
    return;
  }
  
  list.innerHTML = Object.entries(devices).map(([id, dev]) => `
    <div class="device-item">
      <div class="device-info">
        <div class="device-name">${getDeviceIcon(dev.type)} ${dev.name}</div>
        <div class="device-details">📡 ${dev.ip} • 📍 ${dev.location} • <span style="color:${dev.active ? '#00a651' : '#e63946'};font-weight:bold;">${dev.active ? '✓ Actif' : '○ Inactif'}</span></div>
      </div>
      <div class="device-actions">
        <button class="btn btn-small ${dev.active ? 'btn-danger' : 'btn-success'}" onclick="toggleDeviceActive('${id}')">${dev.active ? '⏸️' : '▶️'}</button>
        <button class="btn btn-small btn-primary" onclick="testDeviceConnection('${id}')">🔍</button>
        <button class="btn btn-small btn-danger" onclick="deleteDevice('${id}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

function getDeviceIcon(type) {
  const icons = {agriculture: '🌱', security: '🔒'};
  return icons[type] || '📟';
}

function openAddDeviceModal() {
  document.getElementById('addDeviceModal').classList.add('active');
}

function closeAddDeviceModal() {
  document.getElementById('addDeviceModal').classList.remove('active');
}

function addDevice() {
  const name = document.getElementById('newDeviceName').value.trim();
  const ip = document.getElementById('newDeviceIP').value.trim();
  const type = document.getElementById('newDeviceType').value;
  const location = document.getElementById('newDeviceLocation').value.trim();
  
  if (!name || !ip) {
    showAlert('warning', '⚠️ Nom et IP requis');
    return;
  }
  
  const id = 'dev_' + Date.now();
  devices[id] = {
    name, ip, type,
    location: location || 'Non spécifié',
    active: true,
    addedAt: new Date().toISOString()
  };
  
  Object.entries(devices).forEach(([key, dev]) => {
    if (key !== id && dev.type === type) dev.active = false;
  });
  
  localStorage.setItem('priva_devices', JSON.stringify(devices));
  
  closeAddDeviceModal();
  renderDevicesList();
  showAlert('success', `✓ ${name} ajouté`);
  
  document.getElementById('newDeviceName').value = '';
  document.getElementById('newDeviceIP').value = '';
  document.getElementById('newDeviceLocation').value = '';
  
  if (type === 'agriculture' || type === 'security') {
    setTimeout(() => {
      const moduleBtn = document.querySelector(`.tab-btn[onclick*="switchModule('${type}')"]`);
      if (moduleBtn) moduleBtn.click();
    }, 500);
  }
}

function toggleDeviceActive(id) {
  const device = devices[id];
  
  if (!device.active) {
    Object.entries(devices).forEach(([key, dev]) => {
      if (dev.type === device.type) dev.active = false;
    });
    device.active = true;
    showAlert('success', `✓ ${device.name} activé`);
    
    if (currentModule === device.type) {
      if (updateInterval) clearInterval(updateInterval);
      updateModuleConfig(device.type);
      startModuleUpdate(device.type);
    }
  } else {
    device.active = false;
    showAlert('warning', `⏸️ ${device.name} désactivé`);
    if (updateInterval) clearInterval(updateInterval);
  }
  
  localStorage.setItem('priva_devices', JSON.stringify(devices));
  renderDevicesList();
}

async function testDeviceConnection(id) {
  const device = devices[id];
  showAlert('warning', `🔍 Test ${device.name}...`);
  
  try {
    await fetch(`http://${device.ip}/`, {mode: 'cors', timeout: 5000});
    showAlert('success', `✓ ${device.name} répond`);
  } catch (err) {
    showAlert('danger', `❌ ${device.name} ne répond pas`);
  }
}

function deleteDevice(id) {
  const device = devices[id];
  if (!confirm(`Supprimer "${device.name}" ?`)) return;
  
  delete devices[id];
  localStorage.setItem('priva_devices', JSON.stringify(devices));
  renderDevicesList();
  showAlert('success', `🗑️ ${device.name} supprimé`);
}
// ==================== CODE ESP32-CAM À AJOUTER À LA FIN DE app.js ====================

// ===== INITIALISATION CAMÉRAS =====
function initSecurityCameras() {
  console.log('📹 Initialisation caméras:', Object.keys(securityCameras).length);
  renderSecurityCameras();
  renderSecurityCaptures();
  setInterval(checkCamerasStatus, 15000);
}
// ===== RENDU CAMÉRAS AVEC REFRESH AUTOMATIQUE =====
// Remplacez la fonction renderSecurityCameras() dans votre app.js

let cameraRefreshIntervals = {};

function renderSecurityCameras() {
  const grid = document.getElementById('security-cameras-grid');
  if (!grid) {
    console.error('❌ Element security-cameras-grid introuvable!');
    return;
  }
  
  // Nettoyer les anciens intervals
  Object.values(cameraRefreshIntervals).forEach(interval => clearInterval(interval));
  cameraRefreshIntervals = {};
  
  const active = Object.entries(securityCameras).filter(([id, cam]) => cam.active);
  
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
      
      <!-- CHANGEMENT : Utiliser un conteneur pour l'image -->
      <div style="position: relative; background: #000; border-radius: 8px; min-height: 250px; overflow: hidden;">
        <img class="camera-stream-img" 
             id="stream-${id}" 
             src="http://${cam.ip}:81/capture?t=${Date.now()}"
             onerror="handleCameraError('${id}')"
             onload="handleCameraLoad('${id}')"
             onclick="openCameraFullscreen('${id}', '${cam.name}', '${cam.ip}')"
             alt="${cam.name}"
             style="width: 100%; height: 100%; object-fit: cover;">
        
        <!-- Indicateur de chargement -->
        <div id="loading-${id}" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; display: none;">
          ⏳ Chargement...
        </div>
      </div>
      
      <div class="camera-controls">
        <button class="btn btn-small btn-success" onclick="captureCamera('${id}', '${cam.name}', '${cam.ip}')">📸 Capturer</button>
        <button class="btn btn-small btn-primary" onclick="toggleFlash('${id}', '${cam.ip}')">💡 Flash</button>
        <button class="btn btn-small btn-primary" onclick="openCameraFullscreen('${id}', '${cam.name}', '${cam.ip}')">🔍 Zoom</button>
      </div>
      
      <div class="camera-info">
        📍 ${cam.location} • 🔗 ${cam.ip} • 
        <span style="font-size: 10px; opacity: 0.6;">FPS: <span id="fps-${id}">--</span></span>
      </div>
    </div>
  `).join('');
  
  console.log('✅ Caméras rendues:', active.length);
  
  // Démarrer le refresh automatique pour chaque caméra
  active.forEach(([id, cam]) => {
    startCameraAutoRefresh(id, cam.ip);
  });
}

// ===== REFRESH AUTOMATIQUE DES CAMÉRAS =====
function startCameraAutoRefresh(id, ip) {
  let frameCount = 0;
  let lastTime = Date.now();
  
  // Rafraîchir toutes les 500ms (2 FPS)
  // Vous pouvez changer pour 333ms (3 FPS) ou 200ms (5 FPS)
  cameraRefreshIntervals[id] = setInterval(() => {
    const img = document.getElementById(`stream-${id}`);
    if (img) {
      const timestamp = Date.now();
      img.src = `http://${ip}:81/capture?t=${timestamp}`;
      
      // Calculer FPS
      frameCount++;
      const now = Date.now();
      if (now - lastTime >= 1000) {
        const fps = Math.round(frameCount * 1000 / (now - lastTime));
        const fpsElement = document.getElementById(`fps-${id}`);
        if (fpsElement) fpsElement.textContent = fps;
        frameCount = 0;
        lastTime = now;
      }
    } else {
      clearInterval(cameraRefreshIntervals[id]);
    }
  }, 200); // 500ms = 2 FPS
}

// ===== GESTION ERREUR =====
function handleCameraError(id) {
  const indicator = document.getElementById(`status-${id}`);
  const card = document.getElementById(`sec-cam-${id}`);
  const loading = document.getElementById(`loading-${id}`);
  
  if (indicator) indicator.classList.add('offline');
  if (card) card.classList.add('offline');
  if (loading) {
    loading.style.display = 'block';
    loading.textContent = '❌ Hors ligne';
  }
}

// ===== GESTION CHARGEMENT =====
function handleCameraLoad(id) {
  const indicator = document.getElementById(`status-${id}`);
  const card = document.getElementById(`sec-cam-${id}`);
  const loading = document.getElementById(`loading-${id}`);
  
  if (indicator) indicator.classList.remove('offline');
  if (card) card.classList.remove('offline');
  if (loading) loading.style.display = 'none';
}

// ===== NETTOYAGE LORS DU CHANGEMENT DE MODULE =====
const originalSwitchModule = window.switchModule;
window.switchModule = function(module) {
  // Nettoyer les intervals quand on quitte le module sécurité
  if (currentModule === 'security' && module !== 'security') {
    Object.values(cameraRefreshIntervals).forEach(interval => clearInterval(interval));
    cameraRefreshIntervals = {};
  }
  
  // Appeler la fonction originale
  originalSwitchModule(module);
};

console.log('✅ Code caméra avec auto-refresh chargé');

// ===== RENDU CAPTURES =====
function renderSecurityCaptures() {
  const gallery = document.getElementById('security-captures-gallery');
  if (!gallery) return;
  
  if (securityCaptures.length === 0) {
    gallery.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.6;">Aucune capture</div>';
    return;
  }
  
  gallery.innerHTML = securityCaptures.slice(0, 20).map((cap, idx) => {
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

// ===== GESTION CHARGEMENT IMAGE =====
function handleCameraLoad(id) {
  const indicator = document.getElementById(`status-${id}`);
  const card = document.getElementById(`sec-cam-${id}`);
  if (indicator) indicator.classList.remove('offline');
  if (card) card.classList.remove('offline');
}

function handleCameraError(id) {
  const indicator = document.getElementById(`status-${id}`);
  const card = document.getElementById(`sec-cam-${id}`);
  if (indicator) indicator.classList.add('offline');
  if (card) card.classList.add('offline');
}

// ===== VÉRIFICATION STATUTS =====
async function checkCamerasStatus() {
  Object.entries(securityCameras).forEach(async ([id, cam]) => {
    if (!cam.active) return;
    
    try {
      const res = await fetch(`http://${cam.ip}/status`, {timeout: 5000});
      if (res.ok) handleCameraLoad(id);
      else handleCameraError(id);
    } catch (err) {
      handleCameraError(id);
    }
  });
}

// ===== CAPTURE PHOTO =====
function captureCamera(id, name, ip) {
  showAlert('warning', '📸 Capture en cours...');
  
  const captureUrl = `http://${ip}:81/capture?t=${Date.now()}`;
  
  const capture = {
    id: 'cap_' + Date.now(),
    cameraId: id,
    name: name,
    timestamp: new Date().toISOString(),
    url: captureUrl
  };
  
  securityCaptures.unshift(capture);
  
  if (securityCaptures.length > 100) {
    securityCaptures = securityCaptures.slice(0, 100);
  }
  
  localStorage.setItem('priva_security_captures', JSON.stringify(securityCaptures));
  renderSecurityCaptures();
  showAlert('success', `✅ Photo capturée: ${name}`);
}

// ===== CAPTURER TOUTES =====
function captureAllCameras() {
  const active = Object.entries(securityCameras).filter(([id, cam]) => cam.active);
  
  if (active.length === 0) {
    showAlert('warning', '⚠️ Aucune caméra active');
    return;
  }
  
  showAlert('warning', `📸 Capture de ${active.length} caméra(s)...`);
  
  active.forEach(([id, cam], idx) => {
    setTimeout(() => captureCamera(id, cam.name, cam.ip), idx * 500);
  });
}

// ===== TOGGLE FLASH =====
async function toggleFlash(id, ip) {
  try {
    await fetch(`http://${ip}/flash`, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: 'state=1'
    });
    
    setTimeout(async () => {
      await fetch(`http://${ip}/flash`, {method: 'POST', body: 'state=0'});
    }, 200);
    
    showAlert('success', '💡 Flash activé');
  } catch (err) {
    showAlert('danger', '❌ Erreur flash');
  }
}

// ===== RAFRAÎCHIR TOUTES =====
function refreshAllCameras() {
  Object.entries(securityCameras).forEach(([id, cam]) => {
    const img = document.getElementById(`stream-${id}`);
    if (img) {
      img.src = `http://${cam.ip}:81/stream?t=${Date.now()}`;
    }
  });
  showAlert('success', '🔄 Caméras rafraîchies');
}

// ===== MODAL AJOUT CAMÉRA =====
function openAddCameraModal() {
  console.log('📹 Ouverture modal ajout caméra');
  const modal = document.getElementById('addCameraModal');
  if (modal) {
    modal.classList.add('active');
  } else {
    console.error('❌ Modal addCameraModal introuvable!');
  }
}

function closeAddCameraModal() {
  const modal = document.getElementById('addCameraModal');
  if (modal) modal.classList.remove('active');
}

// ===== AJOUTER CAMÉRA =====
function addSecurityCamera() {
  const name = document.getElementById('newCameraName').value.trim();
  const ip = document.getElementById('newCameraIP').value.trim();
  const location = document.getElementById('newCameraLocation').value.trim();
  
  if (!name || !ip) {
    showAlert('warning', '⚠️ Nom et IP requis');
    return;
  }
  
  const id = 'cam_' + Date.now();
  securityCameras[id] = {
    name,
    ip,
    location: location || 'Non spécifié',
    active: true,
    addedAt: new Date().toISOString()
  };
  
  localStorage.setItem('priva_security_cameras', JSON.stringify(securityCameras));
  
  console.log('✅ Caméra ajoutée:', securityCameras[id]);
  
  closeAddCameraModal();
  renderSecurityCameras();
  showAlert('success', `✅ ${name} ajoutée avec succès`);
  
  // Réinitialiser formulaire
  document.getElementById('newCameraName').value = '';
  document.getElementById('newCameraIP').value = '';
  document.getElementById('newCameraLocation').value = '';
}

// ===== SUPPRIMER CAMÉRA =====
function removeSecurityCamera(id) {
  const cam = securityCameras[id];
  if (!confirm(`Supprimer "${cam.name}" ?`)) return;
  
  delete securityCameras[id];
  localStorage.setItem('priva_security_cameras', JSON.stringify(securityCameras));
  renderSecurityCameras();
  showAlert('success', `🗑️ ${cam.name} supprimée`);
}

// ===== VOIR CAPTURE =====
function viewCapture(idx) {
  const cap = securityCaptures[idx];
  if (!cap) return;
  openCameraFullscreen(null, cap.name, null, cap.url);
}

// ===== SUPPRIMER CAPTURE =====
function deleteCapture(idx) {
  securityCaptures.splice(idx, 1);
  localStorage.setItem('priva_security_captures', JSON.stringify(securityCaptures));
  renderSecurityCaptures();
  showAlert('success', '🗑️ Capture supprimée');
}

// ===== VIDER CAPTURES =====
function clearSecurityCaptures() {
  if (!confirm('Vider toutes les captures ?')) return;
  
  securityCaptures = [];
  localStorage.setItem('priva_security_captures', JSON.stringify(securityCaptures));
  renderSecurityCaptures();
  showAlert('success', '🗑️ Galerie vidée');
}

// ===== CHANGER VUE =====
function setCameraView(mode) {
  const grid = document.getElementById('security-cameras-grid');
  if (!grid) return;
  
  if (mode === 'single') {
    grid.className = 'cameras-single';
  } else {
    grid.className = 'cameras-grid';
  }
  showAlert('success', `📺 Vue ${mode === 'single' ? 'simple' : 'grille'}`);
}

// ===== PLEIN ÉCRAN =====
function openCameraFullscreen(id, name, ip, captureUrl = null) {
  const modal = document.getElementById('cameraFullscreenModal');
  const img = document.getElementById('fullscreen-camera-img');
  const title = document.getElementById('fullscreen-camera-name');
  
  if (!modal || !img || !title) {
    console.error('❌ Elements modal plein écran introuvables');
    return;
  }
  
  title.textContent = `📹 ${name}`;
  
  if (captureUrl) {
    img.src = captureUrl;
    currentFullscreenCamera = null;
  } else {
    img.src = `http://${ip}:81/stream?t=${Date.now()}`;
    currentFullscreenCamera = {id, name, ip};
  }
  
  modal.classList.add('active');
}

function closeCameraFullscreen() {
  const modal = document.getElementById('cameraFullscreenModal');
  if (modal) modal.classList.remove('active');
  currentFullscreenCamera = null;
}

function captureFromFullscreen() {
  if (currentFullscreenCamera) {
    const {id, name, ip} = currentFullscreenCamera;
    captureCamera(id, name, ip);
  }
}

function toggleFlashFullscreen() {
  if (currentFullscreenCamera) {
    toggleFlash(currentFullscreenCamera.id, currentFullscreenCamera.ip);
  }
}

function downloadCapture() {
  const img = document.getElementById('fullscreen-camera-img');
  if (!img) return;
  
  const link = document.createElement('a');
  link.href = img.src;
  link.download = `capture_${Date.now()}.jpg`;
  link.click();
  showAlert('success', '⬇️ Téléchargement...');
}

console.log('✅ Code ESP32-CAM chargé - Caméras disponibles:', Object.keys(securityCameras).length);

