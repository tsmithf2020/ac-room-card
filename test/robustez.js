// Lo que encontro la revision contra el Home Assistant real: un climate
// caido al montar la tarjeta, restos de una reconstruccion, timers que
// quedaban vivos, piezas dentro de un conditional y el selector duplicado.
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
  appendChild(c) { return c; }
  dispatchEvent() {}
};
global.CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
global.document = { createElement: makeEl, addEventListener() {}, removeEventListener() {} };
const DEFS = {};
global.customElements = { get: () => undefined, define: (n, c) => { DEFS[n] = c; } };
global.window = { customCards: [] };
require("../ac-room-card.js");

const CARD = DEFS["ac-room-card"];
const ROOMS = DEFS["ac-rooms-card"];

let fail = 0;
const ok = (n, c, got) => {
  console.log((c ? "  PASA  " : "  FALLA ") + n + (c ? "" : "   -> " + JSON.stringify(got)));
  if (!c) fail++;
};

const caido = { state: "unavailable", attributes: { friendly_name: "Oficina" } };
const vivo = { state: "cool", attributes: { friendly_name: "Oficina", hvac_modes: ["off", "cool", "heat"],
  fan_modes: ["low", "high"], fan_mode: "low" } };
const hass = { language: "es", callService() {}, states: { "climate.aire_oficina": caido } };

