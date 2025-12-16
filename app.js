// =========================================
// CONSTANTES
// =========================================
const COMMAND_API_URL = 'https://script.google.com/macros/s/AKfycbwA53tJWrpVpd6WeoAA09FYVe63aFvwy-liD_rQgb2gr_HZ2bYHC1sKajJ4wzwshMC6aA/exec';
const AGRICULTURE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQwJjy2KpJJ5X--C87zVuPjykAg9Fyc79zIxpdk1Dt0FvrxYw1Onfzt5wSHOVagvLry9uyyohzeN3h4/pub?output=csv";
const SECURITY_CSV_URL = "https://docs.google.com/spreadsheets/d/12x5LRuFBaKeAfkSxc53uR-6Q3Xcu-OxZt2plY0GZSko/export?format=csv&gid=2127989880";
const PROXY = 'https://api.allorigins.win/raw?url=';

// =========================================
// VARIABLES GLOBALES
// =========================================
let devices = [];        // liste de tous les ESP32
let cameras = [];        // liste des ESP32-CAM
let climateChart = null;
let airChart = null;
let mode = 'manual';

// =========================================
// INIT PLATEFORME
// =========================================
function init() {
  loadDevices();
  loadCameras();
  updateData();
  setInterval(updateData, 5000); // mise à jour toutes les 5 secondes
}

// =========================================
// GESTION DES ESP32
// =========================================
function loadDevices() {
  const stored = localStorage.getItem('devices');
  if (stored) {
    devices = JSON.parse(stored);
    renderDevices();
  }
}

function saveDevices() {
  localStorage.setItem('devices', JSON.stringify(devices));
}

function renderDevices() {
  const list = document.getElementById('devicesList');
  list.innerHTML = '';
  devices.forEach((d, i) => {
    const div = document.createElement('div');
    div.className = 'device-card';
    div.innerHTML = `<strong>${d.name}</strong> (${d.type}) - ${d.ip} <button onclick="removeDevice(${i})">❌</button>`;
    list.appendChild(div);
  });
}

function addDevice() {
  const name = document.getElementById('newDeviceName').value.trim();
  const ip = document.getElementById('newDeviceIP').value.trim();
  const type = document.getElementById('newDeviceType').value;
  const location = document.getElementById('newDeviceLocation').value.trim();

  if (!name || !ip) return alert('Nom et IP requis');
  devices.push({ name, ip, type, location });
  saveDevices();
  renderDevices();
  closeAddDeviceModal();
}

function removeDevice(index) {
  devices.splice(index, 1);
  saveDevices();
  renderDevices();
}

// =========================================
// MODULE AGRICULTURE
// =========================================
function updateData() {
  fetch(PROXY + AGRICULTURE_CSV_URL)
    .then(r => r.text())
    .then(csv => parseCSV(csv, 'agriculture'));

  fetch(PROXY + SECURITY_CSV_URL)
    .then(r => r.text())
    .then(csv => parseCSV(csv, 'security'));
}

function parseCSV(csv, module) {
  const lines = csv.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',');

  if (module === 'agriculture') {
    const last = lines[lines.length - 1].split(',');
    document.getElementById('tempValue').innerText = last[1] || '--';
    document.getElementById('humidValue').innerText = last[2] || '--';
    document.getElementById('gasValue').innerText = last[3] || '--';
    document.getElementById('dcValue').innerText = last[4] || '--';

    const tbody = document.getElementById('dataTable');
    tbody.innerHTML = '';
    lines.slice(1).forEach(line => {
      const row = line.split(',');
      const tr = document.createElement('tr');
      row.forEach(cell => tr.appendChild(Object.assign(document.createElement('td'), { innerText: cell })));
      tbody.appendChild(tr);
    });
  } else if (module === 'security') {
    const tbody = document.getElementById('securityTable');
    tbody.innerHTML = '';
    lines.slice(1).forEach(line => {
      const row = line.split(',');
      const tr = document.createElement('tr');
      row.forEach(cell => tr.appendChild(Object.assign(document.createElement('td'), { innerText: cell })));
      tbody.appendChild(tr);
    });
  }
}

// =========================================
// MODULE SÉCURITÉ ET CAMÉRA
// =========================================
function loadCameras() {
  const stored = localStorage.getItem('cameras');
  if (stored) {
    cameras = JSON.parse(stored);
    renderCameras();
  }
}

function saveCameras() {
  localStorage.setItem('cameras', JSON.stringify(cameras));
}

function renderCameras() {
  const grid = document.getElementById('security-cameras-grid');
  grid.innerHTML = '';
  if (!cameras.length) {
    grid.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.6;">Aucune caméra configurée.</div>';
    return;
  }
  cameras.forEach(cam => {
    const div = document.createElement('div');
    div.className = 'camera-card';
    div.innerHTML = `<strong>${cam.name}</strong><br><img src="http://${cam.ip}/stream" style="width:100%;max-height:150px;" onclick="openCameraFullscreen('${cam.ip}','${cam.name}')">`;
    grid.appendChild(div);
  });
}

function addSecurityCamera() {
  const name = document.getElementById('newCameraName').value.trim();
  const ip = document.getElementById('newCameraIP').value.trim();
  const location = document.getElementById('newCameraLocation').value.trim();
  if (!name || !ip) return alert('Nom et IP requis');
  cameras.push({ name, ip, location });
  saveCameras();
  renderCameras();
  closeAddCameraModal();
}

// =========================================
// MODES & COMMANDES
// =========================================
function setMode(m) {
  mode = m;
  document.getElementById('modeDisplay').innerText = m.toUpperCase();
  fetch(COMMAND_API_URL + `?cmd=setMode&mode=${m}`);
}

function toggleDevice(module, device) {
  const statusId = `${device}Status`;
  const el = document.getElementById(statusId);
  if (!el) return;

  const isOn = el.innerText.toLowerCase().includes('arrêté') || el.innerText.toLowerCase().includes('éteintes') || el.innerText.toLowerCase().includes('fermée');
  const cmd = isOn ? 'on' : 'off';
  fetch(COMMAND_API_URL + `?cmd=${device}&action=${cmd}`);
  el.innerText = isOn ? 'Activé' : 'Arrêté';
}

// =========================================
// MODALS
// =========================================
function openAddDeviceModal() { document.getElementById('addDeviceModal').style.display = 'block'; }
function closeAddDeviceModal() { document.getElementById('addDeviceModal').style.display = 'none'; }
function openAddCameraModal() { document.getElementById('addCameraModal').style.display = 'block'; }
function closeAddCameraModal() { document.getElementById('addCameraModal').style.display = 'none'; }

function openCameraFullscreen(ip, name) {
  document.getElementById('fullscreen-camera-img').src = `http://${ip}/stream`;
  document.getElementById('fullscreen-camera-name').innerText = name;
  document.getElementById('cameraFullscreenModal').style.display = 'block';
}
function closeCameraFullscreen() {
  document.getElementById('cameraFullscreenModal').style.display = 'none';
}
