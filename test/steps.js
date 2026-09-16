// Varias escenas por modo (una por temperatura) y las flechas para pasar
// entre ellas. Suite aparte, con su propio shim.
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
const ED = DEFS["ac-room-card-editor"];

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
  states: {
    "scene.calor_20": { state: hace(90), attributes: { friendly_name: "Living calor 20" } },
    "scene.calor_22": { state: hace(10), attributes: { friendly_name: "Living calor 22" } },
    "scene.calor_24": { state: hace(60), attributes: { friendly_name: "Living calor 24" } },
    "scene.frio":     { state: hace(300), attributes: { friendly_name: "Living frío" } },
    "scene.apagar":   { state: hace(120), attributes: {} },
    "scene.sin_num_a": { state: hace(5), attributes: { friendly_name: "Suave" } },
    "scene.sin_num_b": { state: hace(50), attributes: { friendly_name: "Fuerte" } },
  },
};
// Desordenadas a proposito: las flechas deben ir de menor a mayor.
const CALOR = { name: "Calor", icon: "mdi:fire", steps: ["scene.calor_24", "scene.calor_20", "scene.calor_22"] };
const FRIO = { name: "Frío", icon: "mdi:snowflake", entity: "scene.frio" };
const cfgBase = { name: "Living", modes: [FRIO, CALOR], off_entity: "scene.apagar" };

const mkC = (cfg) => {
  const c = new CARD(); c.setConfig(cfg); c._hass = hass;
  return c;
};
const armar = async (cfg) => {
  global.window.loadCardHelpers = async () => ({ createCardElement: async () => makeEl("card") });
  const c = mkC(cfg);
  await c._build();
  c._update();
  return c;
};

