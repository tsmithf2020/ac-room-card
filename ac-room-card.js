/*!
 * ac-room-card
 * Envuelve el card `thermostat` integrado de Home Assistant y le agrega
 * filas opcionales de potencia, energia y sensor de ventana.
 *
 * No copia codigo de Home Assistant: instancia el card integrado en runtime
 * a traves de loadCardHelpers(). Licencia MIT (ver LICENSE).
 */

const VERSION = "0.34.2";

const T = {
  pwOn: "con corriente",
  pwOff: "sin corriente, toca para reponer",
  pwConfirm: "toca otra vez para CORTAR la corriente",
  today: "Hoy",
  month: "Mes",
  window: "Ventana",
  open: "Abierta",
  closed: "Cerrada",
  warn: "Ventana abierta con el aire andando",
  target: "Target",
  actual: "Actual",
  real: "Real",
  schedule: "Programar",
  cancel: "Cancelar",
  offIn: "Apaga en",
  min: "min",
  off: "Apagado",
  isOn: "encendido",
  isOff: "apagado",
  speed: "Velocidad del ventilador",
  windows: "Ventanas",
  batLow: "pila baja",
  unavailable: "no disponible",
};

const T_EN = {
  pwOn: "powered",
  pwOff: "no power, tap to restore",
  pwConfirm: "tap again to CUT the power",
  today: "Today",
  month: "Month",
  window: "Window",
  open: "Open",
  closed: "Closed",
  warn: "Window open while the AC is running",
  target: "Target",
  actual: "Actual",
  real: "Real",
  schedule: "Schedule",
  cancel: "Cancel",
  offIn: "Off in",
  min: "min",
  off: "Off",
  isOn: "on",
  isOff: "off",
  speed: "Fan speed",
  windows: "Windows",
  batLow: "low battery",
  unavailable: "unavailable",
};

/* ---------- idioma ---------- */

/* Español para cualquier `es*`, ingles para el resto. Sin hass (setConfig
   corre antes) se mira el <html lang> que pone Home Assistant; sin nada, se
   queda en español, que es como nacio el card. */
function langOf(hass) {
  const doc = typeof document !== "undefined" && document.documentElement
    ? document.documentElement.lang : "";
  const l = String((hass && ((hass.locale && hass.locale.language) || hass.language)) || doc || "es");
  return l.toLowerCase().startsWith("es") ? "es" : "en";
}

const tr = (lang, es, en) => (lang === "en" ? en : es);

/* ---------- helpers compartidos ---------- */

/* Acepta "sensor.x" o {entity, ...} y devuelve siempre objetos. */
function normEntries(v) {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v])
    .map((x) => (typeof x === "string" ? { entity: x } : x))
    .filter((x) => x && x.entity);
}

/* closed / some / all / unknown, mas el detalle para el tooltip. */
function computeWindows(hass, lista, L) {
  let abiertas = 0, conocidas = 0;
  const detalle = [];
  for (const w of lista) {
    const st = hass.states[w.entity];
    const nombre = w.name || (st && st.attributes.friendly_name) || w.entity;
    if (!st || st.state === "unavailable" || st.state === "unknown") {
      detalle.push(`${nombre}: ${L.unavailable}`);
      continue;
    }
    conocidas++;
    const abierta = st.state === "on";
    if (abierta) abiertas++;
    detalle.push(`${nombre}: ${abierta ? L.open : L.closed}`);
  }
  let estado = "unknown";
  if (conocidas > 0) estado = abiertas === 0 ? "closed" : (abiertas === conocidas ? "all" : "some");
  return { estado, abiertas, conocidas, detalle, lista };
}

function batteriesLow(hass, lista, umbral) {
  const bajos = [];
  for (const w of lista) {
    if (!w.battery) continue;
    const st = hass.states[w.battery];
    if (!st) continue;
    const v = parseFloat(st.state);
    if (!Number.isNaN(v) && v <= umbral) {
      bajos.push(`${w.name || st.attributes.friendly_name || w.battery}: ${v}%`);
    }
  }
  return bajos;
}

/* Segundos que le quedan a un timer, o null si esta parado. */
function remainingSecs(hass, entityId) {
  const st = entityId && hass.states[entityId];
  if (!st) return null;
  if (st.state === "active" && st.attributes.finishes_at) {
    const s = Math.round(new Date(st.attributes.finishes_at).getTime() / 1000 - Date.now() / 1000);
    return s > 0 ? s : 0;
  }
  if (st.state === "paused" && st.attributes.remaining) {
    const [h, m, x] = String(st.attributes.remaining).split(":").map(Number);
    return h * 3600 + m * 60 + (x || 0);
  }
  return null;
}

function hms(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
}

/* ---------- modos: booleans, escenas, scripts y botones ---------- */

/* Un boolean o switch tiene estado on/off. Una escena, un script o un boton
   no: solo se disparan. Para esos, el modo activo es el que se disparo mas
   recientemente (la escena y el boton guardan esa hora en su estado; el
   script, en `last_triggered`), y si lo mas reciente es `off_entity`, el
   equipo esta apagado. */
const STATELESS = ["scene", "script", "button", "input_button"];
const domainOf = (id) => String(id || "").split(".")[0];
const isStateless = (id) => STATELESS.includes(domainOf(id));

function firedAt(hass, id) {
  const st = id && hass.states[id];
  if (!st) return 0;
  const raw = domainOf(id) === "script" ? st.attributes.last_triggered : st.state;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

/* Como normEntries, pero un modo puede no traer `entity` si trae `steps`. */
function normModes(v) {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v])
    .map((x) => (typeof x === "string" ? { entity: x } : x))
    .filter((x) => x && (x.entity || normEntries(x.steps).length));
}

/* Un modo con estado propio (boolean o switch), no una escena. */
const modeIsStateful = (m) =>
  !normEntries(m.steps).length && !!m.entity && !isStateless(m.entity);

/* El ultimo numero del texto: "Living calor 22" -> 22. */
function lastNumber(txt) {
  const m = /(\d+(?:[.,]\d+)?)(?!.*\d)/.exec(String(txt || ""));
  return m ? Number(m[1].replace(",", ".")) : NaN;
}

/* Los pasos de un modo: `steps` (varias escenas, una por temperatura) o su
   `entity` sola. La temperatura de cada paso es `temp`, o si no, el numero
   del nombre de la escena. Si todos tienen numero se ordenan de menor a
   mayor, que es lo que esperan las flechas. */
function modeSteps(hass, m) {
  const lista = normEntries(m && m.steps);
  const base = lista.length ? lista : (m && m.entity ? [{ entity: m.entity }] : []);
  const pasos = base.map((p) => {
    const st = hass && hass.states[p.entity];
    // El numero del nombre solo cuenta en escenas y botones: en un boolean
    // ("AC pieza 2") casi nunca es una temperatura.
    const n = p.temp !== undefined && p.temp !== null && p.temp !== ""
      ? Number(p.temp)
      : isStateless(p.entity) ? lastNumber(p.name || (st && st.attributes.friendly_name)) : NaN;
    // Turbo y swing: misma temperatura, otra variante. `turbo:` / `swing:`
    // mandan; si no, se busca en el nombre o el entity_id. Los nombres vienen
    // pegados y abreviados ("AireLiving23hotTurbSwing"), asi que basta "turb"
    // en cualquier parte, sin exigir la palabra entera.
    const texto = `${(st && st.attributes.friendly_name) || ""} ${p.entity}`;
    const turbo = p.turbo !== undefined ? !!p.turbo : /turb/i.test(texto);
    const swing = p.swing !== undefined ? !!p.swing : /swing/i.test(texto);
    return { ...p, num: Number.isFinite(n) ? n : null, turbo, swing };
  });
  // A igual temperatura: normal, swing, turbo, turbo+swing. ▲ recorre las
  // variantes antes de pasar al grado siguiente.
  if (pasos.length > 1 && pasos.every((p) => p.num !== null)) {
    pasos.sort((a, b) => (a.num - b.num) || (Number(a.turbo) - Number(b.turbo)) ||
      (Number(a.swing) - Number(b.swing)));
  }
  return pasos;
}

/* "T", "S", "TS" o nada. */
const stepMarks = (p) => (p ? `${p.turbo ? "T" : ""}${p.swing ? "S" : ""}` : "");

function stepLabel(hass, p) {
  if (!p) return "";
  if (p.name) return p.name;
  if (p.num !== null) return `${p.num}°${stepMarks(p) ? ` ${stepMarks(p)}` : ""}`;
  const st = hass && hass.states[p.entity];
  return (st && st.attributes.friendly_name) || p.entity;
}

/* Modo y paso en marcha. Un boolean prendido gana; si no, el paso de escena
   disparado mas recientemente, salvo que `off_entity` sea mas nuevo. */
function activeModeStep(hass, modes, offEntity) {
  const lista = modes || [];
  const conEstado = lista.findIndex((m) => {
    if (!modeIsStateful(m)) return false;
    const st = hass.states[m.entity];
    return !!st && st.state === "on";
  });
  if (conEstado >= 0) return { mode: conEstado, step: 0 };
  let mejor = { mode: -1, step: -1 };
  let hora = offEntity ? firedAt(hass, offEntity) : 0;
  lista.forEach((m, i) => {
    modeSteps(hass, m).forEach((p, j) => {
      if (!isStateless(p.entity)) return;
      const t = firedAt(hass, p.entity);
      if (t > hora) { hora = t; mejor = { mode: i, step: j }; }
    });
  });
  return mejor;
}

function activeModeIndex(hass, modes, offEntity) {
  return activeModeStep(hass, modes, offEntity).mode;
}

/* Al elegir un modo se vuelve al paso que se uso la ultima vez en ese modo;
   si nunca se uso, el primero. */
function lastUsedStep(hass, pasos) {
  let j = 0;
  let hora = 0;
  pasos.forEach((p, i) => {
    const t = firedAt(hass, p.entity);
    if (t > hora) { hora = t; j = i; }
  });
  return j;
}

function fireEntity(hass, id, on = true) {
  const d = domainOf(id);
  if (d === "scene" || d === "script") return hass.callService(d, "turn_on", { entity_id: id });
  if (d === "button" || d === "input_button") return hass.callService(d, "press", { entity_id: id });
  const srv = on ? "turn_on" : "turn_off";
  return hass.callService(["input_boolean", "switch"].includes(d) ? d : "homeassistant", srv, { entity_id: id });
}

/* Apaga primero los otros y despues prende el elegido: si cada boolean
   dispara una escena IR, el orden inverso dejaria el equipo apagado.
   idx -1 es Apagado: apaga los booleans y dispara `off_entity` si hay. */
function setModeFor(hass, modes, offEntity, idx, stepIdx) {
  const lista = modes || [];
  lista.forEach((m, i) => {
    if (i === idx || !modeIsStateful(m)) return;
    const st = hass.states[m.entity];
    if (st && st.state === "on") fireEntity(hass, m.entity, false);
  });
  if (idx < 0) {
    if (offEntity) fireEntity(hass, offEntity, true);
  } else if (lista[idx]) {
    const pasos = modeSteps(hass, lista[idx]);
    const j = stepIdx === undefined ? lastUsedStep(hass, pasos) : stepIdx;
    if (pasos[j]) fireEntity(hass, pasos[j].entity, true);
  }
}

/* Flechas: sube o baja un paso dentro del modo en marcha. En los extremos no
   hace nada. Devuelve si disparo algo. */
function stepModeFor(hass, modes, offEntity, dir) {
  const a = activeModeStep(hass, modes, offEntity);
  if (a.mode < 0) return false;
  const pasos = modeSteps(hass, modes[a.mode]);
  const j = a.step + dir;
  if (j < 0 || j >= pasos.length) return false;
  fireEntity(hass, pasos[j].entity, true);
  return true;
}

/* Sin boolean que apagar ni off_entity, el boton Apagado no haria nada. */
const canTurnOff = (modes, offEntity) =>
  !!offEntity || (modes || []).some(modeIsStateful);

function moreInfo(el, entityId) {
  if (!entityId) return;
  el.dispatchEvent(new CustomEvent("hass-more-info", {
    detail: { entityId }, bubbles: true, composed: true,
  }));
}

// Tramos elegidos por lo que se ve en una pieza, no por fisica: de noche con
// la luz apagada se está bajo 10 lx, una lampara da decenas, y un dia nublado
// entrando por la ventana ya pasa de 1000.
function luxIcon(st) {
  const v = st ? Number(st.state) : NaN;
  if (!Number.isFinite(v)) return "mdi:brightness-5";
  if (v < 10) return "mdi:weather-night";
  if (v < 100) return "mdi:brightness-4";
  if (v < 1000) return "mdi:brightness-5";
  return "mdi:white-balance-sunny";
}

/* ---------- vista de arriba ---------- */

/* `base_view` elige lo que va arriba sin escribir un base_card a mano:
     compact    -> mini-climate con los rotulos TARGET / ACTUAL
     thermostat -> el termostato integrado (por defecto, como siempre)
     none       -> nada, solo el encabezado y las filas
   Un `base_card` escrito en YAML siempre gana ("custom"). */
const BASE_VIEWS = ["compact", "thermostat", "none"];
const MINI_CLIMATE = "mini-climate";

const COMPACT_STYLE = {
  "": `
.mc-climate { padding-top: 0 !important; padding-bottom: 0 !important; }
.entity__controls { margin-top: calc(var(--mc-unit) * -.35); }
`,
  "mc-temperature": `
.state { padding-top: 12px; }
.state__value { position: relative; }
.state__value:nth-of-type(1)::before { content: "Target"; }
.state__value:nth-of-type(3)::before { content: "Actual"; }
.state__value:nth-of-type(1)::before,
.state__value:nth-of-type(3)::before {
  position: absolute; bottom: calc(100% + 1px); left: 50%;
  transform: translateX(-50%);
  font-size: 9px; line-height: 1; letter-spacing: .04em;
  text-transform: uppercase; font-weight: 500; white-space: nowrap;
  color: var(--secondary-text-color);
}
`,
};

function resolveView(cfg) {
  const c = cfg || {};
  if (c.base_card && typeof c.base_card === "object") return "custom";
  if (c.base_card === false) return "none";
  return BASE_VIEWS.includes(c.base_view) ? c.base_view : "thermostat";
}

function hasElement(tag) {
  return typeof customElements !== "undefined" && !!customElements.get(tag);
}

/* La misma config de mini-climate que llevan a mano las tarjetas del panel. */
function compactBaseCard(cfg) {
  const dm = normDecimals(cfg.decimals);
  const out = {
    type: `custom:${MINI_CLIMATE}`,
    entity: cfg.entity,
    secondary_info: {},
    fan_mode: { hide: false, location: "main" },
    hide_icon: true,
    group: true,
    temperature: { fixed: dm === null ? 1 : dm },
  };
  // Con encabezado propio, mini-climate no repite el nombre debajo.
  if (cfg.name) out.name = " ";
  return out;
}

/* La fila de botones de modo (apagado / frio / calor / seco / ventilador) del
   termostato nativo. Sin ella habia que abrir el dialogo de los tres puntos
   para cambiar el modo. El feature solo dibuja los modos que se le listan,
   asi que se le pasan los que declara el propio equipo. */
function hvacModeFeatures(hass, entityId) {
  const st = hass && entityId && hass.states[entityId];
  const modos = st && Array.isArray(st.attributes.hvac_modes) ? st.attributes.hvac_modes : [];
  return modos.length ? [{ type: "climate-hvac-modes", hvac_modes: modos.slice() }] : null;
}