(async () => {
  const creados = [];
  global.window.loadCardHelpers = async () => ({
    createCardElement: async (cfg) => { creados.push(cfg); const e = makeEl("card"); e.shadowRoot = null; return e; },
  });

  console.log("\n--- climate caido al montar la tarjeta");
  const c = new CARD();
  c.setConfig({ entity: "climate.aire_oficina", fan_mode: true });
  c._hass = hass;
  await c._render();
  ok("montada con el equipo caido: sin botones de modo", creados.length === 1 && creados[0].features === undefined, creados[0]);
  ok("ni selector de velocidad", !c._fanModeEl, !!c._fanModeEl);

  hass.states["climate.aire_oficina"] = vivo;
  await c._render();
  ok("cuando vuelve, se reconstruye sola", creados.length === 2, creados.length);
  ok("con los botones de modo", creados[1].features && creados[1].features[0].type === "climate-hvac-modes" &&
     creados[1].features[0].hvac_modes.length === 3, creados[1].features);
  ok("y el selector de velocidad", !!c._fanModeEl, !!c._fanModeEl);

  await c._render();
  ok("con el equipo igual no se vuelve a construir", creados.length === 2, creados.length);

  hass.states["climate.aire_oficina"] = caido;
  await c._render();
  ok("si se cae otra vez, deja lo dibujado (no parpadea)", creados.length === 2 && !!c._fanModeEl, creados.length);

  hass.states["climate.aire_oficina"] = { ...vivo, attributes: { ...vivo.attributes, hvac_modes: ["off", "cool"] } };
  await c._render();
  ok("si cambian los modos que declara, se reconstruye", creados.length === 3 && creados[2].features[0].hvac_modes.length === 2, creados.length);

  console.log("\n--- la firma solo mira lo que se usa");
  const compacta = new CARD();
  compacta.setConfig({ entity: "climate.aire_oficina", base_view: "compact" });
  compacta._hass = { ...hass, states: { "climate.aire_oficina": vivo } };
  ok("vista compacta sin fan_mode: nada que vigilar", compacta._firmaEquipo() === "", compacta._firmaEquipo());
  const propios = new CARD();
  propios.setConfig({ entity: "climate.aire_oficina", features: [{ type: "climate-fan-modes" }] });
  propios._hass = compacta._hass;
  ok("con features propios tampoco", propios._firmaEquipo() === "", propios._firmaEquipo());
  const sinBotones = new CARD();
  sinBotones.setConfig({ entity: "climate.aire_oficina", mode_buttons: false });
  sinBotones._hass = compacta._hass;
  ok("ni con mode_buttons: false", sinBotones._firmaEquipo() === "", sinBotones._firmaEquipo());

  console.log("\n--- una reconstruccion no deja restos");
  hass.states["climate.aire_oficina"] = vivo;
  hass.states["fan.techo"] = { state: "on", attributes: {} };
  hass.states["input_boolean.verano"] = { state: "on", attributes: {} };
  const r = new CARD();
  r.setConfig({ entity: "climate.aire_oficina", fans: ["fan.techo"], automations: ["input_boolean.verano"] });
  r._hass = hass;
  await r._render();
  ok("primero con ventilador y automatizacion", r._fanBtns.length === 1 && r._autoBtns.length === 1, "");
  r.setConfig({ entity: "climate.aire_oficina" });
  // setConfig lanza su propia reconstruccion (async): se la deja terminar.
  await new Promise((res) => setTimeout(res, 0));
  await r._render();
  ok("sin ellos, no quedan botones colgando", r._fanBtns === undefined && r._autoBtns === undefined, [r._fanBtns, r._autoBtns]);
  ok("ni se cree que la linea tiene botones", r._rows.power.style.display === "none", r._rows.power.style.display);

  console.log("\n--- el enchufe armado no queda vivo");
  r._pwArmado = true;
  r._pwTimer = setTimeout(() => { throw new Error("no debia correr"); }, 50);
  r.disconnectedCallback();
  ok("al desmontar se suelta", r._pwTimer === null && r._pwArmado === false, [r._pwTimer, r._pwArmado]);
  const lista = new ROOMS();
  lista.setConfig({ rooms: [{ entity: "climate.aire_oficina", power_switch: "switch.x" }] });
  lista._hass = hass; lista._piezas = lista._config.rooms; lista._build();
  const plug = lista._filas[0].fila.querySelector(".plug");
  plug._armado = true;
  plug._tmr = setTimeout(() => { throw new Error("no debia correr"); }, 50);
  lista.disconnectedCallback();
  ok("tambien el de cada fila de la lista", plug._tmr === null && plug._armado === false, [plug._tmr, plug._armado]);

  console.log("\n--- piezas dentro de un conditional");
  const lov = { views: [{ path: "aires", cards: [
    { type: "conditional", conditions: [], card: { type: "custom:ac-room-card", name: "Condicional", entity: "climate.a" } },
    { type: "vertical-stack", cards: [{ type: "custom:ac-room-card", name: "En pila", entity: "climate.b" }] },
  ] }] };
  const d = new ROOMS(); d.setConfig({}); d._hass = { ...hass, callWS: async () => lov };
  const piezas = await d._descubrir();
  ok("encuentra la que esta dentro de un conditional", piezas.some((p) => p.name === "Condicional"), piezas.map((p) => p.name));
  ok("y sigue encontrando las de una pila", piezas.some((p) => p.name === "En pila"), piezas.map((p) => p.name));

  console.log("\n--- el selector de tarjetas no se duplica");
  delete require.cache[require.resolve("../ac-room-card.js")];
  require("../ac-room-card.js");
  const cuenta = (t) => global.window.customCards.filter((x) => x.type === t).length;
  ok("cargar el archivo dos veces deja una sola AC Room Card", cuenta("ac-room-card") === 1, cuenta("ac-room-card"));
  ok("y una sola AC Rooms Card", cuenta("ac-rooms-card") === 1, cuenta("ac-rooms-card"));

  console.log("\n--- una tarjeta solo con automatizaciones es valida");
  let err = null;
  try { new CARD().setConfig({ name: "Solo auto", automations: ["input_boolean.verano"] }); } catch (e) { err = e; }
  ok("no pide equipo ni sensores", err === null, err && err.message);

  console.log(fail === 0 ? "\n=== TODO PASA ===" : `\n=== ${fail} FALLAS ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log("  FALLA con excepcion: " + (err && err.stack || err)); process.exit(1); });
