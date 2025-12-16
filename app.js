// =========================================
// CONSTANTES API
// =========================================
const COMMAND_API_URL = 'https://script.google.com/macros/s/AKfycbwA53tJWrpVpd6WeoAA09FYVe63aFvwy-liD_rQgb2gr_HZ2bYHC1sKajJ4wzwshMC6aA/exec';
const AGRICULTURE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQwJjy2KpJJ5X--C87zVuPjykAg9Fyc79zIxpdk1Dt0FvrxYw1Onfzt5wSHOVagvLry9uyyohzeN3h4/pub?output=csv";
const SECURITY_CSV_URL = "https://docs.google.com/spreadsheets/d/12x5LRuFBaKeAfkSxc53uR-6Q3Xcu-OxZt2plY0GZSko/export?format=csv&gid=2127989880";
const PROXY = 'https://api.allorigins.win/raw?url=';

// =========================================
// VARIABLES GLOBALES
// =========================================
let devices = []; // liste des ESP32
let cameras = []; // liste des ESP32-CAM
let activeModule = 'agriculture';
let climateChart, airChart;

// =========================================
// INITIALISATION
// =========================================
function init() {
  loadDevices();
  loadAgricultureData();
  loadSecurityData();
  initCharts();
}

// =========================================
// GESTION DES MODULES
// =========================================
function switchModule(moduleName) {
  activeModule = moduleName;
  document.querySelectorAll('.module').forEach(m => m.style.display = 'none');
  document.getElementById(moduleName).style.display = 'block';

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tab-btn[onclick="switchModule('${moduleName}')"]`).classList.add('active');
}

// =========================================
// GESTION DES APPAREILS
// =========================================
function loadDevices() {
  const saved = JSON.parse(localStorage.getItem('devices') || '[]');
  devices = saved;
  updateDeviceList();
}

function saveDevices() {
  localStorage.setItem('devices', JSON.stringify(devices));
  updateDeviceList();
}

function updateDeviceList() {
  const list = document.getElementById('devicesList');
  list.innerHTML = '';
  if(devices.length === 0){
    list.innerHTML = '<p style="opacity:0.6;text-align:center;">Aucun appareil ajouté</p>';
    return;
  }
  devices.forEach((d, i) => {
    const div = document.createElement('div');
    div.className = 'device-item';
    div.innerHTML = `<strong>${d.nom}</strong> (${d.type}) - ${d.ip} <button onclick="removeDevice(${i})">Supprimer</button>`;
    list.appendChild(div);
  });
}

function addDevice() {
  const nom = document.getElementById('newDeviceName').value.trim();
  const ip = document.getElementById('newDeviceIP').value.trim();
  const type = document.getElementById('newDeviceType').value;
  const location = document.getElementById('newDeviceLocation').value.trim();

  if(!nom || !ip) { alert('Nom et IP obligatoires'); return; }

  devices.push({ nom, ip, type, location });
  saveDevices();
  closeAddDeviceModal();
}

function removeDevice(index){
  if(confirm('Supprimer cet appareil ?')){
    devices.splice(index,1);
    saveDevices();
  }
}

// =========================================
// GESTION DES MODALS
// =========================================
function openAddDeviceModal(){ document.getElementById('addDeviceModal').style.display = 'flex'; }
function closeAddDeviceModal(){ document.getElementById('addDeviceModal').style.display = 'none'; }

function openAddCameraModal(){ document.getElementById('addCameraModal').style.display = 'flex'; }
function closeAddCameraModal(){ document.getElementById('addCameraModal').style.display = 'none'; }

function openCameraFullscreen(name, url){
  document.getElementById('cameraFullscreenModal').style.display = 'flex';
  document.getElementById('fullscreen-camera-name').innerText = name;
  document.getElementById('fullscreen-camera-img').src = url;
}

function closeCameraFullscreen(){
  document.getElementById('cameraFullscreenModal').style.display = 'none';
}

// =========================================
// GESTION DES CAMERAS
// =========================================
function addSecurityCamera(){
  const name = document.getElementById('newCameraName').value.trim();
  const ip = document.getElementById('newCameraIP').value.trim();
  const location = document.getElementById('newCameraLocation').value.trim();

  if(!name || !ip){ alert('Nom et IP obligatoires'); return; }

  cameras.push({ name, ip, location });
  updateCameraGrid();
  closeAddCameraModal();
}

function updateCameraGrid(){
  const grid = document.getElementById('security-cameras-grid');
  grid.innerHTML = '';
  if(cameras.length === 0){
    grid.innerHTML = '<div style="text-align:center;opacity:0.6;padding:40px;">Aucune caméra configurée.</div>';
    return;
  }
  cameras.forEach(cam => {
    const div = document.createElement('div');
    div.className = 'camera-card';
    div.innerHTML = `<div>${cam.name}</div><img src="http://${cam.ip}/capture" onclick="openCameraFullscreen('${cam.name}','http://${cam.ip}/capture')" style="width:100%;cursor:pointer;border-radius:5px;">`;
    grid.appendChild(div);
  });
}

function refreshAllCameras(){
  cameras.forEach(cam => {
    const img = document.querySelector(`#security-cameras-grid img[src*="${cam.ip}"]`);
    if(img){ img.src = `http://${cam.ip}/capture?time=${Date.now()}`; }
  });
}