/* Los recursos de HACS cargan en paralelo: mini-climate puede definirse
   despues que este archivo. Se espera un poco y, si no llega, se cae al
   termostato integrado en vez de dejar un card de error. */
function whenElement(tag, ms = 3000) {
  if (hasElement(tag)) return Promise.resolve(true);
  if (typeof customElements === "undefined" || typeof customElements.whenDefined !== "function") {
    return Promise.resolve(false);
  }
  return Promise.race([
    customElements.whenDefined(tag).then(() => true),
    new Promise((r) => setTimeout(() => r(false), ms)),
  ]);
}

class AcRoomCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._inner = null;
    this._rows = {};
    this._built = false;
  }

  static getConfigElement() {
    return document.createElement("ac-room-card-editor");
  }

  static getStubConfig(hass, entities) {
    const climate = (entities || []).find((e) => e.startsWith("climate."));
    const stub = { entity: climate || "climate.example" };
    // Agregada desde la UI, sale igual que las del panel si hay mini-climate.
    if (hasElement(MINI_CLIMATE)) stub.base_view = "compact";
    return stub;
  }

  setConfig(config) {
    // `entity` ya no es obligatoria: sirve una tarjeta sin equipo de clima,
    // por ejemplo un garage con solo sensor de puerta y ventiladores.
    const algo = config && (config.entity || config.base_card || config.power_entity ||
      config.lux_entity ||
      config.window_entity || config.temp_entity || config.lux_entity ||
      (config.fans && config.fans.length) || (config.modes && config.modes.length) ||
      (config.timer && config.timer.entity));
    if (!algo) {
      throw new Error(tr(langOf(this._hass),
        "Configura al menos una entidad (equipo, potencia, ventana, temperatura, ventiladores o temporizador)",
        "Set at least one entity (unit, power, window, temperature, fans or timer)"));
    }
    this._lang = langOf(this._hass);
    this._config = {
      labels: {},
      ...config,
      labels: { ...(this._lang === "en" ? T_EN : T), ...(config.labels || {}) },
    };
    this._userLabels = config.labels || {};
    // Un cambio de config obliga a reconstruir el card interno.
    this._built = false;
    this._inner = null;
    this._innerStyle = undefined;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // El idioma se conoce recien con hass: si no calza con el de setConfig,
    // se rehacen los textos y el card.
    const lang = langOf(hass);
    if (this._config && lang !== this._lang) {
      this._lang = lang;
      this._config = { ...this._config, labels: { ...(lang === "en" ? T_EN : T), ...this._userLabels } };
      this._built = false;
      this._inner = null;
      this._innerStyle = undefined;
      if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    }
    this._render();
  }

  getCardSize() {
    if (!this._config) return 3;
    const extra = this._config.timer && this._config.timer.entity ? 1 : 0;
    const view = resolveView(this._config);
    if (view === "custom" || view === "compact") return 4 + extra;
    if (view === "none" || !this._config.entity) return 2;
    return this._config.entity.startsWith("climate.") ? 6 : 3;
  }

  /* ---------- construccion ---------- */

  async _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) {
      this._built = true; // antes del await, para no construir dos veces
      try {
        // false: la pasada quedo vieja y ya corre otra; esta no toca nada.
        if ((await this._build()) === false) return;
      } catch (err) {
        this._built = false;
        this._renderError(err);
        return;
      }
    }
    if (this._inner) this._inner.hass = this._hass;
    this._update();
  }

  async _build() {
    const cfg = this._config;
    const domain = cfg.entity ? cfg.entity.split(".")[0] : "";

    const helpers = await window.loadCardHelpers();

    // Con `modes` el propio card dibuja el selector, asi que no hace falta
    // envolver nada salvo que se pida un base_card explicito.
    // Sin card arriba cuando: se pide explicitamente (base_view: none o
    // base_card: false), hay selector de modos propio, o no hay equipo.
    const view = resolveView(cfg);
    const skipInner = view === "none" ||
      (view !== "custom" && ((Array.isArray(cfg.modes) && cfg.modes.length > 0) || !cfg.entity));
    const compact = !skipInner && view === "compact" && domain === "climate" &&
      await whenElement(MINI_CLIMATE);
    if (cfg !== this._config) return false;

    // base_card permite envolver CUALQUIER card (custom:mini-climate,
    // custom:simple-thermostat, etc). Sin el, se usa el thermostat integrado
    // para entidades climate y un tile para el resto.
    let innerCfg;
    this._innerStyle = cfg.base_card_style || null;
    if (view === "custom") {
      innerCfg = { ...cfg.base_card };
      if (!innerCfg.entity) innerCfg.entity = cfg.entity;
    } else if (compact) {
      innerCfg = compactBaseCard(cfg);
      if (!this._innerStyle) this._innerStyle = COMPACT_STYLE;
    } else {
      innerCfg =
        domain === "climate"
          ? { type: "thermostat", entity: cfg.entity }
          : { type: "tile", entity: cfg.entity, features_position: "bottom", vertical: false };
      // cfg.name pinta el encabezado propio. Al card interno se le manda un
      // espacio para que no repita el friendly_name debajo del encabezado.
      if (cfg.name) innerCfg.name = " ";
      if (cfg.features) innerCfg.features = cfg.features;
      else if (domain === "climate" && cfg.mode_buttons !== false) {
        const feats = hvacModeFeatures(this._hass, cfg.entity);
        if (feats) innerCfg.features = feats;
      }
    }

    const inner = skipInner ? null : await helpers.createCardElement(innerCfg);
    // setConfig o un cambio de idioma durante los await dejan esta pasada
    // vieja: la que vale es la que arranco despues.
    if (cfg !== this._config) return false;
    this._inner = inner;
    if (inner) inner.hass = this._hass;

    const card = document.createElement("ha-card");
    card.className = "root";

    if (cfg.name) {
      const head = document.createElement("div");
      head.className = "header";
      head.innerHTML =
        (cfg.icon ? `<ha-icon class="hicon" icon="${cfg.icon}"></ha-icon>` : "") +
        `<span class="title"></span>`;
      head.querySelector(".title").textContent = cfg.name;
      card.appendChild(head);
    }

    if (this._inner) {
      const innerWrap = document.createElement("div");
      innerWrap.className = "inner";
      innerWrap.appendChild(this._inner);
      card.appendChild(innerWrap);
    }

    const modos = normModes(cfg.modes);
    if (modos.length) {
      const mr = document.createElement("div");
      mr.className = "moderow";
      const mk = (label, icon, idx) => {
        const b = document.createElement("button");
        b.className = "mode";
        b.dataset.idx = String(idx);
        b.innerHTML = (icon ? `<ha-icon icon="${icon}"></ha-icon>` : "") + `<span></span>`;
        b.querySelector("span").textContent = label;
        b.addEventListener("click", () => this._setMode(idx));
        mr.appendChild(b);
        return b;
      };
      this._modeBtns = canTurnOff(modos, cfg.off_entity)
        ? [mk(cfg.labels.off, "mdi:power", -1)] : [];
      modos.forEach((m, i) => this._modeBtns.push(mk(m.name || m.entity, m.icon, i)));

      // Flechas para pasar entre las escenas del modo en marcha (una por
      // temperatura). Solo se ven si ese modo tiene mas de una.
      if (modos.some((m) => normEntries(m.steps).length > 1)) {
        const sp = document.createElement("span");
        sp.className = "stepper";
        sp.innerHTML =
          `<button class="sdown"><ha-icon icon="mdi:chevron-down"></ha-icon></button>` +
          `<span class="sval"></span>` +
          `<button class="sup"><ha-icon icon="mdi:chevron-up"></ha-icon></button>`;
        sp.querySelector(".sdown").addEventListener("click", () => this._stepMode(-1));
        sp.querySelector(".sup").addEventListener("click", () => this._stepMode(1));
        mr.appendChild(sp);
        this._stepper = sp;
      }
      card.appendChild(mr);
      this._rows.modes = mr;
    }

    const footer = document.createElement("div");
    footer.className = "footer";
    card.appendChild(footer);

    this._rows.power = this._addRow(footer, "mdi:flash", null, true);
    this._rows.energy = this._addRow(footer, "mdi:lightning-bolt-outline", cfg.labels.today);

    if (this._fanModeSupported()) this._buildFanMode();

    /* Por defecto todos van en la linea de datos: caben de sobra y se lee
       mejor que con una fila aparte. `auto` deja el comportamiento viejo (uno
       en la linea, dos o mas en fila propia) y `row` fuerza la fila. */
    const fans = this._fanList();
    const modo = cfg.fans_position || "inline";
    const enLinea = fans.length > 0 &&
      (modo === "inline" || (modo === "auto" && fans.length === 1));
    this._fansInline = enLinea;
    if (enLinea) {
      // position: "start" los pone antes de la potencia; el resto va al final
      const fin = this._rows.power.querySelector(".fanslot");
      const ini = this._rows.power.querySelector(".preslot");
      this._fanBtns = fans.map((f) => {
        const b = this._makeFanBtn(f);
        (f.position === "start" && ini ? ini : fin).appendChild(b);
        return b;
      });
    } else if (fans.length) {
      this._fanBtns = [];  // la fila va despues del temporizador
    }

    const pw = this._powerSwitch();
    if (pw) {
      const slot = this._rows.power.querySelector(".pwslot");
      this._pwBtn = this._makePowerBtn(pw);
      if (slot) slot.appendChild(this._pwBtn);
    }

    if (cfg.timer && cfg.timer.entity) {
      const t = document.createElement("div");
      t.className = "timerrow";
      t.innerHTML =
        `<ha-icon class="tico" icon="mdi:timer-outline"></ha-icon>` +
        `<button class="step minus" title="-">\u2212</button>` +
        `<span class="mins"></span>` +
        `<button class="step plus" title="+">+</button>` +
        `<button class="go"></button>`;
      card.appendChild(t);
      this._rows.timer = t;
      t.querySelector(".minus").addEventListener("click", () => this._nudge(-1));
      t.querySelector(".plus").addEventListener("click", () => this._nudge(1));
      t.querySelector(".go").addEventListener("click", () => this._go());
    }

    if (fans.length && !enLinea) {
      const fr = document.createElement("div");
      fr.className = "fanrow";
      for (const f of fans) {
        const b = this._makeFanBtn(f);
        fr.appendChild(b);
        this._fanBtns.push(b);
      }
      card.appendChild(fr);
      this._rows.fans = fr;
    }

    const warn = document.createElement("div");
    warn.className = "warn";
    warn.innerHTML = `<ha-icon icon="mdi:alert"></ha-icon><span></span>`;
    card.appendChild(warn);
    this._rows.warn = warn;

    this.shadowRoot.innerHTML = "";
    this.shadowRoot.appendChild(this._style());
    this.shadowRoot.appendChild(card);

    if (this._inner) this._stripInnerCard();
  }

  _addRow(parent, icon, label, withWindow) {
    const row = document.createElement("div");
    row.className = "row";
    if (withWindow) row.className = "row main";
    row.innerHTML =
      (withWindow ? `<span class="preslot"></span>` : "") +
      `<ha-icon class="picon" icon="${icon}"></ha-icon>` +
      (label === null ? "" : `<span class="label">${label}</span>`) +
      `<span class="value"></span>` +
      (withWindow
        ? `<span class="winwrap"><ha-icon class="win"></ha-icon>` +
          `<span class="batdot"></span></span>` +
          `<ha-icon class="tempicon" icon="mdi:thermometer"></ha-icon>` +
          `<span class="temp"></span>` +
          `<ha-icon class="luxicon" icon="mdi:brightness-5"></ha-icon>` +
          `<span class="lux"></span>` +
          `<span class="fanslot"></span>` +
          `<span class="fmslot"></span>` +
          `<span class="pwslot"></span>`
        : "");
    parent.appendChild(row);
    return row;
  }

  /* El card interno trae su propio <ha-card>. Le sacamos borde y fondo para
     que no se vea un marco dentro de otro. Vive en shadow DOM, asi que hay
     que entrar a buscarlo; si no aparece, el card igual funciona. */
  _stripInnerCard(tries = 0) {
    const inner = this._inner;
    if (!inner) return;
    const target = inner.shadowRoot && inner.shadowRoot.querySelector("ha-card");
    if (!target) {
      if (tries < 10) setTimeout(() => this._stripInnerCard(tries + 1), 60);
      return;
    }
    target.style.boxShadow = "none";
    target.style.border = "none";
    target.style.background = "none";
    target.style.borderRadius = "0";
    this._injectInnerStyle();
  }

  /* base_card_style: CSS inyectado DENTRO del shadow root del card envuelto.
     Acepta un string, o un mapa selector -> css para llegar a shadow roots
     anidados (por ejemplo mc-temperature, que tiene el suyo propio). */
  _injectInnerStyle(tries = 0) {
    // _build() deja el CSS resuelto (el propio o el de la vista compacta).
    const cfg = this._innerStyle !== undefined ? this._innerStyle : this._config.base_card_style;
    const root = this._inner && this._inner.shadowRoot;
    if (!cfg || !root) return;
    const mapa = typeof cfg === "string" ? { "": cfg } : cfg;
    let faltan = false;
    for (const [sel, css] of Object.entries(mapa)) {
      let destino = root;
      if (sel) {
        const el = root.querySelector(sel);
        // Los elementos anidados montan despues; se reintenta.
        if (!el || !el.shadowRoot) { faltan = true; continue; }
        destino = el.shadowRoot;
      }
      const marca = `style[data-acrc="${sel}"]`;
      let st = destino.querySelector(marca);
      if (!st) {
        st = document.createElement("style");
        st.setAttribute("data-acrc", sel);
        destino.appendChild(st);
      }
      if (st.textContent !== css) st.textContent = css;
    }
    if (faltan && tries < 15) setTimeout(() => this._injectInnerStyle(tries + 1), 100);
  }

  _renderError(err) {
    this.shadowRoot.innerHTML =
      `<ha-card style="padding:16px;color:var(--error-color,#db4437)">` +
      `ac-room-card: ${err && err.message ? err.message : err}</ha-card>`;
  }

  /* ---------- datos ---------- */

  _fmt(entityId, decimals = null) {
    if (!entityId) return null;
    const st = this._hass.states[entityId];
    if (!st) return { text: this._config.labels.unavailable, missing: true };
    if (st.state === "unavailable" || st.state === "unknown") {
      return { text: this._config.labels.unavailable, missing: true };
    }
    let text;
    const num = Number(st.state);
    if (decimals !== null && st.state !== "" && !Number.isNaN(num)) {
      // Con `decimals` manda la tarjeta: formatEntityState respeta la precision
      // de cada sensor y deja "24" al lado de "23.5".
      const u = st.attributes.unit_of_measurement;
      text = u ? `${num.toFixed(decimals)} ${u}` : num.toFixed(decimals);
    } else if (typeof this._hass.formatEntityState === "function") {
      text = this._hass.formatEntityState(st);
    } else {
      const n = Number(st.state);
      let v = st.state;
      // Sin formatEntityState, un sensor como 22.6000003814697 se veria entero.
      if (!Number.isNaN(n) && /\.\d{3,}/.test(st.state)) v = n.toFixed(1);
      const u = st.attributes.unit_of_measurement;
      text = u ? `${v} ${u}` : v;
    }
    return { text, missing: false, state: st };
  }

  _update() {
    const cfg = this._config;
    const L = cfg.labels;

    /* Fila unica: potencia y, pegado al lado, el simbolo de ventana.
       Verde todas cerradas, naranjo algunas, rojo todas, gris sin dato. */
    const win = this._rows.power.querySelector(".win");
    const wrap = this._rows.power.querySelector(".winwrap");
    const dot = this._rows.power.querySelector(".batdot");
    const w = this._windowState();
    let windowOpen = false;
    if (!wrap || !win || !dot) {
      // Nunca deberia pasar; si pasa, es preferible perder el icono de
      // ventana antes que abortar _update y dejar el card entero en blanco.
      windowOpen = w.abiertas > 0;
    } else if (!w.lista.length) {
      wrap.style.display = "none";
    } else {
      wrap.style.display = "";
      windowOpen = w.abiertas > 0;
      const CLASES = { closed: "win closed", some: "win some", all: "win open", unknown: "win unknown" };
      win.className = CLASES[w.estado];
      win.setAttribute("icon", windowOpen ? "mdi:window-open-variant" : "mdi:window-closed-variant");
      const resumen = w.lista.length > 1 ? ` (${w.abiertas}/${w.conocidas})` : "";
      win.setAttribute("title", `${L.window}${resumen}\n${w.detalle.join("\n")}`);

      const bajos = this._batteryLow();
      dot.style.display = bajos.length ? "" : "none";
      if (bajos.length) dot.setAttribute("title", `${L.batLow}\n${bajos.join("\n")}`);
    }

    // Temperatura de la pieza, a la derecha del simbolo de ventana
    const tIcon = this._rows.power.querySelector(".tempicon");
    const tVal = this._rows.power.querySelector(".temp");
    const t = this._fmt(cfg.temp_entity, normDecimals(cfg.decimals));
    if (!t) {
      tIcon.style.display = "none";
      tVal.style.display = "none";
    } else {
      tIcon.style.display = "";
      tVal.style.display = "";
      tVal.textContent = t.text;
    }

    // Luz de la pieza, a la derecha de la temperatura
    const lIcon = this._rows.power.querySelector(".luxicon");
    const lVal = this._rows.power.querySelector(".lux");
    const lx = this._fmt(cfg.lux_entity);
    if (lIcon && lVal) {
      if (!lx) {
        lIcon.style.display = "none";
        lVal.style.display = "none";
      } else {
        lIcon.style.display = "";
        lVal.style.display = "";
        lVal.textContent = lx.text;
        // El icono acompaña al valor: sol lleno con mucha luz, luna de noche.
        lIcon.setAttribute("icon", luxIcon(lx.state));
      }
    }

    const p = this._fmt(cfg.power_entity);
    if (!p && !cfg.window_entity && !cfg.temp_entity && !cfg.lux_entity) {
      this._rows.power.style.display = "none";
    } else {
      this._rows.power.style.display = "";
      // El rayo es del sensor de potencia: sin sensor, no se dibuja.
      const pic = this._rows.power.querySelector(".picon");
      if (pic) pic.style.display = cfg.power_entity ? "" : "none";
      this._rows.power.querySelector(".value").textContent = p ? p.text : "";
    }

    // Energia: hoy y/o mes, en su propia fila (opcional)
    const today = this._fmt(cfg.energy_today_entity);
    const month = this._fmt(cfg.energy_month_entity);
    if (!today && !month) {
      this._rows.energy.style.display = "none";
    } else {
      this._rows.energy.style.display = "";
      const parts = [];
      if (today) parts.push(`${L.today} ${today.text}`);
      if (month) parts.push(`${L.month} ${month.text}`);
      this._rows.energy.querySelector(".label").textContent = "";
      this._rows.energy.querySelector(".value").textContent = parts.join(" \u00b7 ");
    }

    // Aviso opcional (por defecto apagado: el icono rojo ya lo dice)
    let acOn;
    if (Array.isArray(cfg.modes) && cfg.modes.length) {
      acOn = this._activeMode() >= 0;
    } else {
      const main = cfg.entity ? this._hass.states[cfg.entity] : null;
      acOn = !!main && main.state !== "off" && main.state !== "unavailable" && main.state !== "unknown";
    }
    const show = !!cfg.show_warning && windowOpen && acOn;
    this._rows.warn.style.display = show ? "flex" : "none";
    if (show) this._rows.warn.querySelector("span").textContent = L.warn;

    this._bindMoreInfo(this._rows.power.querySelector(".picon"), () => cfg.power_entity);
    this._bindMoreInfo(this._rows.power.querySelector(".value"), () => cfg.power_entity);
    this._bindMoreInfo(this._rows.power.querySelector(".win"), () => {
      const w = this._windowState();
      const abierta = w.lista.find((x) => {
        const st = this._hass.states[x.entity];
        return st && st.state === "on";
      });
      return (abierta || w.lista[0] || {}).entity;
    });
    this._bindMoreInfo(this._rows.power.querySelector(".tempicon"), () => cfg.temp_entity);
    this._bindMoreInfo(this._rows.power.querySelector(".temp"), () => cfg.temp_entity);
    this._bindMoreInfo(this._rows.power.querySelector(".luxicon"), () => cfg.lux_entity);
    this._bindMoreInfo(this._rows.power.querySelector(".lux"), () => cfg.lux_entity);

    this._updateFanMode();
    this._updateFans();
    this._updatePowerSwitch();
    this._updateModes();
    this._updateTimer();
  }

  /* ---------- ventanas ---------- */

  _windowList() {
    return normEntries(this._config.window_entity);
  }

  /* closed = todas cerradas, some = algunas, all = todas abiertas.
     Con una sola ventana `some` no puede ocurrir, asi que el naranjo
     aparece solo cuando de verdad hay algo parcial. */
  _windowState() {
    return computeWindows(this._hass, this._windowList(), this._config.labels);
  }

  /* Pila baja de cualquiera de los sensores de ventana. Es una falla
     silenciosa: el sensor deja de reportar y la ventana parece cerrada. */
  _batteryLow() {
    const umbral = this._config.battery_warn === undefined ? 20 : Number(this._config.battery_warn);
    return batteriesLow(this._hass, this._windowList(), umbral);
  }

  /* ---------- interaccion ---------- */

  /* Abre el dialogo estandar de Home Assistant. composed:true es obligatorio:
     sin eso el evento no sale del shadow DOM del card. */
  _moreInfo(entityId) {
    moreInfo(this, entityId);
  }

  _bindMoreInfo(el, getEntity) {
    if (!el || el._bound) return;
    el._bound = true;
    el.style.cursor = "pointer";
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._moreInfo(getEntity());
    });
  }

  /* ---------- ventiladores ---------- */

  _fanList() {
    return normEntries(this._config.fans);
  }

  _fanIsOn(entityId) {
    const st = this._hass.states[entityId];
    return !!st && st.state === "on";
  }

  _toggleFan(entityId) {
    // homeassistant.toggle sirve para fan, switch y tambien para los
    // ventiladores que quedaron expuestos como light.
    this._hass.callService("homeassistant", "toggle", { entity_id: entityId });
  }

  _makeFanBtn(f) {
    const b = document.createElement("button");
    b.className = "fan";
    b.dataset.entity = f.entity;
    const st = this._hass.states[f.entity];
    b.dataset.label = f.name || (st && st.attributes.friendly_name) || f.entity;
    // color propio para el estado encendido; sin esto se usa el verde comun
    if (f.color) b.dataset.color = f.color;
    b.innerHTML = `<ha-icon icon="${f.icon || "mdi:fan"}"></ha-icon>`;
    b.addEventListener("click", () => this._toggleFan(f.entity));
    return b;
  }

  _updateFans() {
    if (!this._fanBtns) return;
    const L = this._config.labels;
    for (const b of this._fanBtns) {
      const st = this._hass.states[b.dataset.entity];
      const on = !!st && st.state === "on";
      b.className = on ? "fan on" : "fan off";
      b.style.color = on && b.dataset.color ? b.dataset.color : "";
      // Sin nombre visible: el tooltip es lo que distingue un ventilador de otro
      b.title = `${b.dataset.label}: ${!st ? L.unavailable : on ? L.isOn : L.isOff}`;
    }
  }

  /* ---------- corte de corriente ---------- */

  /* `power_switch`: el enchufe o rele que alimenta al equipo. Acepta un
     entity_id suelto o un objeto {entity, name, icon, icon_off, confirm}.
     Cortar la corriente a un aire andando no es lo mismo que apagar una luz,
     asi que por defecto pide DOS toques; reponerla nunca pide confirmacion. */
  _powerSwitch() {
    return normPlug(this._config.power_switch);
  }

  _makePowerBtn(pw) {
    const b = document.createElement("button");
    b.className = "pw";
    b.dataset.entity = pw.entity;
    const st = this._hass.states[pw.entity];
    b.dataset.label = pw.name || (st && st.attributes.friendly_name) || pw.entity;
    b.innerHTML = `<ha-icon></ha-icon>`;
    b.addEventListener("click", (ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      this._powerClick();
    });
    return b;
  }

  _powerClick() {
    const pw = this._powerSwitch();
    if (!pw) return;
    const st = this._hass.states[pw.entity];
    if (!st || st.state === "unavailable" || st.state === "unknown") return;
    const dominio = pw.entity.split(".")[0];
    const desarmar = () => {
      this._pwArmado = false;
      if (this._pwTimer) { clearTimeout(this._pwTimer); this._pwTimer = null; }
    };
    if (st.state !== "on") {
      desarmar();
      this._hass.callService(dominio, "turn_on", { entity_id: pw.entity });
      this._updatePowerSwitch();
      return;
    }
    if (pw.confirm !== false && !this._pwArmado) {
      this._pwArmado = true;
      if (this._pwTimer) clearTimeout(this._pwTimer);
      // Si no confirma, el boton vuelve solo a su estado normal.
      this._pwTimer = setTimeout(() => { this._pwArmado = false; this._updatePowerSwitch(); }, 5000);
      this._updatePowerSwitch();
      return;
    }
    desarmar();
    this._hass.callService(dominio, "turn_off", { entity_id: pw.entity });
    this._updatePowerSwitch();
  }

  _updatePowerSwitch() {
    if (!this._pwBtn) return;
    const L = this._config.labels;
    const pw = this._powerSwitch() || {};
    const st = this._hass.states[this._pwBtn.dataset.entity];
    const falta = !st || st.state === "unavailable" || st.state === "unknown";
    const on = !!st && st.state === "on";
    const armado = !!this._pwArmado && on;
    this._pwBtn.className = "pw " + (falta ? "na" : armado ? "armed" : on ? "on" : "cut");
    const ico = this._pwBtn.querySelector("ha-icon");
    if (ico) {
      ico.setAttribute("icon", armado ? "mdi:power-plug-off-outline"
        : on ? (pw.icon || "mdi:power-plug") : (pw.icon_off || "mdi:power-plug-off"));
    }
    const nombre = this._pwBtn.dataset.label;
    this._pwBtn.title = falta ? `${nombre}: ${L.unavailable}`
      : armado ? `${nombre}: ${L.pwConfirm}`
      : on ? `${nombre}: ${L.pwOn}`
      : `${nombre}: ${L.pwOff}`;
  }

  /* ---------- velocidad del ventilador del equipo ---------- */

  _fanModeSupported() {
    if (!this._config.fan_mode || !this._config.entity) return false;
    const st = this._hass.states[this._config.entity];
    return !!(st && Array.isArray(st.attributes.fan_modes) && st.attributes.fan_modes.length);
  }

  _buildFanMode() {
    const slot = this._rows.power.querySelector(".fmslot");
    const wrap = document.createElement("span");
    wrap.className = "fanmode";
    wrap.innerHTML = `<ha-icon icon="mdi:fan"></ha-icon><select></select>`;
    const sel = wrap.querySelector("select");
    sel.title = this._config.labels.speed;
    // change, no click: asi el desplegable nativo muestra las opciones y
    // recien al elegir una se llama al servicio.
    sel.addEventListener("change", () => {
      this._hass.callService("climate", "set_fan_mode", {
        entity_id: this._config.entity,
        fan_mode: sel.value,
      });
    });
    slot.appendChild(wrap);
    this._fanModeEl = wrap;
  }

  _prettyMode(m) {
    const custom = this._config.fan_mode_names || {};
    if (custom[m]) return custom[m];
    return String(m).charAt(0).toUpperCase() + String(m).slice(1);
  }

  _updateFanMode() {
    if (!this._fanModeEl || !this._config.entity) return;
    const st = this._hass.states[this._config.entity];
    const modes = (st && st.attributes.fan_modes) || [];
    const actual = st && st.attributes.fan_mode;
    const sel = this._fanModeEl.querySelector("select");
    const firma = modes.join("|");
    if (sel._firma !== firma) {
      sel._firma = firma;
      sel.innerHTML = "";
      for (const m of modes) {
        const o = document.createElement("option");
        o.value = m;
        o.textContent = this._prettyMode(m);
        sel.appendChild(o);
      }
    }
    if (actual !== undefined && sel.value !== actual) sel.value = actual;
    const apagado = !st || st.state === "off" || st.state === "unavailable";
    this._fanModeEl.className = apagado ? "fanmode off" : "fanmode";
  }

  /* ---------- modos (frio / calor) ---------- */

  _activeMode() {
    return activeModeIndex(this._hass, normModes(this._config.modes), this._config.off_entity);
  }

  _setMode(idx) {
    setModeFor(this._hass, normModes(this._config.modes), this._config.off_entity, idx);
  }

  _stepMode(dir) {
    stepModeFor(this._hass, normModes(this._config.modes), this._config.off_entity, dir);
  }

  _updateModes() {
    if (!this._modeBtns) return;
    const modos = normModes(this._config.modes);
    const a = activeModeStep(this._hass, modos, this._config.off_entity);
    this._modeBtns.forEach((b) => {
      b.className = Number(b.dataset.idx) === a.mode ? "mode on" : "mode";
    });
    if (!this._stepper) return;
    const pasos = a.mode >= 0 ? modeSteps(this._hass, modos[a.mode]) : [];
    if (pasos.length < 2) {
      this._stepper.style.display = "none";
      return;
    }
    this._stepper.style.display = "";
    const actual = pasos[a.step];
    const val = this._stepper.querySelector(".sval");
    if (val) {
      val.textContent = stepLabel(this._hass, actual);
      val.title = (actual && ((this._hass.states[actual.entity] || {}).attributes || {}).friendly_name) || "";
    }
    const abajo = this._stepper.querySelector(".sdown");
    const arriba = this._stepper.querySelector(".sup");
    if (abajo) abajo.disabled = a.step <= 0;
    if (arriba) arriba.disabled = a.step >= pasos.length - 1;
  }

  /* ---------- timer ---------- */

  _timerCfg() {
    return (this._config && this._config.timer) || null;
  }

  _minsEntity() {
    const t = this._timerCfg();
    return t && t.minutes_entity ? this._hass.states[t.minutes_entity] : null;
  }

  _nudge(dir) {
    const t = this._timerCfg();
    const st = this._minsEntity();
    if (!t || !st) return;
    const step = Number(st.attributes.step) || 1;
    const min = Number(st.attributes.min);
    const max = Number(st.attributes.max);
    let v = Number(st.state) + dir * step;
    if (!Number.isNaN(min)) v = Math.max(min, v);
    if (!Number.isNaN(max)) v = Math.min(max, v);
    this._hass.callService("input_number", "set_value", {
      entity_id: t.minutes_entity,
      value: v,
    });
  }

  _go() {
    const t = this._timerCfg();
    if (!t) return;
    const st = this._hass.states[t.entity];
    if (st && (st.state === "active" || st.state === "paused")) {
      this._hass.callService("timer", "cancel", { entity_id: t.entity });
      return;
    }
    if (t.button_entity) {
      // Deja que corra la automatizacion existente (valida que el aire este andando)
      this._hass.callService("input_button", "press", { entity_id: t.button_entity });
    } else {
      const mins = this._minsEntity();
      const secs = Math.round((mins ? Number(mins.state) : 0) * 60);
      if (secs > 0) {
        this._hass.callService("timer", "start", { entity_id: t.entity, duration: secs });
      }
    }
  }

  _remainingSecs() {
    const t = this._timerCfg();
    return t ? remainingSecs(this._hass, t.entity) : null;
  }

  _hms(s) {
    return hms(s);
  }

  _updateTimer() {
    const row = this._rows.timer;
    if (!row) return;
    const L = this._config.labels;
    const secs = this._remainingSecs();
    const running = secs !== null;

    row.className = running ? "timerrow running" : "timerrow";
    row.querySelector(".tico").setAttribute("icon", running ? "mdi:timer-sand" : "mdi:timer-outline");
    row.querySelector(".minus").style.display = running ? "none" : "";
    row.querySelector(".plus").style.display = running ? "none" : "";
    row.querySelector(".go").textContent = running ? L.cancel : L.schedule;

    if (running) {
      row.querySelector(".mins").textContent = `${L.offIn} ${this._hms(secs)}`;
    } else {
      const st = this._minsEntity();
      row.querySelector(".mins").textContent = st ? `${Math.round(Number(st.state))} ${L.min}` : "";
    }
    this._tick(running);
  }

  /* Cuenta regresiva local: evita depender de un sensor de plantilla que
     escriba en el recorder cada segundo. */
  _tick(on) {
    if (on && !this._ticker) {
      this._ticker = setInterval(() => this._updateTimer(), 1000);
    } else if (!on && this._ticker) {
      clearInterval(this._ticker);
      this._ticker = null;
    }
  }

  disconnectedCallback() {
    this._tick(false);
  }

  _setRow(row, data) {
    if (!data) {
      row.style.display = "none";
      return;
    }
    row.style.display = "";
    row.querySelector(".value").textContent = data.text;
  }

  _style() {
    const s = document.createElement("style");
    s.textContent = `
      .root { overflow: hidden; }
      .inner { display: block; }
      .header {
        display: flex; align-items: center; gap: 8px;
        padding: 14px 16px 0 16px;
        font-size: 16px; font-weight: 500;
        color: var(--primary-text-color);
      }
      .header .hicon { --mdc-icon-size: 22px; color: var(--state-icon-color, #44739e); flex: 0 0 auto; }
      .footer { padding: 0 16px 8px 16px; }
      .row {
        display: flex; align-items: center; gap: 10px;
        padding: 7px 0; font-size: 14px;
        border-top: 1px solid var(--divider-color, #e0e0e0);
        color: var(--primary-text-color);
      }
      .row ha-icon { --mdc-icon-size: 20px; color: var(--state-icon-color, var(--paper-item-icon-color, #44739e)); flex: 0 0 auto; }
      .row .label { color: var(--secondary-text-color); flex: 0 0 auto; }
      .row .value { margin-left: auto; text-align: right; font-weight: 500; }
      .row.main .value { margin-left: 0; }
      .row .tempicon { margin-left: 14px; --mdc-icon-size: 20px; flex: 0 0 auto;
        color: var(--state-icon-color, var(--paper-item-icon-color, #44739e)); }
      .row .temp { margin-left: 4px; font-weight: 500; }
      .row .win { margin-left: 10px; --mdc-icon-size: 20px; flex: 0 0 auto; }
      .row .winwrap { position: relative; display: inline-flex; margin-left: 10px; }
      .row .win { margin-left: 0; }
      .row .win.closed  { color: var(--success-color, #43a047); }
      .row .win.some    { color: var(--warning-color, #ffa600); }
      .row .win.open    { color: var(--error-color, #db4437); }
      .row .win.unknown { color: var(--disabled-text-color, #9e9e9e); }
      .row .batdot {
        display: none; position: absolute; right: -1px; bottom: -1px;
        width: 7px; height: 7px; border-radius: 50%;
        background: var(--error-color, #db4437);
        box-shadow: 0 0 0 1.5px var(--card-background-color, #fff);
      }
      .fanmode {
        display: inline-flex; align-items: center; gap: 4px; margin-left: 12px;
        color: var(--state-icon-color, #44739e);
      }
      .fanmode ha-icon { --mdc-icon-size: 20px; }
      .fanmode select {
        font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
        color: var(--primary-text-color); background: transparent;
        border: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px;
        padding: 2px 4px;
      }
      .fanmode.off { opacity: .55; }
      .row .preslot { display: inline-flex; gap: 10px; margin-right: 10px; }
      .row .preslot:empty { display: none; }
      .row .fanslot { margin-left: 12px; display: inline-flex; gap: 10px; }
      .row .fanslot:empty { margin-left: 0; }
      .row .pwslot { margin-left: 12px; display: inline-flex; }
      .row .pwslot:empty { margin-left: 0; }
      .pw {
        display: inline-flex; align-items: center;
        font: inherit; cursor: pointer;
        border: none; background: transparent; padding: 0;
      }
      .pw ha-icon { --mdc-icon-size: 20px; color: inherit; }
      .pw.on  { color: var(--success-color, #43a047); }
      .pw.cut { color: var(--error-color, #db4437); }
      /* Armado: parpadea en naranjo mientras espera el segundo toque. */
      .pw.armed { color: var(--warning-color, #ffa600); animation: acrc-blink 1s steps(2, start) infinite; }
      .pw.na { opacity: .5; cursor: default; }
      .pw:hover { opacity: .7; }
      @keyframes acrc-blink { to { visibility: hidden; } }
      /* Sin marco ni fondo: al lado del rayo y del termometro, que son
         iconos pelados, un boton encajonado desentona. */
      .fan {
        display: inline-flex; align-items: center;
        font: inherit; cursor: pointer;
        border: none; background: transparent; padding: 0;
      }
      /* La regla .row ha-icon fija el color de TODOS los iconos de la fila,
         incluido el del ventilador, y le ganaba a la herencia de .fan.on y
         .fan.off: el icono nunca cambiaba de color. inherit devuelve el mando
         al boton. */
      .fan ha-icon { --mdc-icon-size: 20px; color: inherit; }
      .fan.on  { color: var(--success-color, #43a047); }
      .fan.on ha-icon { animation: acrc-spin 2s linear infinite; }
      .fan.off { color: var(--info-color, #039be5); }
      .fan:hover { opacity: .7; }
      @keyframes acrc-spin { to { transform: rotate(360deg); } }
      .fanrow {
        display: flex; flex-wrap: wrap; gap: 14px;
        padding: 7px 16px 10px 16px;
        border-top: 1px solid var(--divider-color, #e0e0e0);
      }
      .moderow {
        display: flex; gap: 6px; padding: 10px 16px 4px 16px;
      }
      .moderow .mode {
        flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
        font: inherit; font-size: 13px; cursor: pointer; padding: 6px 4px;
        border: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px;
        background: transparent; color: var(--secondary-text-color);
      }
      .moderow .mode ha-icon { --mdc-icon-size: 18px; }
      .moderow .mode:hover { background: var(--secondary-background-color, #f0f0f0); }
      .moderow .mode.on {
        border-color: var(--primary-color, #03a9f4);
        color: var(--primary-color, #03a9f4);
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, transparent);
        font-weight: 500;
      }
      .moderow .stepper {
        flex: 0 0 auto; display: inline-flex; align-items: center; gap: 2px;
        border: 1px solid var(--primary-color, #03a9f4); border-radius: 8px;
        padding: 0 2px;
      }
      .moderow .stepper button {
        display: inline-flex; align-items: center; justify-content: center;
        border: none; background: transparent; cursor: pointer; padding: 3px;
        color: var(--primary-color, #03a9f4); border-radius: 6px;
      }
      .moderow .stepper button:hover { background: var(--secondary-background-color, #f0f0f0); }
      .moderow .stepper button:disabled { color: var(--disabled-text-color, #bdbdbd); cursor: default; background: none; }
      .moderow .stepper ha-icon { --mdc-icon-size: 20px; }
      .moderow .sval {
        min-width: 38px; text-align: center; font-size: 14px; font-weight: 500;
        font-variant-numeric: tabular-nums; color: var(--primary-text-color);
      }
      .timerrow {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 16px 12px 16px;
        border-top: 1px solid var(--divider-color, #e0e0e0);
      }
      .timerrow ha-icon { --mdc-icon-size: 20px; color: var(--state-icon-color, #44739e); flex: 0 0 auto; }
      .timerrow.running ha-icon { color: var(--warning-color, #ffa600); }
      .timerrow .mins { font-size: 14px; font-weight: 500; min-width: 64px; }
      .timerrow.running .mins { color: var(--warning-color, #ffa600); }
      .timerrow button {
        font: inherit; font-size: 13px; cursor: pointer;
        border: 1px solid var(--divider-color, #e0e0e0);
        background: transparent; color: var(--primary-text-color);
        border-radius: 6px; padding: 3px 9px;
      }
      .timerrow button:hover { background: var(--secondary-background-color, #f0f0f0); }
      .timerrow .step { min-width: 28px; }
      .timerrow .go { margin-left: auto; color: var(--primary-color, #03a9f4); font-weight: 500; }
      .timerrow.running .go { color: var(--error-color, #db4437); }
      .warn {
        display: none; align-items: center; gap: 8px;
        margin: 0 12px 12px 12px; padding: 8px 12px; border-radius: 8px;
        background: color-mix(in srgb, var(--warning-color, #ffa600) 18%, transparent);
        color: var(--primary-text-color); font-size: 13px;
      }
      .warn ha-icon { --mdc-icon-size: 18px; color: var(--warning-color, #ffa600); }
    `;
    return s;
  }
}


