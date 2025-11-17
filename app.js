// ============================================
// PRIVA Platform - JavaScript Complet et Corrigé
// ============================================

// ==================== CONFIGURATION ====================

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

// Charger les appareils sauvegardés
const savedDevices = localStorage.getItem('priva_devices');
if (savedDevices) devices = JSON.parse(savedDevices);

// ==================== INITIALISATION ====================

function init() {
  console.log('🚀 Initialisation du système PRIVA...');
  setupCharts();
  loadAgricultureData();
  loadSecurityData();
  
  // Rafraîchir toutes les 10 secondes
  setInterval(() => {
    loadAgricultureData();
    loadSecurityData();
  }, 10000);
  
  renderDevicesList();
  
  // Démarrer les mises à jour du module actif
  const agriDevice = Object.values(devices).find(d => d.type === 'agriculture' && d.active);
  if (agriDevice) {
    updateModuleConfig('agriculture');
    startModuleUpdate('agriculture');
  }
  
  showAlert('success', '✓ Système initialisé avec succès');
}

// ==================== CONFIGURATION GRAPHIQUES ====================

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

  climateChart = new Chart(document.getElementById('climateChart'), {
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

  airChart = new Chart(document.getElementById('airChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{ 
        label: 'CO2 (ppm)', 
        data: [], 
        borderColor: '#10b981', 
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.4, 
        borderWidth: 3, 
        fill: true 
      }]
    },
    options: chartOptions
  });
}

// ==================== CHARGEMENT DONNÉES AGRICULTURE ====================

async function loadAgricultureData() {
  try {
    const res = await fetch(PROXY + encodeURIComponent(AGRICULTURE_CSV_URL));
    const csv = await res.text();
    const rows = csv.trim().split('\n').map(r => r.split(',').map(c => c.trim()));
    
    // Ignorer la première ligne (en-têtes)
    allAgriData = rows.slice(1).filter(row => row.length >= 3);
    
    if (allAgriData.length > 0) {
      updateCharts();
      updateAgricultureTable();
      document.getElementById('dataCount').textContent = allAgriData.length;
      document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
      
      // Mettre à jour les badges de statut
      const lastRow = allAgriData[allAgriData.length - 1];
      updateStatusBadges(lastRow);
    }
  } catch (err) {
    console.error('❌ Erreur chargement données agriculture:', err);
    showAlert('warning', '⚠️ Erreur chargement données agriculture');
  }
}

// ==================== CHARGEMENT DONNÉES SÉCURITÉ ====================

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
    console.error('❌ Erreur chargement données sécurité:', err);
  }
}

// ==================== MISE À JOUR GRAPHIQUES ====================

function updateCharts() {
  const data = allAgriData.slice(-50); // Dernières 50 mesures
  
  climateChart.data.labels = data.map(r => formatDateTime(r[0]));
  climateChart.data.datasets[0].data = data.map(r => parseFloat(r[1]) || 0);
  climateChart.data.datasets[1].data = data.map(r => parseFloat(r[2]) || 0);
  climateChart.update('none');

  airChart.data.labels = data.map(r => formatDateTime(r[0]));
  airChart.data.datasets[0].data = data.map(r => parseFloat(r[3]) || 0);
  airChart.update('none');
}

// ==================== MISE À JOUR TABLEAU AGRICULTURE ====================

