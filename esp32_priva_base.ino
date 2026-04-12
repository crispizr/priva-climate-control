// ============================================================
// PRIVA Platform — Firmware universel ESP32-CAM
// Version : 2.0 — Base avec détection automatique de pins
//
// Endpoints disponibles :
//   GET  /           → Interface web embarquée
//   GET  /scan       → Scan automatique des pins (JSON)
//   GET  /status     → État capteurs + actionneurs (JSON)
//   GET  /capture    → Photo JPEG
//   GET  /stream     → Flux MJPEG
//   POST /control    → Contrôler un actionneur
//   POST /mode       → Changer le mode (auto/manuel)
//   POST /flash      → Contrôler le flash LED
//   POST /settings   → Sauvegarder les seuils
//   GET  /emergency  → Arrêt d'urgence
// ============================================================

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <EEPROM.h>
#include "esp_camera.h"

// ── WiFi ────────────────────────────────────────────────────
const char* WIFI_SSID     = "VOTRE_SSID";
const char* WIFI_PASSWORD = "VOTRE_MOT_DE_PASSE";

// ── Serveur HTTP ─────────────────────────────────────────────
WebServer server(81);

// ── EEPROM ───────────────────────────────────────────────────
#define EEPROM_SIZE 64
#define ADDR_PIN_CONFIG 0   // Début de la zone config pins

// ── Config caméra AI-Thinker ─────────────────────────────────
#define CAM_PIN_PWDN    32
#define CAM_PIN_RESET   -1
#define CAM_PIN_XCLK     0
#define CAM_PIN_SIOD    26
#define CAM_PIN_SIOC    27
#define CAM_PIN_D7      35
#define CAM_PIN_D6      34
#define CAM_PIN_D5      39
#define CAM_PIN_D4      38
#define CAM_PIN_D3      37
#define CAM_PIN_D2      36
#define CAM_PIN_D1      21
#define CAM_PIN_D0      19
#define CAM_PIN_VSYNC   25
#define CAM_PIN_HREF    23
#define CAM_PIN_PCLK    22
#define CAM_LED_FLASH    4

// ── Pins utilisés par la caméra (ne jamais scanner) ──────────
const int CAMERA_PINS[] = {
  CAM_PIN_PWDN, CAM_PIN_XCLK, CAM_PIN_SIOD, CAM_PIN_SIOC,
  CAM_PIN_D7, CAM_PIN_D6, CAM_PIN_D5, CAM_PIN_D4,
  CAM_PIN_D3, CAM_PIN_D2, CAM_PIN_D1, CAM_PIN_D0,
  CAM_PIN_VSYNC, CAM_PIN_HREF, CAM_PIN_PCLK, CAM_LED_FLASH
};
const int CAMERA_PINS_COUNT = sizeof(CAMERA_PINS) / sizeof(CAMERA_PINS[0]);

// ── Pins GPIO disponibles sur ESP32-CAM ──────────────────────
// Pins sûrs à utiliser sans conflit avec la caméra
const int AVAILABLE_PINS[] = {12, 13, 14, 15, 16, 17};
const int AVAILABLE_PINS_COUNT = sizeof(AVAILABLE_PINS) / sizeof(AVAILABLE_PINS[0]);

// ── Structure d'un résultat de scan ─────────────────────────
struct PinScanResult {
  int    gpio;
  String signalType;   // "digital_high", "digital_low", "analog", "pwm", "none"
  String suggested;    // Composant suggéré
  int    confidence;   // 0-100%
  bool   hasSignal;
};

// ── Structure de configuration d'un pin ─────────────────────
struct PinConfig {
  int    gpio;
  String role;         // "temperature", "humidity", "door", "alarm", etc.
  String mode;         // "INPUT", "OUTPUT", "INPUT_PULLUP"
  String logic;        // "HIGH_active", "LOW_active", ""
  bool   configured;
};

// ── État global ──────────────────────────────────────────────
struct SystemState {
  float temperature  = 0.0;
  float humidity     = 0.0;
  int   gas          = 0;
  float voltage      = 0.0;
  bool  doorOpen     = false;
  bool  motionDetected = false;
  String lastBadge   = "";
  unsigned long lastAccess = 0;
  String operatingMode = "auto";