/* ---------- editor visual ---------- */

const EDITOR_LABELS = {
  es: {
    entity: "Equipo (opcional: sin él, no se dibuja tarjeta arriba)",
    base_view: "Vista de arriba",
    mode_buttons: "Botones de modo bajo el termostato (apagado, frío, calor…)",
    name: "Nombre que se muestra arriba",
    battery_warn: "Avisar pila baja bajo (%)",
    fans: "Ventiladores (uno va en la línea; dos o más, en su propia fila)",
    fan_mode: "Mostrar la velocidad del ventilador del equipo",
    fans_position: "Dónde van los ventiladores",
    mode_cold_entity: "Modo FRÍO: boolean, escena, script o botón (varias escenas = flechas de temperatura)",
    mode_heat_entity: "Modo CALOR (opcional; también acepta varias escenas)",
    step_temp: "Temperatura de",
    step_temp_hint: "(vacío = el número del nombre)",
    mode_off_entity: "APAGAR: escena, script o botón (opcional)",
    icon: "Ícono del encabezado (opcional)",
    power_entity: "Potencia",
    temp_entity: "Temperatura de la pieza",
    decimals: "Decimales de temperatura (vacío = como venga el sensor)",
    power_switch: "Enchufe que corta la corriente del equipo",
    power_switch_confirm: "Pedir dos toques antes de cortar",
    lux_entity: "Luz de la pieza",
    window_entity: "Sensor de ventana",
    energy_today_entity: "Energía de hoy",
    energy_month_entity: "Energía del mes",
    timer_entity: "Temporizador",
    timer_minutes_entity: "Minutos (input_number)",
    timer_button_entity: "Botón que dispara tu automatización",
    show_warning: "Avisar por texto si la ventana está abierta con el aire andando",
    fan_name: "Nombre de",
  },
  en: {
    entity: "Unit (optional: without it, no card is drawn on top)",
    base_view: "Top view",
    mode_buttons: "Mode buttons under the thermostat (off, cool, heat…)",
    name: "Title shown on top",
    battery_warn: "Low battery warning below (%)",
    fans: "Fans (one goes on the data line; two or more, on their own row)",
    fan_mode: "Show the unit's own fan speed",
    fans_position: "Where the fans go",
    mode_cold_entity: "COOL mode: boolean, scene, script or button (several scenes = temperature arrows)",
    mode_heat_entity: "HEAT mode (optional; also takes several scenes)",
    step_temp: "Temperature of",
    step_temp_hint: "(empty = the number in its name)",
    mode_off_entity: "TURN OFF: scene, script or button (optional)",
    icon: "Title icon (optional)",
    power_entity: "Power",
    temp_entity: "Room temperature",
    decimals: "Temperature decimals (empty = as the sensor reports)",
    power_switch: "Plug that cuts the unit's power",
    power_switch_confirm: "Ask for two taps before cutting",
    lux_entity: "Room light",
    window_entity: "Window sensor",
    energy_today_entity: "Energy today",
    energy_month_entity: "Energy this month",
    timer_entity: "Timer",
    timer_minutes_entity: "Minutes (input_number)",
    timer_button_entity: "Button that fires your automation",
    show_warning: "Text warning when a window is open while the AC runs",
    fan_name: "Name of",
  },
};