function captureAllCameras(){
  cameras.forEach(cam => {
    const url = `http://${cam.ip}/capture`;
    const gallery = document.getElementById('security-captures-gallery');
    const img = document.createElement('img');
    img.src = url + '?time=' + Date.now();
    img.style.width = '150px';
    img.style.margin = '5px';
    gallery.appendChild(img);
  });
}

function clearSecurityCaptures(){
  document.getElementById('security-captures-gallery').innerHTML = '<div style="text-align:center;opacity:0.6;padding:20px;">Aucune capture</div>';
}

// =========================================
// GESTION AGRICULTURE
// =========================================
function loadAgricultureData(){
  fetch(PROXY + encodeURIComponent(AGRICULTURE_CSV_URL))
    .then(r => r.text())
    .then(csv => parseAgricultureCSV(csv))
    .catch(err => console.error('Erreur CSV Agriculture:', err));
}

function parseAgricultureCSV(csv){
  const lines = csv.split('\n');
  const tbody = document.getElementById('dataTable');
  tbody.innerHTML = '';
  lines.forEach((line,i)=>{
    if(i===0) return; // skip header
    const cols = line.split(',');
    if(cols.length<5) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${cols[0]}</td><td>${cols[1]}</td><td>${cols[2]}</td><td>${cols[3]}</td><td>${cols[4]}</td>`;
    tbody.appendChild(tr);
  });
}

// =========================================
// GESTION SECURITE
// =========================================
function loadSecurityData(){
  fetch(PROXY + encodeURIComponent(SECURITY_CSV_URL))
    .then(r => r.text())
    .then(csv => parseSecurityCSV(csv))
    .catch(err => console.error('Erreur CSV Sécurité:', err));
}

function parseSecurityCSV(csv){
  const lines = csv.split('\n');
  const tbody = document.getElementById('securityTable');
  tbody.innerHTML = '';
  lines.forEach((line,i)=>{
    if(i===0) return; // skip header
    const cols = line.split(',');
    if(cols.length<6) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${cols[0]}</td><td>${cols[1]}</td><td>${cols[2]}</td><td>${cols[3]}</td><td>${cols[4]}</td><td>${cols[5]}</td>`;
    tbody.appendChild(tr);
  });
}

// =========================================
// CHARTS
// =========================================
function initCharts(){
  const ctx1 = document.getElementById('climateChart').getContext('2d');
  climateChart = new Chart(ctx1, {
    type:'line',
    data:{
      labels:[],
      datasets:[
        { label:'Température', data:[], borderColor:'#ff6384', fill:false },
        { label:'Humidité', data:[], borderColor:'#36a2eb', fill:false }
      ]
    },
    options:{ responsive:true, maintainAspectRatio:false }
  });

  const ctx2 = document.getElementById('airChart').getContext('2d');
  airChart = new Chart(ctx2,{
    type:'line',
    data:{
      labels:[],
      datasets:[
        { label:'CO2', data:[], borderColor:'#ff9f40', fill:false },
        { label:'DC', data:[], borderColor:'#4bc0c0', fill:false }
      ]
    },
    options:{ responsive:true, maintainAspectRatio:false }
  });
}

// =========================================
// GESTION DES APPAREILS AGRI/SEC
// =========================================
function toggleDevice(module, device){
  const statusId = device+'Status';
  const elem = document.getElementById(statusId);
  if(!elem) return;

  const current = elem.innerText.toLowerCase();
  if(current==='arrêté' || current==='éteintes' || current==='fermée' || current==='désactivée'){
    elem.innerText = 'Activé';
  }else{
    elem.innerText = module==='agriculture' ? 'Arrêté' : 'Désactivée';
  }
}

// =========================================
// MODE AUTOMATIQUE / MANUEL
// =========================================
function setMode(mode){
  document.getElementById('modeDisplay').innerText = mode.toUpperCase();
}

function emergencyStop(){
  if(confirm('Arrêt d’urgence de tous les appareils ?')){
    document.querySelectorAll('.device-card small').forEach(s=>{
      s.innerText = 'Arrêté';
    });
  }
}

// =========================================
// SLIDERS
// =========================================
function updateSlider(id,value,unit){
  document.getElementById(id+'Val').innerText = value+unit;
}

function saveSettings(){
  alert('Paramètres enregistrés !');
}
