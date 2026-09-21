// La tarjeta completa se tine segun el modo en marcha, como las filas de la
// lista: asi se ve si el aire esta enfriando o calentando sin tocarlo.
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

const hace = (min) => new Date(Date.now() - min * 60000).toISOString();
const hass = {
  language: "es",
  callService() {},
  states: {
    "climate.dorm": { state: "cool", attributes: { hvac_modes: ["off", "cool", "heat", "dry"] } },
    "scene.aireliving23hotturbswing": { state: hace(1), attributes: { friendly_name: "AireLiving23hotTurbSwing" } },
    "scene.aireliving24hot": { state: hace(30), attributes: { friendly_name: "AireLiving24hot" } },
    "scene.airelivingcold": { state: hace(60), attributes: { friendly_name: "AireLivingCold" } },
    "scene.airelivingoff": { state: hace(90), attributes: {} },
  },
};

(async () => {
  global.window.loadCardHelpers = async () => ({
    createCardElement: async () => {
      const e = makeEl("card"); e.shadowRoot = null;
      e.style.removeProperty = function (k) { delete this._vars[k]; };
      return e;
    },
  });
  const armar = async (cfg) => {
    const c = new CARD(); c.setConfig(cfg); c._hass = hass;
    await c._build(); c._update();
    return c;
  };

  console.log("\n--- climate");
  const c = await armar({ entity: "climate.dorm" });
  ok("enfriando: celeste", c._cardEl.className === "root m-cool", c._cardEl.className);
  hass.states["climate.dorm"].state = "heat"; c._update();
  ok("calentando: naranjo", c._cardEl.className === "root m-heat", c._cardEl.className);
  hass.states["climate.dorm"].state = "dry"; c._update();
  ok("seco: verde", c._cardEl.className === "root m-dry", c._cardEl.className);
  hass.states["climate.dorm"].state = "off"; c._update();
  ok("apagado: sin tinte", c._cardEl.className === "root", c._cardEl.className);
  hass.states["climate.dorm"].state = "unavailable"; c._update();
  ok("no disponible: sin tinte", c._cardEl.className === "root", c._cardEl.className);
  hass.states["climate.dorm"].state = "cool";

  console.log("\n--- el icono de modo de mini-climate");
  // Lo que de verdad pinta sus iconos activos (probado en navegador contra
  // mini-climate 3.4.0): --state-binary_sensor-active-color. La 1.2.0 solo
  // ponia --mini-climate-accent-color, que a esos iconos no los toca.
  const acento = (k) => k._inner.style.getPropertyValue("--state-binary_sensor-active-color");
  c._update();
  ok("frio: azul", acento(c) === "var(--info-color, #039be5)", acento(c));
  ok("y el resto de sus acentos tambien",
     c._inner.style.getPropertyValue("--mini-climate-accent-color") === "var(--info-color, #039be5)", "");
  hass.states["climate.dorm"].state = "heat"; c._update();
  ok("calor: amarillo", acento(c) === "var(--amber-color, #ffc107)", acento(c));
  hass.states["climate.dorm"].state = "dry"; c._update();
  ok("seco: verde", acento(c) === "var(--success-color, #43a047)", acento(c));
  hass.states["climate.dorm"].state = "off"; c._update();
  ok("apagado: vuelve al color de mini-climate", acento(c) === undefined, acento(c));
  hass.states["climate.dorm"].state = "cool";
  const propio = await armar({ entity: "climate.dorm", base_card: { type: "custom:mini-climate" } });
  ok("tambien con un mini-climate escrito a mano (base_card)", acento(propio) === "var(--info-color, #039be5)", acento(propio));

  const sin = await armar({ entity: "climate.dorm", mode_color: false });
  ok("mode_color: false lo apaga", sin._cardEl.className === "root", sin._cardEl.className);
  ok("y deja el icono con su color de siempre", acento(sin) === undefined, acento(sin));

  console.log("\n--- aire por IR con escenas");
  const LIVING = { name: "Living", off_entity: "scene.airelivingoff", modes: [
    { name: "Modo 1", steps: ["scene.aireliving23hotturbswing", "scene.aireliving24hot"] },
    { name: "Modo 2", entity: "scene.airelivingcold" },
  ] };
  const ir = await armar(LIVING);
  ok("una escena 'hot' pinta de calefaccion, aunque el modo no se llame Calor", ir._cardEl.className === "root m-heat", ir._cardEl.className);
  hass.states["scene.airelivingcold"].state = hace(0);
  ir._update();
  ok("una 'Cold' pinta de frio", ir._cardEl.className === "root m-cool", ir._cardEl.className);
  hass.states["scene.airelivingoff"].state = new Date(Date.now() + 1000).toISOString();
  ir._update();
  ok("apagado por la escena de Apagar: sin tinte", ir._cardEl.className === "root", ir._cardEl.className);
  hass.states["scene.airelivingoff"].state = hace(90);
  hass.states["scene.airelivingcold"].state = hace(60);

  const declarado = await armar({ name: "X", modes: [{ name: "Raro", entity: "scene.aireliving24hot", hvac: "dry" }] });
  hass.states["scene.aireliving24hot"].state = hace(0);
  declarado._update();
  ok("`hvac` en el modo manda sobre el nombre", declarado._cardEl.className === "root m-dry", declarado._cardEl.className);

  console.log("\n--- la lista usa la misma regla");
  hass.states["scene.aireliving23hotturbswing"].state = new Date(Date.now() + 2000).toISOString();
  const r = new ROOMS(); r.setConfig({ rooms: [LIVING] }); r._hass = hass;
  ok("la fila de la lista tambien reconoce 'hot'", r._hvac(LIVING) === "heat", r._hvac(LIVING));

  console.log(fail === 0 ? "\n=== TODO PASA ===" : `\n=== ${fail} FALLAS ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log("  FALLA con excepcion: " + (err && err.stack || err)); process.exit(1); });
