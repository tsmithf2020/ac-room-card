// Automatizaciones: lo que maneja el aire por su cuenta (la automatizacion
// misma, o el boolean que la habilita, tipo "Control Verano"). Antes se
// metian en `fans` y giraban como un ventilador. Suite aparte, con su shim.
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
    "climate.dorm": { state: "cool", attributes: { hvac_modes: ["off", "cool"] } },
    "input_boolean.control_verano_dorm": { state: "on", last_changed: hace(90), attributes: { friendly_name: "Control Verano Dorm" } },
    "automation.verano_dorm": { state: "on", attributes: { friendly_name: "Verano Dorm", last_triggered: hace(5), current: 0 } },
    "automation.corriendo": { state: "on", attributes: { friendly_name: "Corriendo", last_triggered: hace(0), current: 1 } },
    "automation.apagada": { state: "off", attributes: { friendly_name: "Apagada", last_triggered: null, current: 0 } },
    "fan.vent_ts": { state: "on", attributes: { friendly_name: "Ventilador Dorm" } },
    "sensor.pot": { state: "12", attributes: { unit_of_measurement: "W" } },
  },
};

// Tal como la tiene el usuario hoy: el boolean metido en `fans`.
const VIEJA = {
  type: "custom:ac-room-card", entity: "climate.dorm", name: "Dormitorio", power_entity: "sensor.pot",
  fans: [
    { entity: "input_boolean.control_verano_dorm", name: "Control Verano", icon: "mdi:white-balance-sunny",
      position: "start", color: "var(--warning-color, #ff9800)" },
    "fan.vent_ts",
  ],
};