function updateAgricultureTable() {
  const tableBody = document.getElementById('dataTable');
  const recentData = allAgriData.slice(-10).reverse();
  
  if (recentData.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Aucune donnée disponible</td></tr>';
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

// ==================== MISE À JOUR TABLEAU SÉCURITÉ ====================

function updateSecurityTable() {
  const tableBody = document.getElementById('securityTable');
  const recentData = allSecurityData.slice(-10).reverse();
  
  if (recentData.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Aucune donnée disponible</td></tr>';
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

// ==================== MISE À JOUR BADGES DE STATUT ====================

function updateStatusBadges(data) {
  const temp = parseFloat(data[1]);
  const humid = parseFloat(data[2]);
  const gas = parseFloat(data[3]);
  
  // Badge température
  const tempBadge = document.getElementById('tempBadge');
  if (tempBadge) {
    if (temp < 15 || temp > 35) {
      tempBadge.className = 'status-badge danger';
      tempBadge.textContent = 'Critique';
    } else if (temp < 18 || temp > 28) {
      tempBadge.className = 'status-badge warning';
      tempBadge.textContent = 'Attention';
    } else {
      tempBadge.className = 'status-badge optimal';
      tempBadge.textContent = 'Normal';
    }
  }
  
  // Badge humidité
  const humidBadge = document.getElementById('humidBadge');
  if (humidBadge) {
    if (humid < 30 || humid > 90) {
      humidBadge.className = 'status-badge danger';
      humidBadge.textContent = 'Critique';
    } else if (humid < 50 || humid > 80) {
      humidBadge.className = 'status-badge warning';
      humidBadge.textContent = 'Attention';
    } else {
      humidBadge.className = 'status-badge optimal';
      humidBadge.textContent = 'Normal';
    }
  }
  
  // Badge gaz
  const gasBadge = document.getElementById('gasBadge');
  if (gasBadge) {
    if (gas > 1000) {
      gasBadge.className = 'status-badge danger';
      gasBadge.textContent = 'Élevé';
    } else if (gas > 600) {
      gasBadge.className = 'status-badge warning';
      gasBadge.textContent = 'Moyen';
    } else {
      gasBadge.className = 'status-badge optimal';
      gasBadge.textContent = 'Normal';
    }
  }
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
  
  showAlert('success', `📱 Module ${module === 'agriculture' ? 'Agriculture' : 'Sécurité'} activé`);
}

// ==================== CONFIGURATION MODULE ====================

function updateModuleConfig(module) {
  const device = Object.values(devices).find(d => d.type === module && d.active);
  const configId = module === 'agriculture' ? 'agri-device-info' : 'sec-device-info';
  const configDiv = document.getElementById(configId);
  
  if (!configDiv) return;
  
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
  if (!device) {
    console.log(`ℹ️ Aucun appareil ${module} actif`);
    return;
  }
  
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
    
    // Mettre à jour les valeurs des capteurs
    document.getElementById('tempValue').textContent = data.temperature.toFixed(1);
    document.getElementById('humidValue').textContent = data.humidity.toFixed(1);
    document.getElementById('gasValue').textContent = data.gas.toFixed(0);
    document.getElementById('dcValue').textContent = data.dc.toFixed(2);
    document.getElementById('modeDisplay').textContent = data.mode.toUpperCase();
    
    // Mettre à jour l'état des actionneurs
    ['pompe', 'brumisateur', 'ventilateur', 'chauffage', 'eclairage', 'electrovanne'].forEach(d => 
      updateDeviceUI(d, data.devices[d])
    );
    
    // Mettre à jour les paramètres
    if (data.settings) {
      document.getElementById('tempMin').value = data.settings.tempMin;
      updateSlider('tempMin', data.settings.tempMin, '°C');
      
      document.getElementById('tempMax').value = data.settings.tempMax;
      updateSlider('tempMax', data.settings.tempMax, '°C');
      
      document.getElementById('humidMin').value = data.settings.humMin;
      updateSlider('humidMin', data.settings.humMin, '%');
      
      document.getElementById('humidMax').value = data.settings.humMax;
      updateSlider('humidMax', data.settings.humMax, '%');
    }
    
    // Statut de connexion
    document.getElementById('connectionStatus').className = 'status-dot connected';
    document.getElementById('connectionText').textContent = 'Connecté (Agriculture)';
  } catch (err) {
    document.getElementById('connectionStatus').className = 'status-dot disconnected';
    document.getElementById('connectionText').textContent = 'Déconnecté';
    console.error('Erreur connexion ESP32 Agriculture:', err);
  }
}

async function updateSecurityData(ip) {
  try {
    const res = await fetch(`http://${ip}/status`, {mode: 'cors'});
    const data = await res.json();
    
    // Mettre à jour les capteurs
    document.getElementById('sec-door').textContent = data.doorOpen ? 'OUVERTE' : 'FERMÉE';
    document.getElementById('sec-door').style.color = data.doorOpen ? '#e63946' : '#00a651';
    
    document.getElementById('sec-motion').textContent = data.motionDetected ? 'DÉTECTÉ' : 'AUCUN';
    document.getElementById('sec-motion').style.color = data.motionDetected ? '#f77f00' : '#00a651';
    
    document.getElementById('sec-badge').textContent = data.lastBadge || '--';
    
    if (data.lastAccess > 0) {
      const date = new Date(data.lastAccess);
      document.getElementById('sec-time').textContent = date.toLocaleTimeString();
    }
    
    // Mettre à jour les actionneurs
    updateDeviceUI('lock', data.devices.lock);
    updateDeviceUI('alarm', data.devices.alarm);
    updateDeviceUI('lights', data.devices.lights);
    
    document.getElementById('connectionStatus').className = 'status-dot connected';
    document.getElementById('connectionText').textContent = 'Connecté (Sécurité)';
  } catch (err) {
    document.getElementById('connectionStatus').className = 'status-dot disconnected';
    document.getElementById('connectionText').textContent = 'Déconnecté';
    console.error('Erreur connexion ESP32 Sécurité:', err);
  }
}

// ==================== MISE À JOUR UI ACTIONNEURS ====================

function updateDeviceUI(device, state) {
  const card = document.getElementById(device + 'Card');
  const status = document.getElementById(device + 'Status');
  if (!card || !status) return;
  
  if (state) {
    card.classList.add('active');
    const activeTexts = {
      pompe: 'Actif',
      brumisateur: 'Actif',
      ventilateur: 'Actif',
      chauffage: 'Actif',
      eclairage: 'Allumé',
      electrovanne: 'Ouverte',
      lock: 'Déverrouillée',
      alarm: 'Activée',
      lights: 'Allumées'
    };
    status.textContent = activeTexts[device] || 'Actif';
  } else {
    card.classList.remove('active');
    const inactiveTexts = {
      pompe: 'Arrêté',
      brumisateur: 'Arrêté',
      ventilateur: 'Arrêté',
      chauffage: 'Arrêté',
      eclairage: 'Éteint',
      electrovanne: 'Fermée',
      lock: 'Verrouillée',
      alarm: 'Désactivée',
      lights: 'Éteintes'
    };
    status.textContent = inactiveTexts[device] || 'Arrêté';
  }
}

// ==================== CONTRÔLE ACTIONNEURS ====================

async function toggleDevice(module, device) {
  const activeDevice = Object.values(devices).find(d => d.type === module && d.active);
  const card = document.getElementById(device + 'Card');
  const newState = !card.classList.contains('active');
  
  console.log(`🔧 Toggle ${device} dans module ${module}: ${newState ? 'ON' : 'OFF'}`);
  
  // 1. Essayer via ESP32 local d'abord
  if (activeDevice) {
    try {
      const res = await fetch(`http://${activeDevice.ip}/control`, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `device=${device}&state=${newState ? '1' : '0'}`
      });
      
      if (res.ok) {
        updateDeviceUI(device, newState);
        showAlert('success', `✓ ${device} ${newState ? 'activé' : 'désactivé'} (local)`);
        return;
      }
    } catch (err) {
      console.log('❌ Local échoué, tentative via cloud...');
    }
  }
  
  // 2. Essayer via Google Sheets
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
    console.log('📡 Réponse Google Sheets:', result);
    
    if (result.status === "success") {
      updateDeviceUI(device, newState);
      showAlert('success', `✓ ${device} ${newState ? 'activé' : 'désactivé'} (cloud)`);
    } else {
      showAlert('danger', '❌ Erreur: ' + result.message);
    }
  } catch (err) {
    console.error('❌ Erreur cloud:', err);
    showAlert('danger', '❌ Erreur de communication: ' + err.message);
  }
}

// ==================== CHANGER MODE AGRICULTURE ====================

async function setMode(mode) {
  const activeDevice = Object.values(devices).find(d => d.type === 'agriculture' && d.active);
  
  console.log(`🤖 Changement mode: ${mode}`);
  
  // 1. Essayer local
  if (activeDevice) {
    try {
      const res = await fetch(`http://${activeDevice.ip}/mode`, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `mode=${mode}`
      });
      
      if (res.ok) {
        document.getElementById('modeDisplay').textContent = mode.toUpperCase();
        showAlert('success', `✓ Mode ${mode} activé (local)`);
        return;
      }
    } catch (err) {
      console.log('❌ Local échoué, tentative via cloud...');
    }
  }
  
  // 2. Essayer via Google Sheets
  try {
    const response = await fetch(COMMAND_API_URL, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({
        cible: 'agriculture',
        actionneur: 'mode',
        etat: mode
      })
    });
    
    const result = await response.json();
    
    if (result.status === "success") {
      document.getElementById('modeDisplay').textContent = mode.toUpperCase();
      showAlert('success', `✓ Mode ${mode} activé (cloud)`);
    } else {
      showAlert('danger', '❌ Erreur mode');
    }
  } catch (err) {
    showAlert('danger', '❌ Erreur changement mode');
  }
}

