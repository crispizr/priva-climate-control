// ============================================================
// PRIVA — firmware-generator.js  v3.0
// Bibliothèque complète de 58 blocs physiques
// Génération automatique de firmware .ino
// ============================================================

// ════════════════════════════════════════════════════════════
//  BIBLIOTHÈQUE DE BLOCS PHYSIQUES
//  Chaque bloc = un composant réel qu'on peut acheter
// ════════════════════════════════════════════════════════════
const BLOCK_LIBRARY = {

  // ── MICROCONTRÔLEURS ─────────────────────────────────────
  ESP32CAM: {
    id: 'ESP32CAM', name: 'ESP32-CAM', family: 'mcu',
    icon: '📷',
    ref: 'AI-Thinker', protocol: 'WIFI',
    provides: ['wifi','camera','gpio','stream','capture'],
    requires: [], libs: ['ESP32Camera','WebServer','ArduinoJson'],
    domains: ['all'],
    include: '#include "esp_camera.h"\n#include <WebServer.h>\n#include <ArduinoJson.h>',
    setupCode: () => `  initCamera(); // ESP32-CAM OV2640`,
    readCode:  () => '',
    conflicts: [], shared: false,
    pinType: 'BUILTIN',
    notes: 'Microcontrôleur principal — expose /capture /stream /scan /status',
  },

  ESP32WROOM: {
    id: 'ESP32WROOM', name: 'ESP32 WROOM-32', family: 'mcu',
    icon: '⚡',
    ref: 'WROOM-32', protocol: 'WIFI',
    provides: ['wifi','gpio','ble'],
    requires: [], libs: ['WebServer','ArduinoJson'],
    domains: ['all'],
    include: '#include <WebServer.h>\n#include <ArduinoJson.h>',
    setupCode: () => '',
    readCode:  () => '',
    conflicts: [], shared: false, pinType: 'BUILTIN',
  },

  ESP8266: {
    id: 'ESP8266', name: 'ESP8266 NodeMCU', family: 'mcu',
    icon: '📡',
    ref: 'NodeMCU v3', protocol: 'WIFI',
    provides: ['wifi','gpio'],
    requires: [], libs: ['ESP8266WebServer','ArduinoJson'],
    domains: ['all'],
    include: '#include <ESP8266WebServer.h>\n#include <ArduinoJson.h>',
    setupCode: () => '',
    readCode:  () => '',
    conflicts: ['ESP32CAM','ESP32WROOM'], shared: false, pinType: 'BUILTIN',
  },

  ARDUINO_NANO: {
    id: 'ARDUINO_NANO', name: 'Arduino Nano', family: 'mcu',
    icon: '🔵',
    ref: 'ATmega328P', protocol: 'UART',
    provides: ['gpio','analog','uart'],
    requires: [], libs: [],
    domains: ['all'],
    include: '',
    setupCode: () => '  Serial.begin(9600); // Arduino Nano',
    readCode:  () => '',
    conflicts: ['ESP32CAM','ESP32WROOM'], shared: false, pinType: 'BUILTIN',
    notes: 'Utilisation comme esclave UART — envoie les données au ESP32 maître',
  },

  SIM7600: {
    id: 'SIM7600', name: 'Module 4G SIM7600', family: 'mcu',
    icon: '📶',
    ref: 'SIM7600E', protocol: 'UART',
    provides: ['4g','sms','gps','call'],
    requires: ['TX','RX'],
    libs: ['TinyGSM'],
    domains: ['all'],
    include: '#define TINY_GSM_MODEM_SIM7600\n#include <TinyGsmClient.h>',
    setupCode: (pins) =>
      `  SerialAT.begin(115200, SERIAL_8N1, ${pins.RX||16}, ${pins.TX||17});\n  modem.restart();`,
    readCode: () => '',
    conflicts: [], shared: false, pinType: 'UART',
  },

  // ── CAPTEURS TEMPÉRATURE / HUMIDITÉ ──────────────────────
  DHT22: {
    id: 'DHT22', name: 'DHT22', family: 'capteur',
    icon: '🌡️',
    ref: 'AM2302', protocol: 'DIGITAL_1WIRE',
    provides: ['temperature','humidity'],
    requires: ['DATA'],
    libs: ['DHT sensor library'],
    domains: ['agriculture','médical','éducation','industrie','environnement'],
    include: '#include <DHT.h>',
    setupCode: (pins) => `  dht_${pins.DATA}.begin(); // DHT22 GPIO ${pins.DATA}`,
    readCode:  (pins) => `
  // DHT22 GPIO ${pins.DATA}
  float _t = dht_${pins.DATA}.readTemperature();
  float _h = dht_${pins.DATA}.readHumidity();
  if (!isnan(_t)) sys.temperature = _t;
  if (!isnan(_h)) sys.humidity    = _h;`,
    declaration: (pins) => `DHT dht_${pins.DATA}(${pins.DATA}, DHT22);`,
    conflicts: [], shared: true, pinType: 'DIGITAL',
    provides_vars: { temperature: 'float', humidity: 'float' },
  },

  DS18B20: {
    id: 'DS18B20', name: 'DS18B20', family: 'capteur',
    icon: '🌡️',
    ref: '1-Wire étanche', protocol: 'ONEWIRE',
    provides: ['temperature_precise','water_temp'],
    requires: ['DATA'],
    libs: ['DallasTemperature','OneWire'],
    domains: ['agriculture','médical','industrie','environnement','énergie'],
    include: '#include <OneWire.h>\n#include <DallasTemperature.h>',
    setupCode: (pins) =>
      `  sensors_${pins.DATA}.begin(); // DS18B20 GPIO ${pins.DATA}`,
    readCode: (pins) => `
  // DS18B20 GPIO ${pins.DATA} (précis ±0.5°C)
  sensors_${pins.DATA}.requestTemperatures();
  sys.temperature = sensors_${pins.DATA}.getTempCByIndex(0);`,
    declaration: (pins) =>
      `OneWire ow_${pins.DATA}(${pins.DATA});\nDallasTemperature sensors_${pins.DATA}(&ow_${pins.DATA});`,
    conflicts: [], shared: false, pinType: 'DIGITAL',
    provides_vars: { temperature: 'float' },
  },

  BMP280: {
    id: 'BMP280', name: 'BMP280', family: 'capteur',
    icon: '🌤️',
    ref: 'I2C 0x76', protocol: 'I2C',
    provides: ['temperature','pressure','altitude'],
    requires: ['SDA','SCL'],
    libs: ['Adafruit BMP280 library'],
    domains: ['agriculture','environnement','météo','industrie'],
    include: '#include <Adafruit_BMP280.h>',
    setupCode: () => `  bmp.begin(0x76); // BMP280 I2C`,
    readCode:  () => `
  // BMP280
  sys.temperature = bmp.readTemperature();
  sys.pressure    = bmp.readPressure() / 100.0F;
  sys.altitude    = bmp.readAltitude(1013.25);`,
    declaration: () => `Adafruit_BMP280 bmp;`,
    conflicts: [], shared: false, pinType: 'I2C',
    provides_vars: { temperature: 'float', pressure: 'float', altitude: 'float' },
  },

  SHT31: {
    id: 'SHT31', name: 'SHT31', family: 'capteur',
    icon: '💧',
    ref: 'I2C haute précision', protocol: 'I2C',
    provides: ['temperature','humidity'],
    requires: ['SDA','SCL'],
    libs: ['Adafruit SHT31 library'],
    domains: ['médical','industrie','agriculture'],
    include: '#include <Adafruit_SHT31.h>',
    setupCode: () => `  sht31.begin(0x44); // SHT31 I2C`,
    readCode:  () => `
  // SHT31 (précision ±0.3°C, ±2% HR)
  sys.temperature = sht31.readTemperature();
  sys.humidity    = sht31.readHumidity();`,
    declaration: () => `Adafruit_SHT31 sht31;`,
    conflicts: [], shared: false, pinType: 'I2C',
    provides_vars: { temperature: 'float', humidity: 'float' },
  },

  // ── CAPTEURS SOL / EAU / AIR ─────────────────────────────
  SOIL_HUMIDITY: {
    id: 'SOIL_HUMIDITY', name: 'Hygromètre sol', family: 'capteur',
    icon: '🌱',
    ref: 'Capacitif v1.2', protocol: 'ANALOG',
    provides: ['soil_moisture'],
    requires: ['AOUT'],
    libs: [],
    domains: ['agriculture','jardinage'],
    include: '',
    setupCode: () => `  // Hygromètre sol — ADC`,
    readCode: (pins) => `
  // Humidité sol (GPIO ${pins.AOUT})
  int _rawSoil = analogRead(${pins.AOUT});
  sys.soilMoisture = map(_rawSoil, 4095, 1500, 0, 100);
  sys.soilMoisture = constrain(sys.soilMoisture, 0, 100);`,
    conflicts: [], shared: false, pinType: 'ANALOG',
    provides_vars: { soilMoisture: 'int' },
  },

  MQ135: {
    id: 'MQ135', name: 'MQ-135', family: 'capteur',
    icon: '💨',
    ref: 'Qualité air', protocol: 'ANALOG',
    provides: ['co2','air_quality'],
    requires: ['AOUT'],
    libs: [],
    domains: ['agriculture','éducation','industrie','santé'],
    include: '',
    setupCode: (pins) => `  // MQ-135 GPIO ${pins.AOUT} — laisser chauffer 24h avant calibration`,
    readCode: (pins) => `
  // MQ-135 CO2/Air (GPIO ${pins.AOUT})
  int _rawGas = analogRead(${pins.AOUT});
  sys.gas = map(_rawGas, 0, 4095, 400, 5000); // ppm estimé`,
    conflicts: [], shared: false, pinType: 'ANALOG',
    provides_vars: { gas: 'int' },
  },

  MQ2: {
    id: 'MQ2', name: 'MQ-2', family: 'capteur',
    icon: '🔥',
    ref: 'Gaz / Fumée', protocol: 'ANALOG',
    provides: ['smoke','gas_lpg','gas_co'],
    requires: ['AOUT','DOUT'],
    libs: [],
    domains: ['sécurité','industrie','cuisine'],
    include: '',
    setupCode: (pins) => `  pinMode(${pins.DOUT}, INPUT); // MQ-2 seuil digital`,
    readCode: (pins) => `
  // MQ-2 Fumée/Gaz (GPIO ${pins.AOUT})
  sys.gasRaw   = analogRead(${pins.AOUT});
  sys.smokeAlert = !digitalRead(${pins.DOUT}); // LOW = alerte`,
    conflicts: [], shared: false, pinType: 'ANALOG',
    provides_vars: { gasRaw: 'int', smokeAlert: 'bool' },
  },

  BH1750: {
    id: 'BH1750', name: 'BH1750', family: 'capteur',
    icon: '☀️',
    ref: 'Luminosité I2C', protocol: 'I2C',
    provides: ['light_lux'],
    requires: ['SDA','SCL'],
    libs: ['BH1750'],
    domains: ['agriculture','éducation','énergie','domotique'],
    include: '#include <BH1750.h>',
    setupCode: () => `  lightMeter.begin(); // BH1750 I2C`,
    readCode:  () => `
  // BH1750 luminosité
  sys.lightLux = lightMeter.readLightLevel();`,
    declaration: () => `BH1750 lightMeter;`,
    conflicts: [], shared: false, pinType: 'I2C',
    provides_vars: { lightLux: 'float' },
  },

  HCSR04: {
    id: 'HCSR04', name: 'HC-SR04', family: 'capteur',
    icon: '📏',
    ref: 'Ultrason', protocol: 'DIGITAL',
    provides: ['distance','water_level'],
    requires: ['TRIG','ECHO'],
    libs: [],
    domains: ['agriculture','industrie','eau','domotique'],
    include: '',
    setupCode: (pins) =>
      `  pinMode(${pins.TRIG}, OUTPUT);\n  pinMode(${pins.ECHO}, INPUT); // HC-SR04`,
    readCode: (pins) => `
  // HC-SR04 distance (TRIG:${pins.TRIG} ECHO:${pins.ECHO})
  digitalWrite(${pins.TRIG}, LOW); delayMicroseconds(2);
  digitalWrite(${pins.TRIG}, HIGH); delayMicroseconds(10);
  digitalWrite(${pins.TRIG}, LOW);
  long _dur = pulseIn(${pins.ECHO}, HIGH, 30000);
  sys.distance = _dur * 0.034 / 2.0; // cm`,
    conflicts: [], shared: false, pinType: 'DIGITAL',
    provides_vars: { distance: 'float' },
  },

  // ── CAPTEURS MÉDICAUX ────────────────────────────────────
  MAX30102: {
    id: 'MAX30102', name: 'MAX30102', family: 'capteur',
    icon: '💓',
    ref: 'SpO2 / BPM I2C', protocol: 'I2C',
    provides: ['spo2','heart_rate','bpm'],
    requires: ['SDA','SCL'],
    libs: ['MAX30105 library'],
    domains: ['médical','sport','santé'],
    include: '#include "MAX30105.h"\n#include "heartRate.h"',
    setupCode: () => `
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("[MAX30102] Erreur init");
  }
  particleSensor.setup();
  particleSensor.setPulseAmplitudeRed(0x0A);
  particleSensor.setPulseAmplitudeGreen(0);`,
    readCode: () => `
  // MAX30102 SpO2 + BPM
  long _ir = particleSensor.getIR();
  if (_ir > 50000) { // Doigt détecté
    sys.bpm  = (int)beatsPerMinute;
    sys.spo2 = (int)((float)_ir / 1000.0); // Simplifié
  }`,
    declaration: () => `MAX30105 particleSensor;\nfloat beatsPerMinute = 0;`,
    conflicts: [], shared: false, pinType: 'I2C',
    provides_vars: { bpm: 'int', spo2: 'int' },
  },

  MPU6050: {
    id: 'MPU6050', name: 'MPU-6050', family: 'capteur',
    icon: '🏃',
    ref: 'Accéléromètre I2C', protocol: 'I2C',
    provides: ['acceleration','gyroscope','fall_detection','tilt'],
    requires: ['SDA','SCL'],
    libs: ['Adafruit MPU6050'],
    domains: ['médical','sécurité','industrie','sport'],
    include: '#include <Adafruit_MPU6050.h>\n#include <Adafruit_Sensor.h>',
    setupCode: () => `
  if (!mpu.begin()) Serial.println("[MPU6050] Erreur");
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);`,
    readCode: () => `
  // MPU-6050 accélération + détection chute
  sensors_event_t _a, _g, _t;
  mpu.getEvent(&_a, &_g, &_t);
  sys.accelX = _a.acceleration.x;
  sys.accelY = _a.acceleration.y;
  sys.accelZ = _a.acceleration.z;
  float _total = sqrt(sq(_a.acceleration.x)+sq(_a.acceleration.y)+sq(_a.acceleration.z));
  sys.fallDetected = (_total < 3.0); // < 3 m/s² = chute libre`,
    declaration: () => `Adafruit_MPU6050 mpu;`,
    conflicts: [], shared: false, pinType: 'I2C',
    provides_vars: { accelX: 'float', accelY: 'float', accelZ: 'float', fallDetected: 'bool' },
  },

  // ── CAPTEURS ÉNERGIE / POIDS ─────────────────────────────
  HX711: {
    id: 'HX711', name: 'HX711', family: 'capteur',
    icon: '⚖️',
    ref: 'Cellule de charge', protocol: 'DIGITAL',
    provides: ['weight','mass'],
    requires: ['DOUT','SCK'],
    libs: ['HX711 Arduino Library'],
    domains: ['agriculture','industrie','ruche','alimentation'],
    include: '#include "HX711.h"',
    setupCode: (pins) =>
      `  scale.begin(${pins.DOUT}, ${pins.SCK});\n  scale.set_scale(2280.f); // Calibration à ajuster\n  scale.tare();`,
    readCode: () => `
  // HX711 poids (cellule de charge)
  if (scale.is_ready()) {
    sys.weight = scale.get_units(5); // Moyenne 5 lectures (grammes)
  }`,
    declaration: () => `HX711 scale;`,
    conflicts: [], shared: false, pinType: 'DIGITAL',
    provides_vars: { weight: 'float' },
  },

  ACS712: {
    id: 'ACS712', name: 'ACS712', family: 'capteur',
    icon: '⚡',
    ref: 'Capteur courant', protocol: 'ANALOG',
    provides: ['current','power'],
    requires: ['AOUT'],
    libs: [],
    domains: ['énergie','industrie','solaire'],
    include: '',
    setupCode: () => `  // ACS712 — calibration offset 2048 (5A: 185mV/A)`,
    readCode: (pins) => `
  // ACS712 courant (GPIO ${pins.AOUT})
  int _rawA = analogRead(${pins.AOUT});
  sys.current = ((_rawA - 2048) / 4096.0) * 3.3 / 0.185; // Ampères`,
    conflicts: [], shared: false, pinType: 'ANALOG',
    provides_vars: { current: 'float' },
  },

  // ── CAPTEURS ACCÈS / SÉCURITÉ ────────────────────────────
  RFID_RC522: {
    id: 'RFID_RC522', name: 'RFID RC522', family: 'capteur',
    icon: '🔑',
    ref: '13.56 MHz SPI', protocol: 'SPI',
    provides: ['badge_id','access_control'],
    requires: ['SDA','SCK','MOSI','MISO','RST'],
    libs: ['MFRC522'],
    domains: ['sécurité','éducation','industrie','médical'],
    include: '#include <SPI.h>\n#include <MFRC522.h>',
    setupCode: (pins) =>
      `  SPI.begin();\n  rfid.PCD_Init(${pins.SDA||5}, ${pins.RST||27}); // RFID RC522`,
    readCode: (pins) => `
  // RFID RC522 — lecture badge
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    sys.lastBadge = "";
    for (byte i = 0; i < rfid.uid.size; i++) {
      if (rfid.uid.uidByte[i] < 0x10) sys.lastBadge += "0";
      sys.lastBadge += String(rfid.uid.uidByte[i], HEX);
    }
    sys.lastBadge.toUpperCase();
    sys.lastAccess = millis();
    rfid.PICC_HaltA();
  }`,
    declaration: (pins) => `MFRC522 rfid(${pins.SDA||5}, ${pins.RST||27});`,
    conflicts: [], shared: false, pinType: 'SPI',
    provides_vars: { lastBadge: 'String', lastAccess: 'unsigned long' },
  },

  REED_SWITCH: {
    id: 'REED_SWITCH', name: 'Reed switch', family: 'capteur',
    icon: '🚪',
    ref: 'Magnétique NO/NC', protocol: 'DIGITAL',
    provides: ['door_state','window_state'],
    requires: ['SIG'],
    libs: [],
    domains: ['sécurité','domotique','agriculture'],
    include: '',
    setupCode: (pins) => `  pinMode(${pins.SIG}, INPUT_PULLUP); // Reed switch GPIO ${pins.SIG}`,
    readCode: (pins) => `
  // Reed switch (GPIO ${pins.SIG}) — LOW = ouvert avec pull-up
  sys.doorOpen = !digitalRead(${pins.SIG});`,
    conflicts: [], shared: false, pinType: 'DIGITAL',
    provides_vars: { doorOpen: 'bool' },
  },

  PIR_HCSR501: {
    id: 'PIR_HCSR501', name: 'PIR HC-SR501', family: 'capteur',
    icon: '👁️',
    ref: 'Infrarouge passif', protocol: 'DIGITAL',
    provides: ['motion','presence'],
    requires: ['OUT'],
    libs: [],
    domains: ['sécurité','éclairage','agriculture'],
    include: '',
    setupCode: (pins) => `  pinMode(${pins.OUT}, INPUT); // PIR HC-SR501 GPIO ${pins.OUT}`,
    readCode: (pins) => `
  // PIR HC-SR501 mouvement (GPIO ${pins.OUT})
  sys.motionDetected = digitalRead(${pins.OUT});`,
    conflicts: [], shared: false, pinType: 'DIGITAL',
    provides_vars: { motionDetected: 'bool' },
  },

  SW420: {
    id: 'SW420', name: 'Capteur vibration SW-420', family: 'capteur',
    icon: '📳',
    ref: 'Digital', protocol: 'DIGITAL',
    provides: ['vibration','shock'],
    requires: ['DO'],
    libs: [],
    domains: ['industrie','sécurité','transport'],
    include: '',
    setupCode: (pins) => `  pinMode(${pins.DO}, INPUT); // SW-420 vibration GPIO ${pins.DO}`,
    readCode: (pins) => `
  // SW-420 vibration (GPIO ${pins.DO})
  sys.vibration = digitalRead(${pins.DO});`,
    conflicts: [], shared: false, pinType: 'DIGITAL',
    provides_vars: { vibration: 'bool' },
  },

  RAIN_SENSOR: {
    id: 'RAIN_SENSOR', name: 'Détecteur de pluie', family: 'capteur',
    icon: '🌧️',
    ref: 'YL-83', protocol: 'ANALOG',
    provides: ['rain','rain_intensity'],
    requires: ['AO'],
    libs: [],
    domains: ['agriculture','météo','environnement'],
    include: '',
    setupCode: () => `  // Détecteur pluie — ADC`,
    readCode: (pins) => `
  // Pluie (GPIO ${pins.AO}) — 0 = beaucoup de pluie
  sys.rainLevel = map(analogRead(${pins.AO}), 4095, 0, 0, 100);`,
    conflicts: [], shared: false, pinType: 'ANALOG',
    provides_vars: { rainLevel: 'int' },
  },

  PH_SENSOR: {
    id: 'PH_SENSOR', name: 'Capteur pH', family: 'capteur',
    icon: '🧪',
    ref: 'SEN0161', protocol: 'ANALOG',
    provides: ['ph_value','water_quality'],
    requires: ['AO'],
    libs: [],
    domains: ['agriculture','eau','environnement','médical'],
    include: '',
    setupCode: () => `  // Capteur pH SEN0161 — calibration : pH 7 = 2.5V`,
    readCode: (pins) => `
  // pH eau (GPIO ${pins.AO})
  float _phV = analogRead(${pins.AO}) * (3.3 / 4095.0);
  sys.phValue = 7.0 + ((_phV - 2.5) / -0.18); // Courbe linéaire`,
    conflicts: [], shared: false, pinType: 'ANALOG',
    provides_vars: { phValue: 'float' },
  },

  FLOW_SENSOR: {
    id: 'FLOW_SENSOR', name: 'Capteur débit eau', family: 'capteur',
    icon: '💦',
    ref: 'YF-S201', protocol: 'DIGITAL',
    provides: ['flow_rate','volume'],
    requires: ['SIG'],
    libs: [],
    domains: ['agriculture','eau','industrie'],
    include: '',
    setupCode: (pins) =>
      `  pinMode(${pins.SIG}, INPUT_PULLUP);\n  attachInterrupt(digitalPinToInterrupt(${pins.SIG}), flowISR, RISING);`,
    readCode: () => `
  // Débit — calculé via interrupt (voir flowISR)
  sys.flowRate = (flowPulses / 7.5); // L/min
  sys.flowPulses = 0;`,
    declaration: () =>
      `volatile int flowPulses = 0;\nvoid IRAM_ATTR flowISR() { flowPulses++; }`,
    conflicts: [], shared: false, pinType: 'DIGITAL',
    provides_vars: { flowRate: 'float', flowPulses: 'int' },
  },

  TURBIDITY: {
    id: 'TURBIDITY', name: 'Capteur turbidité', family: 'capteur',
    icon: '🫧',
    ref: 'SEN0189', protocol: 'ANALOG',
    provides: ['turbidity','water_clarity'],
    requires: ['AO'],
    libs: [],
    domains: ['eau','environnement','agriculture'],
    include: '',
    setupCode: () => `  // Turbidité SEN0189`,
    readCode: (pins) => `
  // Turbidité eau (GPIO ${pins.AO})
  int _rawTurb = analogRead(${pins.AO});
  sys.turbidity = map(_rawTurb, 0, 4095, 3000, 0); // NTU`,
    conflicts: [], shared: false, pinType: 'ANALOG',
    provides_vars: { turbidity: 'int' },
  },

  MICROPHONE: {
    id: 'MICROPHONE', name: 'Microphone', family: 'capteur',
    icon: '🎤',
    ref: 'KY-038', protocol: 'ANALOG',
    provides: ['sound_level','noise'],
    requires: ['AO'],
    libs: [],
    domains: ['éducation','sécurité','industrie'],
    include: '',
    setupCode: () => `  // Microphone KY-038`,
    readCode: (pins) => `
  // Niveau sonore (GPIO ${pins.AO})
  sys.soundLevel = analogRead(${pins.AO});`,
    conflicts: [], shared: false, pinType: 'ANALOG',
    provides_vars: { soundLevel: 'int' },
  },

  VOLTAGE_DIVIDER: {
    id: 'VOLTAGE_DIVIDER', name: 'Diviseur de tension', family: 'capteur',
    icon: '🔋',
    ref: 'ADC résistif', protocol: 'ANALOG',
    provides: ['voltage','battery_level'],
    requires: ['AO'],
    libs: [],
    domains: ['énergie','solaire','agriculture'],
    include: '',
    setupCode: () => `  // Diviseur tension — R1=30k R2=7.5k → ratio 5x`,
    readCode: (pins) => `
  // Tension (GPIO ${pins.AO}) — diviseur x5
  sys.voltage = analogRead(${pins.AO}) * (3.3 / 4095.0) * 5.0;`,
    conflicts: [], shared: false, pinType: 'ANALOG',
    provides_vars: { voltage: 'float' },
  },

  SOLAR_CELL: {
    id: 'SOLAR_CELL', name: 'Cellule solaire', family: 'capteur',
    icon: '☀️',
    ref: 'ADC + diviseur', protocol: 'ANALOG',
    provides: ['solar_voltage','solar_power'],
    requires: ['AO'],
    libs: [],
    domains: ['énergie','solaire'],
    include: '',
    setupCode: () => `  // Cellule solaire — ADC`,
    readCode: (pins) => `
  // Tension panneau solaire (GPIO ${pins.AO})
  sys.solarVoltage = analogRead(${pins.AO}) * (3.3 / 4095.0) * 10.0;
  sys.solarPower   = sys.solarVoltage * sys.current;`,
    conflicts: [], shared: false, pinType: 'ANALOG',
    provides_vars: { solarVoltage: 'float', solarPower: 'float' },
  },

  // ── ACTIONNEURS ──────────────────────────────────────────
  RELAY_1CH: {
    id: 'RELAY_1CH', name: 'Relais 1 canal', family: 'actionneur',
    icon: '🔌',
    ref: '5V 10A', protocol: 'DIGITAL',
    provides: ['switch_ac','switch_dc'],
    requires: ['IN'],
    libs: [],
    domains: ['all'],
    include: '',
    setupCode: (pins) =>
      `  pinMode(${pins.IN}, OUTPUT);\n  digitalWrite(${pins.IN}, HIGH); // Relais OFF (actif LOW)`,
    actionCode: (pins, varName) =>
      `  digitalWrite(${pins.IN}, ${varName} ? LOW : HIGH); // Relais actif LOW`,
    conflicts: [], shared: false, pinType: 'DIGITAL',
    isActuator: true,
    notes: 'Actif LOW — HIGH = relais ouvert, LOW = relais fermé',
  },

  RELAY_4CH: {
    id: 'RELAY_4CH', name: 'Relais 4 canaux', family: 'actionneur',
    icon: '🔌',
    ref: '5V', protocol: 'DIGITAL',
    provides: ['switch_4x'],
    requires: ['IN1','IN2','IN3','IN4'],
    libs: [],
    domains: ['all'],
    include: '',
    setupCode: (pins) => {
      const lines = [];
      ['IN1','IN2','IN3','IN4'].forEach(p => {
        if (pins[p]) lines.push(`  pinMode(${pins[p]}, OUTPUT); digitalWrite(${pins[p]}, HIGH);`);
      });
      return lines.join('\n');
    },
    actionCode: (pins, varName, channel=1) =>
      `  digitalWrite(${pins['IN'+channel]}, ${varName} ? LOW : HIGH);`,
    conflicts: [], shared: false, pinType: 'DIGITAL',
    isActuator: true,
  },

  BUZZER: {
    id: 'BUZZER', name: 'Buzzer actif', family: 'actionneur',
    icon: '🔔',
    ref: '5V actif', protocol: 'DIGITAL',
    provides: ['alarm','alert_sound'],
    requires: ['SIG'],
    libs: [],
    domains: ['sécurité','médical','éducation','all'],
    include: '',
    setupCode: (pins) =>
      `  pinMode(${pins.SIG}, OUTPUT);\n  digitalWrite(${pins.SIG}, LOW); // Buzzer GPIO ${pins.SIG}`,
    actionCode: (pins, varName) =>
      `  digitalWrite(${pins.SIG}, ${varName} ? HIGH : LOW);`,
    conflicts: [], shared: false, pinType: 'DIGITAL', isActuator: true,
  },

  SERVO: {
    id: 'SERVO', name: 'Servo moteur', family: 'actionneur',
    icon: '🎯',
    ref: 'SG90 / MG996', protocol: 'PWM',
    provides: ['angle_control','valve_control'],
    requires: ['SIG'],
    libs: ['ESP32Servo'],
    domains: ['agriculture','industrie','domotique'],
    include: '#include <ESP32Servo.h>',
    setupCode: (pins) =>
      `  servo_${pins.SIG}.attach(${pins.SIG}); // Servo GPIO ${pins.SIG}`,
    actionCode: (pins, varName) =>
      `  servo_${pins.SIG}.write(${varName} ? 90 : 0); // Ouvert/Fermé`,
    declaration: (pins) => `Servo servo_${pins.SIG};`,
    conflicts: [], shared: false, pinType: 'PWM', isActuator: true,
  },

  MOTOR_DC: {
    id: 'MOTOR_DC', name: 'Moteur DC', family: 'actionneur',
    icon: '🏎️',
    ref: 'L298N / L293D', protocol: 'PWM',
    provides: ['motor_speed','motor_direction'],
    requires: ['ENA','IN1','IN2'],
    libs: [],
    domains: ['industrie','agriculture','robotique'],
    include: '',
    setupCode: (pins) => `
  pinMode(${pins.IN1}, OUTPUT); pinMode(${pins.IN2}, OUTPUT);
  ledcSetup(0, 5000, 8); ledcAttachPin(${pins.ENA}, 0); // PWM moteur`,
    actionCode: (pins, varName) => `
  if (${varName}) {
    digitalWrite(${pins.IN1}, HIGH); digitalWrite(${pins.IN2}, LOW);
    ledcWrite(0, 200); // Vitesse 0-255
  } else {
    digitalWrite(${pins.IN1}, LOW); digitalWrite(${pins.IN2}, LOW);
    ledcWrite(0, 0);
  }`,
    conflicts: [], shared: false, pinType: 'PWM', isActuator: true,
  },

  LED_RGB: {
    id: 'LED_RGB', name: 'LED RGB', family: 'actionneur',
    icon: '💡',
    ref: 'Anode commune', protocol: 'PWM',
    provides: ['color_light','status_indicator'],
    requires: ['R','G','B'],
    libs: [],
    domains: ['all'],
    include: '',
    setupCode: (pins) => `
  pinMode(${pins.R}, OUTPUT); pinMode(${pins.G}, OUTPUT); pinMode(${pins.B}, OUTPUT);
  // LED RGB GPIO R:${pins.R} G:${pins.G} B:${pins.B}`,
    actionCode: (pins, r=0, g=255, b=0) =>
      `  analogWrite(${pins.R}, ${r}); analogWrite(${pins.G}, ${g}); analogWrite(${pins.B}, ${b});`,
    conflicts: [], shared: false, pinType: 'PWM', isActuator: true,
  },

  LED_STRIP_WS2812: {
    id: 'LED_STRIP_WS2812', name: 'Strip LED WS2812B', family: 'actionneur',
    icon: '🌈',
    ref: 'NeoPixel 5V', protocol: 'DIGITAL',
    provides: ['rgb_strip','animation','status_display'],
    requires: ['DIN'],
    libs: ['Adafruit NeoPixel'],
    domains: ['all'],
    include: '#include <Adafruit_NeoPixel.h>',
    setupCode: (pins, count=8) =>
      `  strip.begin(); strip.setBrightness(50); strip.show(); // WS2812B GPIO ${pins.DIN}`,
    declaration: (pins, count=8) =>
      `Adafruit_NeoPixel strip(${count}, ${pins.DIN}, NEO_GRB + NEO_KHZ800);`,
    conflicts: [], shared: false, pinType: 'DIGITAL', isActuator: true,
  },

  DFPLAYER: {
    id: 'DFPLAYER', name: 'DFPlayer Mini', family: 'actionneur',
    icon: '🔊',
    ref: 'MP3 UART', protocol: 'UART',
    provides: ['audio_alert','voice_message'],
    requires: ['TX','RX'],
    libs: ['DFRobotDFPlayerMini'],
    domains: ['médical','éducation','sécurité'],
    include: '#include "DFRobotDFPlayerMini.h"',
    setupCode: (pins) =>
      `  Serial2.begin(9600, SERIAL_8N1, ${pins.RX}, ${pins.TX});\n  if (!dfPlayer.begin(Serial2)) Serial.println("[DFPlayer] Erreur");`,
    declaration: () => `DFRobotDFPlayerMini dfPlayer;`,
    conflicts: [], shared: false, pinType: 'UART', isActuator: true,
  },

  // ── AFFICHAGE ─────────────────────────────────────────────
  OLED_SSD1306: {
    id: 'OLED_SSD1306', name: 'Écran OLED SSD1306', family: 'affichage',
    icon: '📺',
    ref: 'I2C 128x64', protocol: 'I2C',
    provides: ['local_display','text_display'],
    requires: ['SDA','SCL'],
    libs: ['Adafruit SSD1306','Adafruit GFX Library'],
    domains: ['all'],
    include: '#include <Adafruit_GFX.h>\n#include <Adafruit_SSD1306.h>',
    setupCode: () => `
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("[OLED] Erreur");
  }
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.display();`,
    declaration: () => `Adafruit_SSD1306 display(128, 64, &Wire, -1);`,
    updateCode: () => `
  // Mise à jour OLED
  display.clearDisplay();
  display.setTextSize(1); display.setCursor(0,0);
  display.printf("T:%.1f H:%.0f%%\\n", sys.temperature, sys.humidity);
  display.printf("Mode: %s\\n", sys.mode.c_str());
  display.display();`,
    conflicts: [], shared: false, pinType: 'I2C',
  },

  LCD_I2C: {
    id: 'LCD_I2C', name: 'LCD 16x2 I2C', family: 'affichage',
    icon: '📟',
    ref: 'PCF8574 0x27', protocol: 'I2C',
    provides: ['local_display','text_16x2'],
    requires: ['SDA','SCL'],
    libs: ['LiquidCrystal I2C'],
    domains: ['all'],
    include: '#include <LiquidCrystal_I2C.h>',
    setupCode: () => `
  lcd.init(); lcd.backlight();
  lcd.setCursor(0,0); lcd.print("PRIVA Ready");`,
    declaration: () => `LiquidCrystal_I2C lcd(0x27, 16, 2);`,
    updateCode: () => `
  // Mise à jour LCD
  lcd.setCursor(0,0); lcd.printf("T:%.1f H:%.0f%%  ", sys.temperature, sys.humidity);
  lcd.setCursor(0,1); lcd.printf("%-16s", sys.mode.c_str());`,
    conflicts: [], shared: false, pinType: 'I2C',
  },

  TM1637: {
    id: 'TM1637', name: 'Afficheur 7 segments', family: 'affichage',
    icon: '🔢',
    ref: 'TM1637 4 digits', protocol: 'DIGITAL',
    provides: ['number_display','clock_display'],
    requires: ['CLK','DIO'],
    libs: ['TM1637Display'],
    domains: ['éducation','industrie','énergie'],
    include: '#include <TM1637Display.h>',
    setupCode: (pins) =>
      `  seg.setBrightness(5); // TM1637 CLK:${pins.CLK} DIO:${pins.DIO}`,
    declaration: (pins) =>
      `TM1637Display seg(${pins.CLK}, ${pins.DIO});`,
    conflicts: [], shared: false, pinType: 'DIGITAL',
  },

  BUTTON: {
    id: 'BUTTON', name: 'Bouton poussoir', family: 'affichage',
    icon: '🖲️',
    ref: 'NO momentané', protocol: 'DIGITAL',
    provides: ['user_input','trigger'],
    requires: ['SIG'],
    libs: [],
    domains: ['all'],
    include: '',
    setupCode: (pins) => `  pinMode(${pins.SIG}, INPUT_PULLUP); // Bouton GPIO ${pins.SIG}`,
    readCode: (pins) => `
  // Bouton (GPIO ${pins.SIG}) — LOW = pressé
  sys.buttonPressed = !digitalRead(${pins.SIG});`,
    conflicts: [], shared: false, pinType: 'DIGITAL',
    provides_vars: { buttonPressed: 'bool' },
  },

  KEYPAD_4X4: {
    id: 'KEYPAD_4X4', name: 'Clavier 4x4', family: 'affichage',
    icon: '🎮',
    ref: 'Matriciel', protocol: 'DIGITAL',
    provides: ['pin_code','keypad_input'],
    requires: ['R1','R2','R3','R4','C1','C2','C3','C4'],
    libs: ['Keypad'],
    domains: ['sécurité','médical','éducation'],
    include: '#include <Keypad.h>',
    setupCode: () => `  // Keypad 4x4 initialisé`,
    declaration: () => `
const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'1','2','3','A'}, {'4','5','6','B'},
  {'7','8','9','C'}, {'*','0','#','D'}
};
byte rowPins[ROWS] = {13,12,14,27};
byte colPins[COLS] = {26,25,33,32};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);`,
    readCode: () => `
  // Clavier 4x4
  char key = keypad.getKey();
  if (key) { sys.lastKey = String(key); }`,
    conflicts: [], shared: false, pinType: 'DIGITAL',
    provides_vars: { lastKey: 'String' },
  },

  // ── COMMUNICATION / CONNECTIVITÉ ─────────────────────────
  LORA_SX1276: {
    id: 'LORA_SX1276', name: 'Module LoRa SX1276', family: 'communication',
    icon: '📻',
    ref: '433/868/915 MHz SPI', protocol: 'SPI',
    provides: ['lora_tx','lora_rx','long_range'],
    requires: ['SCK','MOSI','MISO','NSS','RST','DIO0'],
    libs: ['LoRa'],
    domains: ['agriculture','eau','environnement','industrie'],
    include: '#include <LoRa.h>',
    setupCode: (pins) => `
  LoRa.setPins(${pins.NSS||18}, ${pins.RST||14}, ${pins.DIO0||26});
  if (!LoRa.begin(868E6)) Serial.println("[LoRa] Erreur");
  Serial.println("[LoRa] OK 868MHz");`,
    readCode: () => `
  // LoRa — réception
  int _loraSize = LoRa.parsePacket();
  if (_loraSize) {
    String _msg = "";
    while (LoRa.available()) _msg += (char)LoRa.read();
    Serial.println("[LoRa] Reçu: " + _msg);
  }`,
    conflicts: [], shared: false, pinType: 'SPI',
  },

  GPS_NEO6M: {
    id: 'GPS_NEO6M', name: 'Module GPS NEO-6M', family: 'communication',
    icon: '🛰️',
    ref: 'UART 9600', protocol: 'UART',
    provides: ['latitude','longitude','gps_speed','altitude'],
    requires: ['TX','RX'],
    libs: ['TinyGPSPlus'],
    domains: ['agriculture','transport','environnement'],
    include: '#include <TinyGPSPlus.h>',
    setupCode: (pins) =>
      `  gpsSerial.begin(9600, SERIAL_8N1, ${pins.RX||16}, ${pins.TX||17});\n  // GPS NEO-6M`,
    readCode: () => `
  // GPS NEO-6M
  while (gpsSerial.available()) gps.encode(gpsSerial.read());
  if (gps.location.isValid()) {
    sys.latitude  = gps.location.lat();
    sys.longitude = gps.location.lng();
    sys.gpsSpeed  = gps.speed.kmph();
  }`,
    declaration: () =>
      `TinyGPSPlus gps;\nHardwareSerial gpsSerial(1);`,
    conflicts: [], shared: false, pinType: 'UART',
    provides_vars: { latitude: 'float', longitude: 'float', gpsSpeed: 'float' },
  },

  RTC_DS3231: {
    id: 'RTC_DS3231', name: 'Horloge RTC DS3231', family: 'communication',
    icon: '⏱️',
    ref: 'I2C ±2ppm', protocol: 'I2C',
    provides: ['precise_time','date','alarm_clock'],
    requires: ['SDA','SCL'],
    libs: ['RTClib'],
    domains: ['all'],
    include: '#include "RTClib.h"',
    setupCode: () => `
  if (!rtc.begin()) Serial.println("[RTC] Erreur");
  if (rtc.lostPower()) rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));`,
    readCode: () => `
  // RTC DS3231 heure précise
  DateTime now = rtc.now();
  sys.rtcTimestamp = now.unixtime();
  sys.rtcHour      = now.hour();
  sys.rtcMinute    = now.minute();`,
    declaration: () => `RTC_DS3231 rtc;`,
    conflicts: [], shared: false, pinType: 'I2C',
    provides_vars: { rtcTimestamp: 'unsigned long', rtcHour: 'int', rtcMinute: 'int' },
  },

  SD_CARD: {
    id: 'SD_CARD', name: 'Carte SD', family: 'communication',
    icon: '💾',
    ref: 'SPI', protocol: 'SPI',
    provides: ['local_storage','data_logging','offline_storage'],
    requires: ['CS'],
    libs: ['SD'],
    domains: ['all'],
    include: '#include <SD.h>',
    setupCode: (pins) => `
  if (!SD.begin(${pins.CS||5})) Serial.println("[SD] Erreur");
  else Serial.println("[SD] OK");`,
    logCode: (filename='priva_log.csv') => `
  // Log sur carte SD
  File _f = SD.open("${filename}", FILE_APPEND);
  if (_f) {
    _f.printf("%lu,%.1f,%.1f\\n", millis(), sys.temperature, sys.humidity);
    _f.close();
  }`,
    conflicts: [], shared: false, pinType: 'SPI',
  },

  BATTERY_LIPO: {
    id: 'BATTERY_LIPO', name: 'Batterie LiPo/18650', family: 'communication',
    icon: '🔋',
    ref: '3.7V avec BMS', protocol: 'ANALOG',
    provides: ['battery_level','autonomous_power'],
    requires: ['VBAT'],
    libs: [],
    domains: ['all'],
    include: '',
    setupCode: () => `  // Batterie LiPo — ADC diviseur`,
    readCode: (pins) => `
  // Niveau batterie (GPIO ${pins.VBAT})
  float _vbat = analogRead(${pins.VBAT}) * (3.3/4095.0) * 2.0;
  sys.batteryLevel = map((int)(_vbat*100), 300, 420, 0, 100);
  sys.batteryLevel = constrain(sys.batteryLevel, 0, 100);`,
    conflicts: [], shared: false, pinType: 'ANALOG',
    provides_vars: { batteryLevel: 'int' },
  },
};