(async () => {
  global.window.loadCardHelpers = async () => ({
    createCardElement: async () => { const e = makeEl("card"); e.shadowRoot = null; return e; },
  });
  const armar = async (cfg) => {
    const c = new CARD(); c.setConfig(cfg); c._hass = hass;
    await c._build(); c._update();
    return c;
  };

  console.log("\n--- una config de antes se dibuja bien sin volver a guardarla");
  let c = await armar(VIEJA);
  ok("el boolean de `fans` se dibuja como automatizacion", c._autoBtns && c._autoBtns.length === 1, c._autoBtns && c._autoBtns.length);
  ok("y el ventilador sigue siendo ventilador", c._fanBtns && c._fanBtns.length === 1 && c._fanBtns[0].dataset.entity === "fan.vent_ts", "");
  const b = c._autoBtns[0];
  ok("activa: clase on, sin girar", b.className === "auto on", b.className);
  ok("con su color propio", b.style.color === "var(--warning-color, #ff9800)", b.style.color);
  ok("va al principio de la linea (position: start)", c._rows.power.querySelector(".preslot").children.includes(b), "");
  ok("el tooltip dice que esta activa y desde cuando", /Control Verano: activa · desde hace 90 min/.test(b.title), b.title);
  calls.length = 0; b._ev.click({ stopPropagation() {} });
  ok("tocarla la activa o desactiva", calls.length === 1 && calls[0].d === "homeassistant" && calls[0].srv === "toggle" &&
     calls[0].data.entity_id === "input_boolean.control_verano_dorm", calls);

  hass.states["input_boolean.control_verano_dorm"].state = "off";
  c._update();
  ok("desactivada: gris y sin color propio", b.className === "auto off" && b.style.color === "", [b.className, b.style.color]);
  hass.states["input_boolean.control_verano_dorm"].state = "on";

  console.log("\n--- automatizaciones de verdad");
  c = await armar({ entity: "climate.dorm", automations: ["automation.verano_dorm", "automation.corriendo", "automation.apagada", "automation.no_existe"] });
  const [a1, a2, a3, a4] = c._autoBtns;
  ok("activa, con la ultima vez que corrio", a1.className === "auto on" && /Verano Dorm: activa · última vez: hace 5 min/.test(a1.title), [a1.className, a1.title]);
  ok("corriendo ahora: late", a2.className === "auto run" && /corriendo ahora/.test(a2.title), [a2.className, a2.title]);
  ok("desactivada y nunca corrida", a3.className === "auto off" && /desactivada · última vez: nunca/.test(a3.title), [a3.className, a3.title]);
  ok("la que no existe queda como no disponible", a4.className === "auto na", a4.className);
  ok("sin position van al principio", c._rows.power.querySelector(".preslot").children.length === 4, "");
  ok("icono por defecto de robot", /mdi:robot-outline/.test(a1.innerHTML), a1.innerHTML);
  ok("la linea se muestra aunque no haya sensores", c._rows.power.style.display === "", c._rows.power.style.display);

  const cEn = new CARD(); cEn.setConfig({ entity: "climate.dorm", automations: ["automation.verano_dorm"] });
  cEn._hass = { ...hass, language: "en" }; cEn._lang = "en";
  cEn._config = { ...cEn._config, labels: { ...cEn._config.labels, autoOn: "enabled", autoLast: "last run" } };
  await cEn._build(); cEn._update();
  ok("en ingles", /Verano Dorm: enabled · last run: 5 min ago/.test(cEn._autoBtns[0].title), cEn._autoBtns[0].title);

  console.log("\n--- lista de piezas");
  const r = new ROOMS(); r.setConfig({ rooms: [VIEJA] }); r._hass = hass; r._piezas = [VIEJA]; r._build(); r._update();
  const btns = r._filas[0].btns;
  ok("en la lista, la automatizacion va antes que el ventilador", btns[0].dataset.kind === "auto" && btns[1].dataset.entity === "fan.vent_ts", btns.map((x) => x.dataset.entity));
  ok("con su clase propia (no gira)", btns[0].className === "rfan rauto on", btns[0].className);
  ok("y el ventilador sigue igual", btns[1].className === "rfan on", btns[1].className);
  ok("la columna reserva sitio para las dos", r._filas[0].fila.parentNode.style.getPropertyValue("--acrc-fans") === "2",
     r._filas[0].fila.parentNode.style.getPropertyValue("--acrc-fans"));

  console.log("\n--- editor: seccion propia y la mudanza desde Ventiladores");
  const f = ED.toForm(VIEJA);
  ok("Ventiladores ya no muestra el boolean", JSON.stringify(f.fans) === '["fan.vent_ts"]', f.fans);
  ok("Automatizaciones si", JSON.stringify(f.automations) === '["input_boolean.control_verano_dorm"]', f.automations);
  ok("con su nombre en su campo", f.auto_name_0 === "Control Verano" && f.fan_name_0 === "", f);
  const guardada = ED.fromForm(VIEJA, f);
  ok("al guardar, sale de `fans`", JSON.stringify(guardada.fans) === '["fan.vent_ts"]', guardada.fans);
  const au = guardada.automations && guardada.automations[0];
  ok("y queda en `automations` con nombre, icono, color y posicion",
     au && au.entity === "input_boolean.control_verano_dorm" && au.name === "Control Verano" &&
     au.icon === "mdi:white-balance-sunny" && au.color === "var(--warning-color, #ff9800)" && au.position === "start", au);
  ok("sin campos del form en la config", Object.keys(guardada).every((k) => !/_name_/.test(k)), Object.keys(guardada));
  const renombrada = ED.fromForm(guardada, { ...ED.toForm(guardada), auto_name_0: "Verano" });
  ok("renombrar la automatizacion", renombrada.automations[0].name === "Verano" && renombrada.automations[0].icon === "mdi:white-balance-sunny", renombrada.automations[0]);
  const sinAutos = ED.fromForm(guardada, { ...ED.toForm(guardada), automations: [] });
  ok("vaciar la lista quita la clave", sinAutos.automations === undefined, sinAutos);
  const parcial = ED.fromForm(VIEJA, { fans: ["input_boolean.control_verano_dorm", "fan.vent_ts"] });
  ok("una llamada parcial no muda nada", parcial.automations === undefined && parcial.fans.length === 2, parcial);
  const renFan = ED.fromForm(guardada, { ...ED.toForm(guardada), fan_name_0: "Techo" });
  ok("renombrar el ventilador no toca la automatizacion", renFan.fans[0].name === "Techo" && renFan.automations[0].name === "Control Verano", renFan);
  const colorFan = ED.fromForm({ fans: [{ entity: "fan.vent_ts", color: "red", position: "start" }] },
    { ...ED.toForm({ fans: [{ entity: "fan.vent_ts", color: "red", position: "start" }] }) });
  ok("editar ya no borra el color ni la posicion de un ventilador", colorFan.fans[0].color === "red" && colorFan.fans[0].position === "start", colorFan.fans);

  const esq = ED.buildSchema(VIEJA, "es");
  const sec = esq.find((s) => s.icon === "mdi:robot-outline");
  ok("hay seccion Automatizaciones", !!sec && sec.title === "Automatizaciones", sec && sec.title);
  ok("abierta, porque ya tiene una", sec.expanded === true, sec.expanded);
  ok("con su explicacion", /Control Verano/.test(sec.help || ""), sec.help);
  ok("y el nombre de la automatizacion dentro", JSON.stringify(sec.schema).includes("auto_name_0"), "");
  ok("el selector acepta automation, input_boolean y script",
     /"domain":\["automation","input_boolean","script"\]/.test(JSON.stringify(sec.schema)), JSON.stringify(sec.schema));

  console.log(fail === 0 ? "\n=== TODO PASA ===" : `\n=== ${fail} FALLAS ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log("  FALLA con excepcion: " + (err && err.stack || err)); process.exit(1); });