// ==================== CHANGER MODE SÉCURITÉ ====================

async function setSecurityMode(mode) {
  const activeDevice = Object.values(devices).find(d => d.type === 'security' && d.active);
  
  console.log(`🔒 Changement mode sécurité: ${mode}`);
  
  // Essayer via Google Sheets
  try {
    const response = await fetch(COMMAND_API_URL, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({
        cible: 'securite',
        actionneur: 'mode',
        etat: mode
      })
    });
    
    const result = await response.json();
    
    if (result.status === "success") {
      showAlert('success', `✓ Mode sécurité ${mode} activé`);
    } else {
      showAlert('danger', '❌ Erreur mode sécurité');
    }
  } catch (err) {
    showAlert('danger', '❌ Erreur changement mode');
  }
}

// ==================== ARRÊT D'URGENCE ====================

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
      showAlert('danger', '🛑 ARRÊT D\'URGENCE ACTIVÉ');
      return;
    } catch (err) {
      console.log('❌ Arrêt d\'urgence local échoué');
    }
  }
  
  // Désactiver via cloud
  const devices_list = ['pompe', 'brumisateur', 'ventilateur', 'chauffage', 'eclairage', 'electrovanne'];
  for (const device of devices_list) {
    try {
      await fetch(COMMAND_API_URL, {
        method: 'POST',
        headers: {'Content-Type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({
          cible: 'agriculture',
          actionneur: device,
          etat: 0
        })
      });
    } catch (err) {}
  }
  
  showAlert('danger', '🛑 ARRÊT D\'URGENCE (cloud)');
}

