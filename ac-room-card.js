/*!
 * ac-room-card
 * Envuelve el card `thermostat` integrado de Home Assistant y le agrega
 * filas opcionales de potencia, energia y sensor de ventana.
 *
 * No copia codigo de Home Assistant: instancia el card integrado en runtime
 * a traves de loadCardHelpers(). Licencia MIT (ver LICENSE).
 */

const VERSION = "0.38.2";

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
  autoOn: "activa",
  autoOff: "desactivada",
  autoRunning: "corriendo ahora",
  autoLast: "última vez",
  autoNever: "nunca",
  autoSince: "desde",
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
  autoOn: "enabled",
  autoOff: "disabled",
  autoRunning: "running now",
  autoLast: "last run",
  autoNever: "never",
  autoSince: "since",
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

/* ---------- automatizaciones ---------- */

/* Lo que maneja el aire por su cuenta: la automatizacion misma, o el
   boolean o script que la habilita ("Control Verano"). No son ventiladores:
   no giran, y apagadas van en gris, no en azul. */
const AUTO_DOMAINS = ["automation", "input_boolean", "script"];

/* "hace 5 min" / "5 min ago". */
function hace(iso, lang) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  // Truncado, no redondeado: 90 min es "hace 1 h", no "hace 2 h".
  const [n, u] = s < 60 ? [s, "s"]
    : s < 3600 ? [Math.floor(s / 60), "min"]
    : s < 86400 ? [Math.floor(s / 3600), "h"]
    : [Math.floor(s / 86400), "d"];
  return lang === "en" ? `${n} ${u} ago` : `hace ${n} ${u}`;
}

/* Clase para pintar y texto para el tooltip. Una automatizacion dice si esta
   activa y cuando corrio por ultima vez; un script, si esta corriendo; un
   boolean, desde cuando esta como esta. */
function autoState(hass, a, L, lang) {
  const st = hass.states[a.entity];
  const nombre = a.name || (st && st.attributes.friendly_name) || a.entity;
  if (!st || st.state === "unavailable" || st.state === "unknown") {
    return { clase: "na", on: false, texto: `${nombre}: ${L.unavailable}` };
  }
  const d = domainOf(a.entity);
  const on = st.state === "on";
  const corriendo = (d === "automation" && Number(st.attributes.current) > 0) || (d === "script" && on);
  const partes = [corriendo ? L.autoRunning : on ? L.autoOn : L.autoOff];
  if (d === "automation" || d === "script") {
    partes.push(`${L.autoLast}: ${hace(st.attributes.last_triggered, lang) || L.autoNever}`);
  } else if (st.last_changed) {
    const cuando = hace(st.last_changed, lang);
    if (cuando) partes.push(`${L.autoSince} ${cuando}`);
  }
  return { clase: corriendo ? "run" : on ? "on" : "off", on: on || corriendo, texto: `${nombre}: ${partes.join(" · ")}` };
}

/* Busca ac-room-card en la config de un dashboard: dentro de vistas,
   secciones, pilas (`cards`) y tarjetas que envuelven a una sola (`card`,
   como conditional). */
function buscarPiezas(o, alEncontrar) {
  if (Array.isArray(o)) { o.forEach((x) => buscarPiezas(x, alEncontrar)); return; }
  if (!o || typeof o !== "object") return;
  if (o.type === "custom:ac-room-card") { alEncontrar(o); return; }
  if (Array.isArray(o.cards)) buscarPiezas(o.cards, alEncontrar);
  if (Array.isArray(o.sections)) buscarPiezas(o.sections, alEncontrar);
  if (o.card && typeof o.card === "object") buscarPiezas(o.card, alEncontrar);
}

/* Agrega una tarjeta al selector de HA una sola vez, aunque el archivo se
   cargue dos veces (dos recursos apuntando a copias distintas). */