const MODE_DOMAINS = ["input_boolean", "switch", "scene", "script", "button", "input_button"];

/* `decimals`: cuantos decimales llevan las temperaturas. Sin poner, o fuera
   de 0-3, se vuelve al comportamiento de siempre. */
function normDecimals(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 3 ? n : null;
}

/* `power_switch`: entity_id suelto u objeto {entity, name, icon, icon_off,
   confirm}. Lo usan el card de pieza y la lista compacta. */
function normPlug(cfg) {
  if (!cfg) return null;
  const o = typeof cfg === "string" ? { entity: cfg } : cfg;
  return o && o.entity ? o : null;
}

function normFans(list) {
  if (!list) return [];
  return (Array.isArray(list) ? list : [list])
    .map((x) => (typeof x === "string" ? { entity: x } : x))
    .filter((x) => x && x.entity);
}

const fanIds = (list) => normFans(list).map((f) => f.entity);

/* El esquema se arma en cada render porque los campos de nombre dependen de
   cuantos ventiladores haya elegidos. */
function buildSchema(config, lang = "es") {
  const schema = baseSchema(lang);
  // "Card propio" solo aparece si ya hay un base_card escrito en YAML: desde
  // el formulario no se puede armar uno.
  const opciones = viewOptions(lang);
  if (resolveView(config) === "custom") {
    const tipo = config.base_card.type || "base_card";
    opciones.push({ value: "custom", label: tr(lang, `Card propio en YAML (${tipo})`, `Own card in YAML (${tipo})`) });
  }
  schema.splice(1, 0, { name: "", type: "grid", schema: [
    { name: "base_view", selector: { select: { mode: "dropdown", options: opciones } } },
    { name: "mode_buttons", selector: { boolean: {} } },
  ]});
  // Un modo con varias escenas pide la temperatura de cada una, para las
  // flechas. Vacia, se usa el numero del nombre de la escena.
  const modos = normModes((config || {}).modes);
  const tempsDe = (idx, clave) => {
    const pasos = normEntries(modos[idx] && modos[idx].steps);
    return pasos.length > 1
      ? pasos.map((_, i) => ({ name: `${clave}_temp_${i}`, selector: { number: { min: 0, max: 40, step: 0.5, mode: "box" } } }))
      : [];
  };
  const temps = [...tempsDe(0, "mode_cold"), ...tempsDe(1, "mode_heat")];
  if (temps.length) {
    const pos = schema.findIndex((s) => s.name === "mode_off_entity");
    schema.splice(pos + 1, 0, { name: "", type: "grid", schema: temps });
  }
  const fans = fanIds((config || {}).fans);
  if (fans.length) {
    schema.push({
      name: "",
      type: "grid",
      schema: fans.map((_, i) => ({ name: `fan_name_${i}`, selector: { text: {} } })),
    });
  }
  return schema;
}

