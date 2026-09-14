// Modos por escena/script/boton, botones de modo del termostato, idioma y
// el editor de piezas del rooms card. Suite aparte, con su propio shim.
function makeEl(tag) {
  const el = {
    tag, className: "", innerHTML: "", textContent: "",
    style: { _vars: {}, setProperty(k, v) { this._vars[k] = v; },
             getPropertyValue(k) { return this._vars[k]; } },
    children: [], _q: {}, _attrs: {}, dataset: {},
    remove() { this._removed = true; },
    appendChild(c) { this.children.push(c); if (c) c.parentNode = this; return c; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelector(sel) { return this._q[sel] || (this._q[sel] = makeEl("stub")); },
    addEventListener(ev, fn) { (this._ev = this._ev || {})[ev] = fn; },
    classList: { _s: new Set(), add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
  return el;
}
global.HTMLElement = class {
  attachShadow() { return (this.shadowRoot = makeEl("root")); }
  appendChild(c) { (this._hijos = this._hijos || []).push(c); return c; }
  dispatchEvent(ev) { (this._eventos = this._eventos || []).push(ev); }
};
global.CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
global.document = { createElement: makeEl, addEventListener() {}, removeEventListener() {} };
const DEFS = {};
global.customElements = { get: () => undefined, define: (n, c) => { DEFS[n] = c; } };
global.window = { customCards: [] };
require("../ac-room-card.js");

const CARD = DEFS["ac-room-card"];
const ROOMS = DEFS["ac-rooms-card"];
const ED = DEFS["ac-room-card-editor"];
const RED = DEFS["ac-rooms-card-editor"];

let fail = 0;
const ok = (n, c, got) => {
  console.log((c ? "  PASA  " : "  FALLA ") + n + (c ? "" : "   -> " + JSON.stringify(got)));
  if (!c) fail++;
};

const hace = (min) => new Date(Date.now() - min * 60000).toISOString();
const calls = [];
const hass = {
  language: "es",
  callService: (d, srv, data) => calls.push({ d, srv, data }),
  callWS: async () => ({ views: [{ path: "aires", cards: [
    { type: "custom:ac-room-card", name: "Dorm", entity: "climate.dorm", power_entity: "sensor.p" },
  ] }] }),
  states: {
    "climate.dorm":        { state: "off", attributes: { hvac_modes: ["off", "cool", "heat", "dry"], friendly_name: "Dorm" } },
    "climate.sin_modos":   { state: "off", attributes: {} },
    "scene.frio":          { state: hace(30), attributes: { friendly_name: "Living frío" } },
    "scene.calor":         { state: hace(10), attributes: {} },
    "scene.apagar":        { state: hace(20), attributes: {} },
    "script.frio":         { state: "off", attributes: { last_triggered: hace(5) } },
    "input_button.apagar": { state: hace(1), attributes: {} },
    "scene.nunca":         { state: "unknown", attributes: {} },
    "input_boolean.frio":  { state: "on", attributes: {} },
  },
};

(async () => {
  console.log("\n--- modos por escena, script y boton");
  const escenas = [{ name: "Frío", entity: "scene.frio" }, { name: "Calor", entity: "scene.calor" }];
  const mkC = (cfg) => { const c = new CARD(); c.setConfig(cfg); c._hass = hass; return c; };

  let c = mkC({ name: "Living", modes: escenas, off_entity: "scene.apagar" });
  ok("activo = la escena disparada mas reciente", c._activeMode() === 1, c._activeMode());
  c = mkC({ name: "Living", modes: escenas, off_entity: "input_button.apagar" });
  ok("si lo mas reciente es apagar, esta apagado", c._activeMode() === -1, c._activeMode());
  c = mkC({ name: "Living", modes: [{ entity: "script.frio" }, { entity: "scene.calor" }] });
  ok("el script usa last_triggered", c._activeMode() === 0, c._activeMode());
  c = mkC({ name: "Living", modes: [{ entity: "scene.nunca" }] });
  ok("escena sin disparar nunca: apagado", c._activeMode() === -1, c._activeMode());
  c = mkC({ name: "Mixto", modes: [{ entity: "scene.calor" }, { entity: "input_boolean.frio" }] });
  ok("un boolean prendido gana a una escena", c._activeMode() === 1, c._activeMode());

  c = mkC({ name: "Living", modes: escenas, off_entity: "scene.apagar" });
  calls.length = 0; c._setMode(0);
  ok("elegir una escena llama scene.turn_on", calls.length === 1 && calls[0].d === "scene" && calls[0].srv === "turn_on" && calls[0].data.entity_id === "scene.frio", calls);
  calls.length = 0; c._setMode(-1);
  ok("Apagado dispara off_entity", calls.length === 1 && calls[0].data.entity_id === "scene.apagar", calls);
  c = mkC({ name: "Living", modes: escenas, off_entity: "input_button.apagar" });
  calls.length = 0; c._setMode(-1);
  ok("un input_button se aprieta", calls[0].d === "input_button" && calls[0].srv === "press", calls);
  c = mkC({ name: "Living", modes: [{ entity: "script.frio" }] });
  calls.length = 0; c._setMode(0);
  ok("un script se corre con script.turn_on", calls[0].d === "script" && calls[0].srv === "turn_on", calls);
  c = mkC({ name: "Sw", modes: [{ entity: "switch.frio" }] });
  hass.states["switch.frio"] = { state: "on", attributes: {} };
  calls.length = 0; c._setMode(-1);
  ok("un switch se apaga con switch.turn_off (antes iba a input_boolean)", calls[0].d === "switch" && calls[0].srv === "turn_off", calls);

  console.log("\n--- botones de modo del termostato");
  let creado = null;
  global.window.loadCardHelpers = async () => ({
    createCardElement: async (cfg) => { creado = cfg; const e = makeEl("card"); e.shadowRoot = null; return e; },
  });
  const armar = async (cfg) => { creado = null; const k = mkC(cfg); await k._build(); return k; };
  await armar({ entity: "climate.dorm" });
  ok("el termostato trae la fila de modos", creado.features && creado.features[0].type === "climate-hvac-modes", creado);
  ok("con los modos que declara el equipo", JSON.stringify(creado.features[0].hvac_modes) === JSON.stringify(["off", "cool", "heat", "dry"]), creado.features);
  await armar({ entity: "climate.dorm", mode_buttons: false });
  ok("mode_buttons: false la quita", creado.features === undefined, creado);
  await armar({ entity: "climate.dorm", features: [{ type: "climate-fan-modes" }] });
  ok("features propios mandan", creado.features.length === 1 && creado.features[0].type === "climate-fan-modes", creado.features);
  await armar({ entity: "climate.sin_modos" });
  ok("equipo sin hvac_modes no inventa la fila", creado.features === undefined, creado);
  await armar({ entity: "climate.dorm", base_card: { type: "custom:otro" } });
  ok("a un base_card propio no se le agrega", creado.features === undefined, creado);

  console.log("\n--- idioma");
  const hassEn = { ...hass, language: "en" };
  const k = new CARD(); k.setConfig({ entity: "climate.dorm", labels: { today: "Hoy!" } });
  ok("sin hass parte en español", k._config.labels.schedule === "Programar", k._config.labels.schedule);
  k._render = () => {};
  k.hass = hassEn;
  ok("con HA en ingles pasa a ingles", k._config.labels.schedule === "Schedule", k._config.labels.schedule);
  ok("y conserva los labels propios", k._config.labels.today === "Hoy!", k._config.labels.today);
  ok("y obliga a reconstruir", k._built === false, k._built);
  k.hass = { ...hass, locale: { language: "es-CL" } };
  ok("es-CL vuelve a español", k._config.labels.schedule === "Programar", k._config.labels.schedule);

  const r = new ROOMS(); r.setConfig({ rooms: [{ entity: "climate.dorm" }] }); r._render = () => {};
  r.hass = hassEn;
  ok("el rooms card tambien cambia", r._config.labels.off === "Off", r._config.labels.off);
  try { new CARD().setConfig({}); ok("lanza", false, ""); }
  catch (e) { ok("el error sigue en español sin hass", /al menos una entidad/.test(e.message), e.message); }

  const esqEn = JSON.stringify(ED.buildSchema({ entity: "climate.dorm" }, "en"));
  ok("el esquema del editor sale en ingles", esqEn.includes("Home Assistant thermostat") && !esqEn.includes("Termostato"), esqEn);
  ok("y trae mode_buttons y mode_off_entity", esqEn.includes('"mode_buttons"') && esqEn.includes('"mode_off_entity"'), "");
  ok("los modos aceptan escenas y botones", esqEn.includes('"scene"') && esqEn.includes('"input_button"'), "");
  const nuevosModos = ED.fromForm({}, { base_view: "none", mode_cold_entity: "scene.frio" }, "en");
  ok("el nombre por defecto sale en ingles", nuevosModos.modes[0].name === "Cool", nuevosModos.modes);

  console.log("\n--- editor: mode_buttons y off_entity");
  const f0 = ED.toForm({ entity: "climate.dorm" });
  ok("mode_buttons parte prendido", f0.mode_buttons === true, f0);
  const sinBotones = ED.fromForm({ entity: "climate.dorm" }, { ...f0, mode_buttons: false });
  ok("apagarlo guarda false", sinBotones.mode_buttons === false, sinBotones);
  const conBotones = ED.fromForm(sinBotones, { ...ED.toForm(sinBotones), mode_buttons: true });
  ok("prenderlo quita la clave", conBotones.mode_buttons === undefined, conBotones);
  const conOff = ED.fromForm({ name: "L" }, { ...ED.toForm({ name: "L" }), mode_cold_entity: "scene.frio", mode_off_entity: "scene.apagar" });
  ok("off_entity se guarda", conOff.off_entity === "scene.apagar", conOff);
  ok("toForm lo devuelve al campo", ED.toForm(conOff).mode_off_entity === "scene.apagar", ED.toForm(conOff));
  const sinOff = ED.fromForm(conOff, { ...ED.toForm(conOff), mode_off_entity: undefined });
  ok("vaciarlo quita la clave", sinOff.off_entity === undefined, sinOff);
  const parcial = ED.fromForm(conOff, { name: "L" });
  ok("un form parcial no lo toca", parcial.off_entity === "scene.apagar", parcial);

  console.log("\n--- rooms card: piezas por escena");
  const mkR = (cfg) => { const x = new ROOMS(); x.setConfig(cfg); x._hass = hass; return x; };
  const living = { name: "Living", modes: escenas, off_entity: "scene.apagar" };
  let rc = mkR({ rooms: [living] });
  ok("pieza por escenas encendida", rc._encendida(living) === true, "");
  ok("con el modo de la escena", rc._hvac(living) === "heat", rc._hvac(living));
  calls.length = 0; rc._toggle(living);
  ok("el boton de la fila dispara apagar", calls.length === 1 && calls[0].data.entity_id === "scene.apagar", calls);
  const livingOff = { name: "Living", modes: escenas, off_entity: "input_button.apagar" };
  calls.length = 0; rc._toggle(livingOff);
  ok("apagada, prende el primer modo", calls.length === 1 && calls[0].data.entity_id === "scene.frio", calls);
  const sinApagar = { name: "X", modes: escenas };
  calls.length = 0; rc._toggle(sinApagar);
  ok("sin off_entity no hace una llamada sin sentido", calls.length === 0, calls);
  const vacia = { name: "Vacía" };
  calls.length = 0;
  try { rc._toggle(vacia); ok("pieza sin equipo no revienta", calls.length === 0, calls); }
  catch (e) { ok("pieza sin equipo no revienta", false, e.message); }

  console.log("\n--- editor del rooms card: piezas desde la UI");
  const e = new RED(); e._hass = hass;
  e.setConfig({ type: "custom:ac-rooms-card" });
  await new Promise((res) => setTimeout(res, 0));
  const op = await e._cargarOpciones();
  ok("guarda la config completa de lo encontrado", op.configs[0].power_entity === "sensor.p" && op.configs[0].type === undefined, op.configs);
  ok("en modo automatico el esquema ofrece excluir", JSON.stringify(e._esquema(op)).includes('"exclude"'), "");
  const ultimo = () => e._eventos[e._eventos.length - 1].detail.config;

  e._cambioGeneral(op, { rooms_mode: "manual" });
  await new Promise((res) => setTimeout(res, 0));
  ok("pasar a lista parte con las piezas encontradas", Array.isArray(ultimo().rooms) && ultimo().rooms[0].name === "Dorm", ultimo());
  ok("sin guardar rooms_mode", ultimo().rooms_mode === undefined, ultimo());
  ok("en lista ya no ofrece excluir", !JSON.stringify(e._esquema(op)).includes('"exclude"'), "");
  ok("dibuja un panel por pieza", e._lista && e._lista.length === 1, e._lista && e._lista.length);

  e._cambioPieza(0, { type: "custom:ac-room-card", name: "Dorm", entity: "climate.dorm", temp_entity: "sensor.t" });
  ok("editar una pieza la guarda sin type", ultimo().rooms[0].temp_entity === "sensor.t" && ultimo().rooms[0].type === undefined, ultimo().rooms);

  e._agregarPieza(op, "climate.sin_modos");
  ok("agregar suma la pieza", ultimo().rooms.length === 2 && ultimo().rooms[1].entity === "climate.sin_modos", ultimo().rooms);
  await new Promise((res) => setTimeout(res, 0));
  ok("y rehace los paneles", e._lista.length === 2, e._lista.length);
  e._agregarPieza(op, "scene.frio");
  const ir = ultimo().rooms[2];
  ok("agregar una escena crea una pieza IR con ese modo", ir.modes && ir.modes[0].entity === "scene.frio" && !ir.entity, ir);
  ok("con el nombre de la escena", ir.name === "Living frío", ir);

  e._quitarPieza(2); e._quitarPieza(1); e._quitarPieza(0);
  ok("quitar la ultima vuelve a buscarlas solas", ultimo().rooms === undefined, ultimo());

  e._agregarPieza(op, "climate.sin_modos");
  ok("agregar en modo automatico conserva las encontradas", ultimo().rooms.length === 2 && ultimo().rooms[0].name === "Dorm", ultimo().rooms);
  e._cambioGeneral(op, { rooms_mode: "auto" });
  ok("volver a automatico borra la lista", ultimo().rooms === undefined, ultimo());

  console.log(fail === 0 ? "\n=== TODO PASA ===" : `\n=== ${fail} FALLAS ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log("  FALLA con excepcion: " + (err && err.stack || err)); process.exit(1); });
