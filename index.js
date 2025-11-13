// PRIVA Platform - JavaScript

// Configuration
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQwJjy2KpJJ5X--C87zVuPjykAg9Fyc79zIxpdk1Dt0FvrxYw1Onfzt5wSHOVagvLry9uyyohzeN3h4/pub?gid=0&single=true&output=csv';
const PROXY = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(SHEET_URL);
const COMMAND_API_URL = 'https://script.google.com/macros/s/AKfycbzfc55KJi67mnUXNH4uxnhHuJCkiJhzk3RxrboAHOz2WorlEbVXFkHwfWeqJKMCNbLP5w/exec';

// Variables globales
let climateChart, airChart, allData = [], devices = {}, currentModule = 'agriculture', updateInterval;

// Charger les appareils sauvegardés
const savedDevices = localStorage.getItem('priva_devices');
if (savedDevices) devices = JSON.parse(savedDevices);

// ==================== INITIALISATION ====================

function init() {
  setupCharts();
  loadData();
  setInterval(loadData, 10000);
  renderDevicesList();
  
  const agriDevice = Object.values(devices).find(d => d.type === 'agriculture' && d.active);
  if (agriDevice) {
    updateModuleConfig('agriculture');
    startModuleUpdate('agriculture');
  }
}

// ==================== GRAPHIQUES ====================

function setupCharts() {
  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#f8f9fa' } } },
    scales: {
      x: { ticks: { color: '#9ca3af' }, grid: { color: '#2d3142' } },
      y: { ticks: { color: '#9ca3af' }, grid: { color: '#2d3142' } }
    }
  };

  climateChart = new Chart(document.getElementById('climateChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Température', data: [], borderColor: '#ef4444', tension: 0.4, borderWidth: 3 },
        { label: 'Humidité', data: [], borderColor: '#3b82f6', tension: 0.4, borderWidth: 3 }
      ]
    },
    options: opts
  });

  airChart = new Chart(document.getElementById('airChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{ label: 'CO2', data: [], borderColor: '#10b981', tension: 0.4, borderWidth: 3, fill: true }]
    },
    options: opts
  });
}

// ==================== CHARGEMENT DONNÉES ====================

async function loadData() {
  try {
    const res = await fetch(PROXY);
    const csv = await res.text();
    const rows = csv.trim().split('\n').map(r => r.split(',').map(c => c.trim()));
    allData = rows.slice(1);
    
    if (allData.length > 0) {
      updateCharts();
      updateTable();
      document.getElementById('dataCount').textContent = allData.length;
    }
  } catch (err) {
    console.error('Erreur Google Sheets:', err);
  }
}

function updateCharts() {
  const data = allData.slice(-50);
  climateChart.data.labels = data.map(r => r[0]);
  climateChart.data.datasets[0].data = data.map(r => parseFloat(r[1]));
  climateChart.data.datasets[1].data = data.map(r => parseFloat(r[2]));
  climateChart.update('none');

  airChart.data.labels = data.map(r => r[0]);
  airChart.data.datasets[0].data = data.map(r => parseFloat(r[3]));
  airChart.update('none');
}

function updateTable() {
  document.getElementById('dataTable').innerHTML = allData.slice(-10).reverse().map(r => 
    `<tr><td>${r[0]}</td><td>${r[1]}°C</td><td>${r[2]}%</td><td>${r[3]} ppm</td><td>${r[4]}V</td></tr>`
  ).join('');
}

// ==================== NAVIGATION MODULES ====================

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
  }
  
  showAlert('success', `📱 Module ${module} activé`);
}

function updateModuleConfig(module) {
  const device = Object.values(devices).find(d => d.type === module && d.active);
  const configId = module === 'agriculture' ? 'agri-device-info' : 'sec-device-info';
  const configDiv = document.getElementById(configId);
  
  if (!device) {
    configDiv.innerHTML = `
      <div style="text-align: center; padding: 20px; opacity: 0.6;">
        Aucun appareil actif. Ajoutez un ESP32 via l'onglet "🎛️ Appareils"
      </div>
    `;
    return;
  }
  
  configDiv.innerHTML = `
    <div style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap;">
      <div style="flex: 1;">
        <div style="font-weight: 600; margin-bottom: 5px;">${getDeviceIcon(device.type)} ${device.name}</div>
        <div style="font-size: 12px; opacity: 0.7;">📍 ${device.location}</div>
      </div>
      <div style="flex: 2; display: flex; gap: 10px; align-items: center;">
        <label style="font-weight: 600;">📡 IP:</label>
        <input type="text" id="edit-ip-${module}" value="${device.ip}" 
               style="flex: 1; padding: 8px; background: #0f1117; border: 1px solid #2d3142; border-radius: 5px; color: white;">
        <button class="btn btn-success btn-small" onclick="updateDeviceIP('${module}')">💾 Sauver</button>
        <button class="btn btn-primary btn-small" onclick="testActiveDevice('${module}')">🔍 Tester</button>
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
  
  const deviceId = Object.keys(devices).find(key => devices[key] === device);
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
    const text = await res.text();
    showAlert('success', `✓ Connexion réussie: ${text.substring(0, 50)}`);
  } catch (err) {
    showAlert('danger', `❌ Connexion échouée`);
  }
}

// ==================== MISE À JOUR DONNÉES ESP32 ====================

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
    
    if (data.settings) {
      ['tempMin', 'tempMax', 'humidMin', 'humidMax'].forEach(k => {
        const val = data.settings[k.replace('humid', 'hum')];
        document.getElementById(k).value = val;
        updateSlider(k, val, k.includes('temp') ? '°C' : '%');
      });
    }
    
    document.getElementById('connectionStatus').style.background = '#00a651';
    document.getElementById('connectionText').textContent = 'Connecté (Agriculture)';
  } catch (err) {
    document.getElementById('connectionStatus').style.background = '#e63946';
    document.getElementById('connectionText').textContent = 'Déconnecté';
  }
}

async function updateSecurityData(ip) {
  try {
    const res = await fetch(`http://${ip}/status`, {mode: 'cors'});
    const data = await res.json();
    
    document.getElementById('sec-door').textContent = data.doorOpen ? 'OUVERTE' : 'FERMÉE';
    document.getElementById('sec-motion').textContent = data.motionDetected ? 'DÉTECTÉ' : 'AUCUN';
    document.getElementById('sec-badge').textContent = data.lastBadge || '--';
    
    if (data.lastAccess > 0) {
      document.getElementById('sec-time').textContent = new Date(data.lastAccess).toLocaleTimeString();
    }
    
    updateDeviceUI('lock', data.devices.lock);
    updateDeviceUI('alarm', data.devices.alarm);
    updateDeviceUI('lights', data.devices.lights);
    
    document.getElementById('connectionStatus').style.background = '#00a651';
    document.getElementById('connectionText').textContent = 'Connecté (Sécurité)';
  } catch (err) {
    document.getElementById('connectionStatus').style.background = '#e63946';
    document.getElementById('connectionText').textContent = 'Déconnecté';
  }
}

