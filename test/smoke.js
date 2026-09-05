// Shim minimo de DOM para ejercitar la logica del card sin navegador.
function makeEl(tag) {
  const el = {
    tag, className: "", innerHTML: "", textContent: "",
    style: {}, children: [], _q: {}, _attrs: {},
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelector(sel) { return this._q[sel] || (this._q[sel] = makeEl("stub")); },
    addEventListener(ev, fn) { (this._ev = this._ev || {})[ev] = fn; },
    click() { this._ev && this._ev.click && this._ev.click(); },
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
const DEFS = {};
global.customElements = { get: () => undefined, define: (n, c) => { DEFS[n] = c; if (n === "ac-room-card") CARD = c; } };
global.window = { customCards: [] };

require("../ac-room-card.js");

const calls = [];
const hass = {
  callService: (d, srv, data) => calls.push({ d, srv, data }),
  states: {
    "climate.dorm":            { state: "cool",  attributes: {} },
    "sensor.pot":              { state: "1234",  attributes: { unit_of_measurement: "W" } },
    "sensor.hoy":              { state: "0.85",  attributes: { unit_of_measurement: "kWh" } },
    "sensor.mes":              { state: "12.34", attributes: { unit_of_measurement: "kWh" } },
    "binary_sensor.ventana":   { state: "on",    attributes: {} },
    "sensor.caido":            { state: "unavailable", attributes: {} },
    "sensor.temp":             { state: "22.6000003814697", attributes: { unit_of_measurement: "\u00b0C" } },
    "input_number.mins":       { state: "60", attributes: { min: 0, max: 480, step: 30 } },
    "timer.t_idle":            { state: "idle",   attributes: {} },
    "timer.t_run":             { state: "active", attributes: { finishes_at: new Date(Date.now() + 2530 * 1000).toISOString() } },
  },
};

function mk(cfg) {
  const c = new CARD();
  c.setConfig(cfg);
  c._hass = hass;
  // Simulamos lo que arma _build(), sin loadCardHelpers.
  const f = makeEl("div");
  c._rows = {
    power:  c._addRow(f, "mdi:flash", null, true),
    energy: c._addRow(f, "mdi:x", "Hoy"),
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

console.log("\n--- caso 1: potencia + ventana abierta, todo en una linea");
let c = mk({ entity: "climate.dorm", power_entity: "sensor.pot",
  energy_today_entity: "sensor.hoy", energy_month_entity: "sensor.mes",
  window_entity: "binary_sensor.ventana" });
const win = () => c._rows.power.querySelector(".win");
ok("potencia muestra valor+unidad", c._rows.power.querySelector(".value").textContent === "1234 W", c._rows.power.querySelector(".value").textContent);
ok("energia combina hoy y mes",     c._rows.energy.querySelector(".value").textContent === "Hoy 0.85 kWh \u00b7 Mes 12.34 kWh", c._rows.energy.querySelector(".value").textContent);
ok("ventana en la MISMA fila que W", win() !== null && c._rows.window === undefined, "hay fila window aparte");
ok("abierta -> clase open (rojo)",  win().className === "win open", win().className);
ok("abierta -> icono window-open",  win().getAttribute("icon") === "mdi:window-open-variant", win().getAttribute("icon"));
ok("tooltip dice Abierta",          win().getAttribute("title") === "Ventana: Abierta", win().getAttribute("title"));
ok("aviso apagado por defecto",     c._rows.warn.style.display === "none", c._rows.warn.style.display);
ok("NO se dibuja la etiqueta Potencia", !/class="label"/.test(c._rows.power.innerHTML), c._rows.power.innerHTML);
ok("fila principal marcada .main",  c._rows.power.className === "row main", c._rows.power.className);

console.log("\n--- caso 1e: temperatura a la derecha de la ventana");
c = mk({ entity: "climate.dorm", power_entity: "sensor.pot",
  window_entity: "binary_sensor.ventana", temp_entity: "sensor.temp" });
ok("temp redondeada a 1 decimal", c._rows.power.querySelector(".temp").textContent === "22.6 \u00b0C", c._rows.power.querySelector(".temp").textContent);
ok("termometro visible",          c._rows.power.querySelector(".tempicon").style.display === "", c._rows.power.querySelector(".tempicon").style.display);
ok("temp va DESPUES de la ventana", c._rows.power.innerHTML.indexOf("tempicon") > c._rows.power.innerHTML.indexOf('class="win"'), c._rows.power.innerHTML);

console.log("\n--- caso 1f: sin temp_entity el termometro se oculta");
c = mk({ entity: "climate.dorm", power_entity: "sensor.pot" });
ok("termometro oculto", c._rows.power.querySelector(".tempicon").style.display === "none", c._rows.power.querySelector(".tempicon").style.display);
ok("valor de temp oculto", c._rows.power.querySelector(".temp").style.display === "none", c._rows.power.querySelector(".temp").style.display);

console.log("\n--- caso 1g: solo temperatura, sin potencia ni ventana");
c = mk({ entity: "climate.dorm", temp_entity: "sensor.temp" });
ok("fila visible solo con temp", c._rows.power.style.display === "", c._rows.power.style.display);

console.log("\n--- caso 1b: ventana cerrada -> verde");
hass.states["binary_sensor.ventana"].state = "off";
c = mk({ entity: "climate.dorm", power_entity: "sensor.pot", window_entity: "binary_sensor.ventana" });
ok("cerrada -> clase closed (verde)", c._rows.power.querySelector(".win").className === "win closed", c._rows.power.querySelector(".win").className);
ok("cerrada -> icono window-closed",  c._rows.power.querySelector(".win").getAttribute("icon") === "mdi:window-closed-variant", c._rows.power.querySelector(".win").getAttribute("icon"));
hass.states["binary_sensor.ventana"].state = "on";

console.log("\n--- caso 1c: sin ventana -> el icono se oculta");
c = mk({ entity: "climate.dorm", power_entity: "sensor.pot" });
ok("icono de ventana oculto", c._rows.power.querySelector(".win").style.display === "none", c._rows.power.querySelector(".win").style.display);
ok("fila de potencia visible", c._rows.power.style.display === "", c._rows.power.style.display);

console.log("\n--- caso 1d: ventana sin potencia -> la fila igual aparece");
c = mk({ entity: "climate.dorm", window_entity: "binary_sensor.ventana" });
ok("fila visible solo con ventana", c._rows.power.style.display === "", c._rows.power.style.display);
ok("value vacio sin potencia",      c._rows.power.querySelector(".value").textContent === "", c._rows.power.querySelector(".value").textContent);

console.log("\n--- caso 1h: timer inactivo");
function mkT(cfg) {
  const c = new CARD(); c.setConfig(cfg); c._hass = hass;
  const f = makeEl("div");
  const t = makeEl("div");
  c._rows = { power: c._addRow(f, "mdi:flash", null, true), energy: c._addRow(f, "mdi:x", "Hoy"), warn: makeEl("div"), timer: t };
  t.querySelector(".minus").addEventListener("click", () => c._nudge(-1));
  t.querySelector(".plus").addEventListener("click", () => c._nudge(1));
  t.querySelector(".go").addEventListener("click", () => c._go());
  c._update(); c._tick(false);
  return c;
}
const TCFG = { entity: "timer.t_idle", minutes_entity: "input_number.mins", button_entity: "input_button.b" };
c = mkT({ entity: "climate.dorm", power_entity: "sensor.pot", timer: TCFG });
ok("muestra los minutos",     c._rows.timer.querySelector(".mins").textContent === "60 min", c._rows.timer.querySelector(".mins").textContent);
ok("boton dice Programar",    c._rows.timer.querySelector(".go").textContent === "Programar", c._rows.timer.querySelector(".go").textContent);
ok("+/- visibles",            c._rows.timer.querySelector(".minus").style.display === "", c._rows.timer.querySelector(".minus").style.display);
calls.length = 0;
c._rows.timer.querySelector(".plus").click();
ok("+ sube segun el step (60->90)", JSON.stringify(calls[0]) === JSON.stringify({d:"input_number",srv:"set_value",data:{entity_id:"input_number.mins",value:90}}), calls[0]);
calls.length = 0;
c._rows.timer.querySelector(".go").click();
ok("Programar aprieta el input_button", calls[0].d === "input_button" && calls[0].srv === "press", calls[0]);

console.log("\n--- caso 1i: timer corriendo");
c = mkT({ entity: "climate.dorm", power_entity: "sensor.pot", timer: { ...TCFG, entity: "timer.t_run" } });
ok("cuenta regresiva mm:ss", /^Apaga en 42:\d\d$/.test(c._rows.timer.querySelector(".mins").textContent), c._rows.timer.querySelector(".mins").textContent);
ok("boton pasa a Cancelar",  c._rows.timer.querySelector(".go").textContent === "Cancelar", c._rows.timer.querySelector(".go").textContent);
ok("+/- se ocultan",         c._rows.timer.querySelector(".plus").style.display === "none", c._rows.timer.querySelector(".plus").style.display);
ok("fila marcada running",   c._rows.timer.className === "timerrow running", c._rows.timer.className);
calls.length = 0;
c._rows.timer.querySelector(".go").click();
ok("Cancelar llama timer.cancel", calls[0].d === "timer" && calls[0].srv === "cancel", calls[0]);

console.log("\n--- caso 1j: sin button_entity arranca el timer directo");
c = mkT({ entity: "climate.dorm", timer: { entity: "timer.t_idle", minutes_entity: "input_number.mins" } });
calls.length = 0;
c._rows.timer.querySelector(".go").click();
ok("timer.start con 3600 s", calls[0].srv === "start" && calls[0].data.duration === 3600, calls[0]);

console.log("\n--- caso 2: sin energia ni ventana (ej. Cocina/Oficina)");
c = mk({ entity: "climate.dorm", power_entity: "sensor.pot" });
ok("fila energia oculta",  c._rows.energy.style.display === "none", c._rows.energy.style.display);
ok("icono ventana oculto", c._rows.power.querySelector(".win").style.display === "none", c._rows.power.querySelector(".win").style.display);
ok("fila potencia visible",c._rows.power.style.display === "", c._rows.power.style.display);
ok("aviso oculto",         c._rows.warn.style.display === "none", c._rows.warn.style.display);

console.log("\n--- caso 3: aire apagado con ventana abierta -> sin aviso");
hass.states["climate.dorm"].state = "off";
c = mk({ entity: "climate.dorm", window_entity: "binary_sensor.ventana", show_warning: true });
ok("aviso oculto con AC off", c._rows.warn.style.display === "none", c._rows.warn.style.display);
hass.states["climate.dorm"].state = "cool";
c = mk({ entity: "climate.dorm", window_entity: "binary_sensor.ventana", show_warning: true });
ok("aviso visible con show_warning + AC on", c._rows.warn.style.display === "flex", c._rows.warn.style.display);
hass.states["climate.dorm"].state = "off";
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

console.log("\n--- caso 8: editor visual, ida y vuelta de la config");
const ED = DEFS["ac-room-card-editor"];
ok("el editor esta registrado", !!ED, Object.keys(DEFS));
ok("la card expone getConfigElement", typeof CARD.getConfigElement === "function", typeof CARD.getConfigElement);

const cfgFull = {
  type: "custom:ac-room-card",
  entity: "climate.dorm",
  power_entity: "sensor.pot",
  window_entity: "binary_sensor.ventana",
  temp_entity: "sensor.temp",
  timer: { entity: "timer.t_idle", minutes_entity: "input_number.mins", button_entity: "input_button.b" },
  base_card: { type: "custom:mini-climate", entity: "climate.dorm" },
};
const flat = ED.toForm(cfgFull);
ok("aplana timer.entity",         flat.timer_entity === "timer.t_idle", flat);
ok("aplana timer.minutes_entity", flat.timer_minutes_entity === "input_number.mins", flat);
ok("no expone base_card al form", flat.base_card === undefined, flat);

const back = ED.fromForm(cfgFull, flat);
ok("reconstruye timer anidado", JSON.stringify(back.timer) === JSON.stringify(cfgFull.timer), back.timer);
ok("PRESERVA base_card",        JSON.stringify(back.base_card) === JSON.stringify(cfgFull.base_card), back.base_card);
ok("conserva el type",          back.type === "custom:ac-room-card", back.type);

const cleared = ED.fromForm(cfgFull, { ...flat, window_entity: "", timer_entity: undefined });
ok("borrar ventana quita la clave", cleared.window_entity === undefined, cleared);
ok("borrar timer quita el bloque",  cleared.timer === undefined, cleared);
ok("y aun asi conserva base_card",  !!cleared.base_card, cleared.base_card);
ok("no toca lo que no maneja",      cleared.power_entity === "sensor.pot", cleared.power_entity);

console.log(fail === 0 ? "\n=== TODO PASA ===" : `\n=== ${fail} FALLAS ===`);
process.exit(fail ? 1 : 0);
