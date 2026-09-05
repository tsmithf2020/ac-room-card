// Shim minimo de DOM para ejercitar la logica del card sin navegador.
function makeEl(tag) {
  const el = {
    tag, className: "", innerHTML: "", textContent: "",
    style: {}, children: [], _q: {}, _attrs: {},
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelector(sel) { return this._q[sel] || (this._q[sel] = makeEl("stub")); },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
  };
  el.classList = { ...el.classList, _s: new Set() };
  return el;
}
global.HTMLElement = class { attachShadow() { return (this.shadowRoot = makeEl("root")); } };
global.document = { createElement: makeEl };
let CARD = null;
global.customElements = { get: () => undefined, define: (n, c) => { CARD = c; } };
global.window = { customCards: [] };

require("../ac-room-card.js");

const hass = {
  states: {
    "climate.dorm":            { state: "cool",  attributes: {} },
    "sensor.pot":              { state: "1234",  attributes: { unit_of_measurement: "W" } },
    "sensor.hoy":              { state: "0.85",  attributes: { unit_of_measurement: "kWh" } },
    "sensor.mes":              { state: "12.34", attributes: { unit_of_measurement: "kWh" } },
    "binary_sensor.ventana":   { state: "on",    attributes: {} },
    "sensor.caido":            { state: "unavailable", attributes: {} },
  },
};

function mk(cfg) {
  const c = new CARD();
  c.setConfig(cfg);
  c._hass = hass;
  // Simulamos lo que arma _build(), sin loadCardHelpers.
  const f = makeEl("div");
  c._rows = {
    power:  c._addRow(f, "mdi:flash", "Potencia"),
    energy: c._addRow(f, "mdi:x", "Hoy"),
    window: c._addRow(f, "mdi:window-closed-variant", "Ventana"),
    warn:   makeEl("div"),
  };
  c._update();
  return c;
}

let fail = 0;
const ok = (name, cond, got) => {
  console.log((cond ? "  PASA  " : "  FALLA ") + name + (cond ? "" : "   -> " + JSON.stringify(got)));
  if (!cond) fail++;
};

console.log("\n--- caso 1: todas las entidades presentes, ventana abierta, aire encendido");
let c = mk({ entity: "climate.dorm", power_entity: "sensor.pot",
  energy_today_entity: "sensor.hoy", energy_month_entity: "sensor.mes",
  window_entity: "binary_sensor.ventana" });
ok("potencia muestra valor+unidad", c._rows.power.querySelector(".value").textContent === "1234 W", c._rows.power.querySelector(".value").textContent);
ok("energia combina hoy y mes",     c._rows.energy.querySelector(".value").textContent === "Hoy 0.85 kWh · Mes 12.34 kWh", c._rows.energy.querySelector(".value").textContent);
ok("ventana dice Abierta",          c._rows.window.querySelector(".value").textContent === "Abierta", c._rows.window.querySelector(".value").textContent);
ok("ventana marcada en alerta",     c._rows.window.classList.contains("alert"), [...c._rows.window.classList._s]);
ok("icono cambia a window-open",    c._rows.window.querySelector("ha-icon").getAttribute("icon") === "mdi:window-open-variant", c._rows.window.querySelector("ha-icon").getAttribute("icon"));
ok("aviso visible",                 c._rows.warn.style.display === "flex", c._rows.warn.style.display);

console.log("\n--- caso 2: sin energia ni ventana (ej. Cocina/Oficina)");
c = mk({ entity: "climate.dorm", power_entity: "sensor.pot" });
ok("fila energia oculta",  c._rows.energy.style.display === "none", c._rows.energy.style.display);
ok("fila ventana oculta",  c._rows.window.style.display === "none", c._rows.window.style.display);
ok("fila potencia visible",c._rows.power.style.display === "", c._rows.power.style.display);
ok("aviso oculto",         c._rows.warn.style.display === "none", c._rows.warn.style.display);

console.log("\n--- caso 3: aire apagado con ventana abierta -> sin aviso");
hass.states["climate.dorm"].state = "off";
c = mk({ entity: "climate.dorm", window_entity: "binary_sensor.ventana" });
ok("aviso oculto con AC off", c._rows.warn.style.display === "none", c._rows.warn.style.display);
hass.states["climate.dorm"].state = "cool";

console.log("\n--- caso 4: sensor caido / inexistente");
c = mk({ entity: "climate.dorm", power_entity: "sensor.caido", energy_today_entity: "sensor.no_existe" });
ok("potencia unavailable no rompe", c._rows.power.querySelector(".value").textContent === "no disponible", c._rows.power.querySelector(".value").textContent);
ok("entidad inexistente no rompe",  c._rows.energy.querySelector(".value").textContent === "Hoy no disponible", c._rows.energy.querySelector(".value").textContent);

console.log("\n--- caso 5: entity que no es climate (Javi)");
c = mk({ entity: "input_boolean.ac_javi", power_entity: "sensor.pot" });
ok("getCardSize() = 3 para no-climate", c.getCardSize() === 3, c.getCardSize());
c = mk({ entity: "climate.dorm" });
ok("getCardSize() = 6 para climate",    c.getCardSize() === 6, c.getCardSize());

console.log("\n--- caso 6: base_card (envolver mini-climate)");
c = mk({ entity: "climate.dorm", power_entity: "sensor.pot",
  base_card: { type: "custom:mini-climate", fan_mode: { hide: true } } });
ok("getCardSize() = 4 con base_card", c.getCardSize() === 4, c.getCardSize());
ok("filas siguen funcionando",        c._rows.power.querySelector(".value").textContent === "1234 W", c._rows.power.querySelector(".value").textContent);
ok("config original no se muta",      c._config.base_card.entity === undefined, c._config.base_card);

console.log("\n--- caso 7: setConfig sin entity debe tirar error");
try { new CARD().setConfig({}); ok("lanza error", false, "no lanzo"); }
catch (e) { ok("lanza error con mensaje claro", /Falta 'entity'/.test(e.message), e.message); }

console.log(fail === 0 ? "\n=== TODO PASA ===" : `\n=== ${fail} FALLAS ===`);
process.exit(fail ? 1 : 0);