  // Actionneurs — état ON/OFF
  bool pompe         = false;
  bool brumisateur   = false;
  bool ventilateur   = false;
  bool chauffage     = false;
  bool eclairage     = false;
  bool electrovanne  = false;
  bool lock          = false;
  bool alarm         = false;
  bool lights        = false;
} systemState;

// ── Seuils configurables ─────────────────────────────────────
struct Thresholds {
  float tempMin   = 18.0;
  float tempMax   = 28.0;
  float humidMin  = 50.0;
  float humidMax  = 80.0;
} thresholds;

// ── Configs pins actifs ──────────────────────────────────────
PinConfig activePins[10];
int activePinsCount = 0;

// ── Timers ───────────────────────────────────────────────────
unsigned long lastSensorRead    = 0;
unsigned long lastAutoControl   = 0;
const long SENSOR_INTERVAL      = 3000;
const long AUTO_CONTROL_INTERVAL = 5000;

// ============================================================
// HELPERS CORS
// ============================================================
void addCORSHeaders() {
  server.sendHeader("Access-Control-Allow-Origin",  "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers",
    "Content-Type, ngrok-skip-browser-warning, Authorization");
  server.sendHeader("Access-Control-Max-Age",       "86400");
}

void handleOptions() {
  addCORSHeaders();
  server.send(204, "text/plain", "");
}

bool isCameraPin(int gpio) {
  for (int i = 0; i < CAMERA_PINS_COUNT; i++) {
    if (CAMERA_PINS[i] == gpio) return true;
  }
  return false;
}

// ============================================================
// SCAN AUTOMATIQUE DES PINS
// Lit chaque GPIO disponible et infère le type de composant
// ============================================================
PinScanResult scanPin(int gpio) {
  PinScanResult result;
  result.gpio       = gpio;
  result.hasSignal  = false;
  result.confidence = 0;

  // Échantillonnage : lire plusieurs fois pour fiabilité
  const int SAMPLES = 10;
  int digitalReadings = 0;
  int analogSum = 0;

  // Tester en INPUT d'abord
  pinMode(gpio, INPUT);
  delayMicroseconds(100);

  for (int i = 0; i < SAMPLES; i++) {
    digitalReadings += digitalRead(gpio);
    if (gpio >= 34) {
      // Pins ADC uniquement sur GPIO 34, 35, 36, 39
      analogSum += analogRead(gpio);
    }
    delayMicroseconds(50);
  }

  float digitalAvg = (float)digitalReadings / SAMPLES;
  float analogAvg  = (float)analogSum / SAMPLES;

  // ── Analyse du signal ────────────────────────────────────
  if (gpio >= 34) {
    // Pin ADC — peut lire analogique
    if (analogAvg > 4000) {
      result.signalType  = "analog_high";
      result.hasSignal   = true;
      result.suggested   = "Capteur analogique (LDR, FSR, MQ-x)";
      result.confidence  = 70;
    } else if (analogAvg > 100 && analogAvg < 3900) {
      result.signalType  = "analog_variable";
      result.hasSignal   = true;
      result.suggested   = "DHT22 / Capteur température-humidité";
      result.confidence  = 88;
    } else {
      result.signalType  = "analog_low";
      result.hasSignal   = false;
      result.suggested   = "Non câblé";
      result.confidence  = 90;
    }
  } else {
    // Pin digital
    // Tester avec pull-up interne
    pinMode(gpio, INPUT_PULLUP);
    delayMicroseconds(200);
    bool withPullup = digitalRead(gpio);

    // Tester sans pull-up
    pinMode(gpio, INPUT);
    delayMicroseconds(200);
    bool withoutPullup = digitalRead(gpio);

    if (!withPullup && withoutPullup) {
      // Pin passe HIGH sans pull-up → signal actif
      result.signalType  = "digital_high";
      result.hasSignal   = true;
      result.suggested   = "Relais / Buzzer / LED (sortie)";
      result.confidence  = 82;
    } else if (!withPullup && !withoutPullup) {
      // Pin reste LOW même sans pull-up → composant tire à GND
      result.signalType  = "digital_low";
      result.hasSignal   = true;
      result.suggested   = "Reed switch / Bouton (avec pull-up)";
      result.confidence  = 85;
    } else if (withPullup && withoutPullup) {
      // Toujours HIGH → flottant ou non connecté
      result.signalType  = "floating";
      result.hasSignal   = false;
      result.suggested   = "Non câblé (pin flottant)";
      result.confidence  = 75;
    } else {
      // Pull-up tire à HIGH, sans pull-up → LOW = composant passif
      result.signalType  = "passive";
      result.hasSignal   = true;
      result.suggested   = "Capteur passif (thermistance, LDR)";
      result.confidence  = 65;
    }
  }

  // Remettre en INPUT neutre
  pinMode(gpio, INPUT);
  return result;
}