(async () => {
  console.log("\n--- modo y paso activos");
  let c = mkC(cfgBase);
  ok("el modo con varias escenas cuenta como activo", c._activeMode() === 1, c._activeMode());
  const modos = c._config.modes;
  ok("un modo solo con steps no se descarta", modos.length === 2, modos);

  console.log("\n--- flechas");
  c = await armar(cfgBase);
  const sp = c._stepper;
  ok("dibuja las flechas", !!sp, sp);
  ok("se ven con Calor en marcha", sp.style.display === "", sp.style.display);
  ok("muestra la temperatura del nombre de la escena", sp.querySelector(".sval").textContent === "22°", sp.querySelector(".sval").textContent);
  ok("ninguna flecha deshabilitada en el medio", !sp.querySelector(".sdown").disabled && !sp.querySelector(".sup").disabled, "");

  calls.length = 0; c._stepMode(1);
  ok("subir dispara la escena de 24 (orden por temperatura, no el de la lista)",
     calls.length === 1 && calls[0].d === "scene" && calls[0].data.entity_id === "scene.calor_24", calls);
  calls.length = 0; c._stepMode(-1);
  ok("bajar dispara la de 20", calls.length === 1 && calls[0].data.entity_id === "scene.calor_20", calls);

  hass.states["scene.calor_24"].state = hace(0);
  c._update();
  ok("en el tope se deshabilita subir", sp.querySelector(".sup").disabled === true, sp.querySelector(".sup").disabled);
  calls.length = 0; c._stepMode(1);
  ok("y subir no hace nada", calls.length === 0, calls);

  hass.states["scene.frio"].state = hace(-1 * 0.01);
  c._update();
  ok("con Frío (una sola escena) las flechas se esconden", sp.style.display === "none", sp.style.display);
  calls.length = 0; c._stepMode(1);
  ok("y no disparan nada", calls.length === 0, calls);

  hass.states["scene.apagar"].state = new Date(Date.now() + 1000).toISOString();
  c._update();
  ok("apagado, se esconden", sp.style.display === "none", sp.style.display);

  console.log("\n--- elegir el modo vuelve a su ultimo paso");
  hass.states["scene.apagar"].state = hace(500);
  hass.states["scene.frio"].state = hace(400);
  hass.states["scene.calor_20"].state = hace(30);
  hass.states["scene.calor_22"].state = hace(200);
  hass.states["scene.calor_24"].state = hace(100);
  calls.length = 0; c._setMode(1);
  ok("tocar Calor dispara la ultima usada (20)", calls.length === 1 && calls[0].data.entity_id === "scene.calor_20", calls);

  const nuevo = { name: "Nuevo", modes: [{ name: "Calor", steps: ["scene.nunca_22", "scene.nunca_20"] }] };
  hass.states["scene.nunca_22"] = { state: "unknown", attributes: { friendly_name: "x 22" } };
  hass.states["scene.nunca_20"] = { state: "unknown", attributes: { friendly_name: "x 20" } };
  calls.length = 0; mkC(nuevo)._setMode(0);
  ok("nunca usado: la mas baja", calls[0].data.entity_id === "scene.nunca_20", calls);

  console.log("\n--- temperatura explicita y nombres sin numero");
  const conTemp = { name: "T", modes: [{ name: "Calor", steps: [
    { entity: "scene.sin_num_a", temp: 19 }, { entity: "scene.sin_num_b", temp: 25 }] }] };
  c = await armar(conTemp);
  ok("temp explicita manda", c._stepper.querySelector(".sval").textContent === "19°", c._stepper.querySelector(".sval").textContent);
  const sinNum = { name: "S", modes: [{ name: "Calor", steps: ["scene.sin_num_b", "scene.sin_num_a"] }] };
  c = await armar(sinNum);
  ok("sin numeros se respeta el orden de la lista y se muestra el nombre",
     c._stepper.querySelector(".sval").textContent === "Suave", c._stepper.querySelector(".sval").textContent);
  calls.length = 0; c._stepMode(-1);
  ok("y bajar va al anterior de la lista", calls[0].data.entity_id === "scene.sin_num_b", calls);

  console.log("\n--- lista de piezas");
  hass.states["scene.calor_22"].state = hace(0);
  const r = new ROOMS(); r.setConfig({ rooms: [cfgBase] }); r._hass = hass;
  ok("la columna Target muestra la temperatura de la escena", r._temps(cfgBase).target === 22, r._temps(cfgBase));
  ok("la fila se pinta como calor", r._hvac(cfgBase) === "heat", r._hvac(cfgBase));
  ok("y existe (no sale gris)", r._existe(cfgBase) === true, "");
  hass.states["scene.apagar"].state = new Date(Date.now() + 1000).toISOString();
  ok("apagada, Target vacio", r._temps(cfgBase).target === null, r._temps(cfgBase));

  console.log("\n--- turbo: misma temperatura, marcada con T");
  Object.assign(hass.states, {
    "scene.v_24":       { state: hace(40), attributes: { friendly_name: "Living calor 24" } },
    "scene.v_24_turbo": { state: hace(1),  attributes: { friendly_name: "Living calor 24 Turbo" } },
    "scene.v_22":       { state: hace(60), attributes: { friendly_name: "Living calor 22" } },
    "scene.v_20_t":     { state: hace(90), attributes: { friendly_name: "Living calor 20 fuerte" } },
    "scene.v_off":      { state: hace(500), attributes: {} },
  });
  // La turbo va primero en la lista a proposito: el orden lo pone la temperatura.
  const TURBO = { name: "Turbo", modes: [{ name: "Calor", steps: ["scene.v_24_turbo", "scene.v_22", "scene.v_24"] }], off_entity: "scene.v_off" };
  c = await armar(TURBO);
  ok("reconoce Turbo en el nombre y pone la T", c._stepper.querySelector(".sval").textContent === "24° T", c._stepper.querySelector(".sval").textContent);
  ok("la turbo es el tope: subir deshabilitado", c._stepper.querySelector(".sup").disabled === true, "");
  calls.length = 0; c._stepMode(-1);
  ok("bajar desde 24 T va a 24 normal, no a 22", calls[0].data.entity_id === "scene.v_24", calls);

  hass.states["scene.v_24"].state = hace(0);
  c._update();
  ok("la normal se ve sin T", c._stepper.querySelector(".sval").textContent === "24°", c._stepper.querySelector(".sval").textContent);
  calls.length = 0; c._stepMode(1);
  ok("y subir desde 24 va a 24 T", calls[0].data.entity_id === "scene.v_24_turbo", calls);

  const rt = new ROOMS(); rt.setConfig({ rooms: [TURBO] }); rt._hass = hass;
  hass.states["scene.v_24_turbo"].state = new Date(Date.now() + 500).toISOString();
  const t3 = rt._temps(TURBO);
  ok("en la lista, Target sabe que es turbo", t3.target === 24 && t3.turbo === true, t3);

  const explicito = { name: "E", modes: [{ name: "Calor", steps: [
    { entity: "scene.v_20_t", turbo: true }, { entity: "scene.v_22" }] }] };
  hass.states["scene.v_20_t"].state = new Date(Date.now() + 1000).toISOString();
  c = await armar(explicito);
  ok("turbo: true sin la palabra en el nombre tambien pone la T", c._stepper.querySelector(".sval").textContent === "20° T", c._stepper.querySelector(".sval").textContent);
  hass.states["scene.v_22"].state = new Date(Date.now() + 2000).toISOString();
  c._update();
  ok("y un paso sin la palabra ni turbo: true queda sin T", c._stepper.querySelector(".sval").textContent === "22°", c._stepper.querySelector(".sval").textContent);

  console.log("\n--- nombres pegados y abreviados, como en el HA del usuario");
  Object.assign(hass.states, {
    "scene.aireliving23hot":          { state: hace(50), attributes: { friendly_name: "AireLiving23hot" } },
    "scene.aireliving23hotswing":     { state: hace(40), attributes: { friendly_name: "AireLiving23hotSwing" } },
    "scene.aireliving23hotturb":      { state: hace(30), attributes: { friendly_name: "AireLiving23hotTurb" } },
    "scene.aireliving23hotturbswing": { state: hace(0),  attributes: { friendly_name: "AireLiving23hotTurbSwing" } },
    "scene.aireliving24hot":          { state: hace(60), attributes: { friendly_name: "AireLiving24hot" } },
    "scene.airelivingoff":            { state: hace(900), attributes: {} },
  });
  const PEGADO = { name: "Living", off_entity: "scene.airelivingoff", modes: [{ name: "Heat", steps: [
    "scene.aireliving24hot", "scene.aireliving23hotturbswing", "scene.aireliving23hot",
    "scene.aireliving23hotturb", "scene.aireliving23hotswing"] }] };
  c = await armar(PEGADO);
  ok("'Turb' abreviado y pegado cuenta como turbo, y Swing como S",
     c._stepper.querySelector(".sval").textContent === "23° TS", c._stepper.querySelector(".sval").textContent);
  calls.length = 0; c._stepMode(-1);
  ok("bajar desde 23 TS va a 23 T", calls[0].data.entity_id === "scene.aireliving23hotturb", calls);
  calls.length = 0; c._stepMode(1);
  ok("subir desde 23 TS va a 24", calls[0].data.entity_id === "scene.aireliving24hot", calls);
  hass.states["scene.aireliving23hotswing"].state = new Date(Date.now() + 500).toISOString();
  c._update();
  ok("23 con swing solo se ve 23° S", c._stepper.querySelector(".sval").textContent === "23° S", c._stepper.querySelector(".sval").textContent);
  calls.length = 0; c._stepMode(-1);
  ok("y bajar va a 23 normal", calls[0].data.entity_id === "scene.aireliving23hot", calls);
  const rp = new ROOMS(); rp.setConfig({ rooms: [PEGADO] }); rp._hass = hass;
  ok("en la lista las marcas van pegadas al numero", rp._temps(PEGADO).marcas === "S" && rp._temps(PEGADO).target === 23, rp._temps(PEGADO));

  console.log("\n--- editor");
  const f = ED.toForm(cfgBase);
  ok("frío va como lista de una", JSON.stringify(f.mode_cold_entity) === '["scene.frio"]', f.mode_cold_entity);
  ok("calor va con sus tres escenas", f.mode_heat_entity.length === 3, f.mode_heat_entity);
  const esq = JSON.stringify(ED.buildSchema(cfgBase));
  ok("pide la temperatura de cada escena de calor", esq.includes("mode_heat_temp_2") && !esq.includes("mode_cold_temp_"), esq);

  const conTemps = ED.fromForm(cfgBase, { ...f, mode_heat_temp_0: 24, mode_heat_temp_1: 20 });
  ok("guarda steps con temp", conTemps.modes[1].steps[0].temp === 24 && conTemps.modes[1].steps[1].temp === 20, conTemps.modes[1]);
  ok("la sin temp queda como entity_id suelto", conTemps.modes[1].steps[2] === "scene.calor_22", conTemps.modes[1]);
  ok("conserva nombre e icono del modo", conTemps.modes[1].name === "Calor" && conTemps.modes[1].icon === "mdi:fire", conTemps.modes[1]);
  ok("los campos de temperatura no quedan en la config", Object.keys(conTemps).every((k) => !/_temp_/.test(k)), Object.keys(conTemps));
  const ida = ED.toForm(conTemps);
  ok("toForm devuelve las temperaturas a sus campos", ida.mode_heat_temp_0 === 24 && ida.mode_heat_temp_1 === 20, ida);

  const agrega = ED.fromForm(cfgBase, { ...f, mode_cold_entity: ["scene.frio", "scene.calor_20"] });
  ok("agregar una segunda escena a frío lo pasa a steps", Array.isArray(agrega.modes[0].steps) && agrega.modes[0].entity === undefined, agrega.modes[0]);
  const quita = ED.fromForm(conTemps, { ...ida, mode_heat_entity: ["scene.calor_22"] });
  ok("dejar una sola escena vuelve a entity", quita.modes[1].entity === "scene.calor_22" && !quita.modes[1].steps, quita.modes[1]);
  const reordena = ED.fromForm(conTemps, { ...ida, mode_heat_entity: ["scene.calor_20", "scene.calor_24", "scene.calor_22"] });
  const t24 = reordena.modes[1].steps.find((p) => p.entity === "scene.calor_24");
  ok("si cambia la lista, la temperatura sigue a su escena", t24 && t24.temp === 24, reordena.modes[1].steps);

  console.log(fail === 0 ? "\n=== TODO PASA ===" : `\n=== ${fail} FALLAS ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log("  FALLA con excepcion: " + (err && err.stack || err)); process.exit(1); });