function alSelector(entrada) {
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c && c.type === entrada.type)) window.customCards.push(entrada);
}

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
      config.window_entity || config.temp_entity || config.lux_entity ||
      normEntries(config.automations).length ||
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

  /* Lo que _build lee del equipo una sola vez: los modos (botones bajo el
     termostato) y las velocidades (selector de fan_mode). Si el climate
     estaba unavailable al montar la tarjeta llegan vacios y, sin esto, no
     aparecian nunca aunque el equipo volviera. Solo cuenta lo que se usa. */
  _firmaEquipo() {
    const cfg = this._config;
    if (!cfg || domainOf(cfg.entity) !== "climate" || !this._hass) return "";
    const st = this._hass.states[cfg.entity];
    const a = (st && st.attributes) || {};
    const usaModos = resolveView(cfg) === "thermostat" && !cfg.features && cfg.mode_buttons !== false &&
      !normModes(cfg.modes).length;
    const modos = usaModos && Array.isArray(a.hvac_modes) ? a.hvac_modes : [];
    const velocidades = cfg.fan_mode && Array.isArray(a.fan_modes) ? a.fan_modes : [];
    return modos.length || velocidades.length ? JSON.stringify([modos, velocidades]) : "";
  }

  async _render() {
    if (!this._config || !this._hass) return;
    // Llegaron modos o velocidades distintos de los que se usaron al construir:
    // se rehace. Si el equipo se cae (firma vacia) se deja lo dibujado, para
    // que los botones no parpadeen con cada corte.
    if (this._built && this._firma !== undefined) {
      const ahora = this._firmaEquipo();
      if (ahora && ahora !== this._firma) {
        this._built = false;
        this._inner = null;
        this._innerStyle = undefined;
        if (this.shadowRoot) this.shadowRoot.innerHTML = "";
      }
    }
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
    // Antes de los await: es la foto del equipo con la que se arma todo.
    const firma = this._firmaEquipo();

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
    this._firma = firma;
    // Una reconstruccion parte de cero: si no, quedaban filas y botones de la
    // pasada anterior colgando, y la linea de datos se creia con botones.
    this._rows = {};
    this._fanBtns = undefined;
    this._autoBtns = undefined;
    this._modeBtns = undefined;
    this._stepper = undefined;
    this._pwBtn = undefined;
    this._fanModeEl = undefined;
    this._fansInline = false;
    this._soltarEnchufe();

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

    // Automatizaciones: siempre en la linea de datos, por defecto al
    // principio (antes de la potencia); `position: end` las deja al final.
    const autos = this._autoList();
    if (autos.length) {
      const fin = this._rows.power.querySelector(".fanslot");
      const ini = this._rows.power.querySelector(".preslot");
      this._autoBtns = autos.map((a) => {
        const b = this._makeAutoBtn(a);
        (a.position === "end" || !ini ? fin : ini).appendChild(b);
        return b;
      });
    }

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
    // La linea tambien se muestra si solo lleva automatizaciones o
    // ventiladores: antes una pieza con puros conmutables quedaba sin nada.
    const conBotones = (this._autoBtns && this._autoBtns.length) ||
      (this._fansInline && this._fanBtns && this._fanBtns.length);
    if (!p && !cfg.window_entity && !cfg.temp_entity && !cfg.lux_entity && !conBotones) {
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
    this._updateAutos();
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

  // Un boolean o una automatizacion en `fans` (configs de antes) se dibuja
  // como automatizacion, sin tener que volver a guardar la tarjeta.
  _fanList() {
    return splitFans(this._config).fans;
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

  /* ---------- automatizaciones ---------- */

  _autoList() {
    return splitFans(this._config).autos;
  }

  _makeAutoBtn(a) {
    const b = document.createElement("button");
    b.className = "auto";
    b.dataset.entity = a.entity;
    if (a.color) b.dataset.color = a.color;
    b.innerHTML = `<ha-icon icon="${a.icon || "mdi:robot-outline"}"></ha-icon>`;
    // Tocar la activa o la desactiva (homeassistant.toggle sirve para
    // automation, input_boolean y script).
    b.addEventListener("click", (ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      this._hass.callService("homeassistant", "toggle", { entity_id: a.entity });
    });
    return b;
  }

  _updateAutos() {
    if (!this._autoBtns) return;
    const autos = this._autoList();
    this._autoBtns.forEach((b, i) => {
      const e = autoState(this._hass, autos[i] || { entity: b.dataset.entity }, this._config.labels, this._lang);
      b.className = `auto ${e.clase}`;
      b.style.color = e.on && b.dataset.color ? b.dataset.color : "";
      b.title = e.texto;
    });
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
    this._soltarEnchufe();
  }

  /* El doble toque del enchufe deja un setTimeout de 5 s: al desmontar o
     reconstruir no debe quedar vivo. */
  _soltarEnchufe() {
    if (this._pwTimer) { clearTimeout(this._pwTimer); this._pwTimer = null; }
    this._pwArmado = false;
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
      .row .winwrap { position: relative; display: inline-flex; margin-left: 10px; }
      .row .win { margin-left: 0; --mdc-icon-size: 20px; flex: 0 0 auto; }
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
      /* Automatizaciones: verde (o su color) activas, gris desactivadas, y
         latiendo mientras corren. No giran: no son ventiladores. */
      .auto {
        display: inline-flex; align-items: center;
        font: inherit; cursor: pointer;
        border: none; background: transparent; padding: 0;
      }
      .auto ha-icon { --mdc-icon-size: 20px; color: inherit; }
      .auto.on, .auto.run { color: var(--success-color, #43a047); }
      .auto.run ha-icon { animation: acrc-pulse 1.2s ease-in-out infinite; }
      .auto.off { color: var(--disabled-text-color, #9e9e9e); }
      .auto.na { color: var(--disabled-text-color, #9e9e9e); opacity: .5; }
      .auto:hover { opacity: .7; }
      @keyframes acrc-pulse { 50% { opacity: .35; } }
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

// Etiquetas cortas: la seccion ya dice de que se trata. Lo que necesita
// explicacion va en el texto de la seccion (EDITOR_SECTIONS.help).
const EDITOR_LABELS = {
  es: {
    entity: "Equipo",
    base_view: "Vista de arriba",
    mode_buttons: "Botones de modo",
    name: "Nombre",
    icon: "Ícono",
    power_entity: "Potencia",
    temp_entity: "Temperatura",
    lux_entity: "Luz",
    decimals: "Decimales",
    decimals_help: "Vacío = como venga el sensor",
    energy_today_entity: "Energía de hoy",
    energy_month_entity: "Energía del mes",
    window_entity: "Sensores de ventana",
    battery_warn: "Pila baja bajo (%)",
    show_warning: "Aviso de texto con ventana abierta",
    power_switch: "Enchufe del equipo",
    power_switch_confirm: "Cortar con dos toques",
    fans: "Ventiladores",
    fans_position: "Posición",
    fan_mode: "Velocidad del equipo",
    fan_name: "Nombre de",
    automations: "Automatizaciones",
    mode_cold_entity: "Frío",
    mode_heat_entity: "Calor",
    mode_off_entity: "Apagar",
    step_temp: "°C",
    timer_entity: "Timer",
    timer_minutes_entity: "Minutos (input_number)",
    timer_button_entity: "Botón que dispara tu automatización",
  },
  en: {
    entity: "Unit",
    base_view: "Top view",
    mode_buttons: "Mode buttons",
    name: "Title",
    icon: "Icon",
    power_entity: "Power",
    temp_entity: "Temperature",
    lux_entity: "Light",
    decimals: "Decimals",
    decimals_help: "Empty = as the sensor reports",
    energy_today_entity: "Energy today",
    energy_month_entity: "Energy this month",
    window_entity: "Window sensors",
    battery_warn: "Low battery below (%)",
    show_warning: "Text warning with a window open",
    power_switch: "Unit's plug",
    power_switch_confirm: "Cut with two taps",
    fans: "Fans",
    fans_position: "Position",
    fan_mode: "Unit's fan speed",
    fan_name: "Name of",
    automations: "Automations",
    mode_cold_entity: "Cool",
    mode_heat_entity: "Heat",
    mode_off_entity: "Turn off",
    step_temp: "°C",
    timer_entity: "Timer",
    timer_minutes_entity: "Minutes (input_number)",
    timer_button_entity: "Button that fires your automation",
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

/* Ventiladores de verdad y automatizaciones. Las que estaban en `fans` (un
   boolean tipo "Control Verano") se cuentan como automatizaciones, detras
   de las de `automations`. */
function splitFans(c) {
  const enFans = normFans(c && c.fans);
  const esAuto = (f) => AUTO_DOMAINS.includes(domainOf(f.entity));
  return {
    fans: enFans.filter((f) => !esAuto(f)),
    autos: [...normFans(c && c.automations), ...enFans.filter(esAuto)],
  };
}

/* Una lista con nombre editable por posicion (`<prefijo>_<i>`). Si la lista
   acaba de cambiar, esos indices ya no calzan: los nombres se buscan por
   entidad y el siguiente render vuelve a poblar el formulario. Conserva lo
   que el formulario no maneja (icono, color, posicion). */
function listFromForm(ids, prevList, d, prefijo) {
  const listaCambio = prevList.length !== ids.length || prevList.some((f, i) => f.entity !== ids[i]);
  return ids.map((id, i) => {
    const old = prevList.find((f) => f.entity === id) || {};
    const campo = `${prefijo}_${i}`;
    const nombre = listaCambio
      ? old.name
      : String(d[campo] === undefined ? old.name || "" : d[campo]).trim();
    const { entity, name, ...resto } = old;
    const obj = { entity: id, ...resto };
    if (nombre) obj.name = nombre;
    // Sin nada propio, se guarda como simple entity_id
    return Object.keys(obj).length > 1 ? obj : id;
  });
}

/* Secciones plegables del editor: que campos van en cada una, su titulo y
   su icono. Lo basico (equipo, vista, nombre) queda siempre a la vista. */
const EDITOR_SECTIONS = [
  { id: "sensors", icon: "mdi:thermometer",
    title: ["Sensores", "Sensors"],
    keys: ["power_entity", "temp_entity", "lux_entity", "decimals", "energy_today_entity", "energy_month_entity"] },
  { id: "windows", icon: "mdi:window-closed-variant",
    title: ["Ventanas", "Windows"],
    keys: ["window_entity", "battery_warn", "show_warning"] },
  { id: "plug", icon: "mdi:power-plug",
    title: ["Enchufe", "Plug"],
    keys: ["power_switch"] },
  { id: "fans", icon: "mdi:fan",
    title: ["Ventiladores", "Fans"],
    keys: ["fans", "fans_position", "fan_mode"] },
  { id: "autos", icon: "mdi:robot-outline",
    title: ["Automatizaciones", "Automations"],
    help: [
      "Las automatizaciones, o sus interruptores, que manejan este aire.",
      "The automations, or their switches, that run this unit.",
    ],
    keys: ["automations"] },
  { id: "ir", icon: "mdi:remote",
    title: ["Aire IR", "IR unit"],
    help: [
      "Para aires sin entidad climate. Cada modo puede ser un boolean, una escena, un script o un botón. " +
      "Si eliges varias escenas en un modo (una por temperatura), aparecen flechas ▲▼ para pasar entre ellas; " +
      "la temperatura sale del número del nombre, o la escribes en su casilla. «Turb» y «Swing» en el nombre " +
      "se marcan con T y S. Apagar es la escena que apaga el aire.",
      "For units without a climate entity. Each mode can be a boolean, scene, script or button. " +
      "Pick several scenes for a mode (one per temperature) and ▲▼ arrows appear to move between them; " +
      "the temperature comes from the number in the name, or type it in its box. \"Turb\" and \"Swing\" in the " +
      "name are marked T and S. Turn off is the scene that switches the unit off.",
    ],
    keys: ["mode_cold_entity", "mode_heat_entity", "mode_off_entity"] },
  { id: "timer", icon: "mdi:timer-outline",
    title: ["Temporizador", "Timer"],
    keys: ["timer_entity", "timer_minutes_entity", "timer_button_entity"] },
];

const conValor = (v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "" && v !== false);

/* El esquema se arma en cada render porque los campos de nombre dependen de
   cuantos ventiladores haya elegidos. Una seccion viene abierta si ya tiene
   algo configurado, o si esta en `abiertas` (el editor recuerda las que abrio,
   para no cerrarle una en la cara al vaciar su ultimo campo). */
function buildSchema(config, lang = "es", abiertas = null) {
  const c = config || {};
  const campos = baseFields(lang);
  // "Card propio" solo aparece si ya hay un base_card escrito en YAML: desde
  // el formulario no se puede armar uno.
  const opciones = viewOptions(lang);
  if (resolveView(c) === "custom") {
    const tipo = c.base_card.type || "base_card";
    opciones.push({ value: "custom", label: tr(lang, `Card propio en YAML (${tipo})`, `Own card in YAML (${tipo})`) });
  }
  const top = [
    campos.entity,
    { name: "", type: "grid", schema: [
      { name: "base_view", selector: { select: { mode: "dropdown", options: opciones } } },
      { name: "mode_buttons", selector: { boolean: {} } },
    ]},
    { name: "", type: "grid", schema: [campos.name, campos.icon] },
  ];

  // Un modo con varias escenas pide la temperatura de cada una, para las
  // flechas. Vacia, se usa el numero del nombre de la escena.
  const modos = normModes(c.modes);
  const tempsDe = (idx, clave) => {
    const pasos = normEntries(modos[idx] && modos[idx].steps);
    return pasos.length > 1
      ? pasos.map((_, i) => ({ name: `${clave}_temp_${i}`, selector: { number: { min: 0, max: 40, step: 0.5, mode: "box" } } }))
      : [];
  };
  const temps = [...tempsDe(0, "mode_cold"), ...tempsDe(1, "mode_heat")];
  const { fans, autos } = splitFans(c);
  const nombres = (lista, prefijo) => (lista.length ? [{ name: "", type: "grid",
    schema: lista.map((_, i) => ({ name: `${prefijo}_${i}`, selector: { text: {} } })) }] : []);

  const contenido = {
    sensors: [
      { name: "", type: "grid", schema: [campos.power_entity, campos.temp_entity] },
      { name: "", type: "grid", schema: [campos.lux_entity, campos.decimals] },
      { name: "", type: "grid", schema: [campos.energy_today_entity, campos.energy_month_entity] },
    ],
    windows: [
      campos.window_entity,
      { name: "", type: "grid", schema: [campos.battery_warn, campos.show_warning] },
    ],
    plug: [
      { name: "", type: "grid", schema: [campos.power_switch, campos.power_switch_confirm] },
    ],
    fans: [
      campos.fans,
      ...nombres(fans, "fan_name"),
      { name: "", type: "grid", schema: [campos.fans_position, campos.fan_mode] },
    ],
    autos: [
      campos.automations,
      ...nombres(autos, "auto_name"),
    ],
    ir: [
      { name: "", type: "grid", schema: [campos.mode_cold_entity, campos.mode_heat_entity] },
      ...(temps.length ? [{ name: "", type: "grid", schema: temps }] : []),
      campos.mode_off_entity,
    ],
    timer: [
      { name: "", type: "grid", schema: [campos.timer_entity, campos.timer_minutes_entity] },
      campos.timer_button_entity,
    ],
  };

  const datos = toForm(c);
  const secciones = EDITOR_SECTIONS.map((s) => {
    const abierta = s.keys.some((k) => conValor(datos[k])) || !!(abiertas && abiertas.has(s.id));
    if (abierta && abiertas) abiertas.add(s.id);
    const sec = {
      name: "", type: "expandable", flatten: true,
      title: lang === "en" ? s.title[1] : s.title[0],
      icon: s.icon, expanded: abierta,
      schema: contenido[s.id],
    };
    // HA muestra bajo el titulo lo que devuelva computeHelper para la seccion.
    if (s.help) sec.help = lang === "en" ? s.help[1] : s.help[0];
    return sec;
  });
  return [...top, ...secciones];
}

const viewOptions = (lang) => [
  { value: "compact", label: tr(lang, "Compacta: Target / Actual (mini-climate)", "Compact: Target / Actual (mini-climate)") },
  { value: "thermostat", label: tr(lang, "Termostato de Home Assistant", "Home Assistant thermostat") },
  { value: "none", label: tr(lang, "Ninguna: solo el encabezado y las filas", "None: just the title and the data rows") },
];

/* Cada campo del editor, por nombre. buildSchema los acomoda en secciones. */
const baseFields = (lang) => ({
  entity: { name: "entity", selector: { entity: { domain: ["climate", "input_boolean", "switch"] } } },
  name: { name: "name", selector: { text: {} } },
  icon: { name: "icon", selector: { icon: {} } },
  power_entity: { name: "power_entity", selector: { entity: { domain: "sensor", device_class: "power" } } },
  temp_entity: { name: "temp_entity", selector: { entity: { domain: "sensor", device_class: "temperature" } } },
  lux_entity: { name: "lux_entity", selector: { entity: { domain: "sensor", device_class: "illuminance" } } },
  // Deslizador y no casilla: HA dibuja el titulo ARRIBA solo en ese modo, y
  // asi queda alineado con los selectores de entidad de al lado. La casilla
  // chica del deslizador se puede vaciar (= como venga el sensor).
  decimals: { name: "decimals", selector: { number: { min: 0, max: 3, step: 1, mode: "slider", slider_ticks: true } } },
  power_switch: { name: "power_switch", selector: { entity: { domain: ["switch", "light", "input_boolean"] } } },
  power_switch_confirm: { name: "power_switch_confirm", selector: { boolean: {} } },
  mode_cold_entity: { name: "mode_cold_entity", selector: { entity: { domain: MODE_DOMAINS, multiple: true } } },
  mode_heat_entity: { name: "mode_heat_entity", selector: { entity: { domain: MODE_DOMAINS, multiple: true } } },
  mode_off_entity: { name: "mode_off_entity", selector: { entity: { domain: ["scene", "script", "button", "input_button"] } } },
  window_entity: { name: "window_entity", selector: { entity: { domain: "binary_sensor", multiple: true } } },
  fans: { name: "fans", selector: { entity: { domain: ["fan", "switch", "light"], multiple: true } } },
  automations: { name: "automations", selector: { entity: { domain: AUTO_DOMAINS, multiple: true } } },
  fans_position: { name: "fans_position", selector: { select: { mode: "dropdown", options: [
    { value: "inline", label: tr(lang, "En la línea de datos (por defecto)", "On the data line (default)") },
    { value: "auto", label: tr(lang, "Uno en la línea, varios en fila propia", "One on the line, several on their own row") },
    { value: "row", label: tr(lang, "Siempre en fila propia", "Always on their own row") }] } } },
  energy_today_entity: { name: "energy_today_entity", selector: { entity: { domain: "sensor", device_class: "energy" } } },
  energy_month_entity: { name: "energy_month_entity", selector: { entity: { domain: "sensor", device_class: "energy" } } },
  timer_entity: { name: "timer_entity", selector: { entity: { domain: "timer" } } },
  timer_minutes_entity: { name: "timer_minutes_entity", selector: { entity: { domain: "input_number" } } },
  timer_button_entity: { name: "timer_button_entity", selector: { entity: { domain: "input_button" } } },
  battery_warn: { name: "battery_warn", selector: { number: { min: 0, max: 100, step: 5, mode: "box" } } },
  fan_mode: { name: "fan_mode", selector: { boolean: {} } },
  show_warning: { name: "show_warning", selector: { boolean: {} } },
});

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
  const { fans, autos } = splitFans(c);
  if (fans.length) {
    out.fans = fans.map((f) => f.entity);
    fans.forEach((f, i) => {
      out[`fan_name_${i}`] = f.name || "";
    });
  }
  out.automations = autos.map((a) => a.entity);
  autos.forEach((a, i) => {
    out[`auto_name_${i}`] = a.name || "";
  });
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

  // Ventiladores y automatizaciones. El form completo (el que trae
  // `automations`) las separa; un boolean, script o automatizacion que venia
  // en `fans`, como se armaba antes, pasa a `automations` con su nombre, icono,
  // color y posicion. Una llamada parcial sin `automations` no mueve nada.
  const completo = d.automations !== undefined;
  const previo = splitFans(prev || {});
  const prevFans = completo ? previo.fans : normFans((prev || {}).fans);
  if (Array.isArray(d.fans) && d.fans.length) {
    out.fans = listFromForm(d.fans, prevFans, d, "fan_name");
  } else {
    delete out.fans;
  }
  if (completo) {
    const ids = (Array.isArray(d.automations) ? d.automations : []).filter(Boolean);
    if (ids.length) out.automations = listFromForm(ids, previo.autos, d, "auto_name");
    else delete out.automations;
  }
  // Los *_name_* son del formulario, nunca de la config del card
  for (const k of Object.keys(out)) if (/^(fan|auto)_name_\d+$/.test(k)) delete out[k];

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
      : tr(lang, "mini-climate no cargó. Mientras tanto se dibuja el termostato integrado.",
        "mini-climate did not load. Meanwhile the built-in thermostat is drawn.");
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
    const m = /^(fan|auto)_name_(\d+)$/.exec(schema.name || "");
    if (m) {
      const partes = splitFans(getConfig());
      const item = (m[1] === "fan" ? partes.fans : partes.autos)[Number(m[2])];
      const id = item && item.entity;
      const st = id && hass && hass.states[id];
      return `${L.fan_name} ${(st && st.attributes.friendly_name) || id || ""}`;
    }
    const t = /^mode_(cold|heat)_temp_(\d+)$/.exec(schema.name || "");
    if (t) {
      const modo = normModes(getConfig().modes)[t[1] === "cold" ? 0 : 1];
      const id = modo && normEntries(modo.steps)[Number(t[2])] && normEntries(modo.steps)[Number(t[2])].entity;
      const st = id && hass && hass.states[id];
      return `${(st && st.attributes.friendly_name) || id || ""} ${L.step_temp}`;
    }
    return L[schema.name] || schema.name;
  };
  form.computeHelper = (schema) => {
    if (!schema) return undefined;
    if (schema.type === "expandable") return schema.help;
    if (schema.name === "decimals") return EDITOR_LABELS[langOf(getHass())].decimals_help;
    return undefined;
  };
  form.addEventListener("value-changed", (ev) => {
    if (ev.stopPropagation) ev.stopPropagation();
    onChange(fromForm(getConfig(), ev.detail.value, langOf(getHass())));
  });
  return form;
}

function refreshRoomForm(form, config, hass) {
  form.hass = hass;
  if (!form._abiertas) form._abiertas = new Set();
  form.schema = buildSchema(config, langOf(hass), form._abiertas);
  form.data = toForm(config);
}

/* ---------- crear el temporizador desde el editor ---------- */

/* Lo que apaga el aire, como acciones de una automatizacion. Un climate se
   apaga; un aire por IR dispara su escena de Apagar o baja sus booleans.
   Sin nada de eso no hay como apagarlo y se devuelve null. */
function timerOffActions(cfg) {
  const c = cfg || {};
  const d = domainOf(c.entity);
  if (d === "climate") return [{ action: "climate.turn_off", target: { entity_id: c.entity } }];
  if (c.off_entity) {
    const od = domainOf(c.off_entity);
    const srv = od === "button" || od === "input_button" ? "press" : "turn_on";
    return [{ action: `${od}.${srv}`, target: { entity_id: c.off_entity } }];
  }
  const booleans = normModes(c.modes).filter(modeIsStateful).map((m) => m.entity);
  if (!booleans.length && ["input_boolean", "switch"].includes(d)) booleans.push(c.entity);
  return booleans.length
    ? [{ action: "homeassistant.turn_off", target: { entity_id: [...new Set(booleans)] } }]
    : null;
}

const puedeCrearTimer = (cfg) => !(cfg && cfg.timer && cfg.timer.entity) && !!timerOffActions(cfg);

/* Crea en Home Assistant lo que el temporizador necesita, con la misma API
   que usa su interfaz: los minutos (input_number), el timer y la
   automatizacion que apaga el aire al terminar y cancela la cuenta si lo
   apagan a mano. Pide ser administrador. Devuelve la config con `timer`. */
async function crearTemporizador(hass, cfg, lang = "es") {
  if (!hass || !hass.user || !hass.user.is_admin) {
    throw new Error(tr(lang, "Solo un administrador de Home Assistant puede crearlo.",
      "Only a Home Assistant administrator can create it."));
  }
  const apagar = timerOffActions(cfg);
  if (!apagar) {
    throw new Error(tr(lang, "Primero elige el equipo, o sus modos IR con Apagar.",
      "Pick the unit first, or its IR modes with Turn off."));
  }
  const st = cfg.entity && hass.states[cfg.entity];
  const nombre = cfg.name || (st && st.attributes.friendly_name) ||
    (cfg.entity ? cfg.entity.split(".")[1] : tr(lang, "aire", "AC"));

  const minutos = await hass.callWS({
    type: "input_number/create",
    name: tr(lang, `Apagar ${nombre} en`, `Turn off ${nombre} in`),
    min: 0, max: 480, step: 15, initial: 60, mode: "slider",
    unit_of_measurement: "min", icon: "mdi:timer-cog-outline",
  });
  const timer = await hass.callWS({
    type: "timer/create",
    name: tr(lang, `Temporizador ${nombre}`, `${nombre} timer`),
    duration: "00:00:00", restore: true, icon: "mdi:timer-outline",
  });
  const timerEntity = `timer.${timer.id}`;
  const minutesEntity = `input_number.${minutos.id}`;

  const triggers = [{ trigger: "event", event_type: "timer.finished",
    event_data: { entity_id: timerEntity }, id: "finished" }];
  const opciones = [{ conditions: [{ condition: "trigger", id: "finished" }], sequence: apagar }];
  // Si lo apagan a mano antes, la cuenta sobra. Solo con algo que tenga
  // estado on/off que mirar: un climate o el boolean del equipo.
  if (["climate", "input_boolean", "switch"].includes(domainOf(cfg.entity))) {
    triggers.push({ trigger: "state", entity_id: cfg.entity, to: "off",
      not_from: ["unavailable", "unknown"], id: "manual_off" });
    opciones.push({
      conditions: [{ condition: "trigger", id: "manual_off" },
        { condition: "state", entity_id: timerEntity, state: "active" }],
      sequence: [{ action: "timer.cancel", target: { entity_id: timerEntity } }],
    });
  }
  const autoId = `ac_room_card_${timer.id}`;
  await hass.callApi("POST", `config/automation/config/${autoId}`, {
    id: autoId,
    alias: tr(lang, `Apagar ${nombre} al terminar el temporizador`, `Turn off ${nombre} when its timer ends`),
    description: tr(lang, "Creada por AC Room Card.", "Created by AC Room Card."),
    mode: "single",
    // Al vencer, climate.turn_off vuelve a disparar esta misma automatizacion
    // por el cambio a off mientras la primera corrida sigue. Esa segunda no
    // haria nada (pide el timer activo), pero con "single" dejaba un
    // "Already running" en el log cada vez. Probado contra HA real.
    max_exceeded: "silent",
    triggers,
    conditions: [],
    actions: [{ choose: opciones }],
  });
  return {
    ...cfg,
    timer: { entity: timerEntity, minutes_entity: minutesEntity },
    creados: { minutos: minutesEntity, timer: timerEntity, automatizacion: `automation (${autoId})` },
  };
}

/* El boton "Crear temporizador" con su linea de estado. Se muestra solo si
   la tarjeta tiene como apagar el aire y todavia no tiene timer. */
function createTimerButton(getConfig, getHass, onChange) {
  const box = document.createElement("div");
  box.style.cssText = "display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:10px 4px 0";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.style.cssText = "display:inline-flex;align-items:center;gap:6px;cursor:pointer;font:inherit;" +
    "padding:6px 12px;border-radius:8px;border:1px solid var(--primary-color,#03a9f4);" +
    "background:transparent;color:var(--primary-color,#03a9f4)";
  btn.innerHTML = `<ha-icon icon="mdi:timer-plus-outline"></ha-icon><span></span>`;
  const estado = document.createElement("span");
  estado.style.cssText = "font-size:12px;color:var(--secondary-text-color)";
  box.appendChild(btn);
  box.appendChild(estado);

  let ocupado = false;
  btn.addEventListener("click", async () => {
    if (ocupado) return;
    const hass = getHass();
    const lang = langOf(hass);
    ocupado = true;
    btn.disabled = true;
    estado.style.color = "var(--secondary-text-color)";
    estado.textContent = tr(lang, "Creando…", "Creating…");
    try {
      const { creados, ...cfg } = await crearTemporizador(hass, getConfig(), lang);
      estado.textContent = tr(lang, `Listo: ${creados.timer}, ${creados.minutos} y la automatización.`,
        `Done: ${creados.timer}, ${creados.minutos} and the automation.`);
      onChange(cfg);
    } catch (e) {
      estado.style.color = "var(--error-color,#db4437)";
      estado.textContent = (e && (e.message || e.body && e.body.message)) || String(e);
    } finally {
      ocupado = false;
      btn.disabled = false;
    }
  });

  const refresh = () => {
    const lang = langOf(getHass());
    const txt = btn.querySelector("span");
    if (txt) txt.textContent = tr(lang, "Crear temporizador", "Create timer");
    // Tras crearlo se esconde el boton pero queda a la vista el "Listo".
    btn.style.display = puedeCrearTimer(getConfig()) ? "" : "none";
    box.style.display = btn.style.display === "none" && !estado.textContent ? "none" : "flex";
  };
  return { root: box, refresh };
}

class AcRoomCardEditor extends HTMLElement {
  static get toForm() { return toForm; }
  static get buildSchema() { return buildSchema; }
  static get fromForm() { return fromForm; }
  static get crearTemporizador() { return crearTemporizador; }
  static get timerOffActions() { return timerOffActions; }

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

      this._timerBtn = createTimerButton(() => this._config, () => this._hass, (cfg) => {
        this._config = cfg;
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: cfg }, bubbles: true, composed: true,
        }));
        this._render();
      });
      this.appendChild(this._timerBtn.root);

      this._note = document.createElement("div");
      this._note.style.cssText = "padding:8px 4px 0;font-size:12px;color:var(--secondary-text-color)";
      this.appendChild(this._note);
    }
    refreshRoomForm(this._form, this._config, this._hass);
    this._timerBtn.refresh();
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
  autoOn: "activa",
  autoOff: "desactivada",
  autoRunning: "corriendo ahora",
  autoLast: "última vez",
  autoNever: "nunca",
  autoSince: "desde",
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
  autoOn: "enabled",
  autoOff: "disabled",
  autoRunning: "running now",
  autoLast: "last run",
  autoNever: "never",
  autoSince: "since",
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
    // Lo mismo que en la tarjeta de pieza: el enchufe armado de cada fila.
    for (const { fila } of this._filas || []) {
      const b = fila.querySelector(".plug");
      if (b && b._tmr) { clearTimeout(b._tmr); b._tmr = null; b._armado = false; }
    }
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
    const vistas = (lov && lov.views ? lov.views : [])
      .filter((v) => !cfg.discover_view || v.path === cfg.discover_view);
    buscarPiezas(vistas, (o) => encontradas.push(o));
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
    // Las automatizaciones van en la misma columna, antes de los ventiladores.
    const maxFans = cols.has("fans")
      ? Math.max(1, ...piezas.map((r) => normEntries(r.automations).length + normFans(r.fans).length))
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
      const { fans: ventiladores, autos } = splitFans(r);
      for (const a of (cols.has("fans") ? autos : [])) {
        const b = document.createElement("button");
        b.className = "rfan rauto";
        b.dataset.entity = a.entity;
        b.dataset.kind = "auto";
        if (a.color) b.dataset.color = a.color;
        b.innerHTML = `<ha-icon icon="${a.icon || "mdi:robot-outline"}"></ha-icon>`;
        b._auto = a;
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._hass.callService("homeassistant", "toggle", { entity_id: a.entity });
        });
        slot.appendChild(b);
        btns.push(b);
      }
      for (const f of (cols.has("fans") ? ventiladores : [])) {
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
        if (b.dataset.kind === "auto") {
          const e = autoState(this._hass, b._auto, L, this._lang);
          b.className = `rfan rauto ${e.clase}`;
          b.style.color = e.on && b.dataset.color ? b.dataset.color : "";
          b.title = e.texto;
          continue;
        }
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
      .rfan.rauto ha-icon { animation: none; }
      .rfan.rauto.on, .rfan.rauto.run { color: var(--success-color, #43a047); }
      .rfan.rauto.run ha-icon { animation: acrc-pulse 1.2s ease-in-out infinite; }
      .rfan.rauto.off { color: var(--disabled-text-color, #9e9e9e); }
      .rfan.rauto.na { color: var(--disabled-text-color, #9e9e9e); opacity: .5; }
      @keyframes acrc-pulse { 50% { opacity: .35; } }
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
    const anotar = (o) => {
      const v = o.name || o.entity;
      if (v && !piezas.includes(v)) {
        piezas.push(v);
        const { type, ...resto } = o;
        configs.push(resto);
      }
    };
    for (const v of (lov && lov.views ? lov.views : [])) {
      if (v.path) vistas.push({ value: v.path, label: `${v.title || v.path} (${v.path})` });
      buscarPiezas(v, anotar);
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
        { value: "fans", label: tr(lang, "Automatizaciones y ventiladores", "Automations and fans") },
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
        const timer = createTimerButton(() => this._config.rooms[i], () => this._hass,
          (room) => this._cambioPieza(i, room));
        panel.appendChild(form);
        panel.appendChild(timer.root);
        panel.appendChild(quitar);
        this._piezasBox.appendChild(panel);
        return { panel, form, quitar, timer };
      });
    }
    this._lista.forEach(({ panel, form, quitar, timer }, i) => {
      panel.header = this._tituloPieza(rooms[i]);
      const txt = quitar.querySelector("span");
      if (txt) txt.textContent = ROOMS_LABELS[lang].remove;
      refreshRoomForm(form, rooms[i], this._hass);
      timer.refresh();
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

alSelector({
  type: "ac-rooms-card",
  name: "AC Rooms Card",
  description: tr(langOf(null), "Vista compacta de varias piezas, una línea por cada una",
    "Compact list of several rooms, one line each"),
  preview: false,
});

if (!customElements.get("ac-room-card")) {
  customElements.define("ac-room-card", AcRoomCard);
}

alSelector({
  type: "ac-room-card",
  name: "AC Room Card",
  description: tr(langOf(null), "Termostato con potencia, energía y sensor de ventana",
    "Thermostat with power, energy and window sensor"),
  preview: false,
});

/* >>> mini-climate-card (incluido) >>> */
/*!
 * mini-climate-card v3.4.0 - https://github.com/artem-sedykh/mini-climate-card
 * Copia exacta del bundle publicado en ese release, incluida para que la vista
 * compacta funcione sin instalar nada aparte. No se edita a mano: se actualiza
 * con `node scripts/vendor-mini-climate.mjs`.
 *
 * MIT License
 *
 * Copyright (c) 2020 Artem Sedykh
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const MINI_CLIMATE_BUNDLED = "v3.4.0";
// Solo si nadie lo registro antes (por ejemplo, instalado aparte por HACS).
// Sin window.customElements, como en los tests con Node, no se ejecuta.
if (typeof window !== "undefined" && window.customElements && !window.customElements.get("mini-climate")) {
!function(t){"function"==typeof define&&define.amd?define(t):t()}(function(){"use strict";const t=globalThis,e=t.ShadowRoot&&(void 0===t.ShadyCSS||t.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,i=Symbol(),n=new WeakMap;let s=class{constructor(t,e,n){if(this._$cssResult$=!0,n!==i)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=e}get styleSheet(){let t=this.o;const i=this.t;if(e&&void 0===t){const e=void 0!==i&&1===i.length;e&&(t=n.get(i)),void 0===t&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),e&&n.set(i,t))}return t}toString(){return this.cssText}};const o=(t,...e)=>{const n=1===t.length?t[0]:e.reduce((e,i,n)=>e+(t=>{if(!0===t._$cssResult$)return t.cssText;if("number"==typeof t)return t;throw Error("Value passed to 'css' function must be a 'css' function result: "+t+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(i)+t[n+1],t[0]);return new s(n,t,i)},a=e?t=>t:t=>t instanceof CSSStyleSheet?(t=>{let e="";for(const i of t.cssRules)e+=i.cssText;return(t=>new s("string"==typeof t?t:t+"",void 0,i))(e)})(t):t,{is:r,defineProperty:c,getOwnPropertyDescriptor:h,getOwnPropertyNames:l,getOwnPropertySymbols:d,getPrototypeOf:u}=Object,m=globalThis,p=m.trustedTypes,g=p?p.emptyScript:"",f=m.reactiveElementPolyfillSupport,_=(t,e)=>t,v={toAttribute(t,e){switch(e){case Boolean:t=t?g:null;break;case Object:case Array:t=null==t?t:JSON.stringify(t)}return t},fromAttribute(t,e){let i=t;switch(e){case Boolean:i=null!==t;break;case Number:i=null===t?null:Number(t);break;case Object:case Array:try{i=JSON.parse(t)}catch(t){i=null}}return i}},y=(t,e)=>!r(t,e),b={attribute:!0,type:String,converter:v,reflect:!1,useDefault:!1,hasChanged:y};Symbol.metadata??=Symbol("metadata"),m.litPropertyMetadata??=new WeakMap;let w=class extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??=[]).push(t)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,e=b){if(e.state&&(e.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(t)&&((e=Object.create(e)).wrapped=!0),this.elementProperties.set(t,e),!e.noAccessor){const i=Symbol(),n=this.getPropertyDescriptor(t,i,e);void 0!==n&&c(this.prototype,t,n)}}static getPropertyDescriptor(t,e,i){const{get:n,set:s}=h(this.prototype,t)??{get(){return this[e]},set(t){this[e]=t}};return{get:n,set(e){const o=n?.call(this);s?.call(this,e),this.requestUpdate(t,o,i)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)??b}static _$Ei(){if(this.hasOwnProperty(_("elementProperties")))return;const t=u(this);t.finalize(),void 0!==t.l&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties)}static finalize(){if(this.hasOwnProperty(_("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(_("properties"))){const t=this.properties,e=[...l(t),...d(t)];for(const i of e)this.createProperty(i,t[i])}const t=this[Symbol.metadata];if(null!==t){const e=litPropertyMetadata.get(t);if(void 0!==e)for(const[t,i]of e)this.elementProperties.set(t,i)}this._$Eh=new Map;for(const[t,e]of this.elementProperties){const i=this._$Eu(t,e);void 0!==i&&this._$Eh.set(i,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(t){const e=[];if(Array.isArray(t)){const i=new Set(t.flat(1/0).reverse());for(const t of i)e.unshift(a(t))}else void 0!==t&&e.push(a(t));return e}static _$Eu(t,e){const i=e.attribute;return!1===i?void 0:"string"==typeof i?i:"string"==typeof t?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(t=>t(this))}addController(t){(this._$EO??=new Set).add(t),void 0!==this.renderRoot&&this.isConnected&&t.hostConnected?.()}removeController(t){this._$EO?.delete(t)}_$E_(){const t=new Map,e=this.constructor.elementProperties;for(const i of e.keys())this.hasOwnProperty(i)&&(t.set(i,this[i]),delete this[i]);t.size>0&&(this._$Ep=t)}createRenderRoot(){const i=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return((i,n)=>{if(e)i.adoptedStyleSheets=n.map(t=>t instanceof CSSStyleSheet?t:t.styleSheet);else for(const e of n){const n=document.createElement("style"),s=t.litNonce;void 0!==s&&n.setAttribute("nonce",s),n.textContent=e.cssText,i.appendChild(n)}})(i,this.constructor.elementStyles),i}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(t=>t.hostConnected?.())}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach(t=>t.hostDisconnected?.())}attributeChangedCallback(t,e,i){this._$AK(t,i)}_$ET(t,e){const i=this.constructor.elementProperties.get(t),n=this.constructor._$Eu(t,i);if(void 0!==n&&!0===i.reflect){const s=(void 0!==i.converter?.toAttribute?i.converter:v).toAttribute(e,i.type);this._$Em=t,null==s?this.removeAttribute(n):this.setAttribute(n,s),this._$Em=null}}_$AK(t,e){const i=this.constructor,n=i._$Eh.get(t);if(void 0!==n&&this._$Em!==n){const t=i.getPropertyOptions(n),s="function"==typeof t.converter?{fromAttribute:t.converter}:void 0!==t.converter?.fromAttribute?t.converter:v;this._$Em=n;const o=s.fromAttribute(e,t.type);this[n]=o??this._$Ej?.get(n)??o,this._$Em=null}}requestUpdate(t,e,i,n=!1,s){if(void 0!==t){const o=this.constructor;if(!1===n&&(s=this[t]),i??=o.getPropertyOptions(t),!((i.hasChanged??y)(s,e)||i.useDefault&&i.reflect&&s===this._$Ej?.get(t)&&!this.hasAttribute(o._$Eu(t,i))))return;this.C(t,e,i)}!1===this.isUpdatePending&&(this._$ES=this._$EP())}C(t,e,{useDefault:i,reflect:n,wrapped:s},o){i&&!(this._$Ej??=new Map).has(t)&&(this._$Ej.set(t,o??e??this[t]),!0!==s||void 0!==o)||(this._$AL.has(t)||(this.hasUpdated||i||(e=void 0),this._$AL.set(t,e)),!0===n&&this._$Em!==t&&(this._$Eq??=new Set).add(t))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}const t=this.scheduleUpdate();return null!=t&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(const[t,e]of this._$Ep)this[t]=e;this._$Ep=void 0}const t=this.constructor.elementProperties;if(t.size>0)for(const[e,i]of t){const{wrapped:t}=i,n=this[e];!0!==t||this._$AL.has(e)||void 0===n||this.C(e,void 0,i,n)}}let t=!1;const e=this._$AL;try{t=this.shouldUpdate(e),t?(this.willUpdate(e),this._$EO?.forEach(t=>t.hostUpdate?.()),this.update(e)):this._$EM()}catch(e){throw t=!1,this._$EM(),e}t&&this._$AE(e)}willUpdate(t){}_$AE(t){this._$EO?.forEach(t=>t.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return!0}update(t){this._$Eq&&=this._$Eq.forEach(t=>this._$ET(t,this[t])),this._$EM()}updated(t){}firstUpdated(t){}};w.elementStyles=[],w.shadowRootOptions={mode:"open"},w[_("elementProperties")]=new Map,w[_("finalized")]=new Map,f?.({ReactiveElement:w}),(m.reactiveElementVersions??=[]).push("2.1.2");const $=globalThis,x=t=>t,A=$.trustedTypes,C=A?A.createPolicy("lit-html",{createHTML:t=>t}):void 0,T="$lit$",S=`lit$${Math.random().toFixed(9).slice(2)}$`,E="?"+S,k=`<${E}>`,M=document,O=()=>M.createComment(""),U=t=>null===t||"object"!=typeof t&&"function"!=typeof t,P=Array.isArray,D="[ \t\n\f\r]",H=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,j=/-->/g,I=/>/g,z=RegExp(`>|${D}(?:([^\\s"'>=/]+)(${D}*=${D}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,"g"),N=/'/g,L=/"/g,R=/^(?:script|style|textarea|title)$/i,F=(t=>(e,...i)=>({_$litType$:t,strings:e,values:i}))(1),B=Symbol.for("lit-noChange"),V=Symbol.for("lit-nothing"),q=new WeakMap,W=M.createTreeWalker(M,129);function K(t,e){if(!P(t)||!t.hasOwnProperty("raw"))throw Error("invalid template strings array");return void 0!==C?C.createHTML(e):e}const G=(t,e)=>{const i=t.length-1,n=[];let s,o=2===e?"<svg>":3===e?"<math>":"",a=H;for(let e=0;e<i;e++){const i=t[e];let r,c,h=-1,l=0;for(;l<i.length&&(a.lastIndex=l,c=a.exec(i),null!==c);)l=a.lastIndex,a===H?"!--"===c[1]?a=j:void 0!==c[1]?a=I:void 0!==c[2]?(R.test(c[2])&&(s=RegExp("</"+c[2],"g")),a=z):void 0!==c[3]&&(a=z):a===z?">"===c[0]?(a=s??H,h=-1):void 0===c[1]?h=-2:(h=a.lastIndex-c[2].length,r=c[1],a=void 0===c[3]?z:'"'===c[3]?L:N):a===L||a===N?a=z:a===j||a===I?a=H:(a=z,s=void 0);const d=a===z&&t[e+1].startsWith("/>")?" ":"";o+=a===H?i+k:h>=0?(n.push(r),i.slice(0,h)+T+i.slice(h)+S+d):i+S+(-2===h?e:d)}return[K(t,o+(t[i]||"<?>")+(2===e?"</svg>":3===e?"</math>":"")),n]};class Z{constructor({strings:t,_$litType$:e},i){let n;this.parts=[];let s=0,o=0;const a=t.length-1,r=this.parts,[c,h]=G(t,e);if(this.el=Z.createElement(c,i),W.currentNode=this.el.content,2===e||3===e){const t=this.el.content.firstChild;t.replaceWith(...t.childNodes)}for(;null!==(n=W.nextNode())&&r.length<a;){if(1===n.nodeType){if(n.hasAttributes())for(const t of n.getAttributeNames())if(t.endsWith(T)){const e=h[o++],i=n.getAttribute(t).split(S),a=/([.?@])?(.*)/.exec(e);r.push({type:1,index:s,name:a[2],strings:i,ctor:"."===a[1]?tt:"?"===a[1]?et:"@"===a[1]?it:X}),n.removeAttribute(t)}else t.startsWith(S)&&(r.push({type:6,index:s}),n.removeAttribute(t));if(R.test(n.tagName)){const t=n.textContent.split(S),e=t.length-1;if(e>0){n.textContent=A?A.emptyScript:"";for(let i=0;i<e;i++)n.append(t[i],O()),W.nextNode(),r.push({type:2,index:++s});n.append(t[e],O())}}}else if(8===n.nodeType)if(n.data===E)r.push({type:2,index:s});else{let t=-1;for(;-1!==(t=n.data.indexOf(S,t+1));)r.push({type:7,index:s}),t+=S.length-1}s++}}static createElement(t,e){const i=M.createElement("template");return i.innerHTML=t,i}}function J(t,e,i=t,n){if(e===B)return e;let s=void 0!==n?i._$Co?.[n]:i._$Cl;const o=U(e)?void 0:e._$litDirective$;return s?.constructor!==o&&(s?._$AO?.(!1),void 0===o?s=void 0:(s=new o(t),s._$AT(t,i,n)),void 0!==n?(i._$Co??=[])[n]=s:i._$Cl=s),void 0!==s&&(e=J(t,s._$AS(t,e.values),s,n)),e}class Y{constructor(t,e){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=e}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){const{el:{content:e},parts:i}=this._$AD,n=(t?.creationScope??M).importNode(e,!0);W.currentNode=n;let s=W.nextNode(),o=0,a=0,r=i[0];for(;void 0!==r;){if(o===r.index){let e;2===r.type?e=new Q(s,s.nextSibling,this,t):1===r.type?e=new r.ctor(s,r.name,r.strings,this,t):6===r.type&&(e=new nt(s,this,t)),this._$AV.push(e),r=i[++a]}o!==r?.index&&(s=W.nextNode(),o++)}return W.currentNode=M,n}p(t){let e=0;for(const i of this._$AV)void 0!==i&&(void 0!==i.strings?(i._$AI(t,i,e),e+=i.strings.length-2):i._$AI(t[e])),e++}}class Q{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,e,i,n){this.type=2,this._$AH=V,this._$AN=void 0,this._$AA=t,this._$AB=e,this._$AM=i,this.options=n,this._$Cv=n?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode;const e=this._$AM;return void 0!==e&&11===t?.nodeType&&(t=e.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,e=this){t=J(this,t,e),U(t)?t===V||null==t||""===t?(this._$AH!==V&&this._$AR(),this._$AH=V):t!==this._$AH&&t!==B&&this._(t):void 0!==t._$litType$?this.$(t):void 0!==t.nodeType?this.T(t):(t=>P(t)||"function"==typeof t?.[Symbol.iterator])(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==V&&U(this._$AH)?this._$AA.nextSibling.data=t:this.T(M.createTextNode(t)),this._$AH=t}$(t){const{values:e,_$litType$:i}=t,n="number"==typeof i?this._$AC(t):(void 0===i.el&&(i.el=Z.createElement(K(i.h,i.h[0]),this.options)),i);if(this._$AH?._$AD===n)this._$AH.p(e);else{const t=new Y(n,this),i=t.u(this.options);t.p(e),this.T(i),this._$AH=t}}_$AC(t){let e=q.get(t.strings);return void 0===e&&q.set(t.strings,e=new Z(t)),e}k(t){P(this._$AH)||(this._$AH=[],this._$AR());const e=this._$AH;let i,n=0;for(const s of t)n===e.length?e.push(i=new Q(this.O(O()),this.O(O()),this,this.options)):i=e[n],i._$AI(s),n++;n<e.length&&(this._$AR(i&&i._$AB.nextSibling,n),e.length=n)}_$AR(t=this._$AA.nextSibling,e){for(this._$AP?.(!1,!0,e);t!==this._$AB;){const e=x(t).nextSibling;x(t).remove(),t=e}}setConnected(t){void 0===this._$AM&&(this._$Cv=t,this._$AP?.(t))}}class X{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,e,i,n,s){this.type=1,this._$AH=V,this._$AN=void 0,this.element=t,this.name=e,this._$AM=n,this.options=s,i.length>2||""!==i[0]||""!==i[1]?(this._$AH=Array(i.length-1).fill(new String),this.strings=i):this._$AH=V}_$AI(t,e=this,i,n){const s=this.strings;let o=!1;if(void 0===s)t=J(this,t,e,0),o=!U(t)||t!==this._$AH&&t!==B,o&&(this._$AH=t);else{const n=t;let a,r;for(t=s[0],a=0;a<s.length-1;a++)r=J(this,n[i+a],e,a),r===B&&(r=this._$AH[a]),o||=!U(r)||r!==this._$AH[a],r===V?t=V:t!==V&&(t+=(r??"")+s[a+1]),this._$AH[a]=r}o&&!n&&this.j(t)}j(t){t===V?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}}class tt extends X{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===V?void 0:t}}class et extends X{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==V)}}class it extends X{constructor(t,e,i,n,s){super(t,e,i,n,s),this.type=5}_$AI(t,e=this){if((t=J(this,t,e,0)??V)===B)return;const i=this._$AH,n=t===V&&i!==V||t.capture!==i.capture||t.once!==i.once||t.passive!==i.passive,s=t!==V&&(i===V||n);n&&this.element.removeEventListener(this.name,this,i),s&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){"function"==typeof this._$AH?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}}class nt{constructor(t,e,i){this.element=t,this.type=6,this._$AN=void 0,this._$AM=e,this.options=i}get _$AU(){return this._$AM._$AU}_$AI(t){J(this,t)}}const st=$.litHtmlPolyfillSupport;st?.(Z,Q),($.litHtmlVersions??=[]).push("3.3.3");const ot=globalThis;let at=class extends w{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){const t=super.createRenderRoot();return this.renderOptions.renderBefore??=t.firstChild,t}update(t){const e=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=((t,e,i)=>{const n=i?.renderBefore??e;let s=n._$litPart$;if(void 0===s){const t=i?.renderBefore??null;n._$litPart$=s=new Q(e.insertBefore(O(),t),t,void 0,i??{})}return s._$AI(t),s})(e,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return B}};at._$litElement$=!0,at.finalized=!0,ot.litElementHydrateSupport?.({LitElement:at});const rt=ot.litElementPolyfillSupport;rt?.({LitElement:at}),(ot.litElementVersions??=[]).push("4.2.2");const ct=(t,e)=>{customElements.get(t)||customElements.define(t,e)},ht=1,lt=t=>(...e)=>({_$litDirective$:t,values:e});let dt=class{constructor(t){}get _$AU(){return this._$AM._$AU}_$AT(t,e,i){this._$Ct=t,this._$AM=e,this._$Ci=i}_$AS(t,e){return this.update(t,e)}update(t,e){return this.render(...e)}};const ut=lt(class extends dt{constructor(t){if(super(t),t.type!==ht||"class"!==t.name||t.strings?.length>2)throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.")}render(t){return" "+Object.keys(t).filter(e=>t[e]).join(" ")+" "}update(t,[e]){if(void 0===this.st){this.st=new Set,void 0!==t.strings&&(this.nt=new Set(t.strings.join(" ").split(/\s/).filter(t=>""!==t)));for(const t in e)e[t]&&!this.nt?.has(t)&&this.st.add(t);return this.render(e)}const i=t.element.classList;for(const t of this.st)t in e||(i.remove(t),this.st.delete(t));for(const t in e){const n=!!e[t];n===this.st.has(t)||this.nt?.has(t)||(n?(i.add(t),this.st.add(t)):(i.remove(t),this.st.delete(t)))}return B}}),mt="important",pt=" !"+mt,gt=lt(class extends dt{constructor(t){if(super(t),t.type!==ht||"style"!==t.name||t.strings?.length>2)throw Error("The `styleMap` directive must be used in the `style` attribute and must be the only part in the attribute.")}render(t){return Object.keys(t).reduce((e,i)=>{const n=t[i];return null==n?e:e+`${i=i.includes("-")?i:i.replace(/(?:^(webkit|moz|ms|o)|)(?=[A-Z])/g,"-$&").toLowerCase()}:${n};`},"")}update(t,[e]){const{style:i}=t.element;if(void 0===this.ft)return this.ft=new Set(Object.keys(e)),this.render(e);for(const t of this.ft)null==e[t]&&(this.ft.delete(t),t.includes("-")?i.removeProperty(t):i[t]=null);for(const t in e){const n=e[t];if(null!=n){this.ft.add(t);const e="string"==typeof n&&n.endsWith(pt);t.includes("-")||e?i.setProperty(t,e?n.slice(0,-11):n,e?mt:""):i[t]=n}}return B}}),ft=o`
  :host {
    overflow: visible !important;
    display: block;
    --mc-scale: var(--mini-climate-scale, 1);
    --mc-unit: calc(var(--mc-scale) * 40px);
    --mc-name-font-weight: var(--mini-climate-name-font-weight, 400);
    --mc-info-font-weight: var(--mini-climate-info-font-weight, 300);
    --mc-entity-info-left-offset: 8px;
    --mc-accent-color: var(--mini-climate-accent-color, var(--accent-color, #f39c12));
    --mc-text-color: var(--mini-climate-base-color, var(--primary-text-color, #000));
    --mc-active-color: var(--mc-accent-color);
    --mc-button-color: var(--mini-climate-button-color, var(--paper-item-icon-color, #44739e));
    --mc-icon-color:
      var(--mini-climate-icon-color,
        var(--mini-climate-base-color,
          var(--paper-item-icon-color, #44739e)));
    --mc-icon-active-color: var(--state-binary_sensor-active-color, #ffc107);
    --mc-info-opacity: 1;
    --mc-bg-opacity: var(--mini-climate-background-opacity, 1);
    color: var(--mc-text-color);
    --mc-dropdown-unit: calc(var(--mc-unit) * .75);
    --paper-item-min-height: var(--mc-unit);
    /* --mdc-icon-button-size is the pre-2026 knob, --ha-icon-button-size the
       current one; both are set so the card sizes correctly on either. */
    --mdc-icon-button-size: calc(var(--mc-unit) * 0.75);
    --ha-icon-button-size: calc(var(--mc-unit) * 0.75);
  }
  ha-card.--group {
    box-shadow: none;
  }
  ha-card.--bg {
    --mc-info-opacity: .75;
  }
  ha-card {
    cursor: default;
    display: flex;
    background: transparent;
    overflow: visible;
    padding: 0;
    position: relative;
    color: inherit;
    font-size: calc(var(--mc-unit) * 0.35);
    border: none;
  }
  ha-card:before {
    content: '';
    padding-top: 0px;
    transition: padding-top .5s cubic-bezier(.21,.61,.35,1);
    will-change: padding-top;
  }
  header {
    display: none;
  }
  .mc__bg {
    background: var(--ha-card-background, var(--card-background-color, var(--paper-card-background-color, white)));
    position: absolute;
    top: 0; right: 0; bottom: 0; left: 0;
    overflow: hidden;
    -webkit-transform: translateZ(0);
    transform: translateZ(0);
    opacity: var(--mc-bg-opacity);
    box-shadow: var(--mini-climate-card-box-shadow, var(--ha-card-box-shadow, none));
    box-sizing: border-box;
    border-radius: var(--ha-card-border-radius, 12px);
    border-width: var(--ha-card-border-width, 1px);
    border-style: solid;
    border-color: var(--ha-card-border-color, var(--divider-color, #e0e0e0) );
  }
  ha-card.--group .mc__bg {
    background: none;
    border: none;
  }
  .mc-climate {
    align-self: flex-end;
    box-sizing: border-box;
    position: relative;
    padding: 16px 16px 0px 16px;
    transition: padding .25s ease-out;
    width: 100%;
    will-change: padding;
  }
  .flex {
    display: flex;
    display: -ms-flexbox;
    display: -webkit-flex;
    flex-direction: row;
  }
  .mc-climate__core {
    position: relative;
    padding-right: 5px;
  }
  .entity__info {
    user-select: none;
    margin-left: var(--mc-entity-info-left-offset);
    flex: 1;
    min-width: 0;
    white-space: nowrap;
  }
  .entity__icon {
    color: var(--mc-icon-color);
    white-space: nowrap;
  }
  .entity__icon[color] {
    color: var(--mc-icon-active-color);
  }
  .entity__icon {
    animation: fade-in .25s ease-out;
    background-position: center center;
    background-repeat: no-repeat;
    background-size: cover;
    border-radius: 100%;
    height: var(--mc-unit);
    width: var(--mc-unit);
    min-width: var(--mc-unit);
    line-height: var(--mc-unit);
    margin-right: calc(var(--mc-unit) / 5);
    position: relative;
    text-align: center;
    will-change: border-color;
    transition: border-color .25s ease-out;
  }
  .entity__info__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: calc(var(--mc-unit) / 2);
    color: var(--mc-text-color);
    font-weight: var(--mc-name-font-weight);
  }
  .entity__secondary_info {
    margin-top: -2px;
  }
  ha-card.--initial .mc-climate {
    padding: 16px 16px 5px 16px;
  }
  ha-card.--unavailable .mc-climate {
    padding: 16px;
  }
  ha-card.--group .mc-climate {
    padding: 8px 0px 0px 0px;
  }
  .toggle-button {
    width: calc(var(--mc-unit) * .75);
    height: calc(var(--mc-unit) * .75);
    --mdc-icon-button-size: calc(var(--mc-unit) * .75);
    --ha-icon-button-size: calc(var(--mc-unit) * .75);
    color: var(--mc-icon-color);
    margin-left: auto;
    margin-top: calc(var(--mc-unit) * -.125);
    margin-right: calc(var(--mc-unit) * .05);
    --ha-icon-display: flex;
  }
  .toggle-button.open {
     transform: rotate(180deg);
     color: var(--mc-active-color);
  }
  .wrap {
    display: flex;
    flex-direction: row;
  }
  .entity__controls {
    margin-left: auto;
    display: flex;
    white-space: nowrap;
    margin-top: calc(var(--mc-unit) * -.25);
  }
  .ctl-wrap {
    display: flex;
    flex-direction: row;
    flex: 0 0 auto;
    margin-left: auto;
    /* Both margins auto, so the mode and the temperatures sit on the middle
       of the row rather than on its bottom edge. With margin-bottom: 0 the
       block was 4.5px lower than the middle of the entity icon beside it,
       which is what #99 is: the icon on the left not lining up with what is
       on the right. */
    margin-top: auto;
    margin-bottom: auto;
    --ha-icon-display: flex;
  }
  .bottom {
    margin-top: calc(var(--mc-unit) * .05);
    height: calc(var(--mc-unit) * .625);;
  }
  .entity__info__name_wrap {
    margin-right: 10px;
    min-width: 0;
    height: var(--mc-unit);
  }
  /* With a secondary info line the pair fills the row and the name reads as
     part of it. Without one the name was left at the top of a row as tall as
     the icon, 10px above the middle of everything beside it (#100). Centring
     it is confined to that case: applied to both, it would shift the
     secondary line for cards that never asked for a change. */
  .--no-secondary-info .entity__info__name_wrap {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .--more-info .entity__info__name_wrap {
    cursor: pointer;
  }
  mc-buttons {
    width: 100%;
    justify-content: space-evenly;
    display: flex;
    --ha-icon-display: flex;
  }
  mc-temperature {
    min-width: 0;
  }
  .--unavailable .ctl-wrap {
    margin-left: auto;
    margin-top: auto;
    margin-bottom: auto;
  }
  .--unavailable .entity__info {
    margin-top: auto;
    margin-bottom: auto;
  }
  .mc-toggle_content {
    margin-top: calc(var(--mc-unit) * .05);
  }
  .ctl-wrap mc-dropdown, .ctl-wrap mc-button {
    min-width: calc(var(--mc-unit) * .75);
    margin-right: 3px;
  }
  .ctl-wrap mc-button {
    width: calc(var(--mc-unit) * 0.75);
    height: calc(var(--mc-unit) * 0.75);
  }
`,_t=o`
  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label {
    margin: 0 8px;
  }
  ha-icon {
    width: calc(var(--mc-unit) * .6);
    height: calc(var(--mc-unit) * .6);
    --mdc-icon-size: calc(var(--mc-unit) * .6);
  }
  ha-icon-button {
    color: var(--mc-button-color);
    transition: color .25s;
  }
  ha-icon-button[color] {
    color: var(--mc-icon-active-color) !important;
    opacity: 1 !important;
  }
  ha-icon-button[inactive] {
    opacity: .5;
  }
`;var vt=(t,e,i,n)=>{let s;if(i)switch(i.action){case"more-info":s=new Event("hass-more-info",{composed:!0}),s.detail={entityId:i.entity||n},t.dispatchEvent(s);break;case"navigate":if(!i.navigation_path)return;window.history.pushState(null,"",i.navigation_path),s=new Event("location-changed",{composed:!0}),s.detail={replace:!1},window.dispatchEvent(s);break;case"call-service":{if(!i.service)return;const[t,n]=i.service.split(".",2),s={...i.service_data};e.callService(t,n,s);break}case"fire-dom-event":s=new Event("ll-custom",{composed:!0,bubbles:!0}),s.detail={...i},t.dispatchEvent(s);break;case"url":if(!i.url)return;window.location.href=i.url}};const yt=(t,e,i="unknown")=>{for(let i=0;i<e.length;i+=1){const n=e[i],s=t.localize(n);if(""!==s)return s}return i};console.info("%c MINI-CLIMATE-CARD %c v3.4.0 ","color: white; background: coral; font-weight: 700;","color: coral; background: white; font-weight: 700;");const bt={DEFAULT:"mdi:air-conditioner",FAN:"mdi:fan",OFF:"mdi:power",HEAT:"mdi:weather-sunny",AUTO:"mdi:cached",COOL:"mdi:snowflake",HEAT_COOL:"mdi:sun-snowflake",DRY:"mdi:water",FAN_ONLY:"mdi:fan",TOGGLE:"mdi:dots-horizontal",UP:"mdi:chevron-up",DOWN:"mdi:chevron-down"},wt=["closed","locked","off"],$t=["unavailable","unknown"],xt=["more-info","navigate","call-service","url","fire-dom-event"],At="-",Ct=t=>t?wt.includes(t)||$t.includes(t)?wt.includes(t)&&!$t.includes(t)?"on":t:"off":t,Tt=(t,e)=>{if(t)return e&&e.attribute&&t.attributes?t.attributes[e.attribute]:t.state},St=(t,e)=>Number(`${Math.round(Number(`${t}e${e}`))}e-${e}`),Et=t=>"number"==typeof t?Number.isFinite(t):"string"==typeof t&&""!==t.trim()&&Number.isFinite(Number(t)),kt=t=>"string"==typeof t?{action:t}:{action:"none",...t||{}},Mt=(t,e)=>{try{return new Function("",`return ${t}`).call(e||{})}catch(e){throw new Error(`\n[COMPILE ERROR]: [${e.toString()}]\n[SOURCE]: ${t}\n`,{cause:e})}};class Ot{constructor(t,e,i,n){this.climate=n||{},this.temperatureEntity=t||{},this.targetTemperatureEntity=e||{},this.config=i,this.config.hide_current_temperature?"boolean"==typeof this.config.hide_current_temperature?this.shouldHideCurrentTemperature=()=>!0:this.shouldHideCurrentTemperature=Mt(this.config.hide_current_temperature):this.shouldHideCurrentTemperature=()=>!1}get hass(){return this.climate.hass}get tapAction(){return this.config.temperature.tap_action}get targetTapAction(){return this.config.target_temperature.tap_action}get entityId(){return this.config.temperature.source&&this.config.temperature.source.entity||this.config.entity}get targetEntityId(){return this.config.target_temperature.source&&this.config.target_temperature.source.entity||this.config.entity}get unit(){return this.config.temperature.unit||this.config.target_temperature.unit||"°C"}get step(){const t=this.targetTemperatureEntity;return"step"in this.config.target_temperature?this.config.target_temperature.step:t&&t.attributes&&t.attributes.target_temp_step?t.attributes.target_temp_step:1}get value(){const t=this.rawValue;if(Et(t)){if("fixed"in this.config.temperature)return parseFloat(t.toString()).toFixed(this.config.temperature.fixed);if("round"in this.config.temperature)return St(t,this.config.temperature.round)}return t}get rawValue(){return Tt(this.temperatureEntity,this.config.temperature.source)}get hide(){return this.shouldHideCurrentTemperature(this.value,this.temperatureEntity,this.targetTemperatureEntity,this.climate.entity,this.climate.mode)}}class Ut{constructor(t,e,i){this.entity=t||{},this.config=e,this._hass=i,this.min=this.getMin(),this.max=this.getMax(),this.step=this.getStep()}get hass(){return this._hass}get icons(){return this.config.target_temperature.icons}getStep(){return"step"in this.config.target_temperature?parseFloat(this.config.target_temperature.step):this.entity&&this.entity.attributes&&this.entity.attributes.target_temp_step?parseFloat(this.entity.attributes.target_temp_step):1}getMin(){return"min"in this.config.target_temperature?parseFloat(this.config.target_temperature.min):this.entity&&this.entity.attributes&&this.entity.attributes.min_temp?parseFloat(this.entity.attributes.min_temp):16}getMax(){return"max"in this.config.target_temperature?parseFloat(this.config.target_temperature.max):this.entity&&this.entity.attributes&&this.entity.attributes.max_temp?parseFloat(this.entity.attributes.max_temp):30}_floatOrPlaceholder(t){return Number.isNaN(t)?At:t}get value(){if(void 0!==this._targetTemperature)return this._floatOrPlaceholder(parseFloat(this._targetTemperature));const t=Tt(this.entity,this.config.target_temperature.source);return this._floatOrPlaceholder(parseFloat(t))}set value(t){this._targetTemperature=parseFloat(t)}increment(){const t=this.value;if(t===At)return!1;const e=this._round(this.value+this.step);return e<=this.max?e<=this.min?this.value=this.min:this.value=e:this.value=this.max,t!==this.value}decrement(){const t=this.value;if(t===At)return!1;const e=this._round(this.value-this.step);return e>=this.min?this.value=e:this.value=this.min,t!==this.value}_round(t){const e=this.step.toString().split(".");return e[1]?parseFloat(t.toFixed(e[1].length)):Math.round(t)}update(t){if(this.config.target_temperature.functions.change_action){const e=this.hass.states[this.config.entity];return this.config.target_temperature.functions.change_action(t,this.entity,e)}return this.hass.callService("climate","set_temperature",{entity_id:this.entity.entity_id,temperature:t})}}class Pt{constructor(t,e,i,n){this.config=e||{},this.entity=t||{},this.climate=i||{},this._hass=n||{}}get id(){return this.config.id}get location(){return this.config.location||"bottom"}get hass(){return this._hass}get type(){return this.config.type}get order(){return this.config.order}get hide(){return!!this.config.functions.hide&&this.config.functions.hide(this.state,this.entity,this.climate.entity,this.climate.mode)}get icon(){return this.config.functions.icon&&this.config.functions.icon.template?this.config.functions.icon.template(this.state,this.entity,this.climate.entity,this.climate.mode):this.config.icon}get originalState(){return Tt(this.entity,this.config.state)}get state(){let t=this.originalState;return this.config.functions.state&&this.config.functions.state.mapper&&(t=this.config.functions.state.mapper(t,this.entity,this.climate.entity,this.climate.mode)),t}isActive(t){return!!this.config.functions.active&&this.config.functions.active(t,this.entity,this.climate.entity,this.climate.mode)}get isUnavailable(){return void 0===this.entity||$t.includes(this.state)}get isOn(){return void 0!==this.entity&&!wt.includes(this.state)&&!$t.includes(this.state)}get disabled(){return!!this.config.functions.disabled&&this.config.functions.disabled(this.state,this.entity,this.climate.entity,this.climate.mode)}get style(){return this.config.functions.style&&this.config.functions.style(this.state,this.entity,this.climate.entity,this.climate.mode)||{}}get source(){const{functions:t}=this.config;let e=Object.entries(this.config.source||{}).filter(([t])=>"__filter"!==t).map(([t,e])=>"object"==typeof e?{id:t,...e||{}}:{id:t,name:e});return e.some(t=>"order"in t)&&(e=e.sort((t,e)=>t.order>e.order?1:e.order>t.order?-1:0)),t.source&&t.source.filter?t.source.filter(e,this.state,this.entity,this.climate.entity,this.climate.mode):e}get selected(){const{state:t}=this;if(null!=t)return this.source.find(e=>e.id===t.toString())}get actionTimeout(){return"action_timeout"in this.config?this.config.action_timeout:2e3}handleToggle(){return this.config.functions.toggle_action?this.config.functions.toggle_action(this.state,this.entity,this.climate.entity,this.climate.mode):this.climate.callService("switch","toggle",{entity_id:this.entity.entity_id})}handleChange(t){if(this.config.functions.change_action)return this.config.functions.change_action(t,this.state,this.entity,this.climate.entity,this.climate.mode)}}class Dt{constructor(t,e,i,n){this.config=e||{},this.entity=t||{},this.climate=i||{},this._hass=n||{}}get id(){return this.config.id}get hass(){return this._hass}get originalValue(){return Tt(this.entity,this.config.source)}get value(){let t=this.originalValue;return this.config.functions.mapper&&(t=this.config.functions.mapper(t,this.entity,this.climate.entity,this.climate.mode)),Et(t)&&("fixed"in this.config?t=parseFloat(t.toString()).toFixed(this.config.fixed):"round"in this.config&&(t=St(t,this.config.round))),t}get unit(){return this.config.functions.unit&&this.config.functions.unit.template?this.config.functions.unit.template(this.value,this.originalValue,this.entity,this.climate.entity,this.climate.mode):this.config.unit}get icon(){return this.config.functions.icon&&this.config.functions.icon.template?this.config.functions.icon.template(this.value,this.entity,this.climate.entity,this.climate.mode):this.config.icon&&"string"==typeof this.config.icon?this.config.icon:""}get iconStyle(){return this.config.functions.icon&&this.config.functions.icon.style&&this.config.functions.icon.style(this.value,this.entity,this.climate.entity,this.climate.mode)||{}}get valueStyle(){return this.config.functions.value&&this.config.functions.value.style&&this.config.functions.value.style(this.value,this.entity,this.climate.entity,this.climate.mode)||{}}get hide(){return!!this.config.functions.hide&&this.config.functions.hide(this.value,this.entity,this.climate.entity,this.climate.mode)}}const Ht="component.climate.entity_component._";class jt{constructor(t,e,i){this.hass=t||{},this.config=e||{},this.entity=i||{},this.state=this.entity.state,this.attr={friendly_name:"",temperature:16,current_temperature:24,fan_mode:"",hvac_modes:[],target_temp_step:void 0,min_temp:void 0,max_temp:void 0,hvac_action:"",fan_modes:[],...this.entity.attributes||{}}}get lastChanged(){return this.entity.last_changed}get lastUpdated(){return this.entity.last_updated}get hvacAction(){const t=this.config.secondary_info&&this.config.secondary_info.source||{},e=this.attr.hvac_action;let i={id:e};const n=[`${Ht}.state_attributes.hvac_action.state.${e}`,`state_attributes.climate.hvac_action.${e}`];return i.name=yt(this.hass,n,e),e in t&&("string"==typeof t[e]?i.name=t[e]:i={...i,...t[e]}),i}get mode(){return this._hvac_mode}set mode(t){this._hvac_mode=t}get defaultHvacModes(){const t=this.attr.hvac_modes,e=[];for(let i=0;i<t.length;i+=1){const n=t[i],s=[`${Ht}.state.${n}`,`state.climate.${n}`,`component.climate.state._.${n}`],o={id:n,name:yt(this.hass,s,n)},a=n.toString().toUpperCase();a in bt&&(o.icon=bt[a]),e.push(o)}return e}get defaultFanModes(){const t=this.attr.fan_modes,e={};for(let i=0;i<t.length;i+=1){const n=t[i],s=[`${Ht}.state_attributes.fan_mode.state.${n}`,`state_attributes.climate.fan_mode.${n}`];e[n]=yt(this.hass,s,n)}return e}get id(){return this.entity.entity_id}get icon(){return this.attr.icon}get name(){return this.attr.friendly_name||""}get isOff(){return!1===this.isUnavailable&&wt.includes(this.state)}get isActive(){return!1===this.isOff&&!1===this.isUnavailable||!1}get isUnavailable(){return void 0===this.entity.entity_id||$t.includes(this.state)}get isOn(){return!1===this.isUnavailable&&!1===wt.includes(this.state)}callService(t,e,i){return this.hass.callService(t,e,{entity_id:this.config.entity,...i})}}class It{constructor(t,e,i){this.config=e||{},this.entity=t||{},this.climate=i||{}}get hide(){return!!this.config.functions.hide&&this.config.functions.hide(this.state,this.entity,this.climate.entity,this.climate.mode)}get originalState(){return Tt(this.entity,this.config.state)}get state(){let t=this.originalState;return this.config.functions.state&&this.config.functions.state.mapper&&(t=this.config.functions.state.mapper(t,this.entity,this.climate.entity)),t}isActive(t){return!!this.config.functions.active&&this.config.functions.active(t,this.entity,this.climate.entity)}get disabled(){return!!this.config.functions.disabled&&this.config.functions.disabled(this.state,this.entity,this.climate.entity)}get style(){return this.config.functions.style&&this.config.functions.style(this.state,this.entity,this.climate.entity)||{}}get source(){const{functions:t}=this.config;let e=Object.entries(this.config.source||{}).filter(([t])=>"__filter"!==t).map(([t,e])=>"object"==typeof e?{id:t,...e||{}}:{id:t,name:e});return e.some(t=>"order"in t)&&(e=e.sort((t,e)=>t.order>e.order?1:e.order>t.order?-1:0)),t.source&&t.source.filter?t.source.filter(e,this.state,this.entity,this.climate.entity):e}get selected(){const{state:t}=this;if(null!=t)return this.source.find(e=>e.id===t.toString())}get icon(){const{selected:t}=this;if(t?.icon)return t.icon;if(void 0!==t?.id&&null!==t.id){const e=t.id.toString().toUpperCase();if(e in bt)return bt[e]}return bt.DEFAULT}get actionTimeout(){const t=this.config.action_timeout;return"number"==typeof t?t:2e3}handleChange(t){if(this.config.functions.change_action)return this.config.functions.change_action(t,this.entity,this.climate.entity)}}class zt extends at{static get properties(){return{temperature:{type:Object},changing:{type:Boolean},target:{type:Number},swapTemperatures:{type:Boolean}}}get targetStr(){const t=this.target.toString(),e=parseFloat(t);if(Number.isNaN(e)||t===At)return At;const i=this.temperature.step.toString().split(".");return i[1]?e.toFixed(i[1].length):t}static clickable(t){return!!t&&!!t.action&&"none"!==t.action}handleTap(t,e,i){zt.clickable(e)&&(t.stopPropagation(),vt(this,this.temperature.hass,e,i))}renderValue(t,e,i,n=!1){const s=["state__value",n?"changing":"",zt.clickable(e)?"clickable":""].filter(Boolean).join(" ");return F`<span
      class='${s}'
      @click=${t=>this.handleTap(t,e,i)}>${t}</span>`}renderTemperature(){return void 0===this.temperature.value||this.temperature.hide?"":this.renderValue(this.temperature.value,this.temperature.tapAction,this.temperature.entityId)}renderTarget(){return this.renderValue(this.targetStr,this.temperature.targetTapAction,this.temperature.targetEntityId,this.changing)}render(){if(!this.temperature)return F``;const{unit:t}=this.temperature,e=this.renderTemperature(),i=""===e?"":F`<span class='state__value'>/</span>`,[n,s]=this.swapTemperatures?[e,this.renderTarget()]:[this.renderTarget(),e];return F`
    <div class='state ellipsis'>
      ${n}
      ${i}
      ${s}
      <span class='state__uom'>${t}</span>
    </div>
    `}static get styles(){return o`
    .state {
      margin-top:calc(var(--mc-unit) * .15);
    }
    .state__value {
      font-weight: var(--mc-info-font-weight);
      line-height: calc(var(--mc-unit) * .475);
      font-size: calc(var(--mc-unit) * .475);
    }
    .state__uom {
      font-size: calc(var(--mc-unit) * 0.35);
      font-weight: var(--mc-name-font-weight);
      opacity: 0.6;
      line-height: calc(var(--mc-unit) * 0.475);
    }
    .ellipsis {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .changing {
      color: var(--mc-accent-color);
    }
    .clickable {
      cursor: pointer;
    }
    `}}ct("mc-temperature",zt);ct("mc-target-temperature",class extends at{constructor(){super(),this.timeout=800}static get properties(){return{targetTemperature:{type:Object}}}increment(t){t.stopPropagation();this.targetTemperature.increment()&&(this.temp_last_changed=Date.now(),this.targetTemperatureChanged())}decrement(t){t.stopPropagation();this.targetTemperature.decrement()&&(this.temp_last_changed=Date.now(),this.targetTemperatureChanged())}sendChangeEvent(t){const e=new CustomEvent("changing",{detail:{changing:t}});this.dispatchEvent(e)}targetTemperatureChanged(){this.temp_last_changed&&(this.sendChangeEvent(!0),window.setTimeout(()=>{if(!this.temp_last_changed)return;if(Date.now()-this.temp_last_changed<this.timeout)return;const{value:t}=this.targetTemperature;try{this.targetTemperature.update(t)}finally{this.sendChangeEvent(!1),this.temp_last_changed=null}},this.timeout+10))}render(){return this.targetTemperature?F`
      <div class='controls-wrap'>
        <ha-icon-button class='temp --up'
          .icon=${this.targetTemperature.icons.up}
          @click=${t=>this.increment(t)}>
          <ha-icon .icon=${this.targetTemperature.icons.up}></ha-icon>
        </ha-icon-button>
        <ha-icon-button class='temp --down'
          .icon=${this.targetTemperature.icons.down}
          @click=${t=>this.decrement(t)}>
           <ha-icon .icon=${this.targetTemperature.icons.down}></ha-icon>
        </ha-icon-button>
      </div>
    `:""}static get styles(){return o`
    .controls-wrap {
      display: flex;
      flex-direction: column;
      height: 100%;
      --ha-icon-display: flex;
    }
    .temp {
      width: calc(var(--mc-unit) * .75);
      height: calc(var(--mc-unit) * .75);
      --mdc-icon-button-size: calc(var(--mc-unit) * .75);
      --ha-icon-button-size: calc(var(--mc-unit) * .75);
      --mdc-icon-size: calc(var(--mc-unit) * .6);
      color: var(--mc-icon-color);
    }
    .temp.--up {
      margin-top: -2px;
    }
    .temp.--down {
      margin-top: -2px;
    }
    .temp.--down {
      margin-top: auto;
    }
    `}});ct("mc-menu",class extends at{static get properties(){return{items:{type:Array},selected:{type:String},open:{type:Boolean,state:!0}}}constructor(){super(),this.items=[],this.open=!1,this.anchor=null,this.onDocumentPointerDown=t=>this.handleDocumentPointerDown(t),this.onDocumentKeydown=t=>this.handleDocumentKeydown(t),this.onViewportChange=()=>this.close()}disconnectedCallback(){this.stopListening(),super.disconnectedCallback()}get selectedIndex(){return void 0===this.selected||null===this.selected?-1:this.items.map(t=>t.id).indexOf(this.selected)}get surface(){return this.shadowRoot&&this.shadowRoot.getElementById("surface")}get options(){return this.surface?[...this.surface.querySelectorAll(".mc-menu__item")]:[]}show(){this.open=!0}close(){this.open&&(this.open=!1)}select(t){this.close(),this.items[t]&&this.dispatchEvent(new CustomEvent("selected",{detail:{index:t}}))}handleKeydown(t){const{options:e}=this,i=e.indexOf(this.shadowRoot.activeElement),n=i=>{t.preventDefault();const n=e[(i+e.length)%e.length];n&&n.focus()};switch(t.key){case"ArrowDown":n(i+1);break;case"ArrowUp":n(i-1);break;case"Home":n(0);break;case"End":n(e.length-1);break;case"Tab":this.close()}}handleDocumentKeydown(t){"Escape"===t.key&&(t.stopPropagation(),this.close(),this.anchor&&this.anchor.focus&&this.anchor.focus())}handleDocumentPointerDown(t){const e=t.composedPath();e.includes(this)||this.anchor&&e.includes(this.anchor)||this.close()}startListening(){document.addEventListener("pointerdown",this.onDocumentPointerDown,!0),document.addEventListener("keydown",this.onDocumentKeydown,!0),window.addEventListener("scroll",this.onViewportChange,!0),window.addEventListener("resize",this.onViewportChange)}stopListening(){document.removeEventListener("pointerdown",this.onDocumentPointerDown,!0),document.removeEventListener("keydown",this.onDocumentKeydown,!0),window.removeEventListener("scroll",this.onViewportChange,!0),window.removeEventListener("resize",this.onViewportChange)}updated(t){if(!t.has("open"))return;if(!this.open)return void this.stopListening();const{surface:e}=this;if(!e)return;this.showAsPopover(e),this.position(),this.startListening();const i=this.options[this.selectedIndex]||this.options[0];i&&i.focus()}showAsPopover(t){if(t.showPopover)try{t.showPopover()}catch{t.removeAttribute("popover")}}position(){const{surface:t,anchor:e}=this;if(!t||!e)return;const i=e.getBoundingClientRect(),{width:n,height:s}=t.getBoundingClientRect(),o=window.innerWidth,a=window.innerHeight,r=Math.min(Math.max(8,i.right-n),Math.max(8,o-n-8)),c=i.top+s>a-8?Math.max(8,i.bottom-s):Math.max(8,i.top);t.style.left=`${r}px`,t.style.top=`${c}px`}render(){return this.open?F`
      <div
        id="surface"
        class="mc-menu"
        role="listbox"
        popover="manual"
        @keydown=${this.handleKeydown}
      >
        ${this.items.map((t,e)=>F`
            <button
              type="button"
              role="option"
              class="mc-menu__item"
              data-value=${t.id}
              aria-selected=${e===this.selectedIndex?"true":"false"}
              @click=${()=>this.select(e)}
            >
              <span class="mc-menu__item__label ellipsis">${t.name}</span>
            </button>
          `)}
      </div>
    `:F``}static get styles(){return o`
      /* The surface. The colours are Home Assistant's own menu colours, so
         this follows the theme the same way the menu it replaces did. */
      .mc-menu {
        position: fixed;
        inset: auto;
        z-index: 9;
        box-sizing: border-box;
        margin: 0;
        padding: 8px 0;
        border: none;
        border-radius: 4px;
        min-width: 112px;
        max-width: 280px;
        max-height: 60vh;
        overflow-y: auto;
        background: var(
          --mdc-theme-surface,
          var(--card-background-color, var(--ha-card-background, #fff))
        );
        color: var(--primary-text-color, #212121);
        box-shadow:
          0 5px 5px -3px rgba(0, 0, 0, 0.2),
          0 8px 10px 1px rgba(0, 0, 0, 0.14),
          0 3px 14px 2px rgba(0, 0, 0, 0.12);
      }
      .mc-menu__item {
        display: flex;
        align-items: center;
        box-sizing: border-box;
        width: 100%;
        min-height: 48px;
        margin: 0;
        padding: 0 16px;
        border: none;
        background: none;
        color: inherit;
        font-family: inherit;
        font-size: 16px;
        text-align: start;
        cursor: pointer;
        /* No 300ms wait for a second tap that is not coming. */
        touch-action: manipulation;
        -webkit-appearance: none;
        appearance: none;
      }
      .mc-menu__item:hover,
      .mc-menu__item:focus {
        outline: none;
        background: rgba(127, 127, 127, 0.12);
      }
      .mc-menu__item[aria-selected='true'] {
        color: var(--mc-active-color);
      }
      .mc-menu__item__label {
        pointer-events: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `}});ct("mc-dropdown-base",class extends at{static get properties(){return{items:{type:Array},label:{type:String},selected:{type:String},icon:{type:String},active:{type:Boolean},disabled:{type:Boolean},iconStyle:{type:Object}}}constructor(){super(),this.iconStyle={}}get selectedId(){return this.items.map(t=>t.id).indexOf(this.selected)}onChange(t){const{index:e}=t.detail;e!==this.selectedId&&this.items[e]&&this.dispatchEvent(new CustomEvent("change",{detail:this.items[e]}))}handleClick(){const t=this.shadowRoot.querySelector("#menu");t.anchor=this.shadowRoot.querySelector("#button"),t.show()}render(){return F`
      <div class='mc-dropdown'>
        <ha-icon-button class='mc-dropdown__button icon'
          style=${gt(this.iconStyle)}
          id=${"button"}
          @click=${this.handleClick}
          ?disabled=${this.disabled}
          ?color=${this.active}>
            <ha-icon .icon=${this.icon}></ha-icon>
        </ha-icon-button>
        <mc-menu
          id=${"menu"}
          .items=${this.items}
          .selected=${this.selected}
          @selected=${this.onChange}
        ></mc-menu>
      </div>
    `}static get styles(){return[_t,o`
        :host {
          position: relative;
          overflow: hidden;
        }
        .mc-dropdown
        :host([disabled]) {
          opacity: .25;
          pointer-events: none;
        }
        :host([faded]) {
          opacity: .75;
        }
        .mc-dropdown {
          padding: 0;
        }
        ha-icon-button[disabled] {
          opacity: .25;
          pointer-events: none;
        }
        .mc-dropdown__button.icon {
          margin: 0;
        }
        ha-icon-button {
          width: calc(var(--mc-dropdown-unit));
          height: calc(var(--mc-dropdown-unit));
          --mdc-icon-button-size: calc(var(--mc-dropdown-unit));
          --ha-icon-button-size: calc(var(--mc-dropdown-unit));
        }
        .mc-dropdown[focused] ha-icon-button {
          color: var(--mc-accent-color);
        }
        .mc-dropdown[focused] ha-icon-button[focused] {
          color: var(--mc-text-color);
          transform: rotate(0deg);
        }
      `]}});ct("mc-mode-menu",class extends at{constructor(){super(),this.mode={}}static get properties(){return{mode:{type:Object}}}get calcIcon(){if(this.selected){if(this.selected.icon)return this.selected.icon;if(void 0!==this.selected.id&&null!==this.selected.id){const t=this.selected.id.toString().toUpperCase();if(t in bt)return bt[t]}}return""}get selected(){return this.mode.source.find(t=>t.id===this.mode.state)||{}}get sources(){return this.mode.source.filter(t=>!t.hide).map(t=>({name:t.name,id:t.id,type:"source"}))}handleChange(t){t.stopPropagation();const e=t.detail.id;this.mode.handleChange(e)}render(){return F`
      <mc-dropdown-base
        @change=${this.handleChange}
        .items=${this.sources}
        .icon=${this.calcIcon}
        .iconStyle=${this.mode.style}
        .active=${this.mode.isActive(this.mode.state)}
        .selected=${this.selected.id}>
      </mc-dropdown-base>
    `}static get styles(){return o`
      :host {
        min-width: calc(var(--mc-unit) * .85);
        --mc-dropdown-unit: calc(var(--mc-unit) * .75);
        --paper-item-min-height: var(--mc-unit);
      }
    `}});ct("mc-indicators",class extends at{static get properties(){return{indicators:{type:Object}}}handlePopup(t,e){t.stopPropagation(),vt(this,e.hass,e.config.tap_action,e.entity.entity_id)}renderIcon(t){const{icon:e}=t;return e?F`<ha-icon style=${gt(t.iconStyle)} class='state__value_icon' .icon=${e}></ha-icon>`:""}renderUnit(t){return t.unit?F`<span class='state__uom' style=${gt(t.valueStyle)}>${t.unit}</span>`:""}renderIndicator(t){if(!t)return"";const e=t.config&&t.config.tap_action&&t.config.tap_action.action,i=e&&xt.includes(e)?"pointer":"";return F`
       <div class='state ${i}' @click=${e=>this.handlePopup(e,t)}>
         ${this.renderIcon(t)}
         <span class='state__value' style=${gt(t.valueStyle)}>${t.value}</span>
         ${this.renderUnit(t)}
       </div>
    `}render(){const t=Object.entries(this.indicators).map(t=>t[1]).filter(t=>!t.hide);return F`
     <div class='mc-indicators__container'>
       ${t.map(t=>this.renderIndicator(t))}
     </div>
    `}static get styles(){return o`
     :host {
        position: relative;
        box-sizing: border-box;
        font-size: calc(var(--mc-unit) * .35);
        line-height: calc(var(--mc-unit) * .35);
      }
     .mc-indicators__container {
       display: flex;
       flex-wrap: wrap;
       margin-right: calc(var(--mc-unit) * .075);
     }
     .state {
        position: relative;
        display: flex;
        flex-wrap: nowrap;
        margin-right: calc(var(--mc-unit) * .1);
     }
     .pointer {
        cursor: pointer
     }
     .state__value_icon {
        height: calc(var(--mc-unit) * .475);
        width: calc(var(--mc-unit) * .5);
        color: var(--mc-icon-color);
        --mdc-icon-size: calc(var(--mc-unit) * 0.5);
     }
     .state__value {
        margin: 0 1px;
        font-weight: var(--mc-info-font-weight);
        line-height: calc(var(--mc-unit) * .475);
     }
     .state__uom {
        font-size: calc(var(--mc-unit) * .275);
        line-height: calc(var(--mc-unit) * .525);
        margin-left: 1px;
        height: calc(var(--mc-unit) * .475);
        opacity: 0.8;
     }
    `}});ct("mc-dropdown",class extends at{constructor(){super(),this.dropdown={},this.timer=void 0,this._state=void 0}static get properties(){return{dropdown:{type:Object}}}handleChange(t){t.stopPropagation();const e=t.detail.id,{entity:i}=this.dropdown;this._state=e,this.dropdown.handleChange(e),this.timer&&clearTimeout(this.timer),this.timer=setTimeout(async()=>{this.dropdown.entity===i&&(this._state=void 0!==this.dropdown.state&&null!==this.dropdown.state?this.dropdown.state.toString():"",this.requestUpdate("_state"))},this.dropdown.actionTimeout),this.requestUpdate("_state")}render(){return F`
      <mc-dropdown-base
        .iconStyle=${this.dropdown.style}
        @change=${t=>this.handleChange(t)}
        .items=${this.dropdown.source}
        .icon=${this.dropdown.icon}
        .disabled="${this.dropdown.disabled}"
        .active=${this.dropdown.isActive(this._state)}
        .selected=${this._state}>
      </mc-dropdown-base>
    `}willUpdate(t){t.has("dropdown")&&(this._state=void 0!==this.dropdown.state&&null!==this.dropdown.state?this.dropdown.state.toString():"",this.timer&&clearTimeout(this.timer))}static get styles(){return[_t,o`
      :host {
        position: relative;
        box-sizing: border-box;
        margin: 0;
        overflow: hidden;
        transition: background .5s;
      }
      :host([color]) {
        background: var(--mc-active-color);
        transition: background .25s;
        opacity: 1;
      }
      :host([disabled]) {
        opacity: .25;
        pointer-events: none;
      }
    `]}});ct("mc-button",class extends at{constructor(){super(),this._isOn=!1,this.timer=void 0}static get properties(){return{button:{type:Object}}}handleToggle(t){t.stopPropagation();const{entity:e}=this.button;this._isOn=!this._isOn,this.button.handleToggle(),this.timer&&clearTimeout(this.timer),this.timer=setTimeout(async()=>{this.button.entity===e&&(this._isOn=this.button.isOn,this.requestUpdate("_isOn"))},this.button.actionTimeout),this.requestUpdate("_isOn")}render(){return F`
       <ha-icon-button
         style=${gt(this.button.style)}
         .icon=${this.button.icon}
         @click=${t=>this.handleToggle(t)}
         ?disabled="${this.button.disabled||this.button.isUnavailable}"
         ?color=${this._isOn}>
           <ha-icon .icon=${this.button.icon}></ha-icon>
        </ha-icon-button>
    `}willUpdate(t){t.has("button")&&(this._isOn=this.button.isOn,this.timer&&clearTimeout(this.timer))}static get styles(){return[_t,o`
      :host {
        position: relative;
        box-sizing: border-box;
        margin: 0;
        overflow: hidden;
        transition: background .5s;
      }
      :host([color]) {
        background: var(--mc-active-color);
        transition: background .25s;
        opacity: 1;
      }
      :host([disabled]) {
        opacity: .25;
        pointer-events: none;
      }
    `]}});ct("mc-buttons",class extends at{static get properties(){return{buttons:{type:Object}}}renderButton(t){return t.isUnavailable?"":F`
       <mc-button
         class="custom-button"
         .button=${t}>
        </mc-button>
    `}renderDropdown(t){return F`
      <mc-dropdown
        .dropdown=${t}>
      </mc-dropdown>
    `}renderInternal(t){return"dropdown"===t.type?this.renderDropdown(t):this.renderButton(t)}render(){return F`${Object.entries(this.buttons).map(t=>t[1]).filter(t=>"main"!==t.location&&!t.hide).sort((t,e)=>t.order>e.order?1:e.order>t.order?-1:0).map(t=>this.renderInternal(t))}`}static get styles(){return[_t,o`
      :host {
        position: relative;
        box-sizing: border-box;
        margin: 0;
        overflow: hidden;
        transition: background .5s;
        --paper-item-min-height: var(--mc-unit);
        --mc-dropdown-unit: var(--mc-unit);
        --mdc-icon-button-size: calc(var(--mc-unit));
        --ha-icon-button-size: calc(var(--mc-unit));
      }
      :host([color]) {
        background: var(--mc-active-color);
        transition: background .25s;
        opacity: 1;
      }
      :host([disabled]) {
        opacity: .25;
        pointer-events: none;
      }
      mc-button {
        width: calc(var(--mc-unit));
        height: calc(var(--mc-unit));
      }
    `]}});ct("mc-fan-mode-secondary",class extends at{constructor(){super(),this.fanMode={},this.config={},this.timer=void 0,this._selected={}}static get properties(){return{fanMode:{type:Object},config:{type:Object}}}get items(){return this.fanMode.source.filter(t=>!t.hide)}get selectedIndex(){return this.items.map(t=>t.id).indexOf(this._selected?.id)}handleChange(t){const{index:e}=t.detail;if(e===this.selectedIndex||!this.items[e])return;clearTimeout(this.timer);const i=this.items[e],{entity:n}=this.fanMode,s=this._selected;this._selected=i,this.timer=setTimeout(async()=>{this.fanMode.entity===n&&(this._selected=s,this.requestUpdate("_selected"))},this.fanMode.actionTimeout),this.fanMode.handleChange(i.id),this.requestUpdate("_selected")}renderFanMode(t=0){const e=this._selected?this._selected.name:this.fanMode.state,i=this.config.secondary_info.icon?this.config.secondary_info.icon:this.fanMode.icon;return F`
       <ha-icon class='icon' .icon=${i}></ha-icon>
       <span class='name' style=${gt(t?{"padding-left":`${t}px`}:{})}>${e}</span>
    `}handleClick(){const t=this.shadowRoot.querySelector("#menu"),e=this.shadowRoot.querySelector("#button");t.anchor=e,t.show()}handleKeydown(t){"Enter"!==t.key&&" "!==t.key||(t.preventDefault(),this.handleClick())}renderFanModeDropdown(){return F`
      <div class='mc-dropdown'>
        <!-- The whole drop (icon + label) is the button, not just the 20x20
             icon grid. Anchored and keyboard-focusable like one, so the menu
             opens wherever the reader presses, not only on the glyph. -->
        <button
          class='mc-dropdown__button'
          id=${"button"}
          @click=${this.handleClick}
          @keydown=${this.handleKeydown}
          ?disabled=${this.fanMode.disabled}
          role='button'
          tabindex='0'
        >
          ${this.renderFanMode(3)}
        </button>
        <mc-menu
          id=${"menu"}
          .items=${this.items}
          .selected=${this._selected?.id}
          @selected=${this.handleChange}
        ></mc-menu>
      </div>
    `}render(){const{type:t}=this.config.secondary_info;return"fan-mode-dropdown"===t||"hvac-mode-dropdown"===t?this.renderFanModeDropdown():this.renderFanMode()}willUpdate(t){t.has("fanMode")&&(clearTimeout(this.timer),this._selected=this.fanMode.selected)}static get styles(){return[_t,o`
      .mc-dropdown {
        padding: 0;
      }
      /* The whole drop is the click target - icon and label in one row - and
         the label is sized by the same unit as the secondary info line. The
         only shadow-owning element left is the menu, which renders in a top
         layer and does not interfere. */
      .mc-dropdown__button {
        display: flex;
        align-items: center;
        padding: 0;
        margin: 0;
        border: none;
        background: none;
        color: inherit;
        font-family: inherit;
        cursor: pointer;
        text-align: start;
        -webkit-appearance: none;
        appearance: none;
      }
      .mc-dropdown__button[disabled] {
        opacity: .25;
        pointer-events: none;
      }
      .name {
        font-size: calc(var(--mc-unit) * .35);
        font-weight: var(--mc-info-font-weight);
        line-height: calc(var(--mc-unit) * .5);
        vertical-align: middle;
        display: inline-block;
      }
      .icon {
        color: var(--mc-icon-color);
        /* Square, and the same size as the button and the glyph inside it.
           The height was .475 against a width of .5 - 19px against 20px - so
           whatever the button did, it could not sit inside the host. */
        height: calc(var(--mc-unit) * .5);
        width: calc(var(--mc-unit) * .5);
        min-width: calc(var(--mc-unit) * .5);
        --mdc-icon-size: calc(var(--mc-unit) * 0.5);
        /* The button inside ha-icon-button is sized by these, not by the host:
           without them it keeps whatever it inherits - 30px against a 20px
           host on 2026.8.3 - and spills out of the secondary info line. Both
           spellings, like everywhere else in this card: --mdc-icon-button-size
           is the pre-2026 knob and --ha-icon-button-size the current one. */
        --mdc-icon-button-size: calc(var(--mc-unit) * .5);
        --ha-icon-button-size: calc(var(--mc-unit) * .5);
      }
    `]}});ct("mc-secondary-info",class extends at{constructor(){super(),this.fanMode={},this.hvacMode={},this.config={},this.climate={}}static get properties(){return{fanMode:{type:Object},config:{type:Object},hvacMode:{type:Object},climate:{type:Object}}}renderHvacAction(){const t=this.climate.hvacAction;if(!t)return"";const e=t.icon?t.icon:this.config.secondary_info.icon;return F`
        ${e?F`<ha-icon class='icon' .icon=${e}></ha-icon>`:""}
         <span class='name ${e?"":"gray"}'>${t.name}</span>
      `}renderHvacMode(){const{hvacMode:t}=this,e=t.selected||{},i=e.icon?e.icon:this.config.secondary_info.icon;return F`
        ${i?F`<ha-icon class='icon' .icon=${i}></ha-icon>`:""}
         <span class='name'>${e.name}</span>
      `}render(){const{type:t}=this.config.secondary_info;switch(t){case"hvac-mode":return this.renderHvacMode();case"hvac-mode-dropdown":return F`<mc-fan-mode-secondary .fanMode=${this.hvacMode} .config=${this.config}></mc-fan-mode-secondary>`;case"hvac-action":return this.renderHvacAction();case"last-changed":return F`<ha-relative-time .hass=${this.climate.hass} .datetime=${this.climate.lastChanged}></ha-relative-time>`;case"last-updated":return F`<ha-relative-time .hass=${this.climate.hass} .datetime=${this.climate.lastUpdated}></ha-relative-time>`;default:return F`<mc-fan-mode-secondary .fanMode=${this.fanMode} .config=${this.config}></mc-fan-mode-secondary>`}}static get styles(){return[_t,o`
      ha-relative-time, .gray {
        color: #727272;
      }
      .name {
        font-size: calc(var(--mc-unit) * .35);
        font-weight: var(--mc-info-font-weight);
        line-height: calc(var(--mc-unit) * .5);
        vertical-align: middle;
        display: inline-block;
      }
      .icon {
        color: var(--mc-icon-color);
        height: calc(var(--mc-unit) * .475);
        width: calc(var(--mc-unit) * .5);
        min-width: calc(var(--mc-unit) * .5);
        --mdc-icon-size: calc(var(--mc-unit) * 0.5);
      }
    `]}});const Nt=[{name:"entity",required:!0,selector:{entity:{domain:["climate","fan"]}}},{name:"name",selector:{text:{}}},{name:"icon",selector:{icon:{}}},{name:"group",selector:{boolean:{}}},{name:"scale",selector:{number:{min:.5,max:3,step:.1,mode:"box"}}},{name:"swap_temperatures",selector:{boolean:{}}},{name:"hide_current_temperature",selector:{boolean:{}}}],Lt=[{value:"more-info",label:"More info (default)"},{value:"navigate",label:"Navigate"},{value:"call-service",label:"Call service"},{value:"url",label:"Open URL"},{value:"fire-dom-event",label:"Fire DOM event"},{value:"none",label:"None"}];const Rt=[{name:"hide",selector:{boolean:{}}},{name:"default",selector:{boolean:{}}},{name:"icon",selector:{icon:{}}}],Ft=[{name:"type",selector:{select:{options:[{value:"fan-mode",label:"Fan mode"},{value:"fan-mode-dropdown",label:"Fan mode (dropdown)"},{value:"hvac-mode",label:"HVAC mode"},{value:"hvac-mode-dropdown",label:"HVAC mode (dropdown)"},{value:"hvac-action",label:"HVAC action"},{value:"last-changed",label:"Last changed"},{value:"last-updated",label:"Last updated"}]}}},{name:"hide",selector:{boolean:{}}},{name:"icon",selector:{icon:{}}}],Bt=[{name:"unit",selector:{select:{options:["°C","°F"],custom_value:!0}}},{name:"round",selector:{number:{min:0,max:5,step:1,mode:"box"}}}],Vt=[{name:"unit",selector:{select:{options:["°C","°F"],custom_value:!0}}},{name:"min",selector:{number:{step:.5,mode:"box"}}},{name:"max",selector:{number:{step:.5,mode:"box"}}},{name:"step",selector:{number:{min:.1,max:5,step:.1,mode:"box"}}},{name:"icon_up",selector:{icon:{}}},{name:"icon_down",selector:{icon:{}}}],qt=[{name:"hide",selector:{boolean:{}}}],Wt=[{name:"icon",selector:{icon:{}}},{name:"hide",selector:{boolean:{}}},{name:"location",selector:{select:{options:[{value:"bottom",label:"Bottom panel"},{value:"main",label:"Main row"}]}}}],Kt={entity:"Entity",name:"Name (optional override)",icon:"Icon",group:"Group mode (remove card background)",scale:"UI scale",swap_temperatures:"Swap current and target temperature",hide_current_temperature:"Hide current temperature",action:"Action",navigation_path:"Navigation path",url:"URL",service:"Service / Action",service_data:"Service data",hide:"Hide",default:"Expanded by default",type:"Type",unit:"Unit",round:"Decimal places (round)",min:"Minimum temperature",max:"Maximum temperature",step:"Step",icon_up:"Up icon",icon_down:"Down icon",location:"Button location"},Gt=["entity","name","icon","group","scale","swap_temperatures","hide_current_temperature"];ct("mini-climate-editor",class extends at{constructor(){super(),this._basicSchema=Nt,this._computeLabel=t=>Kt[t.name]??t.name,this._basicChanged=t=>this._handleBasicChanged(t),this._tapActionChanged=t=>this._handleTapActionChanged(t),this._targetTempChanged=t=>this._handleTargetTempChanged(t),this._onSecondaryInfo=t=>this._onSub("secondary_info",t),this._onToggle=t=>this._onSub("toggle",t),this._onTemperature=t=>this._onSub("temperature",t),this._onHvacMode=t=>this._onSub("hvac_mode",t),this._onFanMode=t=>this._onSub("fan_mode",t)}static get properties(){return{hass:{type:Object},config:{type:Object}}}static get styles(){return o`
      :host {
        display: block;
      }
      ha-expansion-panel {
        display: block;
        margin-top: 4px;
        --expansion-panel-summary-padding: 0 16px;
        --expansion-panel-content-padding: 0 16px 8px;
      }
      ha-form {
        display: block;
      }
    `}setConfig(t){let e=t.secondary_info;"string"==typeof e&&(e={type:e}),"string"==typeof t.tap_action&&(t={...t,tap_action:{action:t.tap_action}}),this.config={...t,secondary_info:e??{}},this._basicSchema=this.config.icon&&"object"==typeof this.config.icon?Nt.filter(t=>"icon"!==t.name):Nt}_fire(t){this.dispatchEvent(new CustomEvent("config-changed",{detail:{config:t}}))}_onSub(t,e){if(!this.config||!this.hass)return;const i=e.detail.value;this._fire({...this.config,[t]:{...this._subData(t),...i}})}_basicData(){const t={};for(let e=0;e<Gt.length;e+=1){const i=Gt[e];void 0!==this.config[i]&&("icon"===i&&"object"==typeof this.config[i]||(t[i]=this.config[i]))}return t}_tapActionData(){return{action:"more-info",...this.config.tap_action}}_targetTempData(){const t=this.config.target_temperature??{},e=t.icons??{},i={};return void 0!==t.unit&&(i.unit=t.unit),void 0!==t.min&&(i.min=t.min),void 0!==t.max&&(i.max=t.max),void 0!==t.step&&(i.step=t.step),void 0!==e.up&&(i.icon_up=e.up),void 0!==e.down&&(i.icon_down=e.down),i}_subData(t){return this.config[t]??{}}_handleBasicChanged(t){if(!this.config||!this.hass)return;const e=t.detail.value,i={...this.config};for(let t=0;t<Gt.length;t+=1){const n=Gt[t];"icon"===n&&"object"==typeof this.config.icon||(void 0!==e[n]&&""!==e[n]?i[n]=e[n]:delete i[n])}this._fire(i)}_handleTapActionChanged(t){if(!this.config||!this.hass)return;const e=t.detail.value,i=e.action??"more-info",n={action:i};"navigate"===i&&e.navigation_path?n.navigation_path=e.navigation_path:"url"===i&&e.url?n.url=e.url:"more-info"===i&&e.entity?n.entity=e.entity:"call-service"===i&&(e.service&&(n.service=e.service),e.service_data&&Object.keys(e.service_data).length>0&&(n.service_data=e.service_data)),this._fire({...this.config,tap_action:n})}_handleTargetTempChanged(t){if(!this.config||!this.hass)return;const e=t.detail.value,i=this.config.target_temperature??{},n={...i.icons};e.icon_up?n.up=e.icon_up:delete n.up,e.icon_down?n.down=e.icon_down:delete n.down;const s={...i};void 0!==e.unit?s.unit=e.unit:delete s.unit,void 0!==e.min?s.min=e.min:delete s.min,void 0!==e.max?s.max=e.max:delete s.max,void 0!==e.step?s.step=e.step:delete s.step,Object.keys(n).length>0?s.icons=n:delete s.icons,this._fire({...this.config,target_temperature:s})}_renderSection(t,e,i,n){return F`
      <ha-expansion-panel .header=${t} outlined>
        <ha-form
          .hass=${this.hass}
          .data=${i}
          .schema=${e}
          .computeLabel=${this._computeLabel}
          @value-changed=${n}
        ></ha-form>
      </ha-expansion-panel>
    `}render(){return this.hass&&this.config?F`
      <ha-form
        .hass=${this.hass}
        .data=${this._basicData()}
        .schema=${this._basicSchema}
        .computeLabel=${this._computeLabel}
        @value-changed=${this._basicChanged}
      ></ha-form>

      ${this._renderSection("Tap action",function(t){const e=[{name:"action",selector:{select:{options:Lt}}}];return"navigate"===t?e.push({name:"navigation_path",selector:{text:{}}}):"url"===t?e.push({name:"url",selector:{text:{}}}):"more-info"===t?e.push({name:"entity",selector:{entity:{}}}):"call-service"===t&&(e.push({name:"service",selector:{action:{}}}),e.push({name:"service_data",selector:{object:{}}})),e}(this._tapActionData().action),this._tapActionData(),this._tapActionChanged)}

      ${this._renderSection("Secondary info",Ft,this._subData("secondary_info"),this._onSecondaryInfo)}

      ${this._renderSection("Toggle panel button",Rt,this._subData("toggle"),this._onToggle)}

      ${this._renderSection("Temperature display",Bt,this._subData("temperature"),this._onTemperature)}

      ${this._renderSection("Target temperature",Vt,this._targetTempData(),this._targetTempChanged)}

      ${this._renderSection("HVAC mode",qt,this._subData("hvac_mode"),this._onHvacMode)}

      ${this._renderSection("Fan mode",Wt,this._subData("fan_mode"),this._onFanMode)}
    `:F``}});ct("mini-climate",class extends at{static getStubConfig(t,e,i){let n=e.find(t=>"climate"===t.split(".")[0]);return n||(n=i.find(t=>"climate"===t.split(".")[0])),{entity:n}}static getConfigElement(){return document.createElement("mini-climate-editor")}constructor(){super(),this.initial=!0,this.toggle=!1,this.temperature={},this.targetTemperature={},this.swapTemperatures=!1,this.buttons={},this.indicators={},this.hvacMode={},this.targetTemperatureChanging=!1,this.climate={},this.targetTemperatureValue=0,this.shouldHideIcon=()=>!1,this.iconTemplate=void 0,this.iconStyle=void 0}static get properties(){return{_hass:{type:Object},config:{type:Object},entity:{type:Object},climate:{type:Object},initial:{type:Boolean},toggle:{type:Boolean}}}static get styles(){return[_t,ft]}set hass(t){if(!t)return;const e=t.states[this.config.entity];this._hass=t;let i=!1;this.entity===e&&this.climate instanceof jt||(this.entity=e,this.climate=new jt(t,this.config,e),i=!0),this.updateIndicators(i),this.updateButtons(i),this.updateTemperature(i),this.updateTargetTemperature(i),this.updateHvacMode(i),this.climate.mode=this.hvacMode.selected}get hass(){return this._hass}get name(){return this.config.name||this.climate.name}updateIndicators(t){const e={};let i=!1;for(let t=0;t<this.config.indicators.length;t+=1){const n=this.config.indicators[t],{id:s}=n,o=n.source.entity||this.climate.id,a=this.hass.states[o];a&&(e[s]=new Dt(a,n,this.climate,this.hass)),a!==(this.indicators[s]&&this.indicators[s].entity)&&(i=!0)}(i||t)&&(this.indicators=e)}updateTemperature(t){if(this.targetTemperatureChanging)return;const e=this.config.temperature.source.entity||this.config.entity,i=this.hass.states[e],n=this.config.target_temperature.source&&this.config.target_temperature.source.entity||this.config.entity,s=this.hass.states[n],o=new Ot(i,s,this.config,this.climate);(this.temperature.rawValue!==o.rawValue||t)&&(this.temperature=o)}updateTargetTemperature(t){if(this.targetTemperatureChanging)return;const e=this.config.target_temperature.source&&this.config.target_temperature.source.entity||this.config.entity,i=this.hass.states[e];(this.targetTemperature.entity!==i||t)&&(this.targetTemperature=new Ut(i,this.config,this.hass),this.targetTemperatureValue=this.targetTemperature.value)}updateHvacMode(t){const e=this.config.hvac_mode,i=e.state&&e.state.entity||this.climate.id,n=this.hass.states[i];(n&&n!==(this.hvacMode&&this.hvacMode.entity)||t)&&(this.hvacMode=new It(n,e,this.climate))}updateButtons(t){const e={};let i=!1;for(let t=0;t<this.config.buttons.length;t+=1){const n=this.config.buttons[t],{id:s}=n,o=n.state&&n.state.entity||this.climate.id,a=this.hass.states[o];a&&(e[s]=new Pt(a,n,this.climate,this.hass)),a!==(this.buttons[s]&&this.buttons[s].entity)&&(i=!0)}(i||t)&&(this.buttons=e)}getButtonsConfig(t){const e=Object.entries(t.buttons||{}),i=[];for(let n=0;n<e.length;n+=1){const[s,o]=e[n],a=this.getButtonConfig(o,t);a.id=s,"order"in a||(a.order=n+1),i.push(a)}return i}getButtonConfig(t,e){const i={icon:"mdi:radiobox-marked",type:"button",toggle_action:void 0,...t};i.functions={};const n={...t};return n.call_service=(t,e,i)=>this.hass.callService(t,e,i),n.entity_config=e,n.toggle_state=Ct,i.disabled&&(i.functions.disabled=Mt(i.disabled,n)),i.state&&i.state.mapper&&(i.functions.state={mapper:Mt(i.state.mapper,n)}),i.active&&(i.functions.active=Mt(i.active,n)),i.source&&i.source.__filter&&(i.functions.source={filter:Mt(i.source.__filter,n)}),i.toggle_action&&(i.functions.toggle_action=Mt(i.toggle_action,n)),i.change_action&&(i.functions.change_action=Mt(i.change_action,n)),i.style&&(i.functions.style=Mt(i.style,n)),"object"==typeof i.icon&&(i.functions.icon={},i.icon.template&&(i.functions.icon.template=Mt(i.icon.template,n)),i.icon.style&&(i.functions.icon.style=Mt(i.icon.style,n))),i.hide&&("boolean"==typeof i.hide?i.functions.hide=()=>!0:i.functions.hide=Mt(i.hide,n)),i}getFanModeConfig(t){let e={id:"fan_mode",icon:"mdi:fan",type:"dropdown",order:0,state:{attribute:"fan_mode"},change_action:(t,e,i)=>{const n={fan_mode:t,entity_id:i.entity_id};return this.call_service("climate","set_fan_mode",n)},...t.fan_mode||{}};e=this.getButtonConfig(e,t);const{functions:i}=e;return i.active||(i.active=()=>this.climate.isOn),e}getIndicatorConfig(t,e,i){const n={id:t,source:{enitity:void 0,attribute:void 0,mapper:void 0},icon:"",...e};n.tap_action=kt(e.tap_action),n.functions=n.functions||{};const s={...e};return s.entity_config=i,s.toggle_state=Ct,n.source.mapper&&(n.functions.mapper=Mt(n.source.mapper,s)),"object"==typeof n.icon&&(n.functions.icon={},n.icon.template&&(n.functions.icon.template=Mt(n.icon.template,s)),n.icon.style&&(n.functions.icon.style=Mt(n.icon.style,s))),"object"==typeof n.value&&(n.functions.value={},n.value.style&&(n.functions.value.style=Mt(n.value.style,s))),"object"==typeof n.unit&&(n.functions.unit={},n.unit.template&&(n.functions.unit.template=Mt(n.unit.template,s))),n.hide&&("boolean"==typeof n.hide?n.functions.hide=()=>!0:n.functions.hide=Mt(n.hide,s)),n}getSecondaryInfoConfig(t){const e={...t};e.functions=e.functions||{};const i={...t};return e.hide&&("boolean"==typeof e.hide?e.functions.hide=()=>!0:e.functions.hide=Mt(e.hide,i)),e}getToggleConfig(t){const e={...t};e.functions=e.functions||{};const i={...t};return e.hide&&("boolean"==typeof e.hide?e.functions.hide=()=>!0:e.functions.hide=Mt(e.hide,i)),e}getIndicatorsConfig(t){return Object.entries(t.indicators||{}).map(e=>this.getIndicatorConfig(e[0],e[1]||{},t))}getTargetTemperatureConfig(t){const e={source:{entity:void 0,attribute:"temperature"},...t.target_temperature||{}};e.icons={up:bt.UP,down:bt.DOWN,...e.icons||{}},e.tap_action=kt(e.tap_action),e.functions={};const i={...t.target_temperature||{}};return i.call_service=(t,e,i)=>this.hass.callService(t,e,i),i.entity_config=t,i.toggle_state=Ct,e.change_action&&(e.functions.change_action=Mt(e.change_action,i)),e}getHvacModeConfig(t){let e={type:"dropdown",change_action:(t,e)=>{const i={hvac_mode:t,entity_id:e.entity_id};return this.call_service("climate","set_hvac_mode",i)},...t.hvac_mode||{}};e=this.getButtonConfig(e,this.config);const{functions:i}=e;return i.active||(i.active=()=>this.climate.isOn),e}setConfig(t){const e=["climate","fan"];if(!t.entity||!1===e.includes(t.entity.split(".")[0]))throw new Error(`Specify an entity from within domains: [${e.join(", ")}].`);this.config={tap_action:{action:"more-info",navigation_path:"",url:"",entity:"",service:"",service_data:{}},...t},"string"==typeof t.tap_action&&(this.config.tap_action={action:t.tap_action});const i=t.hide_icon;if(this.shouldHideIcon="string"==typeof i?Mt(i,this.config):()=>!0===i,this.iconTemplate=void 0,this.iconStyle=void 0,t.icon&&"object"==typeof t.icon){const e={...t.icon,entity_config:t};t.icon.template&&(this.iconTemplate=Mt(t.icon.template,e)),t.icon.style&&(this.iconStyle=Mt(t.icon.style,e))}this.config.indicators=this.getIndicatorsConfig(t),this.config.buttons=this.getButtonsConfig(t),this.fanModeConfig=this.getFanModeConfig(t),this.config.buttons.push(this.fanModeConfig),this.config.target_temperature=this.getTargetTemperatureConfig(t),this.config.temperature={round:1,source:{entity:void 0,attribute:"current_temperature"},...t.temperature||{},tap_action:kt((t.temperature||{}).tap_action)},this.config.hvac_mode=this.getHvacModeConfig(this.config),this.config.toggle=this.getToggleConfig({icon:bt.TOGGLE,hide:!1,default:!1,...t.toggle||{}}),"string"==typeof t.secondary_info?this.config.secondary_info={type:t.secondary_info}:this.config.secondary_info={type:"fan_mode",...t.secondary_info||{}},this.config.secondary_info=this.getSecondaryInfoConfig(this.config.secondary_info),this.toggle=this.config.toggle.default,this.swapTemperatures=!!this.config.swap_temperatures}renderCtlWrap(){if(this.climate.isUnavailable)return F`
        <span class="label ellipsis">        
          ${yt(this.hass,["state.default.unavailable"],"Unavailable")}
        </span>
      `;const t=Object.entries(this.buttons).map(t=>t[1]).filter(t=>"main"===t.location&&!t.hide).sort((t,e)=>t.order>e.order?1:e.order>t.order?-1:0);return F`
        ${t.map(t=>"dropdown"===t.type?F`<mc-dropdown .dropdown=${t}></mc-dropdown>`:F`<mc-button .button=${t}></mc-button>`)}
        ${this.hvacMode.hide?"":F`<mc-mode-menu .mode=${this.hvacMode}></mc-mode-menu>`}
        <mc-temperature
          .temperature=${this.temperature}
          .target=${this.targetTemperatureValue}
          .changing=${this.targetTemperatureChanging}
          .swapTemperatures=${this.swapTemperatures}>
        </mc-temperature>
    `}renderEntityControls(){return this.climate.isUnavailable?"":F`
        <div class="entity__controls">
          <mc-target-temperature
            .targetTemperature=${this.targetTemperature}
            @changing="${t=>this.handleChangingTargetTemperature(t)}">
          </mc-target-temperature>
        </div>
    `}render(){const t=!this.secondaryInfoIsDropdown();return F`
      <ha-card
        class=${this.computeClasses()}
        style=${gt(this.computeStyles())}>
        <div class='mc__bg'></div>
        <div class='mc-climate'>
          <div class='mc-climate__core flex'>
            ${this.renderIcon()}
            <div class='entity__info'>
              <div class="wrap">
                <div class="entity__info__name_wrap" @click=${e=>this.handlePopup(e,t)}>
                  ${this.renderEntityName()}
                </div>
                <div class="ctl-wrap ellipsis">
                  ${this.renderCtlWrap()}
                </div>
              </div>
              ${this.renderBottomPanel()}
            </div>
            ${this.renderEntityControls()}
          </div>
          ${this.renderTogglePanel()}
        </div>
      </ha-card>
    `}handleChangingTargetTemperature(t){this.targetTemperatureValue=this.targetTemperature.value,this.targetTemperatureChanging=t.detail.changing,this.requestUpdate("targetTemperatureChanging")}handlePopup(t,e){e&&(t.stopPropagation(),vt(this,this.hass,this.config.tap_action,this.climate.id))}handleToggle(t){t.stopPropagation(),this.toggle=!this.toggle}toggleButtonCls(){return this.toggle?"open":""}renderIcon(){if(this.shouldHideIcon(this.climate.entity,this.climate.mode))return F``;const t=this.climate.isActive&&!this.iconStyle;return F`
      <div class='entity__icon' ?color=${t} style=${gt(this.computeIconStyle())}>
        <ha-icon .icon=${this.computeIcon()} ></ha-icon>
      </div>`}renderTogglePanel(){return this.toggle?F`
        <div class="mc-toggle_content">
          <mc-buttons
            .buttons=${this.buttons}>
          </mc-buttons>
        </div>
    `:""}renderBottomPanel(){return this.climate.isUnavailable?"":F`
        <div class='bottom flex'>
          <mc-indicators
            .indicators=${this.indicators}>
          </mc-indicators>
          ${this.renderToggleButton()}
        </div>
    `}renderToggleButton(){return 0===Object.entries(this.buttons).map(t=>t[1]).filter(t=>!t.hide&&"main"!==t.location).length||this.config.toggle.functions.hide&&this.config.toggle.functions.hide(this.climate.entity,this.climate.mode)?F``:F`
        <ha-icon-button class='toggle-button ${this.toggleButtonCls()}'
          .icon=${this.config.toggle.icon}
          @click=${t=>this.handleToggle(t)}>
            <ha-icon .icon=${this.config.toggle.icon}></ha-icon>
        </ha-icon-button>
    `}renderEntityName(){return F`
      <div class='entity__info__name' @click=${t=>this.handlePopup(t,!0)}>
        ${this.name}
      </div>
     ${this.renderSecondaryInfo()}
    `}secondaryInfoHidden(){return!!this.climate.isUnavailable||Boolean(this.config.secondary_info.functions.hide&&this.config.secondary_info.functions.hide(this.climate.entity,this.climate.mode))}secondaryInfoIsDropdown(){const t=this.config.secondary_info.type;return"fan-mode-dropdown"===t||"hvac-mode-dropdown"===t}renderSecondaryInfo(){return this.secondaryInfoHidden()?F``:F`
      <div class='entity__secondary_info ellipsis'>
        <mc-secondary-info
          .climate=${this.climate}
          .config=${this.config}
          .hvacMode=${this.hvacMode}
          .fanMode=${this.buttons.fan_mode}>
        </mc-secondary-info>
      </div>`}computeIcon(){if(this.iconTemplate){const t=this.iconTemplate(this.climate.entity,this.climate.mode);if(t)return t}return"string"==typeof this.config.icon&&this.config.icon?this.config.icon:this.climate.icon||bt.DEFAULT}computeIconStyle(){return this.iconStyle&&this.iconStyle(this.climate.entity,this.climate.mode)||{}}computeClasses({config:t}=this){return ut({"--initial":this.initial,"--group":t.group,"--more-info":"none"!==t.tap_action.action,"--inactive":!this.climate.isActive,"--unavailable":this.climate.isUnavailable,"--no-secondary-info":this.secondaryInfoHidden()})}computeStyles(){const{scale:t}=this.config;return t?{"--mc-unit":40*t+"px"}:{}}initDefaultFanModeSource(){const t=this.fanModeConfig,e=Object.entries(t.source||{}).filter(t=>"__filter"!==t[0]),{entity:i}=this.climate;i&&0===e.length&&i.attributes&&i.attributes.fan_modes&&(t.source={...this.climate.defaultFanModes,...t.source||{}})}initDefaultHvacModeSource(){const t=this.config.hvac_mode,e=Object.entries(t.source||{}).filter(t=>"__filter"!==t[0]),{entity:i}=this.climate;i&&0===e.length&&(t.source={...this.climate.defaultHvacModes,...t.source||{}})}firstUpdated(t){super.firstUpdated(t),t.has("climate")&&(this.initDefaultFanModeSource(),this.initDefaultHvacModeSource(),this.requestUpdate("climate")),t.has("targetTemperature")&&(this.targetTemperatureValue=this.targetTemperature.value,this.requestUpdate("targetTemperatureValue"))}}),window.customCards=window.customCards||[],window.customCards.push({type:"mini-climate",name:"Mini Climate",preview:!0,description:"A custom climate card",documentationURL:"https://github.com/artem-sedykh/mini-climate-card",configurable:!0})});
}
/* <<< mini-climate-card (incluido) <<< */

console.info(`%c AC-ROOM-CARD %c v${VERSION} · mini-climate ${MINI_CLIMATE_BUNDLED} `,
  "color:white;background:#44739e;font-weight:700",
  "color:#44739e;background:white;font-weight:700");
