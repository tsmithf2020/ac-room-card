// base_view: la vista de arriba elegible desde el editor visual.
// Va aparte porque necesita cambiar que elementos "estan instalados" y
// esperar a _build(), que es async.
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
global.HTMLElement = class { attachShadow() { return (this.shadowRoot = makeEl("root")); } };
global.document = { createElement: makeEl, addEventListener() {}, removeEventListener() {} };
const DEFS = {};
const instalados = new Set();
global.customElements = {
  get: (n) => (instalados.has(n) ? class {} : undefined),
  define: (n, c) => { DEFS[n] = c; },
};
global.window = { customCards: [] };
require("../ac-room-card.js");

const CARD = DEFS["ac-room-card"];
const ROOMS = DEFS["ac-rooms-card"];
const ED = DEFS["ac-room-card-editor"];

let fail = 0;
const ok = (n, c, got) => {
  console.log((c ? "  PASA  " : "  FALLA ") + n + (c ? "" : "   -> " + JSON.stringify(got)));
  if (!c) fail++;
};

const hass = { states: { "climate.dorm": { state: "cool", attributes: {} } }, callService() {} };
let creado = null;
global.window.loadCardHelpers = async () => ({
  createCardElement: async (cfg) => { creado = cfg; const e = makeEl("card"); e.shadowRoot = null; return e; },
});
const armar = async (cfg) => {
  creado = null;
  const k = new CARD(); k.setConfig(cfg); k._hass = hass;
  await k._build();
  return k;
};