// ============================================================
// ENDPOINT : GET /scan
// Retourne JSON avec tous les pins scannés
// ============================================================
void handleScan() {
  addCORSHeaders();

  StaticJsonDocument<2048> doc;
  JsonArray pins = doc.createNestedArray("pins");

  // Scanner uniquement les pins disponibles (hors caméra)
  for (int i = 0; i < AVAILABLE_PINS_COUNT; i++) {
    int gpio = AVAILABLE_PINS[i];

    // Vérification sécurité supplémentaire
    if (isCameraPin(gpio)) continue;

    PinScanResult result = scanPin(gpio);

    JsonObject pinObj = pins.createNestedObject();
    pinObj["gpio"]        = result.gpio;
    pinObj["signalType"]  = result.signalType;
    pinObj["suggested"]   = result.suggested;
    pinObj["confidence"]  = result.confidence;
    pinObj["hasSignal"]   = result.hasSignal;
  }

  // Infos sur l'ESP32
  JsonObject info = doc.createNestedObject("esp32");
  info["model"]     = "ESP32-CAM AI-Thinker";
  info["freeHeap"]  = ESP.getFreeHeap();
  info["psramFound"] = psramFound();
  info["ipAddress"]  = WiFi.localIP().toString();

  doc["scannedAt"]    = millis();
  doc["totalPins"]    = AVAILABLE_PINS_COUNT;
  doc["activePins"]   = activePinsCount;

  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

// ============================================================
// ENDPOINT : GET /status
// État complet du système
// ============================================================
void handleStatus() {
  addCORSHeaders();

  StaticJsonDocument<1024> doc;
  doc["temperature"]      = systemState.temperature;
  doc["humidity"]         = systemState.humidity;
  doc["gas"]              = systemState.gas;
  doc["dc"]               = systemState.voltage;
  doc["doorOpen"]         = systemState.doorOpen;
  doc["motionDetected"]   = systemState.motionDetected;
  doc["lastBadge"]        = systemState.lastBadge;
  doc["lastAccess"]       = systemState.lastAccess;
  doc["mode"]             = systemState.operatingMode;
  doc["uptime"]           = millis() / 1000;
  doc["freeHeap"]         = ESP.getFreeHeap();
  doc["wifiRSSI"]         = WiFi.RSSI();

  // Actionneurs
  JsonObject devices = doc.createNestedObject("devices");
  devices["pompe"]        = systemState.pompe;
  devices["brumisateur"]  = systemState.brumisateur;
  devices["ventilateur"]  = systemState.ventilateur;
  devices["chauffage"]    = systemState.chauffage;
  devices["eclairage"]    = systemState.eclairage;
  devices["electrovanne"] = systemState.electrovanne;
  devices["lock"]         = systemState.lock;
  devices["alarm"]        = systemState.alarm;
  devices["lights"]       = systemState.lights;

  // Seuils actifs
  JsonObject thresh = doc.createNestedObject("thresholds");
  thresh["tempMin"]       = thresholds.tempMin;
  thresh["tempMax"]       = thresholds.tempMax;
  thresh["humidMin"]      = thresholds.humidMin;
  thresh["humidMax"]      = thresholds.humidMax;

  // Pins configurés
  JsonArray pinsArr = doc.createNestedArray("activePins");
  for (int i = 0; i < activePinsCount; i++) {
    JsonObject p = pinsArr.createNestedObject();
    p["gpio"]        = activePins[i].gpio;
    p["role"]        = activePins[i].role;
    p["mode"]        = activePins[i].mode;
    p["configured"]  = activePins[i].configured;
  }

  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

// ============================================================
// ENDPOINT : POST /control
// Contrôler un actionneur
// body: device=pompe&state=1
// ============================================================
void handleControl() {
  addCORSHeaders();

  if (!server.hasArg("device") || !server.hasArg("state")) {
    server.send(400, "application/json", "{\"error\":\"device et state requis\"}");
    return;
  }

  String device = server.arg("device");
  bool   state  = server.arg("state") == "1";

  // Trouver le pin configuré pour cet actionneur
  int targetPin = -1;
  for (int i = 0; i < activePinsCount; i++) {
    if (activePins[i].role == device && activePins[i].configured) {
      targetPin = activePins[i].gpio;
      break;
    }
  }

  // Appliquer l'état
  bool applied = true;
  if      (device == "pompe")        { systemState.pompe        = state; }
  else if (device == "brumisateur")  { systemState.brumisateur  = state; }
  else if (device == "ventilateur")  { systemState.ventilateur  = state; }
  else if (device == "chauffage")    { systemState.chauffage    = state; }
  else if (device == "eclairage")    { systemState.eclairage    = state; }
  else if (device == "electrovanne") { systemState.electrovanne = state; }
  else if (device == "lock")         { systemState.lock         = state; }
  else if (device == "alarm")        { systemState.alarm        = state; }
  else if (device == "lights")       { systemState.lights       = state; }
  else                               { applied = false; }

  // Écriture physique sur le pin si configuré
  if (applied && targetPin >= 0 && !isCameraPin(targetPin)) {
    digitalWrite(targetPin, state ? HIGH : LOW);
  }

  if (applied) {
    String resp = "{\"status\":\"ok\",\"device\":\"" + device +
                  "\",\"state\":" + (state ? "true" : "false") + "}";
    server.send(200, "application/json", resp);
  } else {
    server.send(400, "application/json", "{\"error\":\"Actionneur inconnu\"}");
  }
}

// ============================================================
// ENDPOINT : POST /pins/save
// Sauvegarder la config pins reçue de PRIVA
// body: JSON array de PinConfig
// ============================================================
void handlePinsSave() {
  addCORSHeaders();

  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"error\":\"Body JSON manquant\"}");
    return;
  }

  String body = server.arg("plain");
  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    server.send(400, "application/json", "{\"error\":\"JSON invalide\"}");
    return;
  }

  // Réinitialiser les pins actifs
  activePinsCount = 0;
  JsonArray pinsArray = doc.as<JsonArray>();

  for (JsonObject p : pinsArray) {
    if (activePinsCount >= 10) break;
    int gpio = p["gpio"] | -1;
    if (gpio < 0 || isCameraPin(gpio)) continue;

    activePins[activePinsCount].gpio        = gpio;
    activePins[activePinsCount].role        = p["role"].as<String>();
    activePins[activePinsCount].mode        = p["mode"].as<String>();
    activePins[activePinsCount].logic       = p["logic"].as<String>();
    activePins[activePinsCount].configured  = true;

    // Appliquer le pinMode physique
    String mode = activePins[activePinsCount].mode;
    if      (mode == "OUTPUT")       pinMode(gpio, OUTPUT);
    else if (mode == "INPUT_PULLUP") pinMode(gpio, INPUT_PULLUP);
    else                             pinMode(gpio, INPUT);

    activePinsCount++;
  }

  // Sauvegarder en EEPROM (marqueur de version + count)
  EEPROM.write(ADDR_PIN_CONFIG, 0xAB);       // Marqueur valide
  EEPROM.write(ADDR_PIN_CONFIG + 1, activePinsCount);
  EEPROM.commit();

  String resp = "{\"status\":\"ok\",\"saved\":" +
                String(activePinsCount) + "}";
  server.send(200, "application/json", resp);
}