const viewOptions = (lang) => [
  { value: "compact", label: tr(lang, "Compacta: Target / Actual (requiere mini-climate)", "Compact: Target / Actual (needs mini-climate)") },
  { value: "thermostat", label: tr(lang, "Termostato de Home Assistant", "Home Assistant thermostat") },
  { value: "none", label: tr(lang, "Ninguna: solo el encabezado y las filas", "None: just the title and the data rows") },
];

const baseSchema = (lang) => [
  { name: "entity",
    selector: { entity: { domain: ["climate", "input_boolean", "switch"] } } },
  { name: "", type: "grid", schema: [
    { name: "name", selector: { text: {} } },
    { name: "icon", selector: { icon: {} } },
  ]},
  { name: "", type: "grid", schema: [
    { name: "power_entity", selector: { entity: { domain: "sensor", device_class: "power" } } },
    { name: "temp_entity", selector: { entity: { domain: "sensor", device_class: "temperature" } } },
  ]},
  { name: "", type: "grid", schema: [
    { name: "lux_entity", selector: { entity: { domain: "sensor", device_class: "illuminance" } } },
    { name: "decimals", selector: { number: { min: 0, max: 3, step: 1, mode: "box" } } },
  ]},
  { name: "", type: "grid", schema: [
    { name: "power_switch", selector: { entity: { domain: ["switch", "light", "input_boolean"] } } },
    { name: "power_switch_confirm", selector: { boolean: {} } },
  ]},
  { name: "", type: "grid", schema: [
    { name: "mode_cold_entity", selector: { entity: { domain: MODE_DOMAINS, multiple: true } } },
    { name: "mode_heat_entity", selector: { entity: { domain: MODE_DOMAINS, multiple: true } } },
  ]},
  { name: "mode_off_entity", selector: { entity: { domain: ["scene", "script", "button", "input_button"] } } },
  { name: "window_entity", selector: { entity: { domain: "binary_sensor", multiple: true } } },
  { name: "fans", selector: { entity: { domain: ["fan", "switch", "light"], multiple: true } } },
  { name: "fans_position", selector: { select: { mode: "dropdown", options: [
      { value: "inline", label: tr(lang, "En la línea de datos (por defecto)", "On the data line (default)") },
      { value: "auto", label: tr(lang, "Uno en la línea, varios en fila propia", "One on the line, several on their own row") },
      { value: "row", label: tr(lang, "Siempre en fila propia", "Always on their own row") }] } } },
  { name: "", type: "grid", schema: [
    { name: "energy_today_entity", selector: { entity: { domain: "sensor", device_class: "energy" } } },
    { name: "energy_month_entity", selector: { entity: { domain: "sensor", device_class: "energy" } } },
  ]},
  { name: "", type: "grid", schema: [
    { name: "timer_entity", selector: { entity: { domain: "timer" } } },
    { name: "timer_minutes_entity", selector: { entity: { domain: "input_number" } } },
  ]},
  { name: "timer_button_entity", selector: { entity: { domain: "input_button" } } },
  { name: "", type: "grid", schema: [
    { name: "battery_warn", selector: { number: { min: 0, max: 100, step: 5, mode: "box" } } },
    { name: "fan_mode", selector: { boolean: {} } },
    { name: "show_warning", selector: { boolean: {} } },
  ]},
];

/* El formulario es plano; la config guarda el timer anidado. Estas dos
   funciones traducen entre ambos y son las que cubren los tests. */
function toForm(config) {
  const c = config || {};
  const t = c.timer || {};
  const out = {};
  for (const k of ["entity", "name", "icon", "power_entity", "temp_entity",
                   "lux_entity", "energy_today_entity", "energy_month_entity",
                   "battery_warn", "fan_mode", "fans_position", "show_warning", "decimals"]) {
    if (c[k] !== undefined) out[k] = c[k];
  }
  out.base_view = resolveView(c);
  out.mode_buttons = c.mode_buttons !== false;
  if (c.off_entity) out.mode_off_entity = c.off_entity;
  const pw = c.power_switch;
  if (pw) {
    const o = typeof pw === "string" ? { entity: pw } : pw;
    if (o.entity) {
      out.power_switch = o.entity;
      out.power_switch_confirm = o.confirm !== false;
    }
  }
  const wins = normFans(c.window_entity);
  if (wins.length) out.window_entity = wins.map((x) => x.entity);
  const fans = normFans(c.fans);
  if (fans.length) {
    out.fans = fans.map((f) => f.entity);
    fans.forEach((f, i) => {
      out[`fan_name_${i}`] = f.name || "";
    });
  }
  // Cada modo va al form como lista: una escena, o varias (una por
  // temperatura) con su campo de temperatura cada una.
  const m = normModes(c.modes);
  [["mode_cold", m[0]], ["mode_heat", m[1]]].forEach(([clave, modo]) => {
    if (!modo) return;
    const pasos = normEntries(modo.steps);
    out[`${clave}_entity`] = pasos.length ? pasos.map((p) => p.entity) : [modo.entity];
    if (pasos.length > 1) {
      pasos.forEach((p, i) => {
        if (p.temp !== undefined && p.temp !== null && p.temp !== "") out[`${clave}_temp_${i}`] = p.temp;
      });
    }
  });
  if (t.entity) out.timer_entity = t.entity;
  if (t.minutes_entity) out.timer_minutes_entity = t.minutes_entity;
  if (t.button_entity) out.timer_button_entity = t.button_entity;
  return out;
}

/* Un modo desde el form. Una escena queda como `entity`; varias, como
   `steps` con la temperatura de cada una. Igual que con los nombres de los
   ventiladores, si la lista acaba de cambiar los campos de temperatura (por
   posicion) ya no calzan, asi que se conserva la temperatura por entidad. */
function modeFromForm(d, clave, prevMode, defecto) {
  const raw = d[`${clave}_entity`];
  const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
  if (!ids.length) return null;
  const base = { ...(prevMode || defecto) };
  if (ids.length === 1) {
    delete base.steps;
    base.entity = ids[0];
    return base;
  }
  const prevSteps = normEntries(prevMode && prevMode.steps);
  const listaCambio = prevSteps.length !== ids.length || prevSteps.some((p, i) => p.entity !== ids[i]);
  delete base.entity;
  base.steps = ids.map((id, i) => {
    const old = prevSteps.find((p) => p.entity === id) || {};
    const campo = `${clave}_temp_${i}`;
    const t = !listaCambio && campo in d ? d[campo] : old.temp;
    const paso = { entity: id };
    if (old.name) paso.name = old.name;
    if (t !== undefined && t !== null && t !== "" && Number.isFinite(Number(t))) paso.temp = Number(t);
    return paso.name || paso.temp !== undefined ? paso : id;
  });
  return base;
}

function fromForm(prev, data, lang = "es") {
  // Arranca de la config previa para NO perder base_card, labels ni nada
  // que el formulario no maneje.
  const out = { ...(prev || {}) };
  const d = { ...(data || {}) };

  // Los botones de modo vienen prendidos: solo se guarda el `false`.
  if (d.mode_buttons === false) out.mode_buttons = false;
  else if (d.mode_buttons !== undefined) delete out.mode_buttons;

  // base_view siempre viene en el formulario completo: sin el, es una
  // llamada parcial y no se toca lo que no llego.
  if (d.mode_off_entity) out.off_entity = d.mode_off_entity;
  else if (d.base_view !== undefined) delete out.off_entity;

  for (const k of ["entity", "name", "icon", "power_entity", "temp_entity",
                   "lux_entity", "energy_today_entity", "energy_month_entity",
                   "battery_warn", "fan_mode", "fans_position", "show_warning", "decimals"]) {
    const v = d[k];
    if (v === undefined || v === "" || v === null || v === false) delete out[k];
    else out[k] = v;
  }

  // Vista de arriba. "custom" es un base_card escrito a mano y se deja tal
  // cual. Elegir otra lo reemplaza, y con el se va su CSS, que apuntaba a ese
  // card. "thermostat" es el default, asi que no se guarda.
  if (d.base_view !== undefined) {
    const eraPropio = resolveView(prev) === "custom";
    if (d.base_view === "custom" && eraPropio) {
      delete out.base_view;
    } else {
      if (eraPropio) delete out.base_card_style;
      delete out.base_card;
      if (d.base_view === "compact" || d.base_view === "none") out.base_view = d.base_view;
      else delete out.base_view;
    }
  }

  // Enchufe: el form da el entity_id y el booleano de confirmacion. Se
  // conserva lo que el formulario no maneja (name, icon, icon_off).
  if (d.power_switch) {
    const prevPw = (prev || {}).power_switch;
    const base = typeof prevPw === "object" && prevPw ? { ...prevPw } : {};
    base.entity = d.power_switch;
    if (d.power_switch_confirm === false) base.confirm = false;
    else delete base.confirm;
    out.power_switch = Object.keys(base).length === 1 ? base.entity : base;
  } else {
    delete out.power_switch;
  }
  delete out.power_switch_confirm;

  // Ventanas: el form da entity_id sueltos; conserva el `battery` y el
  // `name` de las que ya estaban configuradas como objeto.
  const prevWins = normFans((prev || {}).window_entity);
  if (Array.isArray(d.window_entity) && d.window_entity.length) {
    out.window_entity = d.window_entity.map((id) => {
      const old = prevWins.find((x) => x.entity === id);
      return old && (old.battery || old.name) ? old : id;
    });
  } else {
    delete out.window_entity;
  }

  // Ventiladores. Los nombres vienen en campos fan_name_<i>, que son por
  // posicion; si la lista misma acaba de cambiar esos indices ya no calzan,
  // asi que en ese caso se conservan los nombres buscando por entidad y el
  // siguiente render vuelve a poblar el formulario correctamente.
  const prevFans = normFans((prev || {}).fans);
  if (Array.isArray(d.fans) && d.fans.length) {
    const listaCambio =
      prevFans.length !== d.fans.length ||
      prevFans.some((f, i) => f.entity !== d.fans[i]);
    out.fans = d.fans.map((id, i) => {
      const old = prevFans.find((f) => f.entity === id) || {};
      const nombre = listaCambio
        ? old.name
        : String(d[`fan_name_${i}`] === undefined ? old.name || "" : d[`fan_name_${i}`]).trim();
      const obj = { entity: id };
      if (nombre) obj.name = nombre;
      if (old.icon) obj.icon = old.icon;
      // Sin nombre ni icono propios, se guarda como simple entity_id
      return obj.name || obj.icon ? obj : id;
    });
  } else {
    delete out.fans;
  }
  // Los fan_name_* son del formulario, nunca de la config del card
  for (const k of Object.keys(out)) if (/^fan_name_\d+$/.test(k)) delete out[k];

  // Reconstruye `modes` conservando nombre e icono si ya existian
  const prevModes = normModes((prev || {}).modes);
  const modes = [];
  const cold = modeFromForm(d, "mode_cold", prevModes[0], { name: tr(lang, "Frío", "Cool"), icon: "mdi:snowflake" });
  const heat = modeFromForm(d, "mode_heat", prevModes[1], { name: tr(lang, "Calor", "Heat"), icon: "mdi:fire" });
  if (cold) modes.push(cold);
  if (heat) modes.push(heat);
  if (modes.length) out.modes = modes;
  else delete out.modes;
  for (const k of Object.keys(out)) if (/^mode_(cold|heat)_temp_\d+$/.test(k)) delete out[k];

  if (d.timer_entity) {
    const t = { entity: d.timer_entity };
    if (d.timer_minutes_entity) t.minutes_entity = d.timer_minutes_entity;
    if (d.timer_button_entity) t.button_entity = d.timer_button_entity;
    out.timer = t;
  } else {
    delete out.timer;
  }
  out.type = (prev && prev.type) || "custom:ac-room-card";
  return out;
}

function editorNote(config, lang = "es") {
  const view = resolveView(config);
  if (view === "custom") {
    const tipo = config.base_card.type;
    return tr(lang, `El card de arriba (${tipo}) se conserva; se edita en YAML.`,
      `The card on top (${tipo}) is kept; edit it in YAML.`);
  }
  if (view === "compact") {
    return hasElement(MINI_CLIMATE)
      ? tr(lang, "Vista compacta: mini-climate con los rótulos Target / Actual.",
        "Compact view: mini-climate with Target / Actual labels.")
      : tr(lang, "Falta instalar mini-climate (HACS). Mientras no esté, se dibuja el termostato integrado.",
        "mini-climate (HACS) is not installed. Until it is, the built-in thermostat is drawn.");
  }
  if (view === "none") {
    return tr(lang, "Sin card arriba: solo el encabezado y las filas de datos.",
      "No card on top: just the title and the data rows.");
  }
  return tr(lang, "Se usa el termostato integrado de Home Assistant.",
    "Home Assistant's built-in thermostat is used.");
}

/* El formulario de UNA pieza. Lo usan el editor del card de pieza y, una vez
   por pieza, el editor de la lista: son los mismos campos. */
function createRoomForm(getConfig, getHass, onChange) {
  const form = document.createElement("ha-form");
  form.computeLabel = (schema) => {
    const hass = getHass();
    const L = EDITOR_LABELS[langOf(hass)];
    const m = /^fan_name_(\d+)$/.exec(schema.name || "");
    if (m) {
      const id = fanIds(getConfig().fans)[Number(m[1])];
      const st = id && hass && hass.states[id];
      return `${L.fan_name} ${(st && st.attributes.friendly_name) || id || ""}`;
    }
    const t = /^mode_(cold|heat)_temp_(\d+)$/.exec(schema.name || "");
    if (t) {
      const modo = normModes(getConfig().modes)[t[1] === "cold" ? 0 : 1];
      const id = modo && normEntries(modo.steps)[Number(t[2])] && normEntries(modo.steps)[Number(t[2])].entity;
      const st = id && hass && hass.states[id];
      return `${L.step_temp} ${(st && st.attributes.friendly_name) || id || ""} ${L.step_temp_hint}`;
    }
    return L[schema.name] || schema.name;
  };
  form.addEventListener("value-changed", (ev) => {
    if (ev.stopPropagation) ev.stopPropagation();
    onChange(fromForm(getConfig(), ev.detail.value, langOf(getHass())));
  });
  return form;
}

function refreshRoomForm(form, config, hass) {
  form.hass = hass;
  form.schema = buildSchema(config, langOf(hass));
  form.data = toForm(config);
}