(async () => {
  console.log("\n--- getStubConfig");
  ok("sin mini-climate no propone vista", CARD.getStubConfig(null, ["climate.dorm"]).base_view === undefined,
     CARD.getStubConfig(null, ["climate.dorm"]));
  instalados.add("mini-climate");
  ok("con mini-climate propone la compacta", CARD.getStubConfig(null, ["climate.dorm"]).base_view === "compact",
     CARD.getStubConfig(null, ["climate.dorm"]));
  ok("el rooms card tambien", ROOMS.getStubConfig(null, ["climate.dorm"]).base_view === "compact",
     ROOMS.getStubConfig(null, ["climate.dorm"]));

  console.log("\n--- _build con base_view");
  let k = await armar({ entity: "climate.dorm", name: "Dormitorio", decimals: 1, base_view: "compact" });
  ok("compacta envuelve mini-climate", creado && creado.type === "custom:mini-climate", creado);
  ok("con la entidad del card", creado.entity === "climate.dorm", creado);
  ok("no repite el nombre", creado.name === " ", creado.name);
  ok("fan_mode en la linea principal", creado.fan_mode.location === "main" && creado.fan_mode.hide === false, creado.fan_mode);
  ok("temperatura con los decimales del card", creado.temperature.fixed === 1, creado.temperature);
  ok("trae el CSS de Target / Actual", /Target/.test((k._innerStyle || {})["mc-temperature"]), k._innerStyle);
  ok("y el ajuste de padding del card", /mc-climate/.test((k._innerStyle || {})[""]), k._innerStyle);

  k = await armar({ entity: "climate.dorm", decimals: 0, base_view: "compact" });
  ok("sin name deja que mini-climate muestre el suyo", creado.name === undefined, creado.name);
  ok("decimals 0 llega como fixed 0", creado.temperature.fixed === 0, creado.temperature);

  k = await armar({ entity: "climate.dorm", base_view: "compact", base_card_style: { "": "a{}" } });
  ok("un base_card_style propio reemplaza el de la vista", k._innerStyle[""] === "a{}" && !k._innerStyle["mc-temperature"], k._innerStyle);

  k = await armar({ entity: "climate.dorm", base_view: "compact", base_card: { type: "custom:otro" } });
  ok("base_card escrito a mano gana", creado.type === "custom:otro", creado);
  ok("y no le pone el CSS de mini-climate", k._innerStyle === null, k._innerStyle);

  k = await armar({ entity: "climate.dorm", base_view: "none" });
  ok("none no crea card arriba", creado === null && k._inner === null, creado);

  k = await armar({ entity: "climate.dorm", base_view: "thermostat" });
  ok("thermostat usa el integrado", creado && creado.type === "thermostat", creado);

  k = await armar({ entity: "climate.dorm" });
  ok("sin base_view sigue el integrado", creado && creado.type === "thermostat", creado);

  instalados.delete("mini-climate");
  k = await armar({ entity: "climate.dorm", base_view: "compact" });
  ok("sin mini-climate cae al termostato", creado && creado.type === "thermostat", creado);
  ok("y no inyecta CSS", k._innerStyle === null, k._innerStyle);
  instalados.add("mini-climate");

  console.log("\n--- editor");
  ok("toForm: base_card propio -> custom", ED.toForm({ base_card: { type: "custom:mini-climate" } }).base_view === "custom", "");
  ok("toForm: base_card false -> none", ED.toForm({ base_card: false }).base_view === "none", "");
  ok("toForm: nada -> thermostat", ED.toForm({ entity: "climate.dorm" }).base_view === "thermostat", "");
  ok("toForm: compact -> compact", ED.toForm({ base_view: "compact" }).base_view === "compact", "");

  const propio = { type: "custom:ac-room-card", entity: "climate.dorm",
    base_card: { type: "custom:mini-climate", group: true }, base_card_style: { "": "x{}" } };
  const igual = ED.fromForm(propio, ED.toForm(propio));
  ok("ida y vuelta conserva el base_card propio", igual.base_card && igual.base_card.group === true, igual);
  ok("y su CSS", igual.base_card_style && igual.base_card_style[""] === "x{}", igual);
  ok("sin escribir base_view", igual.base_view === undefined, igual);

  const aCompacta = ED.fromForm(propio, { ...ED.toForm(propio), base_view: "compact" });
  ok("pasar a compacta guarda base_view", aCompacta.base_view === "compact", aCompacta);
  ok("y quita el base_card propio", aCompacta.base_card === undefined, aCompacta);
  ok("y el CSS que era de ese card", aCompacta.base_card_style === undefined, aCompacta);

  const nueva = { type: "custom:ac-room-card", entity: "climate.dorm", base_view: "compact" };
  const aTermo = ED.fromForm(nueva, { ...ED.toForm(nueva), base_view: "thermostat" });
  ok("thermostat es el default y no se guarda", aTermo.base_view === undefined, aTermo);
  const aNada = ED.fromForm(nueva, { ...ED.toForm(nueva), base_view: "none" });
  ok("none se guarda", aNada.base_view === "none", aNada);
  const sinCampo = ED.fromForm(propio, { entity: "climate.dorm" });
  ok("un form sin el campo no toca la vista", !!sinCampo.base_card, sinCampo);

  const esq = JSON.stringify(ED.buildSchema({ entity: "climate.dorm" }));
  ok("el esquema trae el selector", esq.includes('"base_view"'), esq);
  ok("sin base_card no ofrece 'card propio'", !esq.includes('"custom"'), esq);
  ok("con base_card si lo ofrece", JSON.stringify(ED.buildSchema(propio)).includes('"custom"'), "");

  console.log("\n--- popup del rooms card");
  const popup = async (lista, pieza) => {
    const r = new ROOMS(); r.setConfig({ ...lista, rooms: [pieza] }); r._hass = hass;
    creado = null;
    await r._openPopup(pieza);
    r._closePopup();
    return creado;
  };
  let p = await popup({ base_view: "compact" }, { entity: "climate.dorm", name: "Dorm" });
  ok("la pieza hereda la vista de la lista", p.base_view === "compact", p);
  p = await popup({ base_view: "compact" }, { entity: "climate.dorm", base_view: "none" });
  ok("pero no pisa la suya", p.base_view === "none", p);
  p = await popup({ base_view: "compact" }, { entity: "climate.dorm", base_card: { type: "custom:otro" } });
  ok("ni se la agrega a una con base_card", p.base_view === undefined, p);
  p = await popup({}, { entity: "climate.dorm" });
  ok("sin vista en la lista no inventa nada", p.base_view === undefined, p);

  console.log(fail === 0 ? "\n=== TODO PASA ===" : `\n=== ${fail} FALLAS ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("  FALLA con excepcion: " + (e && e.stack || e)); process.exit(1); });