// ============================================================
// ENDPOINT : POST /mode
// ============================================================
void handleMode() {
  addCORSHeaders();
  if (server.hasArg("mode")) {
    systemState.operatingMode = server.arg("mode");
    server.send(200, "application/json", "{\"status\":\"ok\"}");
  } else {
    server.send(400, "application/json", "{\"error\":\"mode requis\"}");
  }
}

// ============================================================
// ENDPOINT : POST /settings
// Sauvegarder les seuils
// ============================================================
void handleSettings() {
  addCORSHeaders();
  if (server.hasArg("tempMin"))   thresholds.tempMin  = server.arg("tempMin").toFloat();
  if (server.hasArg("tempMax"))   thresholds.tempMax  = server.arg("tempMax").toFloat();
  if (server.hasArg("humidMin"))  thresholds.humidMin = server.arg("humidMin").toFloat();
  if (server.hasArg("humidMax"))  thresholds.humidMax = server.arg("humidMax").toFloat();
  server.send(200, "application/json", "{\"status\":\"ok\"}");
}

// ============================================================
// ENDPOINT : POST /flash
// ============================================================
void handleFlash() {
  addCORSHeaders();
  bool state = server.hasArg("state") && server.arg("state") == "1";
  pinMode(CAM_LED_FLASH, OUTPUT);
  digitalWrite(CAM_LED_FLASH, state ? HIGH : LOW);
  server.send(200, "application/json", "{\"status\":\"ok\"}");
}