class AcRoomCardEditor extends HTMLElement {
  static get toForm() { return toForm; }
  static get buildSchema() { return buildSchema; }
  static get fromForm() { return fromForm; }

  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this._form) {
      this._form = createRoomForm(() => this._config, () => this._hass, (cfg) => {
        this._config = cfg;
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: cfg }, bubbles: true, composed: true,
        }));
      });
      this.appendChild(this._form);

      this._note = document.createElement("div");
      this._note.style.cssText = "padding:8px 4px 0;font-size:12px;color:var(--secondary-text-color)";
      this.appendChild(this._note);
    }
    refreshRoomForm(this._form, this._config, this._hass);
    this._note.textContent = editorNote(this._config, langOf(this._hass));
  }
}

if (!customElements.get("ac-room-card-editor")) {
  customElements.define("ac-room-card-editor", AcRoomCardEditor);
}


/* ==================================================================
   ac-rooms-card - vista compacta, una linea por pieza.
   Pensada para el celular: cada pieza acepta el mismo bloque de
   configuracion que ac-room-card, para copiar y pegar.
   ================================================================== */

const RT = {
  pwOn: "con corriente",
  pwOff: "sin corriente, toca para reponer",
  pwConfirm: "toca otra vez para CORTAR la corriente",
  off: "Apagado",
  unavailable: "no disponible",
  window: "Ventanas",
  open: "Abierta",
  closed: "Cerrada",
  batLow: "pila baja",
  target: "Target",
  actual: "Actual",
  real: "Real",
  schedule: "Programar",
  cancel: "Cancelar",
  min: "min",
  empty: "Configura al menos una pieza en `rooms`",
};

const RT_EN = {
  pwOn: "powered",
  pwOff: "no power, tap to restore",
  pwConfirm: "tap again to CUT the power",
  off: "Off",
  unavailable: "unavailable",
  window: "Windows",
  open: "Open",
  closed: "Closed",
  batLow: "low battery",
  target: "Target",
  actual: "Actual",
  real: "Real",
  schedule: "Schedule",
  cancel: "Cancel",
  min: "min",
  empty: "Set at least one room in `rooms`",
};

class AcRoomsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._filas = [];
  }

  static getConfigElement() {
    return document.createElement("ac-rooms-card-editor");
  }

  static getStubConfig(hass, entities) {
    const c = (entities || []).filter((e) => e.startsWith("climate.")).slice(0, 3);
    const stub = { rooms: c.map((e) => ({ entity: e })) };
    if (hasElement(MINI_CLIMATE)) stub.base_view = "compact";
    return stub;
  }

  setConfig(config) {
    // `rooms` es opcional: sin el, se descubren solas leyendo el dashboard.
    const lang = langOf(this._hass);
    const base = lang === "en" ? RT_EN : RT;
    if (!config) throw new Error(base.empty);
    if (config.rooms !== undefined && config.rooms !== "auto" &&
        (!Array.isArray(config.rooms) || !config.rooms.length)) {
      throw new Error(base.empty);
    }
    this._lang = lang;
    this._userLabels = config.labels || {};
    this._config = { ...config, labels: { ...base, ...this._userLabels } };
    this._built = false;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const lang = langOf(hass);
    if (this._config && lang !== this._lang) {
      this._lang = lang;
      this._config = { ...this._config, labels: { ...(lang === "en" ? RT_EN : RT), ...this._userLabels } };
      this._built = false;
    }
    this._render();
  }

  getCardSize() {
    const n = (this._piezas || (Array.isArray(this._config && this._config.rooms) ? this._config.rooms : [])).length;
    return 1 + Math.ceil((n || 3) * 0.7);
  }

  /* ---------- estado de una pieza ---------- */

  /* Que columnas se dibujan. Por defecto todas; el detalle completo de cada
     pieza siempre esta a un toque, en el popup. */
  _cols() {
    const c = this._config.columns;
    // `lux` y `plug` NO entran por defecto: la mayoria de las piezas no tiene
    // sensor de luz ni enchufe declarado, y una columna vacia en todas las
    // filas solo roba ancho en el telefono.
    return new Set(Array.isArray(c) && c.length ? c : ["temps", "power", "window", "timer", "fans"]);
  }

  _modos(r) {
    return normModes(r.modes);
  }

  /* Se puede prender y apagar: tiene equipo o tiene modos. */
  _conmutable(r) {
    return !!r.entity || this._modos(r).length > 0;
  }

  /* La fila va atenuada solo si lo que la maneja no existe en Home Assistant.
     Antes bastaba no tener `entity`, y una pieza por IR con sus modos en
     booleans o escenas quedaba gris aunque funcionara perfecto. */
  _existe(r) {
    const modos = this._modos(r);
    if (modos.length) {
      return modos.some((m) => modeSteps(this._hass, m).some((p) => !!this._hass.states[p.entity])) ||
        !!(r.off_entity && this._hass.states[r.off_entity]);
    }
    if (r.entity) return !!this._hass.states[r.entity];
    return true;
  }

  _encendida(r) {
    const modos = this._modos(r);
    if (modos.length) return activeModeIndex(this._hass, modos, r.off_entity) >= 0;
    const st = this._hass.states[r.entity];
    return !!st && !["off", "unavailable", "unknown"].includes(st.state);
  }

  /* Modo en marcha, para pintar la fila. Con entidad climate es su estado;
     con modos por input_boolean se deduce del nombre o del entity_id, o se
     puede declarar a mano con `hvac` en cada modo. */
  _hvac(r) {
    const modos = this._modos(r);
    if (modos.length) {
      const activo = modos[activeModeIndex(this._hass, modos, r.off_entity)];
      if (!activo) return null;
      if (activo.hvac) return activo.hvac;
      const ids = modeSteps(this._hass, activo).map((p) => p.entity).join(" ");
      const txt = ((activo.name || "") + " " + ids).toLowerCase();
      if (/heat|calor|calef/.test(txt)) return "heat";
      if (/cool|frio|fr\u00edo|cold/.test(txt)) return "cool";
      return null;
    }
    const st = this._hass.states[r.entity];
    if (!st || ["off", "unavailable", "unknown"].includes(st.state)) return null;
    return st.state;
  }

  _toggle(r) {
    const modos = this._modos(r);
    if (modos.length) {
      // Encendida: Apagado (booleans abajo y off_entity). Apagada: el primer modo.
      if (this._encendida(r)) {
        if (canTurnOff(modos, r.off_entity)) setModeFor(this._hass, modos, r.off_entity, -1);
      } else {
        setModeFor(this._hass, modos, r.off_entity, 0);
      }
      return;
    }
    if (!r.entity) return;
    const dominio = r.entity.split(".")[0];
    this._hass.callService(dominio, this._encendida(r) ? "turn_off" : "turn_on", {
      entity_id: r.entity,
    });
  }

  /* `decimals` de la pieza, o el de la tarjeta si la pieza no trae. */
  _decimals(r) {
    const propio = normDecimals(r.decimals);
    return propio !== null ? propio : normDecimals(this._config.decimals);
  }

  /* Tres lecturas distintas y a proposito separadas:
       target = la consigna del equipo
       actual = lo que mide el propio equipo
       real   = el sensor independiente de la pieza (temp_entity)
     Los dos ultimos casi nunca coinciden: el equipo mide en su carcasa. */
  _temps(r) {
    const st = this._hass.states[r.entity];
    const dm = this._decimals(r);
    const p = 10 ** (dm === null ? 1 : dm);
    const dec = (v) => {
      const n = parseFloat(v);
      return Number.isNaN(n) ? null : Math.round(n * p) / p;
    };
    const attr = (k) => (st && st.attributes[k] !== undefined && st.attributes[k] !== null
      ? dec(st.attributes[k]) : null);
    const rs = r.temp_entity && this._hass.states[r.temp_entity];
    // Sin climate, la consigna es la temperatura de la escena en marcha.
    let consigna = attr("temperature");
    let turbo = false;
    let marcas = "";
    const modos = this._modos(r);
    if (consigna === null && modos.length) {
      const a = activeModeStep(this._hass, modos, r.off_entity);
      const paso = a.mode >= 0 ? modeSteps(this._hass, modos[a.mode])[a.step] : null;
      if (paso && paso.num !== null) {
        consigna = dec(paso.num);
        turbo = !!paso.turbo;
        marcas = stepMarks(paso);
      }
    }
    return {
      target: consigna,
      turbo,
      marcas,
      actual: attr("current_temperature"),
      real: rs && !["unavailable", "unknown"].includes(rs.state) ? dec(rs.state) : null,
    };
  }

  /* Corriendo: cancela. Parado: arranca, apretando el input_button del
     usuario si lo hay, para que su automatizacion siga mandando. */
  _toggleTimer(r) {
    const t = r.timer;
    if (!t || !t.entity) return;
    if (remainingSecs(this._hass, t.entity) !== null) {
      this._hass.callService("timer", "cancel", { entity_id: t.entity });
      return;
    }
    if (t.button_entity) {
      this._hass.callService("input_button", "press", { entity_id: t.button_entity });
    } else {
      const mins = t.minutes_entity && this._hass.states[t.minutes_entity];
      const secs = Math.round((mins ? Number(mins.state) : 0) * 60);
      if (secs > 0) this._hass.callService("timer", "start", { entity_id: t.entity, duration: secs });
    }
  }

  /* Enchufe de la pieza, en su propia columna al lado de los W. Mismo trato
     que en el card completo: cortar pide dos toques (el estado armado vive en
     el propio boton, porque hay uno por fila), reponer no pide nada. */
  _plugClick(fila, r) {
    const pw = normPlug(r.power_switch);
    const b = fila.querySelector(".plug");
    if (!pw || !b) return;
    const st = this._hass.states[pw.entity];
    if (!st || st.state === "unavailable" || st.state === "unknown") return;
    const dominio = pw.entity.split(".")[0];
    const desarmar = () => {
      b._armado = false;
      if (b._tmr) { clearTimeout(b._tmr); b._tmr = null; }
    };
    if (st.state !== "on") {
      desarmar();
      this._hass.callService(dominio, "turn_on", { entity_id: pw.entity });
    } else if (pw.confirm !== false && !b._armado) {
      b._armado = true;
      if (b._tmr) clearTimeout(b._tmr);
      b._tmr = setTimeout(() => { b._armado = false; this._updatePlug(fila, r); }, 5000);
    } else {
      desarmar();
      this._hass.callService(dominio, "turn_off", { entity_id: pw.entity });
    }
    this._updatePlug(fila, r);
  }

  _updatePlug(fila, r) {
    const b = fila.querySelector(".plug");
    if (!b) return;
    const L = this._config.labels;
    const pw = normPlug(r.power_switch);
    if (!pw) {
      // Se reserva el hueco, como la ventana y el timer, para que la columna
      // caiga en el mismo x en todas las filas.
      b.style.visibility = "hidden";
      return;
    }
    b.style.visibility = "";
    const st = this._hass.states[pw.entity];
    const falta = !st || st.state === "unavailable" || st.state === "unknown";
    const on = !!st && st.state === "on";
    const armado = !!b._armado && on;
    b.className = "plug " + (falta ? "na" : armado ? "armed" : on ? "on" : "cut");
    const ico = b.querySelector("ha-icon");
    if (ico) {
      ico.setAttribute("icon", armado ? "mdi:power-plug-off-outline"
        : on ? (pw.icon || "mdi:power-plug") : (pw.icon_off || "mdi:power-plug-off"));
    }
    const nombre = pw.name || (st && st.attributes.friendly_name) || pw.entity;
    b.title = falta ? `${nombre}: ${L.unavailable}`
      : armado ? `${nombre}: ${L.pwConfirm}`
      : on ? `${nombre}: ${L.pwOn}`
      : `${nombre}: ${L.pwOff}`;
  }

  /* Abre la pieza completa en un ac-room-card sobre el dashboard, para no
     tener que meter todo en una linea que en el telefono no cabe. */
  async _openPopup(r) {
    if (this._overlay) return;
    const helpers = await window.loadCardHelpers();
    const cfg = { type: "custom:ac-room-card", ...r };
    delete cfg.popup;
    // La pieza hereda los decimales de la lista si no trae los suyos.
    if (cfg.decimals === undefined && this._config.decimals !== undefined) cfg.decimals = this._config.decimals;
    // Y la vista de arriba, salvo que la pieza traiga la suya o un base_card.
    if (cfg.base_view === undefined && cfg.base_card === undefined && this._config.base_view !== undefined) {
      cfg.base_view = this._config.base_view;
    }
    const card = await helpers.createCardElement(cfg);
    card.hass = this._hass;
    this._popupCard = card;

    const ov = document.createElement("div");
    ov.className = "ov";
    const caja = document.createElement("div");
    caja.className = "ovbox";
    caja.appendChild(card);
    ov.appendChild(caja);
    ov.addEventListener("click", (ev) => { if (ev.target === ov) this._closePopup(); });
    this._escHandler = (ev) => { if (ev.key === "Escape") this._closePopup(); };
    document.addEventListener("keydown", this._escHandler);
    this.shadowRoot.appendChild(ov);
    this._overlay = ov;
  }

  _closePopup() {
    if (!this._overlay) return;
    this._overlay.remove();
    this._overlay = null;
    this._popupCard = null;
    if (this._escHandler) {
      document.removeEventListener("keydown", this._escHandler);
      this._escHandler = null;
    }
  }

  _tick(on) {
    if (on && !this._ticker) this._ticker = setInterval(() => this._update(), 1000);
    else if (!on && this._ticker) { clearInterval(this._ticker); this._ticker = null; }
  }

  disconnectedCallback() {
    this._tick(false);
    this._closePopup();
  }

  /* Sin `rooms`, se leen del propio dashboard: cualquier ac-room-card que
     exista pasa a ser una fila, sin tener que repetir su configuracion. */
  /* Quita las piezas excluidas. Se puede excluir por nombre (lo que se ve) o
     por entity_id, para que sirva tambien con piezas sin nombre. */
  _filtrar(lista) {
    const ex = this._config.exclude;
    if (!Array.isArray(ex) || !ex.length) return lista;
    const fuera = new Set(ex);
    return lista.filter((r) => !fuera.has(r.name) && !fuera.has(r.entity));
  }

  async _descubrir() {
    const cfg = this._config;
    if (Array.isArray(cfg.rooms) && cfg.rooms.length) return this._filtrar(cfg.rooms);
    const partes = String((window.location && window.location.pathname) || "").split("/").filter(Boolean);
    const url_path = partes[0] && partes[0] !== "lovelace" ? partes[0] : null;
    let lov;
    try {
      lov = await this._hass.callWS({ type: "lovelace/config", url_path });
    } catch (e) {
      return [];
    }
    const encontradas = [];
    const recorrer = (o) => {
      if (Array.isArray(o)) { o.forEach(recorrer); return; }
      if (!o || typeof o !== "object") return;
      if (o.type === "custom:ac-room-card") { encontradas.push(o); return; }
      if (Array.isArray(o.cards)) recorrer(o.cards);
      if (Array.isArray(o.sections)) recorrer(o.sections);
    };
    const vistas = (lov && lov.views ? lov.views : [])
      .filter((v) => !cfg.discover_view || v.path === cfg.discover_view);
    vistas.forEach(recorrer);
    return this._filtrar(encontradas);
  }

  /* ---------- construccion ---------- */

  async _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) {
      this._built = true;
      this._piezas = await this._descubrir();
      this._build();
    }
    this._update();
  }

  _build() {
    const card = document.createElement("ha-card");
    if (this._config.title) {
      const h = document.createElement("div");
      h.className = "title";
      h.textContent = this._config.title;
      card.appendChild(h);
    }
    const cont = document.createElement("div");
    cont.className = "rooms";
    card.appendChild(cont);

    // Las etiquetas van una vez como encabezado de columna. Repetirlas en
    // cada una de las filas seria ruido puro.
    /* El encabezado tiene que llevar los MISMOS huecos que las filas y en el
       mismo orden, o las columnas dejan de calzar. */
    const cols0 = this._cols();
    if (["temps", "power", "plug", "lux", "timer", "window", "fans"].some((k) => cols0.has(k))) {
      const L0 = this._config.labels;
      const head = document.createElement("div");
      head.className = "room head";
      head.innerHTML =
        `<span class="pwrsp"></span><span class="rname"></span>` +
        (cols0.has("temps")
          ? `<span class="temps"><span class="tgt"></span>` +
            `<span class="act"></span><span class="real"></span></span>` : "") +
        (cols0.has("power")  ? `<span class="pw"><ha-icon icon="mdi:flash"></ha-icon></span>` : "") +
        (cols0.has("plug")   ? `<span class="plug"><ha-icon icon="mdi:power-plug"></ha-icon></span>` : "") +
        (cols0.has("lux")    ? `<span class="lx"><ha-icon icon="mdi:brightness-5"></ha-icon></span>` : "") +
        (cols0.has("timer")  ? `<span class="tmr"><ha-icon icon="mdi:timer-outline"></ha-icon></span>` : "") +
        (cols0.has("window") ? `<span class="winwrap"><ha-icon icon="mdi:window-closed-variant"></ha-icon></span>` : "") +
        (cols0.has("fans")   ? `<span class="fans"><ha-icon icon="mdi:fan"></ha-icon></span>` : "");
      if (cols0.has("temps")) {
        head.querySelector(".tgt").textContent = L0.target;
        head.querySelector(".act").textContent = L0.actual;
        head.querySelector(".real").textContent = L0.real;
      }
      cont.appendChild(head);
    }

    // Ancho fijo para la columna de ventiladores segun la pieza que mas
    // tiene, para que el icono de ventana caiga siempre en el mismo x.
    const cols = this._cols();
    const piezas = this._piezas || [];
    const maxFans = cols.has("fans")
      ? Math.max(1, ...piezas.map((r) => normEntries(r.fans).length))
      : 1;
    cont.style.setProperty("--acrc-fans", String(maxFans));

    this._filas = piezas.map((r) => {
      const fila = document.createElement("div");
      fila.className = "room";
      fila.innerHTML =
        `<button class="pwr" title=""><ha-icon icon="mdi:power"></ha-icon></button>` +
        `<span class="rname"></span>` +
        `<span class="temps"><span class="tgt"></span>` +
        `<span class="act"></span><span class="real"></span></span>` +
        `<span class="pw"></span>` +
        `<button class="plug"><ha-icon></ha-icon></button>` +
        `<span class="lx"></span>` +
        `<button class="tmr"><ha-icon></ha-icon><span class="tleft"></span></button>` +
        `<span class="winwrap"><ha-icon class="win"></ha-icon>` +
        `<span class="batdot"></span></span>` +
        `<span class="fans"></span>`;
      fila.querySelector(".pwr").addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._toggle(r);
      });
      const abrir = () => (this._config.popup === false
        ? moreInfo(this, r.entity)
        : this._openPopup(r));
      fila.querySelector(".rname").addEventListener("click", abrir);
      fila.querySelector(".temps").addEventListener("click", abrir);
      fila.querySelector(".pw").addEventListener("click", (ev) => {
        ev.stopPropagation();
        moreInfo(this, r.power_entity || r.entity);
      });
      fila.querySelector(".plug").addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._plugClick(fila, r);
      });
      fila.querySelector(".tmr").addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._toggleTimer(r);
      });
      fila.querySelector(".win").addEventListener("click", (ev) => {
        ev.stopPropagation();
      const lista = normEntries(r.window_entity);
        const abierta = lista.find((x) => {
          const st = this._hass.states[x.entity];
          return st && st.state === "on";
        });
        moreInfo(this, (abierta || lista[0] || {}).entity);
      });
      // Ventiladores: se crean una vez, aca, porque son fijos por config
      const slot = fila.querySelector(".fans");
      const btns = [];
      for (const f of (cols.has("fans") ? normEntries(r.fans) : [])) {
        const b = document.createElement("button");
        b.className = "rfan";
        b.dataset.entity = f.entity;
        const st = this._hass.states[f.entity];
        b.dataset.label = f.name || (st && st.attributes.friendly_name) || f.entity;
        // color propio para el estado encendido; sin esto se usa el verde comun
    if (f.color) b.dataset.color = f.color;
    b.innerHTML = `<ha-icon icon="${f.icon || "mdi:fan"}"></ha-icon>`;
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._hass.callService("homeassistant", "toggle", { entity_id: f.entity });
        });
        slot.appendChild(b);
        btns.push(b);
      }
      // Columnas apagadas: fuera del flujo, para que no reserven hueco.
      for (const [clave, sel] of [["temps", ".temps"], ["power", ".pw"],
                                  ["lux", ".lx"], ["plug", ".plug"],
                                  ["window", ".winwrap"], ["timer", ".tmr"],
                                  ["fans", ".fans"]]) {
        if (!cols.has(clave)) fila.querySelector(sel).style.display = "none";
      }

      cont.appendChild(fila);
      return { r, fila, btns };
    });

    this.shadowRoot.innerHTML = "";
    this.shadowRoot.appendChild(this._style());
    this.shadowRoot.appendChild(card);
  }

  _update() {
    const L = this._config.labels;
    if (this._popupCard) this._popupCard.hass = this._hass;
    let hayTimer = false;
    const orden = this._config.sort === "active" ? [...this._filas].sort(
      (a, b) => Number(this._encendida(b.r)) - Number(this._encendida(a.r))) : this._filas;
    orden.forEach((f, i) => { f.fila.style.order = String(i); });

    for (const { r, fila, btns } of this._filas) {
      const st = this._hass.states[r.entity];
      const on = this._encendida(r);
      const noExiste = !this._existe(r);

      const modo = this._hvac(r);
      fila.className = "room" + (on ? " on" : "") + (noExiste ? " gone" : "") +
        (modo ? " m-" + modo : "");
      const pwr = fila.querySelector(".pwr");
      pwr.className = on ? "pwr on" : "pwr";
      pwr.title = on ? "" : L.off;
      // Una pieza sin nada que prender (solo sensores) no lleva boton: el
      // hueco se reserva para que las columnas sigan calzando.
      pwr.style.visibility = this._conmutable(r) ? "" : "hidden";

      fila.querySelector(".rname").textContent =
        r.name || (st && st.attributes.friendly_name) || r.entity;

      const t3 = this._temps(r);
      const dm = this._decimals(r);
      const pon = (sel, v) => {
        fila.querySelector(sel).textContent = v === null ? "" : `${dm === null ? v : v.toFixed(dm)}°`;
      };
      pon(".tgt", t3.target);
      if (t3.marcas && t3.target !== null) fila.querySelector(".tgt").textContent += t3.marcas;
      pon(".act", t3.actual);
      pon(".real", t3.real);

      const pEl = fila.querySelector(".pw");
      const ps = r.power_entity && this._hass.states[r.power_entity];
      pEl.textContent = ps && !["unavailable", "unknown"].includes(ps.state)
        ? `${Math.round(parseFloat(ps.state) || 0)} W` : "";

      this._updatePlug(fila, r);

      const lEl = fila.querySelector(".lx");
      if (lEl) {
        const ls = r.lux_entity && this._hass.states[r.lux_entity];
        const lv = ls && !["unavailable", "unknown"].includes(ls.state)
          ? parseFloat(ls.state) : null;
        // Sobre 10.000 lx el numero deja de caber y no aporta nada: 18k se lee
        // igual de bien y no descuadra la columna.
        lEl.textContent = lv === null || Number.isNaN(lv) ? ""
          : lv >= 10000 ? `${Math.round(lv / 1000)}k` : `${Math.round(lv)}`;
      }

      const lista = normEntries(r.window_entity);
      const wrap = fila.querySelector(".winwrap");
      const win = fila.querySelector(".win");
      const dot = fila.querySelector(".batdot");
      if (!lista.length) {
        // visibility, no display: la columna se mantiene para que el icono
        // caiga en el mismo x en todas las filas.
        wrap.style.visibility = "hidden";
      } else {
        wrap.style.visibility = "";
        const w = computeWindows(this._hass, lista, L);
        const CLASES = { closed: "win closed", some: "win some", all: "win open", unknown: "win unknown" };
        win.className = CLASES[w.estado];
        win.setAttribute("icon", w.abiertas ? "mdi:window-open-variant" : "mdi:window-closed-variant");
        const resumen = lista.length > 1 ? ` (${w.abiertas}/${w.conocidas})` : "";
        win.setAttribute("title", `${L.window}${resumen}\n${w.detalle.join("\n")}`);
        const umbral = r.battery_warn === undefined ? 20 : Number(r.battery_warn);
        const bajos = batteriesLow(this._hass, lista, umbral);
        dot.style.display = bajos.length ? "" : "none";
        if (bajos.length) dot.setAttribute("title", `${L.batLow}\n${bajos.join("\n")}`);
      }

      const tmr = fila.querySelector(".tmr");
      const t = r.timer;
      const restan = t && t.entity ? remainingSecs(this._hass, t.entity) : null;
      if (!t || !t.entity || (restan === null && !on)) {
        // Parado y con la pieza apagada no aporta nada: ocupa espacio y no
        // se puede arrancar un timer de un equipo que no esta andando.
        tmr.style.visibility = "hidden";
      } else {
        tmr.style.visibility = "";
        const corriendo = restan !== null;
        if (corriendo) hayTimer = true;
        tmr.className = corriendo ? "tmr on" : "tmr";
        tmr.querySelector("ha-icon").setAttribute("icon", corriendo ? "mdi:timer-sand" : "mdi:timer-outline");
        tmr.querySelector(".tleft").textContent = corriendo ? hms(restan) : "";
        const mins = t.minutes_entity && this._hass.states[t.minutes_entity];
        tmr.title = corriendo ? L.cancel : (mins ? `${Math.round(Number(mins.state))} ${L.min}` : L.schedule);
      }

      for (const b of btns) {
        const fst = this._hass.states[b.dataset.entity];
        const fon = !!fst && fst.state === "on";
        b.className = fon ? "rfan on" : "rfan off";
        // El color propio se guardaba en dataset y no se aplicaba nunca: en la
        // lista quedaba el verde comun aunque la pieza pidiera otro color.
        b.style.color = fon && b.dataset.color ? b.dataset.color : "";
        b.title = `${b.dataset.label}: ${!fst ? L.unavailable : fon ? "on" : "off"}`;
      }
    }

    this._tick(hayTimer);
  }

  _style() {
    const s = document.createElement("style");
    s.textContent = `
      ha-card { overflow: hidden; }
      .title { padding: 16px 18px 6px; font-size: 18px; font-weight: 500;
               color: var(--primary-text-color); }
      .rooms { display: flex; flex-direction: column; padding: 4px 0 8px; }
      .room {
        display: flex; align-items: center; gap: 11px;
        padding: 7px 16px; min-height: 54px;
        font-size: 16px; color: var(--primary-text-color);
      }
      .room + .room { border-top: 1px solid var(--divider-color, #e0e0e0); }
      .room.head { border-top: none; }
      .room.gone { opacity: .4; }
      /* La fila entera se tine segun el modo en marcha. */
      .room.m-cool { background: color-mix(in srgb, var(--info-color, #039be5) 13%, transparent); }
      .room.m-heat { background: color-mix(in srgb, var(--warning-color, #ff9800) 15%, transparent); }
      .room.m-dry  { background: color-mix(in srgb, var(--success-color, #43a047) 10%, transparent); }
      .room.m-cool .pwr.on { background: var(--info-color, #039be5); }
      .room.m-heat .pwr.on { background: var(--warning-color, #ff9800); }
      .pwr {
        flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
        width: 42px; height: 42px; border-radius: 50%; cursor: pointer;
        border: none; background: var(--secondary-background-color, #f1f1f1);
        color: var(--secondary-text-color); padding: 0;
      }
      .pwr ha-icon { --mdc-icon-size: 24px; }
      .pwr.on { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
      .rname { flex: 1 1 auto; min-width: 72px; cursor: pointer;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .room.on .rname { font-weight: 500; }
      .temps { flex: 0 0 auto; display: inline-flex; cursor: pointer;
               font-variant-numeric: tabular-nums;
               color: var(--primary-text-color); white-space: nowrap; }
      .temps > span { width: 52px; text-align: right; }
      .temps .real { color: var(--primary-color, #03a9f4); font-weight: 500; }
      .head {
        min-height: 0; padding-top: 2px; padding-bottom: 2px;
        font-size: 9px; letter-spacing: .05em; text-transform: uppercase;
        font-weight: 500; color: var(--secondary-text-color);
      }
      .head .temps > span { overflow: hidden; text-overflow: clip; }
      .head .temps > span, .head .pw, .head .lx { color: inherit; font-weight: 500; }
      .head .pw, .head .lx { display: inline-flex; justify-content: flex-end; align-items: center; }
      .head .tmr, .head .winwrap, .head .fans {
        display: inline-flex; align-items: center; justify-content: flex-start;
        color: inherit; border: none; background: none; padding: 0;
      }
      .head ha-icon { --mdc-icon-size: 14px; color: inherit; }
      .head .pwrsp { flex: 0 0 auto; width: 42px; }
      .head .rname { min-width: 72px; }
      .room.head + .room { border-top: 1px solid var(--divider-color, #e0e0e0); }
      .lx { flex: 0 0 auto; width: 44px; text-align: right;
            font-size: 14px; color: var(--secondary-text-color, #727272); }
      .pw { flex: 0 0 auto; cursor: pointer; width: 52px; text-align: right;
            color: var(--secondary-text-color); font-variant-numeric: tabular-nums;
            white-space: nowrap; }
      .plug { flex: 0 0 auto; width: 26px; display: inline-flex; align-items: center;
              justify-content: flex-start; border: none; background: transparent;
              padding: 0; cursor: pointer; color: var(--secondary-text-color); }
      .plug ha-icon { --mdc-icon-size: 24px; color: inherit; }
      .plug.on  { color: var(--success-color, #43a047); }
      .plug.cut { color: var(--error-color, #db4437); }
      .plug.armed { color: var(--warning-color, #ffa600); animation: acrc-blink 1s steps(2, start) infinite; }
      .plug.na { opacity: .5; cursor: default; }
      .head .plug { display: inline-flex; align-items: center; justify-content: flex-start; color: inherit; }
      @keyframes acrc-blink { to { visibility: hidden; } }
      .winwrap { position: relative; display: inline-flex; flex: 0 0 auto; width: 24px; }
      .win { --mdc-icon-size: 24px; cursor: pointer; }
      .win.closed  { color: var(--success-color, #43a047); }
      .win.some    { color: var(--warning-color, #ffa600); }
      .win.open    { color: var(--error-color, #db4437); }
      .win.unknown { color: var(--disabled-text-color, #9e9e9e); }
      .batdot { display: none; position: absolute; right: -1px; bottom: -1px;
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--error-color, #db4437);
        box-shadow: 0 0 0 1.5px var(--card-background-color, #fff); }
      .tmr {
        display: inline-flex; align-items: center; gap: 3px;
        flex: 0 0 auto; width: 62px; justify-content: flex-start;
        border: none; background: transparent; padding: 0; cursor: pointer;
        font: inherit; font-size: 14px; font-variant-numeric: tabular-nums;
        color: var(--secondary-text-color);
      }
      .tmr ha-icon { --mdc-icon-size: 22px; color: inherit; }
      .tmr.on { color: var(--warning-color, #ffa600); font-weight: 500; }
      .fans { display: inline-flex; gap: 10px; flex: 0 0 auto;
              width: calc(var(--acrc-fans, 1) * 24px + (var(--acrc-fans, 1) - 1) * 10px);
              justify-content: flex-start; }
      .rfan { border: none; background: transparent; padding: 0; cursor: pointer;
              display: inline-flex; }
      .rfan ha-icon { --mdc-icon-size: 24px; color: inherit; }
      .rfan.on  { color: var(--success-color, #43a047); }
      .rfan.on ha-icon { animation: acrc-spin 2s linear infinite; }
      .rfan.off { color: var(--info-color, #039be5); }
      @keyframes acrc-spin { to { transform: rotate(360deg); } }
      .ov {
        position: fixed; inset: 0; z-index: 9;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, .45); padding: 16px;
        animation: acrc-in .12s ease-out;
      }
      .ovbox { width: 100%; max-width: 420px; max-height: 88vh; overflow: auto; }
      @keyframes acrc-in { from { opacity: 0 } to { opacity: 1 } }
      /* Antes la potencia se escondia bajo 420px. Se prefiere apretar las
         columnas: en un telefono el consumo es justo lo que se quiere ver. */
      /* Ojo con los shorthand aca: .head tambien es un .room, y estas reglas
         van despues, asi que con la misma especificidad le ganan. El tamano de
         letra y el padding vertical se aplican solo a las filas de datos; el
         gap y el padding lateral SI van a las dos, porque son los que alinean
         las columnas con su encabezado. */
      @media (max-width: 460px) {
        .room { gap: 7px; padding-left: 10px; padding-right: 10px; }
        .room:not(.head) { padding-top: 6px; padding-bottom: 6px; font-size: 15px; }
        .temps > span { width: 46px; }
        .pw { width: 46px; }
        .lx { width: 38px; }
        .tmr { width: 54px; }
      }
      @media (max-width: 360px) {
        .room { gap: 5px; padding-left: 8px; padding-right: 8px; }
        .room:not(.head) { padding-top: 6px; padding-bottom: 6px; font-size: 14px; }
        .temps > span { width: 42px; }
        .pw { width: 42px; }
        .lx { width: 34px; }
        .rname { min-width: 56px; }
      }
    `;
    return s;
  }
}