function updateDeviceUI(device, state) {
  const card = document.getElementById(device + 'Card');
  const status = document.getElementById(device + 'Status');
  if (!card || !status) return;
  
  if (state) {
    card.classList.add('active');
    const texts = {electrovanne: 'Ouverte', lock: 'Déverrouillée', alarm: 'Activée', lights: 'Allumées'};
    status.textContent = texts[device] || 'Actif';
  } else {
    card.classList.remove('active');
    const texts = {electrovanne: 'Fermée', lock: 'Verrouillée', alarm: 'Désactivée', lights: 'Éteintes'};
    status.textContent = texts[device] || 'Arrêté';
  }
}

// ==================== CONTRÔLE APPAREILS ====================

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
    } catch (err) {
      console.log('Local failed, trying cloud');
    }
  }
  
  try {
    await fetch(COMMAND_API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({actionneur: device, etat: newState ? 1 : 0})
    });
    
    updateDeviceUI(device, newState);
    showAlert('success', `✓ ${device} ${newState ? 'activé' : 'désactivé'} (cloud)`);
  } catch (err) {
    showAlert('danger', '❌ Erreur: ' + err.message);
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
        showAlert('success', `✓ Mode ${mode} activé`);
        return;
      }
    } catch (err) {}
  }
  
  try {
    await fetch(COMMAND_API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({actionneur: 'mode', etat: mode})
    });
    
    document.getElementById('modeDisplay').textContent = mode.toUpperCase();
    showAlert('success', `✓ Mode ${mode} activé (cloud)`);
  } catch (err) {
    showAlert('danger', '❌ Erreur');
  }
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
      document.getElementById('modeDisplay').textContent = 'MANUAL';
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
  
  showAlert('warning', '⚠️ Connectez un ESP32 pour enregistrer');
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

// ==================== GESTIONNAIRE D'APPAREILS ====================

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
    list.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.6;">Aucun appareil configuré. Cliquez sur "Ajouter" pour commencer.</div>';
    return;
  }
  
  list.innerHTML = Object.entries(devices).map(([id, dev]) => `
    <div class="device-item">
      <div class="device-info">
        <div class="device-name">${getDeviceIcon(dev.type)} ${dev.name}</div>
        <div class="device-details">
          📡 ${dev.ip} • 📍 ${dev.location} • 
          <span style="color: ${dev.active ? '#00a651' : '#e63946'}">
            ${dev.active ? '✓ Actif' : '○ Inactif'}
          </span>
        </div>
      </div>
      <div class="device-actions">
        <button class="btn btn-small ${dev.active ? 'btn-danger' : 'btn-success'}" 
                onclick="toggleDeviceActive('${id}')">
          ${dev.active ? '⏸️' : '▶️'}
        </button>
        <button class="btn btn-small btn-primary" onclick="testDeviceConnection('${id}')">🔍</button>
        <button class="btn btn-small btn-danger" onclick="deleteDevice('${id}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

function getDeviceIcon(type) {
  const icons = {agriculture: '🌱', security: '🔒', custom: '⚙️'};
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
    name,
    ip,
    type,
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
  showAlert('success', `✓ ${name} ajouté avec succès`);
  
  document.getElementById('newDeviceName').value = '';
  document.getElementById('newDeviceIP').value = '';
  document.getElementById('newDeviceLocation').value = '';
  
  if (type === 'agriculture' || type === 'security') {
    setTimeout(() => {
      const moduleBtn = document.querySelector(`.tab-btn[onclick="switchModule('${type}')"]`);
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
  showAlert('warning', `🔍 Test de ${device.name}...`);
  
  try {
    const res = await fetch(`http://${device.ip}/`, {mode: 'cors'});
    const text = await res.text();
    showAlert('success', `✓ ${device.name} répond: ${text.substring(0, 50)}`);
  } catch (err) {
    showAlert('danger', `❌ ${device.name} ne répond pas`);
  }
}

function deleteDevice(id) {
  const device = devices[id];
  if (!confirm(`Supprimer ${device.name} ?`)) return;
  
  delete devices[id];
  localStorage.setItem('priva_devices', JSON.stringify(devices));
  renderDevicesList();
  showAlert('success', `🗑️ ${device.name} supprimé`);
}

// ==================== DÉMARRAGE ====================

init();