// ============================================================
// ENDPOINT : GET /emergency — Arrêt d'urgence
// ============================================================
void handleEmergency() {
  addCORSHeaders();
  systemState.pompe = systemState.brumisateur = systemState.ventilateur = false;
  systemState.chauffage = systemState.eclairage = systemState.electrovanne = false;

  // Tout couper physiquement
  for (int i = 0; i < activePinsCount; i++) {
    if (activePins[i].mode == "OUTPUT" && !isCameraPin(activePins[i].gpio)) {
      digitalWrite(activePins[i].gpio, LOW);
    }
  }
  server.send(200, "application/json", "{\"status\":\"emergency_stop\"}");
}

// ============================================================
// ENDPOINT : GET /capture — Photo JPEG
// ============================================================
void handleCapture() {
  addCORSHeaders();

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    server.send(503, "application/json", "{\"error\":\"Capture échouée\"}");
    return;
  }

  server.sendHeader("Content-Disposition", "inline; filename=capture.jpg");
  server.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// ============================================================
// ENDPOINT : GET /stream — Flux MJPEG
// ============================================================
void handleStream() {
  addCORSHeaders();
  WiFiClient client = server.client();

  client.println("HTTP/1.1 200 OK");
  client.println("Content-Type: multipart/x-mixed-replace; boundary=frame");
  client.println("Access-Control-Allow-Origin: *");
  client.println();

  while (client.connected()) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) { delay(100); continue; }

    client.printf("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n",
                  fb->len);
    client.write(fb->buf, fb->len);
    client.println();

    esp_camera_fb_return(fb);
    delay(50); // ~20 FPS max
  }
}

