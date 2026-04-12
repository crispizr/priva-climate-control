// ============================================================
// PRIVA — pin-manager.js  v1.0
// Gestionnaire de pins ESP32
// - Détection automatique via GET /scan
// - Configuration manuelle avec anti-conflit temps réel
// - Validation et envoi à l'ESP32 via POST /pins/save
// - Connexion vers FirmwareGenerator pour produire le .ino
// ============================================================

const PinManager = {

  // ── État interne ─────────────────────────────────────────
  _state: {
    deviceIp:      null,
    serviceConfig: null,
    scanResults:   [],
    pinConfig:     [],
    mode:          'auto',
    step:          0,
    validated:     false,
  },

  // ── GPIO disponibles ESP32-CAM (hors pins caméra) ────────
  AVAILABLE_GPIOS: [12, 13, 14, 15, 16, 17, 32, 33, 34, 35, 36, 39],

  // Pins réservés caméra AI-Thinker — ne jamais assigner
  CAMERA_RESERVED: [0, 2, 4, 19, 21, 22, 23, 25, 26, 27, 34, 35, 36, 38, 39],

  // ── Règles d'inférence : signal détecté → composants ────
  SIGNAL_RULES: [
    {
      test:      (r) => r.signalType === 'analog_variable' && r.analogValue > 100 && r.analogValue < 3900,
      suggests:  ['DHT22','SOIL_HUMIDITY','PH_SENSOR','RAIN_SENSOR','MICROPHONE'],
      confidence: 88,
    },
    {
      test:      (r) => r.signalType === 'analog_high' && r.analogValue > 3500,
      suggests:  ['ACS712','VOLTAGE_DIVIDER','SOLAR_CELL','BATTERY_LIPO'],
      confidence: 75,
    },
    {
      test:      (r) => r.signalType === 'analog' && r.analogValue > 0,
      suggests:  ['MQ135','MQ2','TURBIDITY','ACS712','VOLTAGE_DIVIDER'],
      confidence: 70,
    },
    {
      test:      (r) => r.signalType === 'digital_low',
      suggests:  ['REED_SWITCH','BUTTON','PIR_HCSR501','SW420'],
      confidence: 85,
    },
    {
      test:      (r) => r.signalType === 'digital_high',
      suggests:  ['RELAY_1CH','BUZZER','LED_RGB','HCSR04'],
      confidence: 82,
    },
    {
      test:      (r) => r.signalType === 'pwm',
      suggests:  ['SERVO','MOTOR_DC','LED_STRIP_WS2812'],
      confidence: 78,
    },
    {
      test:      (r) => !r.hasSignal,
      suggests:  [],
      confidence: 95,
    },
  ],

  // ─────────────────────────────────────────────────────────
  // INITIALISATION
  // ─────────────────────────────────────────────────────────
  init(serviceConfig, deviceIp) {
    this._state.serviceConfig = serviceConfig;
    this._state.deviceIp      = deviceIp;
    this._state.scanResults   = [];
    this._state.pinConfig     = this._buildDefaultPinConfig(serviceConfig.blocks || []);
    this._state.validated     = false;
    this._state.step          = 0;
    this._render();
  },

  // ─────────────────────────────────────────────────────────
  // Config par défaut — un slot par pin requis par chaque bloc
  // ─────────────────────────────────────────────────────────
  _buildDefaultPinConfig(blocks) {
    const config = [];
    const lib    = this._lib();
    const usedGpios = new Set();

    blocks.forEach(id => {
      const b = lib[id];
      if (!b) return;

      const entry = { blockId: id, pins: {}, component: b.name, protocol: b.protocol };

      if (b.protocol === 'I2C') {
        entry.pins = { SDA: 21, SCL: 22 };
      } else if (['BUILTIN','WIFI'].includes(b.protocol)) {
        entry.pins = {};
      } else {
        (b.requires || []).forEach(role => {
          const gpio = this._nextFreeGpio(usedGpios);
          if (gpio > 0) {
            entry.pins[role] = gpio;
            usedGpios.add(gpio);
          }
        });
      }
      config.push(entry);
    });

    return config;
  },

  _lib() {
    return typeof FirmwareGenerator !== 'undefined' ? FirmwareGenerator.BLOCK_LIBRARY : {};
  },

  _nextFreeGpio(usedSet) {
    return this.AVAILABLE_GPIOS.find(g =>
      !usedSet.has(g) && !this.CAMERA_RESERVED.includes(g)
    ) || -1;
  },

  // ─────────────────────────────────────────────────────────
  // SCAN AUTOMATIQUE — GET /scan
  // ─────────────────────────────────────────────────────────
  async scanDevice() {
    const ip = this._state.deviceIp;
    if (!ip) { this._log('error','Aucune IP configurée'); return false; }

    const isNgrok  = ip.includes('ngrok')||ip.includes('.dev')||ip.includes('.app');
    const protocol = isNgrok ? 'https' : 'http';
    const port     = isNgrok ? '' : ':81';
    const url      = `${protocol}://${ip}${port}/scan`;

    this._log('info', `Connexion à ${ip}...`);
    this._progress(10);

    try {
      const headers = isNgrok ? {'ngrok-skip-browser-warning':'true'} : {};
      const ctrl    = new AbortController();
      const timer   = setTimeout(() => ctrl.abort(), 8000);

      this._progress(30);
      this._log('info', 'Scan GPIO en cours...');

      const res  = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      this._progress(80);

      this._state.scanResults = data.pins || [];
      this._log('ok', `${this._state.scanResults.length} GPIO analysés`);

      this._state.scanResults.forEach(pin => {
        if (pin.hasSignal) this._log('detect', `GPIO ${pin.gpio} → ${pin.signalType}`);
      });

      this._progress(100);
      this._applyAutoAssign();
      return true;

    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Timeout (8s) — ESP32 ne répond pas' : err.message;
      this._log('error', msg);
      this._progress(0);
      return false;
    }
  },

  // ─────────────────────────────────────────────────────────
  // ASSIGNATION AUTOMATIQUE après scan
  // ─────────────────────────────────────────────────────────
  _applyAutoAssign() {
    const blocks  = this._state.serviceConfig.blocks || [];
    const scanned = this._state.scanResults.filter(r => r.hasSignal);
    const lib     = this._lib();
    const used    = new Set();

    scanned.forEach(scanResult => {
      const rule = this.SIGNAL_RULES.find(r => r.test(scanResult));
      if (!rule || !rule.suggests.length) return;

      const matchedId = rule.suggests.find(id =>
        blocks.includes(id) && !used.has(id));
      if (!matchedId) return;

      const entry    = this._state.pinConfig.find(pc => pc.blockId === matchedId);
      const libBlock = lib[matchedId];
      if (!entry || !libBlock) return;

      const firstRole = libBlock.requires?.[0];
      if (firstRole && libBlock.protocol !== 'I2C') {
        entry.pins[firstRole]    = scanResult.gpio;
        entry.autoDetected       = true;
        entry.confidence         = rule.confidence;
        used.add(matchedId);
      }
    });

    const assigned = [...used].length;
    this._log('ok', `${assigned} bloc${assigned > 1 ? 's' : ''} assigné${assigned > 1 ? 's' : ''} automatiquement`);
    this._renderPinTable();
  },

  // ─────────────────────────────────────────────────────────
  // VALIDATION — conflits et pins manquants
  // ─────────────────────────────────────────────────────────
  validate() {
    const errors   = [];
    const warnings = [];
    const usedMap  = {};
    const lib      = this._lib();

    this._state.pinConfig.forEach(pc => {
      const b = lib[pc.blockId];
      if (b?.protocol === 'I2C') return;

      Object.entries(pc.pins || {}).forEach(([role, gpio]) => {
        if (!gpio || gpio <= 0) return;
        if (this.CAMERA_RESERVED.includes(gpio)) {
          errors.push(`GPIO ${gpio} (${pc.blockId}.${role}) est réservé à la caméra`);
          return;
        }
        const key = String(gpio);
        if (!usedMap[key]) usedMap[key] = [];
        usedMap[key].push(`${pc.blockId}.${role}`);
      });
    });

    Object.entries(usedMap).forEach(([gpio, users]) => {
      if (users.length > 1)
        errors.push(`GPIO ${gpio} partagé par : ${users.join(' et ')}`);
    });

    this._state.pinConfig.forEach(pc => {
      const b = lib[pc.blockId];
      if (!b || ['I2C','BUILTIN','WIFI','SPI'].includes(b.protocol)) return;
      if (!b.requires?.length) return;
      const hasPin = Object.values(pc.pins || {}).some(g => g > 0);
      if (!hasPin) warnings.push(`${b.name} n'a pas de GPIO assigné`);
    });

    this._state.validated = errors.length === 0;
    return { valid: errors.length === 0, errors, warnings };
  },

  // ─────────────────────────────────────────────────────────
  // ENVOI CONFIG À L'ESP32 — POST /pins/save
  // ─────────────────────────────────────────────────────────
  async savePinsToDevice() {
    if (!this._state.validated && !this.validate().valid) {
      this._log('error', 'Config invalide — corrigez les conflits'); return false;
    }
    const ip = this._state.deviceIp;
    if (!ip) return false;

    const isNgrok  = ip.includes('ngrok')||ip.includes('.dev')||ip.includes('.app');
    const protocol = isNgrok ? 'https' : 'http';
    const port     = isNgrok ? '' : ':81';
    const lib      = this._lib();

    const payload = this._state.pinConfig
      .filter(pc => pc.pins && Object.keys(pc.pins).length)
      .flatMap(pc => {
        const b = lib[pc.blockId];
        return Object.entries(pc.pins).map(([role, gpio]) => ({
          blockId: pc.blockId,
          gpio,
          role:    pc.blockId.toLowerCase().replace(/[^a-z0-9]/g,'_'),
          mode:    b?.isActuator ? 'OUTPUT' : 'INPUT_PULLUP',
          logic:   '',
        }));
      });

    try {
      const headers = {'Content-Type':'application/json'};
      if (isNgrok) headers['ngrok-skip-browser-warning'] = 'true';

      const res = await fetch(`${protocol}://${ip}${port}/pins/save`, {
        method: 'POST', headers, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._log('ok', `Config envoyée — ${data.saved || payload.length} pins sauvegardés`);
      if (typeof showAlert === 'function')
        showAlert('success', `✅ Config pins sauvegardée sur l'ESP32`);
      return true;
    } catch (err) {
      this._log('error', `Erreur : ${err.message}`);
      return false;
    }
  },

  // ─────────────────────────────────────────────────────────
  // GÉNÉRATION FIRMWARE
  // ─────────────────────────────────────────────────────────
  generateFirmware(options = {}) {
    if (typeof FirmwareGenerator === 'undefined') return null;
    return FirmwareGenerator.generate(
      this._state.serviceConfig,
      this._state.pinConfig,
      options
    );
  },

  downloadFirmware(options = {}) {
    if (typeof FirmwareGenerator === 'undefined') return;
    FirmwareGenerator.download(this._state.serviceConfig, this._state.pinConfig, options);
  },

  // ─────────────────────────────────────────────────────────
  // UPDATE depuis l'UI (select GPIO)
  // ─────────────────────────────────────────────────────────
  updatePin(blockId, role, newGpio) {
    const entry = this._state.pinConfig.find(pc => pc.blockId === blockId);
    if (entry) {
      entry.pins[role] = parseInt(newGpio) || 0;
      entry.autoDetected = false;
    }
    this._state.validated = false;
    this._updateConflictUI();
  },

  getFreeGpios(exceptBlockId) {
    const used = new Set();
    const lib  = this._lib();
    this._state.pinConfig.forEach(pc => {
      if (pc.blockId === exceptBlockId) return;
      const b = lib[pc.blockId];
      if (b?.protocol === 'I2C') return;
      Object.values(pc.pins || {}).forEach(g => { if (g > 0) used.add(g); });
    });
    return this.AVAILABLE_GPIOS.filter(g =>
      !used.has(g) && !this.CAMERA_RESERVED.includes(g));
  },

  // ─────────────────────────────────────────────────────────
  // RENDU HTML COMPLET
  // ─────────────────────────────────────────────────────────
  _render() {
    const container = document.getElementById('pm-container');
    if (!container) return;
    container.innerHTML = this._css() + this._stepsHtml() + this._viewsHtml();
    setTimeout(() => this._renderPinTable(), 30);
  },

  _css() {
    return `<style>
#pm-container *{box-sizing:border-box}
.pm-steps{display:flex;border:1px solid #2d3142;border-radius:8px;overflow:hidden;margin-bottom:16px}
.pm-step{flex:1;padding:8px 4px;text-align:center;font-size:12px;color:#7a7fa8;background:#161929;border-right:1px solid #2d3142;cursor:pointer;transition:background .15s}
.pm-step:last-child{border-right:none}
.pm-step.active{background:#0f1117;color:#fff;font-weight:600}
.pm-step.done{color:#27ae60}
.pm-sn{display:inline-flex;width:16px;height:16px;border-radius:50%;background:#2d3142;color:#7a7fa8;font-size:10px;align-items:center;justify-content:center;margin-right:3px}
.pm-step.active .pm-sn{background:#667eea;color:#fff}
.pm-step.done   .pm-sn{background:#27ae60;color:#fff}
.pm-view{display:none}.pm-view.active{display:block}
.pm-card{background:#161929;border:1px solid #2d3142;border-radius:10px;padding:14px;margin-bottom:12px}
.pm-ct{font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#7a7fa8;margin-bottom:10px}
.pm-log{background:#0f1117;border:1px solid #1a1d29;border-radius:6px;padding:10px;font-size:11px;font-family:monospace;max-height:140px;overflow-y:auto}
.pm-ll{padding:1px 0}
.pm-ok{color:#27ae60}.pm-error{color:#e63946}.pm-warn{color:#f77f00}.pm-info{color:#667eea}.pm-detect{color:#00B894}
.pm-bar{height:4px;background:#2d3142;border-radius:2px;margin:8px 0}
.pm-bar-fill{height:100%;background:#667eea;border-radius:2px;transition:width .2s;width:0%}
.pm-btn{padding:8px 16px;border-radius:6px;border:1px solid #2d3142;cursor:pointer;font-size:13px;font-family:inherit;background:#1a1d29;color:#d5d5ee;transition:all .15s}
.pm-btn:hover{background:#252836}
.pm-btn-p{background:#667eea;color:#fff;border-color:#667eea}
.pm-btn-p:hover{background:#5a6fd6}
.pm-btn-s{background:#27ae60;color:#fff;border-color:#27ae60}
.pm-btn-s:hover{background:#219a52}
.pm-btn-row{display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:8px}
.pm-mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}
.pm-mc{border:2px solid #2d3142;border-radius:10px;padding:14px;cursor:pointer;text-align:center;transition:all .15s}
.pm-mc:hover{border-color:#667eea44}
.pm-mc.sel{border-color:#667eea;background:#1a1d29}
.pm-tbl{width:100%;border-collapse:collapse;font-size:12px}
.pm-tbl th{text-align:left;padding:6px 8px;color:#7a7fa8;font-size:11px;border-bottom:1px solid #2d3142;font-weight:600;letter-spacing:.5px}
.pm-tbl td{padding:7px 8px;border-bottom:1px solid #161929;vertical-align:middle}
.pm-tbl tr:last-child td{border-bottom:none}
.pm-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600}
.pb-cap{background:#1a3d2b;color:#27ae60}
.pb-act{background:#1d1a3d;color:#667eea}
.pb-aff{background:#2d1a3d;color:#a87fd8}
.pb-mcu{background:#1a2d3d;color:#3b82f6}
.pb-com{background:#2d2a1a;color:#f77f00}
.pb-auto{background:#0d2d1a;color:#00B894}
.pm-sel{padding:4px 6px;font-size:11px;background:#0f1117;border:1px solid #2d3142;border-radius:4px;color:#d5d5ee;font-family:monospace}
.pm-sel.conflict{border-color:#e63946;background:#2d1a1a}
.pm-err-banner{background:#2d1a1a;border:1px solid #e63946;border-radius:6px;padding:8px 12px;font-size:12px;color:#e63946;margin-top:8px}
.pm-ok-banner{background:#1a2d1a;border:1px solid #27ae60;border-radius:6px;padding:8px 12px;font-size:12px;color:#27ae60;margin-top:8px}
.pm-warn-banner{background:#2d2a1a;border:1px solid #f77f00;border-radius:6px;padding:8px 12px;font-size:12px;color:#f77f00;margin-top:8px}
.pm-ino{background:#0f1117;border:1px solid #2d3142;border-radius:6px;padding:12px;font-size:11px;font-family:monospace;color:#9ca3af;line-height:1.7;overflow-x:auto;max-height:280px;overflow-y:auto}
.ino-kw{color:#667eea}.ino-fn{color:#27ae60}.ino-str{color:#f77f00}.ino-cmt{color:#4a5568}
.pm-lib{display:flex;align-items:center;gap:8px;padding:6px 10px;background:#0f1117;border-radius:6px;font-size:12px;margin-bottom:4px}
.pm-cap-tag{padding:3px 10px;background:#1a1d29;border:1px solid #2d3142;border-radius:10px;font-size:11px;color:#d5d5ee;display:inline-block;margin:3px}
</style>`;
  },

  _stepsHtml() {
    const steps = ['Mode','Schéma','Détection','Validation','Firmware'];
    return `<div class="pm-steps">${steps.map((s,i) =>
      `<div class="pm-step ${i===0?'active':''}" id="pm-st-${i}" onclick="PinManager._goStep(${i})">
        <span class="pm-sn">${i+1}</span>${s}
       </div>`
    ).join('')}</div>`;
  },

  _viewsHtml() {
    const svc  = this._state.serviceConfig || {};
    const mode = this._state.mode;
    return `
    <div class="pm-view active" id="pm-v-0">${this._htmlMode(svc)}</div>
    <div class="pm-view" id="pm-v-1"><div id="pm-wiring"></div>
      <div class="pm-btn-row">
        <button class="pm-btn" onclick="PinManager._goStep(0)">← Retour</button>
        <button class="pm-btn pm-btn-p" onclick="PinManager._goStep(2)">${mode==='auto'?'Lancer la détection →':'Configurer manuellement →'}</button>
      </div>
    </div>
    <div class="pm-view" id="pm-v-2">
      <div id="pm-detect-zone">${mode==='auto' ? this._htmlAutoDetect() : this._htmlManual()}</div>
      <div class="pm-btn-row">
        <button class="pm-btn" onclick="PinManager._goStep(1)">← Retour</button>
        <button class="pm-btn pm-btn-p" onclick="PinManager._goToValidation()">Valider →</button>
      </div>
    </div>
    <div class="pm-view" id="pm-v-3">
      <div id="pm-val-content"></div>
      <div class="pm-btn-row">
        <button class="pm-btn" onclick="PinManager._goStep(2)">← Modifier</button>
        <button class="pm-btn pm-btn-p" onclick="PinManager._goToFirmware()">Générer le firmware →</button>
      </div>
    </div>
    <div class="pm-view" id="pm-v-4"><div id="pm-fw-content"></div></div>`;
  },

  _htmlMode(svc) {
    return `<div class="pm-card">
      <div class="pm-ct">Service sélectionné</div>
      <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#0f1117;border-radius:6px;margin-bottom:14px">
        <span style="font-size:22px">${svc.icon||'🔧'}</span>
        <div>
          <div style="font-size:13px;font-weight:600;color:#d5d5ee">${svc.name||'Service'}</div>
          <div style="font-size:11px;color:#7a7fa8;margin-top:2px">
            ${(svc.blocks||[]).length} blocs · ${this._state.deviceIp||'IP non configurée'}
          </div>
        </div>
      </div>
      <div class="pm-ct">Mode de configuration</div>
      <div class="pm-mode-grid">
        <div class="pm-mc ${this._state.mode==='auto'?'sel':''}" onclick="PinManager._selMode('auto')">
          <div style="font-size:28px;margin-bottom:8px">⚡</div>
          <div style="font-size:13px;font-weight:600;color:#d5d5ee">Détection automatique</div>
          <div style="font-size:11px;color:#7a7fa8;margin-top:6px">
            L'ESP32 scanne ses GPIO après câblage. PRIVA propose l'assignation.
          </div>
        </div>
        <div class="pm-mc ${this._state.mode==='manual'?'sel':''}" onclick="PinManager._selMode('manual')">
          <div style="font-size:28px;margin-bottom:8px">🔧</div>
          <div style="font-size:13px;font-weight:600;color:#d5d5ee">Configuration manuelle</div>
          <div style="font-size:11px;color:#7a7fa8;margin-top:6px">
            Je choisis moi-même chaque GPIO dans la liste.
          </div>
        </div>
      </div>
    </div>
    <div class="pm-btn-row">
      <div></div>
      <button class="pm-btn pm-btn-p" onclick="PinManager._goStep(1)">Voir le schéma →</button>
    </div>`;
  },

  _htmlAutoDetect() {
    return `<div class="pm-card">
      <div class="pm-ct">Détection automatique</div>
      <div style="font-size:13px;color:#d5d5ee;margin-bottom:10px">
        Cliquez sur "Lancer le scan" — PRIVA interroge l'ESP32 et identifie les composants branchés.
      </div>
      <div class="pm-bar"><div class="pm-bar-fill" id="pm-prog"></div></div>
      <div id="pm-stat" style="font-size:11px;color:#7a7fa8;margin-bottom:8px">En attente...</div>
      <div class="pm-log" id="pm-log"><div class="pm-ll" style="opacity:.4">> En attente...</div></div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="pm-btn pm-btn-s" onclick="PinManager._runScan()">▶ Lancer le scan</button>
        <button class="pm-btn" onclick="PinManager._selMode('manual');PinManager._goStep(2)">Passer en manuel</button>
      </div>
    </div>
    <div class="pm-card" id="pm-auto-res" style="display:none">
      <div class="pm-ct">Assignation proposée — vérifiez et corrigez si besoin</div>
      <div id="pm-tbl-auto"></div>
    </div>`;
  },

  _htmlManual() {
    return `<div class="pm-card">
      <div class="pm-ct">Configuration manuelle des GPIO</div>
      <div id="pm-tbl-manual"></div>
      <div id="pm-conflict-ui"></div>
    </div>`;
  },

  // ─────────────────────────────────────────────────────────
  // Table de pins (auto ou manuel)
  // ─────────────────────────────────────────────────────────
  _renderPinTable() {
    const lib     = this._lib();
    const gpioOpts = this.AVAILABLE_GPIOS
      .filter(g => !this.CAMERA_RESERVED.includes(g))
      .map(g => `<option value="${g}">GPIO ${g}</option>`).join('');
    const noGpioOpt = '<option value="-1">— non assigné</option>';

    const makeSelect = (blockId, role, currentGpio) => {
      const opts = this.AVAILABLE_GPIOS
        .filter(g => !this.CAMERA_RESERVED.includes(g))
        .map(g => `<option value="${g}" ${g===currentGpio?'selected':''}>${'GPIO '+g}</option>`)
        .join('') + `<option value="-1" ${currentGpio<=0?'selected':''}>— non assigné</option>`;
      return `<select class="pm-sel" id="pm-sel-${blockId}-${role}"
                onchange="PinManager.updatePin('${blockId}','${role}',this.value)">${opts}</select>`;
    };

    const catBadge = (family) => {
      const m = {capteur:'pb-cap',actionneur:'pb-act',affichage:'pb-aff',mcu:'pb-mcu',communication:'pb-com'};
      return `<span class="pm-badge ${m[family]||'pb-mcu'}">${family||'?'}</span>`;
    };

    if (this._state.mode === 'auto') {
      const el = document.getElementById('pm-tbl-auto');
      if (!el) return;
      if (!this._state.scanResults.length) return;
      document.getElementById('pm-auto-res').style.display = 'block';

      const rows = this._state.pinConfig.map(pc => {
        const b = lib[pc.blockId];
        if (!b || ['BUILTIN','WIFI'].includes(b.protocol)) return '';
        const auto = pc.autoDetected
          ? `<span class="pm-badge pb-auto" style="margin-left:6px">auto ${pc.confidence||'?'}%</span>` : '';
        const cells = Object.entries(pc.pins).map(([role, gpio]) => {
          if (b.protocol === 'I2C')
            return `<span style="font-size:11px;color:#3b82f6">${role}: GPIO ${gpio} (I2C)</span>`;
          return `<label style="font-size:11px;color:#7a7fa8;margin-right:4px">${role}</label>${makeSelect(pc.blockId,role,gpio)}`;
        }).join(' ');
        return `<tr>
          <td>${b.name}${auto}</td>
          <td>${catBadge(b.family)}</td>
          <td>${cells}</td>
        </tr>`;
      }).filter(Boolean).join('');

      el.innerHTML = `<table class="pm-tbl">
        <thead><tr><th>Composant</th><th>Type</th><th>GPIO assigné</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="3" style="text-align:center;opacity:.5">Aucun résultat</td></tr>'}</tbody>
      </table>`;

    } else {
      const el = document.getElementById('pm-tbl-manual');
      if (!el) return;

      const rows = this._state.pinConfig.map(pc => {
        const b = lib[pc.blockId];
        if (!b) return '';
        if (['BUILTIN','WIFI'].includes(b.protocol))
          return `<tr><td>${b.name}</td><td colspan="2" style="color:#7a7fa8;font-size:11px">Interne — pas de GPIO</td></tr>`;
        if (b.protocol === 'I2C')
          return `<tr><td>${b.name}</td><td colspan="2" style="color:#3b82f6;font-size:11px">GPIO 21 (SDA) · GPIO 22 (SCL) — bus I2C partagé</td></tr>`;

        const inputs = Object.entries(pc.pins).map(([role, gpio]) =>
          `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
             <span style="font-size:11px;color:#7a7fa8;min-width:38px">${role}</span>
             ${makeSelect(pc.blockId, role, gpio)}
           </div>`).join('');
        return `<tr>
          <td style="vertical-align:top;padding-top:10px">${b.name}<br><span style="font-size:10px;color:#7a7fa8">${b.ref}</span></td>
          <td>${catBadge(b.family)}</td>
          <td>${inputs}</td>
        </tr>`;
      }).filter(Boolean).join('');

      el.innerHTML = `<table class="pm-tbl">
        <thead><tr><th>Composant</th><th>Type</th><th>GPIO</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    }
  },

  // ─────────────────────────────────────────────────────────
  // Schéma de câblage (vue 1)
  // ─────────────────────────────────────────────────────────
  _renderWiring() {
    const lib  = this._lib();
    const rows = this._state.pinConfig
      .filter(pc => pc.pins && Object.keys(pc.pins).length)
      .map(pc => {
        const b = lib[pc.blockId];
        const pins = Object.entries(pc.pins)
          .map(([r,g]) => g>0 ? `${r}:GPIO${g}` : `${r}:—`).join(' · ');
        const catBadge = {capteur:'pb-cap',actionneur:'pb-act',affichage:'pb-aff',mcu:'pb-mcu',communication:'pb-com'};
        return `<tr>
          <td style="color:#d5d5ee">${b?.name||pc.blockId}</td>
          <td><span class="pm-badge ${catBadge[b?.family]||'pb-mcu'}">${b?.family||'?'}</span></td>
          <td style="font-family:monospace;font-size:11px;color:#667eea">${pins}</td>
          <td style="font-size:11px;color:#7a7fa8">${b?.protocol||'—'}</td>
        </tr>`;
      }).join('');

    const wiring = document.getElementById('pm-wiring');
    if (wiring) wiring.innerHTML = `
      <div class="pm-card">
        <div class="pm-ct">Schéma de câblage</div>
        <div style="font-size:12px;color:#7a7fa8;margin-bottom:10px">
          Câblez l'ESP32 selon ce tableau, puis passez à l'étape de détection.
        </div>
        <table class="pm-tbl">
          <thead><tr><th>Composant</th><th>Type</th><th>Pins</th><th>Protocole</th></tr></thead>
          <tbody>${rows||'<tr><td colspan="4" style="text-align:center;opacity:.5">Aucun bloc</td></tr>'}</tbody>
        </table>
        <div style="margin-top:10px;padding:8px 12px;background:#0f1117;border-radius:6px;font-size:11px;color:#3b82f6">
          📡 GPIO 21 (SDA) et GPIO 22 (SCL) sont partagés entre tous les composants I2C — branchez-les en parallèle.
        </div>
      </div>`;
  },

  // ─────────────────────────────────────────────────────────
  // Validation view
  // ─────────────────────────────────────────────────────────
  _renderValidation() {
    const result = this.validate();
    const lib    = this._lib();

    const i2cBlocks = this._state.pinConfig
      .filter(pc => lib[pc.blockId]?.protocol === 'I2C')
      .map(pc => lib[pc.blockId]?.name || pc.blockId);

    const rows = this._state.pinConfig.map(pc => {
      const b    = lib[pc.blockId];
      const pins = Object.entries(pc.pins||{})
        .map(([,g]) => g>0 ? `<span style="color:#667eea;font-family:monospace">GPIO ${g}</span>` : '—')
        .join(' · ');
      const auto = pc.autoDetected
        ? `<span class="pm-badge pb-auto">auto</span>` : '';
      const conf = pc.confidence ? `<span style="color:${pc.confidence>=85?'#27ae60':'#f77f00'}">${pc.confidence}%</span>` : '—';
      return `<tr>
        <td style="color:#d5d5ee">${b?.name||pc.blockId} ${auto}</td>
        <td>${pins||'<span style="opacity:.4">Interne</span>'}</td>
        <td style="font-size:11px;color:#7a7fa8">${b?.protocol||'—'}</td>
        <td>${conf}</td>
      </tr>`;
    }).join('');

    const el = document.getElementById('pm-val-content');
    if (!el) return;

    el.innerHTML = `
      <div class="pm-card">
        <div class="pm-ct">Récapitulatif</div>
        <table class="pm-tbl">
          <thead><tr><th>Composant</th><th>GPIO</th><th>Protocole</th><th>Confiance</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${i2cBlocks.length > 1
          ? `<div style="margin-top:10px;font-size:12px;color:#3b82f6;padding:6px 10px;background:#1a2d3d;border-radius:6px">
              📡 Bus I2C partagé entre : ${i2cBlocks.join(', ')}
             </div>` : ''}
      </div>
      ${result.errors.length
        ? `<div class="pm-err-banner">⚠ ${result.errors.join('<br>⚠ ')}</div>`
        : '<div class="pm-ok-banner">✅ Configuration valide — aucun conflit</div>'
      }
      ${result.warnings.length
        ? `<div class="pm-warn-banner">⚠ ${result.warnings.join('<br>⚠ ')}</div>` : ''}`;
  },

  // ─────────────────────────────────────────────────────────
  // Firmware view
  // ─────────────────────────────────────────────────────────
  _renderFirmware() {
    const el = document.getElementById('pm-fw-content');
    if (!el) return;

    const result = this.generateFirmware();
    if (!result) {
      el.innerHTML = '<div style="color:#e63946;padding:20px">FirmwareGenerator non disponible</div>';
      return;
    }

    const hl = result.code.split('\n').slice(0,70).join('\n')
      .replace(/\/\/.*/g, m => `<span class="ino-cmt">${m}</span>`)
      .replace(/#include|#define/g, m => `<span class="ino-kw">${m}</span>`)
      .replace(/\b(void|bool|float|int|String|unsigned long|const|struct)\b/g,
               m => `<span class="ino-kw">${m}</span>`)
      .replace(/"[^"]*"/g, m => `<span class="ino-str">${m}</span>`);

    el.innerHTML = `
      <div class="pm-card">
        <div class="pm-ct">Firmware prêt</div>
        <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
          <button class="pm-btn pm-btn-s" onclick="PinManager.downloadFirmware()">⬇ Télécharger ${result.filename}</button>
          <button class="pm-btn pm-btn-p" onclick="PinManager.savePinsToDevice()">📡 Envoyer config à l'ESP32</button>
        </div>
        <div style="display:flex;gap:16px;margin-bottom:10px;font-size:12px;color:#7a7fa8;flex-wrap:wrap">
          <span>📦 ${result.blockCount} blocs</span>
          <span>📌 ${result.pinCount} pins</span>
          <span>🔧 ${result.libraries.length} librairies</span>
          ${result.sharedPins?.length ? `<span>🔗 ${result.sharedPins.length} bus partagés</span>` : ''}
        </div>
        <div class="pm-ino">${hl}
<span class="ino-cmt">// ... (fichier complet au téléchargement)</span></div>
      </div>
      <div class="pm-card">
        <div class="pm-ct">Librairies Arduino IDE requises</div>
        ${result.libraries.length
          ? result.libraries.map(l =>
              `<div class="pm-lib"><span style="font-size:16px">📦</span>
               <span style="font-family:monospace;color:#d5d5ee">${l}</span>
               <span style="margin-left:auto;font-size:11px;color:#7a7fa8">Gestionnaire de bibliothèques</span></div>`
            ).join('')
          : '<div style="font-size:12px;color:#7a7fa8">Aucune librairie tierce requise</div>'}
      </div>
      <div class="pm-card">
        <div class="pm-ct">Capacités de ce firmware</div>
        <div>${result.capabilities.map(c =>
          `<span class="pm-cap-tag">${c}</span>`).join('')}</div>
      </div>`;
  },

  // ─────────────────────────────────────────────────────────
  // NAVIGATION
  // ─────────────────────────────────────────────────────────
  _goStep(n) {
    this._state.step = n;
    document.querySelectorAll('.pm-view').forEach((v,i) => v.classList.toggle('active',i===n));
    document.querySelectorAll('.pm-step').forEach((s,i) => {
      s.classList.toggle('active',i===n);
      s.classList.toggle('done',i<n);
    });
    if (n===1) { this._renderWiring(); }
    if (n===2) { setTimeout(() => this._renderPinTable(), 30); }
  },

  _goToValidation() { this._renderValidation(); this._goStep(3); },

  _goToFirmware() {
    if (!this.validate().valid) { this._goToValidation(); return; }
    this._goStep(4);
    setTimeout(() => this._renderFirmware(), 30);
  },

  _selMode(mode) {
    this._state.mode = mode;
    document.querySelectorAll('.pm-mc').forEach((c,i) =>
      c.classList.toggle('sel', (i===0&&mode==='auto')||(i===1&&mode==='manual')));
    // Recharger detect zone
    const dz = document.getElementById('pm-detect-zone');
    if (dz) dz.innerHTML = mode==='auto' ? this._htmlAutoDetect() : this._htmlManual();
    setTimeout(() => this._renderPinTable(), 30);
    // Mettre à jour le bouton du schéma
    const btn = document.querySelector('#pm-v-1 .pm-btn-p');
    if (btn) btn.textContent = mode==='auto' ? 'Lancer la détection →' : 'Configurer manuellement →';
  },

  // ─────────────────────────────────────────────────────────
  // Helpers UI
  // ─────────────────────────────────────────────────────────
  async _runScan() {
    const logEl  = document.getElementById('pm-log');
    const statEl = document.getElementById('pm-stat');
    if (logEl)  logEl.innerHTML  = '';
    if (statEl) statEl.textContent = 'Scan en cours...';
    const ok = await this.scanDevice();
    if (ok && statEl) statEl.textContent = `Scan terminé — ${this._state.scanResults.length} GPIO analysés`;
  },

  _progress(pct) {
    const bar = document.getElementById('pm-prog');
    if (bar) bar.style.width = pct + '%';
  },

  _log(type, msg) {
    const el = document.getElementById('pm-log');
    if (!el) { console.log(`[PM] ${msg}`); return; }
    const icons = {ok:'✅',error:'❌',info:'▶',warn:'⚠',detect:'◉'};
    const d = document.createElement('div');
    d.className = `pm-ll pm-${type}`;
    d.textContent = `${icons[type]||'>'} ${msg}`;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  },

  _updateConflictUI() {
    const usedMap = {};
    const lib = this._lib();
    this._state.pinConfig.forEach(pc => {
      const b = lib[pc.blockId];
      if (b?.protocol === 'I2C') return;
      Object.entries(pc.pins||{}).forEach(([role,gpio]) => {
        if (gpio<=0) return;
        const k = String(gpio);
        if (!usedMap[k]) usedMap[k] = [];
        usedMap[k].push(`${pc.blockId}:${role}`);
      });
    });
    const conflicts = new Set();
    Object.entries(usedMap).forEach(([,users]) => {
      if (users.length>1) users.forEach(u => conflicts.add(u));
    });

    document.querySelectorAll('.pm-sel').forEach(sel => {
      const id = sel.id||'';
      const parts = id.replace('pm-sel-','').split('-');
      const role = parts[parts.length-1];
      const blockId = parts.slice(0,-1).join('-');
      sel.classList.toggle('conflict', conflicts.has(`${blockId}:${role}`));
    });

    const banner = document.getElementById('pm-conflict-ui');
    if (banner) {
      if (conflicts.size) {
        banner.className = 'pm-err-banner';
        banner.textContent = '⚠ Conflit détecté — plusieurs blocs utilisent le même GPIO';
      } else {
        banner.className = '';
        banner.textContent = '';
      }
    }
  },
};

if (typeof module !== 'undefined') module.exports = PinManager;
else window.PinManager = PinManager;