// ==================== ENREGISTRER PARAMÈTRES ====================

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
    } catch (err) {
      console.log('❌ Sauvegarde locale échouée');
    }
  }
  
  showAlert('warning', '⚠️ Connectez un ESP32 pour enregistrer les paramètres');
}

// ==================== MISE À JOUR SLIDER ====================

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
    list.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.6;">🔧 Aucun appareil configuré. Cliquez sur "Ajouter ESP32" pour commencer.</div>';
    return;
  }
  
  list.innerHTML = Object.entries(devices).map(([id, dev]) => `
    <div class="device-item">
      <div class="device-info">
        <div class="device-name">${getDeviceIcon(dev.type)} ${dev.name}</div>
        <div class="device-details">
          📡 ${dev.ip} • 📍 ${dev.location} • 
          <span style="color: ${dev.active ? '#00a651' : '#e63946'}; font-weight: bold;">
            ${dev.active ? '✓ Actif' : '○ Inactif'}
          </span>
        </div>
      </div>
      <div class="device-actions">
        <button class="btn btn-small ${dev.active ? 'btn-danger' : 'btn-success'}" 
                onclick="toggleDeviceActive('${id}')">
          ${dev.active ? '⏸️' : '▶️'}
        </button>
        <button class="btn btn-small btn-primary" onclick="testDeviceConnection('${id}')">🔍 Test</button>
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
    name,
    ip,
    type,
    location: location || 'Non spécifié',
    active: true,
    addedAt: new Date().toISOString()
  };
  
  // Désactiver les autres appareils du même type
  Object.entries(devices).forEach(([key, dev]) => {
    if (key !== id && dev.type === type) dev.active = false;
  });
  
  localStorage.setItem('priva_devices', JSON.stringify(devices));
  
  closeAddDeviceModal();
  renderDevicesList();
  showAlert('success', `✓ ${name} ajouté avec succès`);
  
  // Réinitialiser le formulaire
  document.getElementById('newDeviceName').value = '';
  document.getElementById('newDeviceIP').value = '';
  document.getElementById('newDeviceLocation').value = '';
  
  // Basculer automatiquement vers le module correspondant
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
    // Désactiver tous les autres appareils du même type
    Object.entries(devices).forEach(([key, dev]) => {
      if (dev.type === device.type) dev.active = false;
    });
    device.active = true;
    showAlert('success', `✓ ${device.name} activé`);
    
    // Si on est déjà sur le module, redémarrer les mises à jour
    if (currentModule === device.type) {
      if (updateInterval) clearInterval(updateInterval);
      updateModuleConfig(device.type);
      startModuleUpdate(device.type);
    }
  } else {
    device.active = false;
    showAlert('warning', `⏸️ ${device.name} désactivé`);
    
    // Arrêter les mises à jour si c'était l'appareil actif
    if (updateInterval) clearInterval(updateInterval);
  }
  
  localStorage.setItem('priva_devices', JSON.stringify(devices));
  renderDevicesList();
}

async function testDeviceConnection(id) {
  const device = devices[id];
  showAlert('warning', `🔍 Test de connexion à ${device.name}...`);
  
  try {
    const res = await fetch(`http://${device.ip}/`, {mode: 'cors', timeout: 5000});
    const text = await res.text();
    showAlert('success', `✓ ${device.name} répond correctement`);
  } catch (err) {
    showAlert('danger', `❌ ${device.name} ne répond pas (vérifiez l'IP et le réseau)`);
  }
}

function deleteDevice(id) {
  const device = devices[id];
  if (!confirm(`Supprimer l'appareil "${device.name}" ?`)) return;
  
  delete devices[id];
  localStorage.setItem('priva_devices', JSON.stringify(devices));
  renderDevicesList();
  showAlert('success', `🗑️ ${device.name} supprimé`);
}

// ==================== UTILITAIRES ====================

function formatDateTime(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'});
  } catch {
    return dateStr;
  }
}

// ==================== DÉMARRAGE ====================

window.addEventListener('DOMContentLoaded', init);