// ============================================================
// ENDPOINT : GET / — Interface web embarquée
// ============================================================
void handleRoot() {
  addCORSHeaders();
  String html = R"rawHTML(
<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP32 PRIVA</title>
<style>
  body{background:#0f1117;color:#d5d5ee;font-family:monospace;padding:20px;max-width:500px;margin:0 auto}
  h1{color:#667eea;font-size:18px}
  .card{background:#161929;border:1px solid #2d3142;border-radius:8px;padding:15px;margin:10px 0}
  .metric{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e2240}
  .metric:last-child{border-bottom:none}
  .val{color:#00a651;font-weight:bold}
  .btn{background:#667eea;color:white;border:none;padding:8px 16px;border-radius:5px;cursor:pointer;margin:4px}
  a{color:#667eea}
</style></head><body>
<h1>ESP32-CAM PRIVA v2.0</h1>
<div class="card">
  <div class="metric"><span>Adresse IP</span><span class="val">)rawHTML" +
    WiFi.localIP().toString() +
    R"rawHTML(</span></div>
  <div class="metric"><span>Mémoire libre</span><span class="val">)rawHTML" +
    String(ESP.getFreeHeap()) +
    R"rawHTML( octets</span></div>
  <div class="metric"><span>PSRAM</span><span class="val">)rawHTML" +
    String(psramFound() ? "Disponible" : "Absent") +
    R"rawHTML(</span></div>
</div>
<div class="card">
  <div style="margin-bottom:10px;color:#667eea;font-weight:bold">Endpoints</div>
  <div class="metric"><span>📡 Scan pins</span><a href="/scan">/scan</a></div>
  <div class="metric"><span>📊 Status</span><a href="/status">/status</a></div>
  <div class="metric"><span>📸 Capture</span><a href="/capture">/capture</a></div>
  <div class="metric"><span>🎥 Stream</span><a href="/stream">/stream</a></div>
</div>
<div class="card">
  <button class="btn" onclick="fetch('/flash',{method:'POST',body:'state=1'})">Flash ON</button>
  <button class="btn" onclick="fetch('/flash',{method:'POST',body:'state=0'})">Flash OFF</button>
  <button class="btn" onclick="fetch('/emergency')">Arrêt urgence</button>
</div>
</body></html>
  )rawHTML";
  server.send(200, "text/html", html);
}

// ============================================================
// LECTURE DES CAPTEURS
// Lit les pins configurés et met à jour systemState
// ============================================================
void readSensors() {
  for (int i = 0; i < activePinsCount; i++) {
    int gpio       = activePins[i].gpio;
    String role    = activePins[i].role;
    String mode    = activePins[i].mode;
    String logic   = activePins[i].logic;
    bool activeLow = logic == "LOW_active" || logic == "LOW=open";

    if (isCameraPin(gpio)) continue;

    // ── Capteurs analogiques ──────────────────────────────
    if (role == "gas" || role == "voltage") {
      if (gpio >= 34) {
        int raw = analogRead(gpio);
        float volts = raw * (3.3f / 4095.0f);
        if (role == "gas")     systemState.gas     = map(raw, 0, 4095, 0, 1000);
        if (role == "voltage") systemState.voltage = volts * 5.0f; // Diviseur de tension x5
      }
    }
    // ── Capteurs digitaux ────────────────────────────────
    else if (role == "door") {
      bool raw = digitalRead(gpio);
      systemState.doorOpen = activeLow ? !raw : raw;
    }
    else if (role == "motion") {
      bool raw = digitalRead(gpio);
      systemState.motionDetected = activeLow ? !raw : raw;
    }
    // ── DHT22 simulé (placeholder) ───────────────────────
    // En production : utiliser la lib DHT pour gpio == dht_pin
    else if (role == "temperature") {
      // Placeholder — remplacé par le firmware généré
      systemState.temperature = 25.0f + random(-30, 50) / 10.0f;
    }
    else if (role == "humidity") {
      // Placeholder — remplacé par le firmware généré
      systemState.humidity = 60.0f + random(-100, 150) / 10.0f;
    }
  }
}

// ============================================================
// MODE AUTO — Logique de contrôle automatique
// ============================================================
void runAutoControl() {
  if (systemState.operatingMode != "auto") return;

  // Régulation température
  if (systemState.temperature > thresholds.tempMax) {
    systemState.ventilateur = true;
    systemState.chauffage   = false;
  } else if (systemState.temperature < thresholds.tempMin) {
    systemState.chauffage   = true;
    systemState.ventilateur = false;
  } else {
    systemState.ventilateur = false;
    systemState.chauffage   = false;
  }

  // Régulation humidité
  if (systemState.humidity < thresholds.humidMin) {
    systemState.brumisateur = true;
  } else if (systemState.humidity > thresholds.humidMax) {
    systemState.brumisateur = false;
  }

  // Appliquer les états aux pins physiques
  for (int i = 0; i < activePinsCount; i++) {
    if (activePins[i].mode != "OUTPUT") continue;
    int gpio    = activePins[i].gpio;
    String role = activePins[i].role;
    if (isCameraPin(gpio)) continue;

    bool state = false;
    if      (role == "ventilateur")  state = systemState.ventilateur;
    else if (role == "chauffage")    state = systemState.chauffage;
    else if (role == "brumisateur")  state = systemState.brumisateur;
    else if (role == "pompe")        state = systemState.pompe;
    else if (role == "eclairage")    state = systemState.eclairage;
    else if (role == "electrovanne") state = systemState.electrovanne;

    digitalWrite(gpio, state ? HIGH : LOW);
  }
}

// ============================================================
// INIT CAMÉRA
// ============================================================
bool initCamera() {
  camera_config_t config;
  config.ledc_channel  = LEDC_CHANNEL_0;
  config.ledc_timer    = LEDC_TIMER_0;
  config.pin_d0        = CAM_PIN_D0;
  config.pin_d1        = CAM_PIN_D1;
  config.pin_d2        = CAM_PIN_D2;
  config.pin_d3        = CAM_PIN_D3;
  config.pin_d4        = CAM_PIN_D4;
  config.pin_d5        = CAM_PIN_D5;
  config.pin_d6        = CAM_PIN_D6;
  config.pin_d7        = CAM_PIN_D7;
  config.pin_xclk      = CAM_PIN_XCLK;
  config.pin_pclk      = CAM_PIN_PCLK;
  config.pin_vsync     = CAM_PIN_VSYNC;
  config.pin_href      = CAM_PIN_HREF;
  config.pin_sccb_sda  = CAM_PIN_SIOD;
  config.pin_sccb_scl  = CAM_PIN_SIOC;
  config.pin_pwdn      = CAM_PIN_PWDN;
  config.pin_reset     = CAM_PIN_RESET;
  config.xclk_freq_hz  = 20000000;
  config.pixel_format  = PIXFORMAT_JPEG;

  if (psramFound()) {
    config.frame_size    = FRAMESIZE_VGA;
    config.jpeg_quality  = 12;
    config.fb_count      = 2;
  } else {
    config.frame_size    = FRAMESIZE_QVGA;
    config.jpeg_quality  = 20;
    config.fb_count      = 1;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAMERA] Erreur init : 0x%x\n", err);
    return false;
  }
  Serial.println("[CAMERA] OK");
  return true;
}

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  Serial.println("\n[PRIVA] Démarrage firmware v2.0...");

  // EEPROM
  EEPROM.begin(EEPROM_SIZE);

  // WiFi
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] Connexion");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500); Serial.print("."); attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connecté — IP : %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WIFI] Échec — mode AP non implémenté");
  }

  // Caméra
  initCamera();

  // Routage HTTP
  server.on("/",            HTTP_GET,     handleRoot);
  server.on("/scan",        HTTP_GET,     handleScan);
  server.on("/status",      HTTP_GET,     handleStatus);
  server.on("/capture",     HTTP_GET,     handleCapture);
  server.on("/stream",      HTTP_GET,     handleStream);
  server.on("/control",     HTTP_POST,    handleControl);
  server.on("/mode",        HTTP_POST,    handleMode);
  server.on("/flash",       HTTP_POST,    handleFlash);
  server.on("/settings",    HTTP_POST,    handleSettings);
  server.on("/emergency",   HTTP_GET,     handleEmergency);
  server.on("/pins/save",   HTTP_POST,    handlePinsSave);

  // OPTIONS preflight CORS
  server.on("/scan",      HTTP_OPTIONS, handleOptions);
  server.on("/status",    HTTP_OPTIONS, handleOptions);
  server.on("/capture",   HTTP_OPTIONS, handleOptions);
  server.on("/control",   HTTP_OPTIONS, handleOptions);
  server.on("/mode",      HTTP_OPTIONS, handleOptions);
  server.on("/flash",     HTTP_OPTIONS, handleOptions);
  server.on("/settings",  HTTP_OPTIONS, handleOptions);
  server.on("/emergency", HTTP_OPTIONS, handleOptions);
  server.on("/pins/save", HTTP_OPTIONS, handleOptions);

  server.begin();
  Serial.println("[HTTP] Serveur démarré sur port 81");
  Serial.println("[PRIVA] Prêt — accédez à http://" + WiFi.localIP().toString());
}

// ============================================================
// LOOP
// ============================================================
void loop() {
  server.handleClient();

  unsigned long now = millis();

  // Lecture capteurs toutes les 3s
  if (now - lastSensorRead >= SENSOR_INTERVAL) {
    lastSensorRead = now;
    readSensors();
  }

  // Contrôle auto toutes les 5s
  if (now - lastAutoControl >= AUTO_CONTROL_INTERVAL) {
    lastAutoControl = now;
    if (systemState.operatingMode == "auto") {
      runAutoControl();
    }
  }
}