// ════════════════════════════════════════════════════════════
//  MOTEUR DE GÉNÉRATION
// ════════════════════════════════════════════════════════════
const FirmwareGenerator = {

  BLOCK_LIBRARY,

  // ── Retourne tous les blocs d'une famille ─────────────────
  getByFamily(family) {
    return Object.values(BLOCK_LIBRARY).filter(b => b.family === family);
  },

  // ── Retourne tous les blocs compatibles avec un domaine ──
  getByDomain(domain) {
    return Object.values(BLOCK_LIBRARY).filter(b =>
      b.domains.includes('all') || b.domains.includes(domain));
  },

  // ── Déduit les capacités offertes par un ensemble de blocs
  resolveCapabilities(selectedBlockIds) {
    const caps = new Set();
    selectedBlockIds.forEach(id => {
      const b = BLOCK_LIBRARY[id];
      if (b) b.provides.forEach(p => caps.add(p));
    });
    return [...caps];
  },

  // ── Détecte les conflits entre blocs sélectionnés ─────────
  detectConflicts(selectedBlockIds) {
    const conflicts = [];
    selectedBlockIds.forEach(id => {
      const b = BLOCK_LIBRARY[id];
      if (!b) return;
      b.conflicts.forEach(cid => {
        if (selectedBlockIds.includes(cid)) {
          conflicts.push({ block: id, conflictsWith: cid });
        }
      });
    });
    return conflicts;
  },

  // ── Détecte les blocs qui partagent un pin ─────────────────
  detectSharedPins(pinConfig) {
    const pinMap = {};
    pinConfig.forEach(pc => {
      if (!pc.pins) return;
      Object.values(pc.pins).forEach(gpio => {
        if (gpio <= 0) return;
        if (!pinMap[gpio]) pinMap[gpio] = [];
        pinMap[gpio].push(pc.blockId);
      });
    });
    return Object.entries(pinMap)
      .filter(([, blocks]) => blocks.length > 1)
      .map(([gpio, blocks]) => ({ gpio: parseInt(gpio), blocks }));
  },

  // ─────────────────────────────────────────────────────────
  // GÉNÉRATION PRINCIPALE
  // serviceConfig : { name, blocks:['DHT22','RELAY_1CH',...] }
  // pinConfig     : [{ blockId:'DHT22', pins:{DATA:14} }]
  // options       : { wifi_ssid, wifi_password, mcu:'ESP32CAM' }
  // ─────────────────────────────────────────────────────────
  generate(serviceConfig, pinConfig, options = {}) {
    const { name = 'Mon Service PRIVA', blocks = [] } = serviceConfig;
    const { wifi_ssid='VOTRE_SSID', wifi_password='VOTRE_MDP' } = options;
    const mcu = options.mcu || 'ESP32CAM';

    // Résoudre les librairies
    const libs = new Set(['ArduinoJson','WebServer']);
    blocks.forEach(id => {
      const b = BLOCK_LIBRARY[id];
      if (b) b.libs.forEach(l => libs.add(l));
    });

    // Résoudre les capacités offertes
    const capabilities = this.resolveCapabilities(blocks);
    const hasCamera    = capabilities.includes('camera') || capabilities.includes('stream');
    const hasDisplay   = blocks.some(id => ['OLED_SSD1306','LCD_I2C','TM1637'].includes(id));
    const hasSD        = blocks.includes('SD_CARD');
    const hasLoRa      = blocks.includes('LORA_SX1276');
    const hasGPS       = blocks.includes('GPS_NEO6M');

    // Construire toutes les sections
    const sections = [
      this._header(name, blocks, pinConfig),
      this._includes(blocks, libs),
      '',
      this._wifiAndServer(wifi_ssid, wifi_password),
      '',
      this._pinDefines(pinConfig),
      '',
      this._declarations(blocks, pinConfig),
      '',
      this._stateStruct(blocks, capabilities),
      '',
      this._corsAndOptions(),
      '',
      this._httpHandlers(blocks, pinConfig, capabilities, hasCamera),
      '',
      this._readSensors(blocks, pinConfig),
      '',
      this._autoControl(blocks, pinConfig, capabilities),
      hasDisplay ? this._updateDisplays(blocks) : '',
      hasCamera  ? this._cameraInit() : '',
      '',
      this._setup(blocks, pinConfig, wifi_ssid, wifi_password, hasCamera, hasSD),
      '',
      this._loop(hasDisplay),
    ].filter(s => s !== '');

    const code = sections.join('\n');

    return {
      code,
      filename:     this._slugify(name) + '.ino',
      libraries:    [...libs].map(l => l),
      capabilities,
      blockCount:   blocks.length,
      pinCount:     pinConfig.filter(p => p.pins && Object.values(p.pins).some(g => g > 0)).length,
      sharedPins:   this.detectSharedPins(pinConfig),
      conflicts:    this.detectConflicts(blocks),
    };
  },

  _header(name, blocks, pinConfig) {
    const date = new Date().toLocaleDateString('fr-FR');
    const pinLines = pinConfig
      .filter(pc => pc.pins)
      .map(pc => {
        const pinsStr = Object.entries(pc.pins)
          .map(([role, gpio]) => `${role}:${gpio}`)
          .join(' ');
        return `//   ${pc.blockId.padEnd(20)} ${pinsStr}`;
      }).join('\n');
    const caps = this.resolveCapabilities(blocks).join(', ');
    return `// ============================================================
// Firmware PRIVA — Généré automatiquement v3.0
// Service      : ${name}
// Date         : ${date}
// Blocs        : ${blocks.join(', ')}
// Capacités    : ${caps}
//
// Assignation des pins :
${pinLines || '//   (aucun pin externe)'}
// ============================================================
`;
  },

  _includes(blocks, libs) {
    const base = ['#include <Arduino.h>','#include <WiFi.h>',
                  '#include <WebServer.h>','#include <ArduinoJson.h>','#include <EEPROM.h>'];
    blocks.forEach(id => {
      const b = BLOCK_LIBRARY[id];
      if (b && b.include) {
        b.include.split('\n').forEach(inc => {
          if (inc && !base.includes(inc)) base.push(inc);
        });
      }
    });
    return base.join('\n');
  },

  _wifiAndServer(ssid, pass) {
    return `// ── WiFi & Serveur HTTP ───────────────────────────────
const char* WIFI_SSID     = "${ssid}";
const char* WIFI_PASSWORD = "${pass}";
WebServer server(81);`;
  },

  _pinDefines(pinConfig) {
    const lines = ['// ── Pins des blocs ───────────────────────────────────'];
    const seen = new Set();
    pinConfig.forEach(pc => {
      if (!pc.pins) return;
      Object.entries(pc.pins).forEach(([role, gpio]) => {
        if (gpio <= 0 || seen.has(gpio)) return;
        seen.add(gpio);
        const label = `PIN_${pc.blockId}_${role}`.toUpperCase().replace(/[^A-Z0-9]/g,'_');
        lines.push(`#define ${label.padEnd(32)} ${gpio}`);
      });
    });
    lines.push('#define CAM_LED_FLASH                      4');
    return lines.join('\n');
  },

  _declarations(blocks, pinConfig) {
    const lines = ['// ── Instances des composants ─────────────────────────'];
    const seenDecl = new Set();
    blocks.forEach(id => {
      const b = BLOCK_LIBRARY[id];
      if (!b || !b.declaration) return;
      const pc = pinConfig.find(p => p.blockId === id);
      const pins = pc?.pins || {};
      const key = `${id}_decl`;
      if (seenDecl.has(key)) return;
      seenDecl.add(key);
      const decl = b.declaration(pins);
      if (decl) lines.push(decl);
    });
    return lines.join('\n');
  },

  _stateStruct(blocks, capabilities) {
    const lines = ['// ── État global du système ───────────────────────────','struct SystemState {'];

    // Variables dynamiques selon les capacités
    const varMap = {
      temperature:    '  float temperature    = 0.0;',
      humidity:       '  float humidity       = 0.0;',
      pressure:       '  float pressure       = 0.0;',
      altitude:       '  float altitude       = 0.0;',
      soil_moisture:  '  int   soilMoisture   = 0;',
      co2:            '  int   gas            = 0;',
      air_quality:    '  int   gasRaw         = 0;',
      smoke:          '  bool  smokeAlert     = false;',
      light_lux:      '  float lightLux       = 0.0;',
      distance:       '  float distance       = 0.0;',
      water_level:    '  float waterLevel     = 0.0;',
      spo2:           '  int   spo2           = 0;',
      heart_rate:     '  int   bpm            = 0;',
      fall_detection: '  bool  fallDetected   = false;',
      acceleration:   '  float accelX=0,accelY=0,accelZ=0;',
      weight:         '  float weight         = 0.0;',
      current:        '  float current        = 0.0;',
      voltage:        '  float voltage        = 0.0;',
      solar_voltage:  '  float solarVoltage   = 0.0;',
      battery_level:  '  int   batteryLevel   = 0;',
      badge_id:       '  String lastBadge     = "";',
      access_control: '  unsigned long lastAccess = 0;',
      door_state:     '  bool  doorOpen       = false;',
      motion:         '  bool  motionDetected = false;',
      vibration:      '  bool  vibration      = false;',
      rain:           '  int   rainLevel      = 0;',
      ph_value:       '  float phValue        = 7.0;',
      flow_rate:      '  float flowRate       = 0.0;',
      flow_rate2:     '  volatile int flowPulses = 0;',
      turbidity:      '  int   turbidity      = 0;',
      sound_level:    '  int   soundLevel     = 0;',
      latitude:       '  float latitude       = 0.0;',
      longitude:      '  float longitude      = 0.0;',
      gps_speed:      '  float gpsSpeed       = 0.0;',
      precise_time:   '  unsigned long rtcTimestamp = 0;',
      alarm_clock:    '  int   rtcHour=0, rtcMinute=0;',
      user_input:     '  bool  buttonPressed  = false;',
      pin_code:       '  String lastKey       = "";',
    };

    const added = new Set();
    capabilities.forEach(cap => {
      if (varMap[cap] && !added.has(cap)) {
        lines.push(varMap[cap]);
        added.add(cap);
      }
    });

    // Actionneurs
    const actuators = blocks.filter(id => BLOCK_LIBRARY[id]?.isActuator);
    if (actuators.length) {
      lines.push('  // Actionneurs');
      actuators.forEach(id => {
        const b = BLOCK_LIBRARY[id];
        lines.push(`  bool  ${id.toLowerCase().replace(/[^a-z0-9]/g,'_').padEnd(20)} = false; // ${b.name}`);
      });
    }

    lines.push('  String mode = "auto";');
    lines.push('} sys;');

    // Seuils si capteurs analogiques présents
    const hasThresh = capabilities.some(c => ['temperature','humidity','co2'].includes(c));
    if (hasThresh) {
      lines.push('', '// ── Seuils configurables ─────────────────────────────','struct Thresholds {');
      if (capabilities.includes('temperature')) { lines.push('  float tempMin=18.0, tempMax=28.0;'); }
      if (capabilities.includes('humidity'))    { lines.push('  float humMin=50.0, humMax=80.0;'); }
      if (capabilities.includes('co2'))         { lines.push('  int   gasMax=1000;'); }
      if (capabilities.includes('spo2'))        { lines.push('  int   spo2Min=95;'); }
      lines.push('} thresh;');
    }

    lines.push('', 'unsigned long lastSensor=0, lastAuto=0, lastDisplay=0;',
      'const long SENSOR_INTERVAL  = 3000;',
      'const long AUTO_INTERVAL    = 5000;',
      'const long DISPLAY_INTERVAL = 1000;');

    return lines.join('\n');
  },

  _corsAndOptions() {
    return `// ── CORS ─────────────────────────────────────────────
void addCORSHeaders() {
  server.sendHeader("Access-Control-Allow-Origin",  "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers",
    "Content-Type, ngrok-skip-browser-warning");
  server.sendHeader("Access-Control-Max-Age", "86400");
}
void handleOptions() { addCORSHeaders(); server.send(204); }`;
  },

  _httpHandlers(blocks, pinConfig, capabilities, hasCamera) {
    const lines = [];
    const actuators = blocks.filter(id => BLOCK_LIBRARY[id]?.isActuator);

    // /status
    lines.push('// ── GET /status ──────────────────────────────────────');
    lines.push('void handleStatus() {');
    lines.push('  addCORSHeaders();');
    lines.push('  StaticJsonDocument<1024> doc;');
    const statusVars = ['temperature','humidity','pressure','gas','voltage','current',
      'doorOpen','motionDetected','vibration','smokeAlert','rainLevel','phValue',
      'flowRate','turbidity','soundLevel','soilMoisture','lightLux','distance',
      'weight','bpm','spo2','fallDetected','batteryLevel','lastBadge','latitude','longitude'];
    statusVars.forEach(v => {
      if (capabilities.some(c => c.includes(v.toLowerCase().replace(/[A-Z]/g, l=>'_'+l.toLowerCase())))) {
        lines.push(`  doc["${v}"] = sys.${v};`);
      }
    });
    lines.push('  doc["mode"]    = sys.mode;');
    lines.push('  doc["uptime"]  = millis()/1000;');
    lines.push('  doc["freeHeap"]= ESP.getFreeHeap();');
    lines.push('  doc["wifiRSSI"]= WiFi.RSSI();');
    lines.push('  JsonObject dev = doc.createNestedObject("devices");');
    actuators.forEach(id => {
      const varName = id.toLowerCase().replace(/[^a-z0-9]/g,'_');
      lines.push(`  dev["${varName}"] = sys.${varName};`);
    });
    lines.push('  String out; serializeJson(doc,out); server.send(200,"application/json",out);');
    lines.push('}', '');

    // /control
    lines.push('void handleControl() {');
    lines.push('  addCORSHeaders();');
    lines.push('  if (!server.hasArg("device")) { server.send(400); return; }');
    lines.push('  String d=server.arg("device"); bool s=server.arg("state")=="1";');
    actuators.forEach((id, i) => {
      const varName = id.toLowerCase().replace(/[^a-z0-9]/g,'_');
      const pc = pinConfig.find(p => p.blockId === id);
      const b  = BLOCK_LIBRARY[id];
      let physWrite = '';
      if (pc?.pins && b?.actionCode) {
        physWrite = ` ${b.actionCode(pc.pins, 's')}`;
      }
      lines.push(`  ${i===0?'if':'else if'} (d=="${varName}") { sys.${varName}=s;${physWrite} }`);
    });
    lines.push('  server.send(200,"application/json","{\\"status\\":\\"ok\\"}");');
    lines.push('}', '');

    // /scan
    lines.push('void handleScan() {');
    lines.push('  addCORSHeaders();');
    lines.push('  StaticJsonDocument<2048> doc;');
    lines.push('  JsonArray pins=doc.createNestedArray("pins");');
    lines.push('  const int SCAN[]={12,13,14,15,16,17,32,33,34,35};');
    lines.push('  for (int i=0;i<10;i++) {');
    lines.push('    int g=SCAN[i]; JsonObject p=pins.createNestedObject(); p["gpio"]=g;');
    lines.push('    if (g>=34) {');
    lines.push('      int v=analogRead(g); p["signalType"]="analog"; p["analogValue"]=v; p["hasSignal"]=v>100;');
    lines.push('    } else {');
    lines.push('      pinMode(g,INPUT_PULLUP); delayMicroseconds(200); bool wp=digitalRead(g);');
    lines.push('      pinMode(g,INPUT); delayMicroseconds(200); bool wo=digitalRead(g);');
    lines.push('      if(!wp&&wo){p["signalType"]="digital_high";p["hasSignal"]=true;}');
    lines.push('      else if(!wp){p["signalType"]="digital_low";p["hasSignal"]=true;}');
    lines.push('      else{p["signalType"]="floating";p["hasSignal"]=false;}');
    lines.push('    }');
    lines.push('  }');
    lines.push('  doc["model"]="ESP32"; doc["freeHeap"]=ESP.getFreeHeap(); doc["psram"]=psramFound();');
    lines.push('  String out; serializeJson(doc,out); server.send(200,"application/json",out);');
    lines.push('}', '');

    // /mode /flash /emergency
    lines.push('void handleMode() { addCORSHeaders(); if(server.hasArg("mode")) sys.mode=server.arg("mode"); server.send(200,"application/json","{\\"status\\":\\"ok\\"}"); }');
    lines.push('void handleFlash() { addCORSHeaders(); bool s=server.arg("state")=="1"; pinMode(CAM_LED_FLASH,OUTPUT); digitalWrite(CAM_LED_FLASH,s?HIGH:LOW); server.send(200,"application/json","{\\"status\\":\\"ok\\"}"); }');
    lines.push('void handleEmergency() {');
    lines.push('  addCORSHeaders();');
    actuators.forEach(id => {
      const varName = id.toLowerCase().replace(/[^a-z0-9]/g,'_');
      const pc = pinConfig.find(p => p.blockId === id);
      const b  = BLOCK_LIBRARY[id];
      let physWrite = '';
      if (pc?.pins && b?.actionCode) physWrite = ` ${b.actionCode(pc.pins,'false')}`;
      lines.push(`  sys.${varName}=false;${physWrite}`);
    });
    lines.push('  server.send(200,"application/json","{\\"status\\":\\"emergency\\"}");');
    lines.push('}', '');

    if (hasCamera) {
      lines.push('void handleCapture() {');
      lines.push('  addCORSHeaders();');
      lines.push('  camera_fb_t* fb=esp_camera_fb_get();');
      lines.push('  if(!fb){server.send(503);return;}');
      lines.push('  server.sendHeader("Content-Disposition","inline;filename=capture.jpg");');
      lines.push('  server.send_P(200,"image/jpeg",(const char*)fb->buf,fb->len);');
      lines.push('  esp_camera_fb_return(fb);');
      lines.push('}');
    }

    return lines.join('\n');
  },

  _readSensors(blocks, pinConfig) {
    const lines = ['// ── Lecture capteurs ─────────────────────────────────','void readSensors() {'];
    const seenShared = new Set();
    blocks.forEach(id => {
      const b  = BLOCK_LIBRARY[id];
      if (!b || !b.readCode) return;
      const pc = pinConfig.find(p => p.blockId === id);
      const pins = pc?.pins || {};
      if (b.shared) {
        const sharedKey = Object.values(pins)[0];
        if (seenShared.has(sharedKey)) return;
        seenShared.add(sharedKey);
      }
      const code = b.readCode(pins);
      if (code) lines.push(code);
    });
    lines.push('}');
    return lines.join('\n');
  },

  _autoControl(blocks, pinConfig, capabilities) {
    const lines = ['// ── Contrôle automatique ─────────────────────────────','void runAutoControl() {','  if (sys.mode!="auto") return;',''];

    const actuators = blocks.filter(id => BLOCK_LIBRARY[id]?.isActuator);

    // Règles intelligentes selon les capacités
    if (capabilities.includes('temperature')) {
      if (actuators.some(id => ['RELAY_1CH','RELAY_4CH'].includes(id))) {
        lines.push('  // Régulation thermique');
        lines.push('  // if (sys.temperature > thresh.tempMax) { /* allumer ventilateur */ }');
        lines.push('  // if (sys.temperature < thresh.tempMin) { /* allumer chauffage */ }');
      }
    }
    if (capabilities.includes('humidity') && capabilities.includes('soil_moisture')) {
      lines.push('  // Irrigation automatique');
      lines.push('  // if (sys.soilMoisture < 30) { /* activer pompe */ }');
    }
    if (capabilities.includes('smoke') || capabilities.includes('motion')) {
      lines.push('  // Alarme automatique');
      lines.push('  // if (sys.smokeAlert || sys.motionDetected) { /* buzzer */ }');
    }
    if (capabilities.includes('fall_detection') || capabilities.includes('spo2')) {
      lines.push('  // Alerte médicale');
      lines.push('  // if (sys.fallDetected || sys.spo2 < thresh.spo2Min) { /* buzzer appel */ }');
    }
    if (capabilities.includes('water_level') || capabilities.includes('distance')) {
      lines.push('  // Gestion niveau eau');
      lines.push('  // if (sys.distance > 80) { /* pompe de relevage */ }');
    }

    lines.push('}');
    return lines.join('\n');
  },

  _updateDisplays(blocks) {
    const lines = ['// ── Mise à jour affichages ───────────────────────────','void updateDisplays() {'];
    blocks.forEach(id => {
      const b = BLOCK_LIBRARY[id];
      if (b?.updateCode) lines.push(b.updateCode());
    });
    lines.push('}');
    return lines.join('\n');
  },

  _cameraInit() {
    return `// ── Initialisation caméra OV2640 ─────────────────────
bool initCamera() {
  camera_config_t c;
  c.ledc_channel=LEDC_CHANNEL_0; c.ledc_timer=LEDC_TIMER_0;
  c.pin_d0=19; c.pin_d1=21; c.pin_d2=36; c.pin_d3=37;
  c.pin_d4=38; c.pin_d5=39; c.pin_d6=34; c.pin_d7=35;
  c.pin_xclk=0; c.pin_pclk=22; c.pin_vsync=25; c.pin_href=23;
  c.pin_sccb_sda=26; c.pin_sccb_scl=27; c.pin_pwdn=32; c.pin_reset=-1;
  c.xclk_freq_hz=20000000; c.pixel_format=PIXFORMAT_JPEG;
  if (psramFound()) { c.frame_size=FRAMESIZE_VGA; c.jpeg_quality=12; c.fb_count=2; }
  else              { c.frame_size=FRAMESIZE_QVGA; c.jpeg_quality=20; c.fb_count=1; }
  return esp_camera_init(&c)==ESP_OK;
}`;
  },

  _setup(blocks, pinConfig, ssid, pass, hasCamera, hasSD) {
    const lines = ['void setup() {'];
    lines.push('  Serial.begin(115200);');
    lines.push(`  Serial.println("\\n[PRIVA] Démarrage...");`);
    lines.push('  EEPROM.begin(64);');
    lines.push('  WiFi.setSleep(false);');
    lines.push(`  WiFi.begin("${ssid}", "${pass}");`);
    lines.push('  while(WiFi.status()!=WL_CONNECTED){delay(500);Serial.print(".");}');
    lines.push('  Serial.println("\\n[WIFI] "+WiFi.localIP().toString());');
    lines.push('');

    const seenSetup = new Set();
    blocks.forEach(id => {
      const b  = BLOCK_LIBRARY[id];
      if (!b || !b.setupCode) return;
      const key = id;
      if (seenSetup.has(key)) return;
      seenSetup.add(key);
      const pc = pinConfig.find(p => p.blockId === id);
      const code = b.setupCode(pc?.pins || {}).trim();
      if (code) lines.push('  // '+b.name+'\n'+code.split('\n').map(l=>'  '+l.trim()).join('\n'));
    });

    if (hasCamera) lines.push('  if(!initCamera()) Serial.println("[CAM] Erreur");\n  else Serial.println("[CAM] OK");');

    lines.push('');
    lines.push('  // Routes HTTP');
    lines.push('  server.on("/status",    HTTP_GET,     handleStatus);');
    lines.push('  server.on("/control",   HTTP_POST,    handleControl);');
    lines.push('  server.on("/scan",      HTTP_GET,     handleScan);');
    lines.push('  server.on("/mode",      HTTP_POST,    handleMode);');
    lines.push('  server.on("/flash",     HTTP_POST,    handleFlash);');
    lines.push('  server.on("/emergency", HTTP_GET,     handleEmergency);');
    if (hasCamera) lines.push('  server.on("/capture",   HTTP_GET,     handleCapture);');
    lines.push('  server.on("/status",    HTTP_OPTIONS, handleOptions);');
    lines.push('  server.on("/control",   HTTP_OPTIONS, handleOptions);');
    lines.push('  server.on("/scan",      HTTP_OPTIONS, handleOptions);');
    lines.push('  server.begin();');
    lines.push('  Serial.println("[HTTP] Port 81 OK");');
    lines.push('}');
    return lines.join('\n');
  },

  _loop(hasDisplay) {
    const displayLine = hasDisplay
      ? '\n  if (now-lastDisplay >= DISPLAY_INTERVAL)  { lastDisplay=now; updateDisplays(); }'
      : '';
    return [
      'void loop() {',
      '  server.handleClient();',
      '  unsigned long now = millis();',
      '  if (now-lastSensor >= SENSOR_INTERVAL) { lastSensor=now; readSensors(); }',
      '  if (now-lastAuto   >= AUTO_INTERVAL)   { lastAuto=now;   runAutoControl(); }',
      displayLine ? '  if (now-lastDisplay >= DISPLAY_INTERVAL) { lastDisplay=now; updateDisplays(); }' : '',
      '}',
    ].filter(l => l !== '').join('\n');
  },

  _slugify(str) {
    return (str||'priva').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')
      .substring(0,40)||'priva_service';
  },

  // ── Téléchargement dans le navigateur ────────────────────
  download(serviceConfig, pinConfig, options={}) {
    const r = this.generate(serviceConfig, pinConfig, options);
    const b = new Blob([r.code],{type:'text/plain;charset=utf-8'});
    const u = URL.createObjectURL(b);
    const a = Object.assign(document.createElement('a'),{href:u,download:r.filename});
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(u);
    return r;
  },

  // ── Aperçu (N premières lignes) ──────────────────────────
  preview(serviceConfig, pinConfig, options={}, maxLines=80) {
    const r = this.generate(serviceConfig, pinConfig, options);
    const lines = r.code.split('\n');
    return {
      ...r,
      preview: lines.slice(0,maxLines).join('\n')+
               (lines.length>maxLines?'\n// ... (fichier complet au téléchargement)':''),
    };
  },
};

if (typeof module!=='undefined') module.exports = FirmwareGenerator;
else window.FirmwareGenerator = FirmwareGenerator;