const ROOMS_LABELS = {
  es: {
    title: "Título",
    rooms_mode: "Piezas",
    discover_view: "Buscar solo en esta vista (vacío = todo el dashboard)",
    columns: "Columnas de cada línea",
    sort: "Orden",
    popup: "Al tocar una pieza, abrir su tarjeta completa",
    exclude: "Piezas a excluir",
    decimals: "Decimales de temperatura (vacío = hasta 1)",
    base_view: "Vista de arriba en el popup (vacío = la de cada pieza)",
    add_room: "Agregar pieza: elige su equipo (o la escena de frío, si es por IR)",
    remove: "Quitar esta pieza",
    auto: "Buscarlas en el panel",
    manual: "Listarlas acá",
    noteManual: "Cada pieza se edita abajo con los mismos campos que la tarjeta AC Room.",
    noteAuto: (n) => `Se agregan solas las tarjetas AC Room del panel (${n} ahora mismo). Para elegir los sensores acá, cambia "Piezas" a "Listarlas acá".`,
  },
  en: {
    title: "Title",
    rooms_mode: "Rooms",
    discover_view: "Only search this view (empty = whole dashboard)",
    columns: "Columns on each line",
    sort: "Order",
    popup: "Tapping a room opens its full card",
    exclude: "Rooms to exclude",
    decimals: "Temperature decimals (empty = up to 1)",
    base_view: "Top view in the popup (empty = each room's own)",
    add_room: "Add a room: pick its unit (or its cool scene, for IR units)",
    remove: "Remove this room",
    auto: "Find them on the dashboard",
    manual: "List them here",
    noteManual: "Each room is edited below with the same fields as the AC Room card.",
    noteAuto: (n) => `AC Room cards on the dashboard are added automatically (${n} right now). To pick sensors here, switch "Rooms" to "List them here".`,
  },
};

const ROOMS_KEYS = ["title", "discover_view", "columns", "exclude", "sort", "decimals", "base_view"];
const ROOM_DOMAINS = ["climate", "input_boolean", "switch", "scene", "script", "button", "input_button"];

class AcRoomsCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  /* Las opciones de "excluir" y de "vista" salen del propio dashboard, para
     que sean las piezas y vistas que el usuario realmente tiene. */
  async _cargarOpciones() {
    if (this._opciones) return this._opciones;
    const partes = String((window.location && window.location.pathname) || "").split("/").filter(Boolean);
    const url_path = partes[0] && partes[0] !== "lovelace" ? partes[0] : null;
    let lov = null;
    try { lov = await this._hass.callWS({ type: "lovelace/config", url_path }); } catch (e) { lov = null; }
    const piezas = [];
    const configs = [];
    const vistas = [];
    const recorrer = (o) => {
      if (Array.isArray(o)) { o.forEach(recorrer); return; }
      if (!o || typeof o !== "object") return;
      if (o.type === "custom:ac-room-card") {
        const v = o.name || o.entity;
        if (v && !piezas.includes(v)) {
          piezas.push(v);
          const { type, ...resto } = o;
          configs.push(resto);
        }
        return;
      }
      if (Array.isArray(o.cards)) recorrer(o.cards);
      if (Array.isArray(o.sections)) recorrer(o.sections);
    };
    for (const v of (lov && lov.views ? lov.views : [])) {
      if (v.path) vistas.push({ value: v.path, label: `${v.title || v.path} (${v.path})` });
      recorrer(v);
    }
    this._opciones = { piezas, vistas, configs };
    return this._opciones;
  }

  _manual() {
    return Array.isArray(this._config.rooms) && this._config.rooms.length > 0;
  }

  _esquema(op, lang = "es") {
    const L = ROOMS_LABELS[lang];
    const manual = this._config && this._manual();
    return [
      { name: "title", selector: { text: {} } },
      { name: "rooms_mode", selector: { select: { mode: "dropdown", options: [
        { value: "auto", label: L.auto },
        { value: "manual", label: L.manual },
      ] } } },
      // Buscar en una vista y excluir solo tienen sentido buscando solas.
      ...(manual ? [] : [
        { name: "discover_view", selector: { select: { mode: "dropdown", options: op.vistas } } },
      ]),
      { name: "columns", selector: { select: { multiple: true, mode: "list", options: [
        { value: "temps", label: tr(lang, "Temperaturas", "Temperatures") },
        { value: "power", label: tr(lang, "Potencia", "Power") },
        { value: "plug", label: tr(lang, "Corte de corriente", "Power cut") },
        { value: "lux", label: tr(lang, "Luz", "Light") },
        { value: "window", label: tr(lang, "Ventanas", "Windows") },
        { value: "timer", label: tr(lang, "Temporizador", "Timer") },
        { value: "fans", label: tr(lang, "Ventiladores y conmutables", "Fans and toggles") },
      ] } } },
      ...(manual ? [] : [
        { name: "exclude", selector: { select: { multiple: true, mode: "list",
          options: op.piezas.map((p) => ({ value: p, label: p })) } } },
      ]),
      { name: "", type: "grid", schema: [
        { name: "sort", selector: { select: { mode: "dropdown", options: [
          { value: "configured", label: tr(lang, "Como están en el dashboard", "As configured") },
          { value: "active", label: tr(lang, "Las encendidas primero", "Running rooms first") },
        ] } } },
        { name: "popup", selector: { boolean: {} } },
        { name: "decimals", selector: { number: { min: 0, max: 3, step: 1, mode: "box" } } },
      ]},
      { name: "base_view", selector: { select: { mode: "dropdown", options: viewOptions(lang) } } },
    ];
  }

  _emitir(cfg) {
    this._config = cfg;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: cfg }, bubbles: true, composed: true,
    }));
    this._render();
  }

  /* Al pasar a la lista se parte con lo que ya se veia: las piezas que habia
     encontrado en el dashboard, o si no hay ninguna, los climate que existan. */
  _semilla(op) {
    if (op.configs.length) return op.configs.map((c) => ({ ...c }));
    return Object.keys(this._hass.states || {})
      .filter((e) => e.startsWith("climate.")).slice(0, 3).map((entity) => ({ entity }));
  }

  _cambioGeneral(op, d) {
    const cfg = { ...this._config, ...d, type: this._config.type || "custom:ac-rooms-card" };
    delete cfg.rooms_mode;
    if (d.rooms_mode === "manual" && !this._manual()) {
      const semilla = this._semilla(op);
      if (semilla.length) cfg.rooms = semilla;
      delete cfg.exclude;
      delete cfg.discover_view;
    } else if (d.rooms_mode === "auto") {
      delete cfg.rooms;
    }
    for (const k of ROOMS_KEYS) {
      const v = cfg[k];
      if (v === undefined || v === "" || v === null || (Array.isArray(v) && !v.length)) delete cfg[k];
    }
    if (cfg.popup !== false) delete cfg.popup;   // true es el default
    this._emitir(cfg);
  }

  _cambioPieza(i, room) {
    const { type, ...limpia } = room;
    const rooms = this._config.rooms.map((r, j) => (j === i ? limpia : r));
    this._emitir({ ...this._config, rooms });
  }

  _quitarPieza(i) {
    const rooms = this._config.rooms.filter((_, j) => j !== i);
    const cfg = { ...this._config, rooms };
    // Sin piezas, `rooms: []` es un error: se vuelve a buscarlas solas.
    if (!rooms.length) delete cfg.rooms;
    this._emitir(cfg);
  }

  _agregarPieza(op, entity) {
    if (!entity) return;
    const base = this._manual() ? this._config.rooms : this._semilla(op).filter((r) => r.entity !== entity);
    // Un aire por IR sin climate se agrega desde su escena o boton de frio:
    // queda como pieza con ese modo, y el resto se completa en su panel.
    let nueva = { entity };
    if (isStateless(entity)) {
      const st = this._hass.states[entity];
      const lang = langOf(this._hass);
      nueva = { modes: [{ name: tr(lang, "Frío", "Cool"), icon: "mdi:snowflake", entity }] };
      if (st && st.attributes.friendly_name) nueva.name = st.attributes.friendly_name;
    }
    this._emitir({ ...this._config, rooms: [...base, nueva] });
  }

  _tituloPieza(r) {
    const st = r.entity && this._hass.states[r.entity];
    return r.name || (st && st.attributes.friendly_name) || r.entity || "?";
  }

  /* Un panel por pieza con el mismo formulario del card de pieza. Se rehace
     solo si cambia la cantidad; si no, se refrescan los datos, para no
     perder el foco mientras se escribe. */
  _renderPiezas(lang) {
    const rooms = this._manual() ? this._config.rooms : [];
    if (!this._lista || this._lista.length !== rooms.length) {
      this._piezasBox.innerHTML = "";
      this._lista = rooms.map((_, i) => {
        const panel = document.createElement("ha-expansion-panel");
        panel.outlined = true;
        panel.style.cssText = "display:block;margin-top:8px";
        const form = createRoomForm(() => this._config.rooms[i], () => this._hass,
          (room) => this._cambioPieza(i, room));
        const quitar = document.createElement("button");
        quitar.type = "button";
        quitar.style.cssText = "margin:8px 0 4px;background:none;border:none;cursor:pointer;" +
          "color:var(--error-color,#db4437);font:inherit;display:flex;align-items:center;gap:6px;padding:0";
        quitar.innerHTML = `<ha-icon icon="mdi:delete-outline"></ha-icon><span></span>`;
        quitar.addEventListener("click", () => this._quitarPieza(i));
        panel.appendChild(form);
        panel.appendChild(quitar);
        this._piezasBox.appendChild(panel);
        return { panel, form, quitar };
      });
    }
    this._lista.forEach(({ panel, form, quitar }, i) => {
      panel.header = this._tituloPieza(rooms[i]);
      const txt = quitar.querySelector("span");
      if (txt) txt.textContent = ROOMS_LABELS[lang].remove;
      refreshRoomForm(form, rooms[i], this._hass);
    });
  }

  async _render() {
    if (!this._config || !this._hass) return;
    const op = await this._cargarOpciones();
    const lang = langOf(this._hass);
    const L = ROOMS_LABELS[lang];
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (sc) => ROOMS_LABELS[langOf(this._hass)][sc.name] || sc.name;
      this._form.addEventListener("value-changed", (ev) => {
        if (ev.stopPropagation) ev.stopPropagation();
        this._cambioGeneral(op, { ...ev.detail.value });
      });
      this.appendChild(this._form);
      this._nota = document.createElement("div");
      this._nota.style.cssText = "padding:8px 4px 0;font-size:12px;color:var(--secondary-text-color)";
      this.appendChild(this._nota);

      this._piezasBox = document.createElement("div");
      this.appendChild(this._piezasBox);

      this._agregar = document.createElement("ha-form");
      this._agregar.style.cssText = "display:block;margin-top:12px";
      this._agregar.computeLabel = (sc) => ROOMS_LABELS[langOf(this._hass)][sc.name] || sc.name;
      this._agregar.addEventListener("value-changed", (ev) => {
        if (ev.stopPropagation) ev.stopPropagation();
        const entity = ev.detail.value && ev.detail.value.add_room;
        this._agregar.data = {};
        this._agregarPieza(op, entity);
      });
      this.appendChild(this._agregar);
    }
    this._form.hass = this._hass;
    this._form.schema = this._esquema(op, lang);
    const d = { popup: this._config.popup !== false, rooms_mode: this._manual() ? "manual" : "auto" };
    for (const k of ROOMS_KEYS) {
      if (this._config[k] !== undefined) d[k] = this._config[k];
    }
    this._form.data = d;
    this._nota.textContent = this._manual() ? L.noteManual : L.noteAuto(op.piezas.length);

    this._renderPiezas(lang);
    this._agregar.hass = this._hass;
    this._agregar.schema = [{ name: "add_room", selector: { entity: { domain: ROOM_DOMAINS } } }];
    if (!this._agregar.data) this._agregar.data = {};
  }

  static get filtrar() { return null; }
}

if (!customElements.get("ac-rooms-card-editor")) {
  customElements.define("ac-rooms-card-editor", AcRoomsCardEditor);
}

if (!customElements.get("ac-rooms-card")) {
  customElements.define("ac-rooms-card", AcRoomsCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ac-rooms-card",
  name: "AC Rooms Card",
  description: tr(langOf(null), "Vista compacta de varias piezas, una línea por cada una",
    "Compact list of several rooms, one line each"),
  preview: false,
});

if (!customElements.get("ac-room-card")) {
  customElements.define("ac-room-card", AcRoomCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ac-room-card",
  name: "AC Room Card",
  description: tr(langOf(null), "Termostato con potencia, energía y sensor de ventana",
    "Thermostat with power, energy and window sensor"),
  preview: false,
});

console.info(`%c AC-ROOM-CARD %c v${VERSION} `,
  "color:white;background:#44739e;font-weight:700",
  "color:#44739e;background:white;font-weight:700");
