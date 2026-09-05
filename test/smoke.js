// Shim minimo de DOM para ejercitar la logica del card sin navegador.
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
    // El shim devolvia un stub para CUALQUIER selector, existiera o no en el
    // DOM. Eso dejo pasar un bug que blanqueaba el card entero: un
    // querySelector que en el navegador daba null. Ahora, si el elemento se
    // construyo por innerHTML, se comprueba que la clase o el tag esten ahi.
    querySelector(sel) {
      if (typeof this.innerHTML === "string" && this.innerHTML.length) {
        const cls = /\.([\w-]+)/.exec(sel);
        const existe = cls
          ? new RegExp('class="[^"]*\\b' + cls[1] + '\\b').test(this.innerHTML)
          : this.innerHTML.includes("<" + sel.split(/[.\[\s:]/)[0]);
        if (!existe) return null;
      }
      return this._q[sel] || (this._q[sel] = makeEl("stub"));
    },
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
global.document = { createElement: makeEl, addEventListener() {}, removeEventListener() {} };
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
    "climate.conFan":          { state: "cool",  attributes: { fan_modes: ["silent","low","auto"], fan_mode: "auto" } },
    "sensor.pot":              { state: "1234",  attributes: { unit_of_measurement: "W" } },
    "sensor.hoy":              { state: "0.85",  attributes: { unit_of_measurement: "kWh" } },
    "sensor.mes":              { state: "12.34", attributes: { unit_of_measurement: "kWh" } },
    "binary_sensor.ventana":   { state: "on",    attributes: {} },
    "binary_sensor.v1":        { state: "off",   attributes: { friendly_name: "Norte" } },
    "binary_sensor.v2":        { state: "off",   attributes: { friendly_name: "Sur" } },
    "sensor.pila_ok":          { state: "85",    attributes: { friendly_name: "Pila Norte" } },
    "sensor.pila_baja":        { state: "12",    attributes: { friendly_name: "Pila Sur" } },
    "sensor.caido":            { state: "unavailable", attributes: {} },
    "sensor.temp":             { state: "22.6000003814697", attributes: { unit_of_measurement: "\u00b0C" } },
    "input_number.mins":       { state: "60", attributes: { min: 0, max: 480, step: 30 } },
    "input_boolean.frio":      { state: "off", attributes: {} },
    "fan.uno":                 { state: "on",  attributes: { friendly_name: "Vent 1" } },
    "fan.dos":                 { state: "off", attributes: { friendly_name: "Vent 2" } },
    "input_boolean.calor":     { state: "on",  attributes: {} },
    "input_boolean.neutro":    { state: "on",  attributes: {} },
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
ok("tooltip lista la ventana y su estado", /Abierta/.test(win().getAttribute("title")), win().getAttribute("title"));
ok("aviso apagado por defecto",     c._rows.warn.style.display === "none", c._rows.warn.style.display);
ok("NO se dibuja la etiqueta Potencia", !/class="label"/.test(c._rows.power.innerHTML), c._rows.power.innerHTML);
ok("fila principal marcada .main",  c._rows.power.className === "row main", c._rows.power.className);
// Guarda contra el bug de 0.15.0: si el markup no trae estos elementos,
// _update() revienta en la primera linea y el card queda en blanco entero.
for (const sel of [".picon", ".value", ".win", ".winwrap", ".batdot", ".tempicon", ".temp", ".fanslot", ".fmslot"]) {
  ok("la fila principal contiene " + sel, c._rows.power.querySelector(sel) !== null, c._rows.power.innerHTML);
}

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
ok("icono de ventana oculto", c._rows.power.querySelector(".winwrap").style.display === "none", c._rows.power.querySelector(".winwrap").style.display);
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
ok("icono ventana oculto", c._rows.power.querySelector(".winwrap").style.display === "none", c._rows.power.querySelector(".winwrap").style.display);
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
catch (e) { ok("lanza error con mensaje claro", /al menos una entidad/.test(e.message), e.message); }

console.log("\n--- caso 7b: nombre e icono del encabezado");
c = mk({ entity: "climate.dorm", name: "Dormitorio", icon: "mdi:snowflake", power_entity: "sensor.pot" });
ok("guarda el nombre en config", c._config.name === "Dormitorio", c._config.name);
ok("guarda el icono en config",  c._config.icon === "mdi:snowflake", c._config.icon);


console.log("\n--- caso 7c: selector de modo frio/calor");
const MODES = [{ name: "Frio", entity: "input_boolean.frio", icon: "mdi:snowflake" },
               { name: "Calor", entity: "input_boolean.calor", icon: "mdi:fire" }];
c = mk({ entity: "input_boolean.frio", modes: MODES, power_entity: "sensor.pot" });
ok("detecta que el modo activo es Calor", c._activeMode() === 1, c._activeMode());
calls.length = 0;
c._setMode(0);
ok("cambiar a Frio apaga Calor primero", calls[0].srv === "turn_off" && calls[0].data.entity_id === "input_boolean.calor", calls[0]);
ok("y despues prende Frio",              calls[1].srv === "turn_on"  && calls[1].data.entity_id === "input_boolean.frio", calls[1]);
calls.length = 0;
c._setMode(-1);
ok("Apagado solo apaga, no prende nada", calls.length === 1 && calls[0].srv === "turn_off", calls);
c = mk({ entity: "input_boolean.frio", modes: [{ name: "Frio", entity: "input_boolean.frio" }] });
ok("sin ningun modo on, activo = -1", c._activeMode() === -1, c._activeMode());

console.log("\n--- caso 7h: varias ventanas (verde / naranjo / rojo)");
const W = () => c._rows.power.querySelector(".win");
const setW = (a, b) => { hass.states["binary_sensor.v1"].state = a; hass.states["binary_sensor.v2"].state = b; };

setW("off", "off");
c = mk({ entity: "climate.dorm", window_entity: ["binary_sensor.v1", "binary_sensor.v2"] });
ok("todas cerradas -> verde", W().className === "win closed", W().className);
setW("on", "off");
c = mk({ entity: "climate.dorm", window_entity: ["binary_sensor.v1", "binary_sensor.v2"] });
ok("una de dos -> naranjo",   W().className === "win some", W().className);
ok("el tooltip cuenta 1/2",   /\(1\/2\)/.test(W().getAttribute("title")), W().getAttribute("title"));
ok("y lista cada ventana",    /Norte: Abierta/.test(W().getAttribute("title")) && /Sur: Cerrada/.test(W().getAttribute("title")), W().getAttribute("title"));
setW("on", "on");
c = mk({ entity: "climate.dorm", window_entity: ["binary_sensor.v1", "binary_sensor.v2"] });
ok("todas abiertas -> rojo",  W().className === "win open", W().className);

setW("on", "off");
c = mk({ entity: "climate.dorm", window_entity: "binary_sensor.v1" });
ok("una sola abierta -> rojo, nunca naranjo", W().className === "win open", W().className);
c = mk({ entity: "climate.dorm", window_entity: "binary_sensor.v2" });
ok("una sola cerrada -> verde", W().className === "win closed", W().className);
c = mk({ entity: "climate.dorm" });
ok("sin ventanas se oculta", c._rows.power.querySelector(".winwrap").style.display === "none", c._rows.power.querySelector(".winwrap").style.display);

console.log("\n--- caso 7i: pila baja de un sensor de ventana");
const DOT = () => c._rows.power.querySelector(".batdot");
c = mk({ entity: "climate.dorm", window_entity: [
  { entity: "binary_sensor.v1", battery: "sensor.pila_ok" },
  { entity: "binary_sensor.v2", battery: "sensor.pila_baja" }] });
ok("marca visible si alguna esta baja", DOT().style.display === "", DOT().style.display);
ok("el tooltip dice cual y cuanto", /Pila Sur: 12%/.test(DOT().getAttribute("title")), DOT().getAttribute("title"));
c = mk({ entity: "climate.dorm", window_entity: [{ entity: "binary_sensor.v1", battery: "sensor.pila_ok" }] });
ok("sin pilas bajas no hay marca", DOT().style.display === "none", DOT().style.display);
c = mk({ entity: "climate.dorm", battery_warn: 90,
  window_entity: [{ entity: "binary_sensor.v1", battery: "sensor.pila_ok" }] });
ok("el umbral es configurable (85 <= 90)", DOT().style.display === "", DOT().style.display);
setW("off", "off");

console.log("\n--- caso 7d: ventiladores");
function mkF(cfg) {
  const c = new CARD(); c.setConfig(cfg); c._hass = hass;
  const f = makeEl("div");
  c._rows = { power: c._addRow(f, "mdi:flash", null, true), energy: c._addRow(f, "mdi:x", "Hoy"), warn: makeEl("div") };
  const fans = c._fanList();
  if (fans.length) {
    const fin = c._rows.power.querySelector(".fanslot");
    const ini = c._rows.power.querySelector(".preslot");
    c._fanBtns = fans.map((x) => { const b = c._makeFanBtn(x);
      (x.position === "start" && ini ? ini : fin).appendChild(b); return b; });
  }
  c._update(); c._tick(false);
  return c;
}
c = mkF({ entity: "climate.dorm", power_entity: "sensor.pot", fans: ["fan.uno"] });
ok("un ventilador: un boton",   c._fanBtns.length === 1, c._fanBtns.length);
ok("encendido -> clase on (verde)", c._fanBtns[0].className === "fan on", c._fanBtns[0].className);
calls.length = 0; c._fanBtns[0].click();
ok("click llama homeassistant.toggle", calls[0].d === "homeassistant" && calls[0].srv === "toggle" && calls[0].data.entity_id === "fan.uno", calls[0]);

c = mkF({ entity: "climate.dorm", fans: ["fan.uno", "fan.dos"] });
ok("dos ventiladores: dos botones", c._fanBtns.length === 2, c._fanBtns.length);
ok("apagado -> clase off (azul)",   c._fanBtns[1].className === "fan off", c._fanBtns[1].className);
ok("los dos botones son del mismo tamano compacto", c._fanBtns.every(b => !/fname/.test(b.innerHTML)), c._fanBtns.map(b=>b.innerHTML));
ok("el nombre va al tooltip",   c._fanBtns[1].title === "Vent 2: apagado", c._fanBtns[1].title);
ok("tooltip del encendido",     c._fanBtns[0].title === "Vent 1: encendido", c._fanBtns[0].title);

c = mkF({ entity: "climate.dorm", fans: [{ entity: "fan.uno", name: "Sol", color: "orange" }] });
ok("encendido usa el color propio", c._fanBtns[0].style.color === "orange", c._fanBtns[0].style.color);
hass.states["fan.uno"].state = "off";
c = mkF({ entity: "climate.dorm", fans: [{ entity: "fan.uno", name: "Sol", color: "orange" }] });
ok("apagado NO usa el color propio", c._fanBtns[0].style.color === "", c._fanBtns[0].style.color);
hass.states["fan.uno"].state = "on";
c = mkF({ entity: "climate.dorm", fans: [{ entity: "fan.uno" }] });
// position: start lo pone en el hueco previo a la potencia
c = mkF({ entity: "climate.dorm", power_entity: "sensor.pot",
          fans: [{ entity: "fan.uno", position: "start" }, { entity: "fan.dos" }] });
ok("con position:start va al hueco inicial",
   c._rows.power.querySelector(".preslot").children.length === 1,
   c._rows.power.querySelector(".preslot").children.length);
ok("y el otro al hueco del final",
   c._rows.power.querySelector(".fanslot").children.length === 1,
   c._rows.power.querySelector(".fanslot").children.length);
ok("el hueco inicial va antes del rayo",
   c._rows.power.innerHTML.indexOf("preslot") < c._rows.power.innerHTML.indexOf("picon"),
   c._rows.power.innerHTML.slice(0, 80));
c = mkF({ entity: "climate.dorm", fans: [{ entity: "fan.uno" }] });
ok("sin position, todos al final",
   c._rows.power.querySelector(".fanslot").children.length === 1,
   c._rows.power.querySelector(".fanslot").children.length);

ok("sin color sigue el verde comun", c._fanBtns[0].style.color === "" && c._fanBtns[0].className === "fan on", [c._fanBtns[0].style.color, c._fanBtns[0].className]);
c = mkF({ entity: "climate.dorm", fans: [{ entity: "fan.uno", name: "Techo", icon: "mdi:ceiling-fan" }] });
ok("acepta objeto con nombre propio", c._fanList()[0].name === "Techo", c._fanList()[0]);
c = mkF({ entity: "climate.dorm" });
ok("sin fans, sin botones", c._fanBtns === undefined, c._fanBtns);

console.log("\n--- caso 7f: velocidad del ventilador del equipo");
function mkFM(cfg) {
  const c = new CARD(); c.setConfig(cfg); c._hass = hass;
  const f = makeEl("div");
  c._rows = { power: c._addRow(f, "mdi:flash", null, true), energy: c._addRow(f, "mdi:x", "Hoy"), warn: makeEl("div") };
  if (c._fanModeSupported()) c._buildFanMode();
  c._update(); c._tick(false);
  return c;
}
c = mkFM({ entity: "climate.conFan", fan_mode: true, power_entity: "sensor.pot" });
ok("se dibuja el control",        !!c._fanModeEl, c._fanModeEl);
const sel = c._fanModeEl.querySelector("select");
ok("carga las 3 velocidades",     sel.children.length === 3, sel.children.length);
ok("muestra la actual (auto)",    sel.value === "auto", sel.value);
ok("capitaliza los nombres",      sel.children[0].textContent === "Silent", sel.children[0].textContent);
calls.length = 0; sel.value = "low"; sel._ev.change();
ok("elegir llama climate.set_fan_mode", calls[0].d === "climate" && calls[0].srv === "set_fan_mode" && calls[0].data.fan_mode === "low", calls[0]);

c = mkFM({ entity: "climate.conFan", power_entity: "sensor.pot" });
ok("sin la opcion no se dibuja",  !c._fanModeEl, "se dibujo igual");
c = mkFM({ entity: "climate.dorm", fan_mode: true, power_entity: "sensor.pot" });
ok("equipo sin fan_modes no lo dibuja", !c._fanModeEl, "se dibujo igual");
c = mkFM({ entity: "climate.conFan", fan_mode: true, fan_mode_names: { auto: "Automatico" }, power_entity: "sensor.pot" });
ok("acepta nombres propios", c._fanModeEl.querySelector("select").children[2].textContent === "Automatico",
   c._fanModeEl.querySelector("select").children[2].textContent);

console.log("\n--- caso 7k: donde van los ventiladores");
{
  const build = (cfg) => {
    const c = new CARD(); c.setConfig(cfg); c._hass = hass;
    const f = makeEl("div");
    c._rows = { power: c._addRow(f, "mdi:flash", null, true), energy: c._addRow(f, "mdi:x", "Hoy"), warn: makeEl("div") };
    const fans = c._fanList();
    const modo = c._config.fans_position || "inline";
    const enLinea = fans.length > 0 && (modo === "inline" || (modo === "auto" && fans.length === 1));
    c._fansInline = enLinea;
    c._fanBtns = fans.map((x) => c._makeFanBtn(x));
    return { c, enLinea, n: fans.length };
  };
  let r = build({ entity: "climate.dorm", fans: ["fan.uno"] });
  ok("por defecto uno -> en la linea", r.enLinea === true, r.enLinea);
  r = build({ entity: "climate.dorm", fans: ["fan.uno", "fan.dos", "fan.uno"] });
  ok("por defecto tres -> tambien en la linea", r.enLinea === true, r.enLinea);
  ok("y se crean los tres botones", r.c._fanBtns.length === 3, r.c._fanBtns.length);
  r = build({ entity: "climate.dorm", fans: ["fan.uno", "fan.dos"], fans_position: "auto" });
  ok("auto con dos -> fila propia", r.enLinea === false, r.enLinea);
  r = build({ entity: "climate.dorm", fans: ["fan.uno", "fan.dos"], fans_position: "inline" });
  ok("inline con dos -> en la linea", r.enLinea === true, r.enLinea);
  ok("y se crean los dos botones",   r.c._fanBtns.length === 2, r.c._fanBtns.length);
  r = build({ entity: "climate.dorm", fans: ["fan.uno"], fans_position: "row" });
  ok("row con uno -> fila propia",   r.enLinea === false, r.enLinea);
  r = build({ entity: "climate.dorm", fans_position: "inline" });
  ok("sin ventiladores no hay linea ni fila", r.enLinea === false, r.enLinea);
}

console.log("\n--- caso 7l: tarjeta sin equipo de clima (ej. garage)");
{
  const sinEquipo = (cfg) => {
    const c = new CARD(); c.setConfig(cfg); c._hass = hass;
    const f = makeEl("div");
    c._rows = { power: c._addRow(f, "mdi:flash", null, true), energy: c._addRow(f, "mdi:x", "Hoy"), warn: makeEl("div") };
    c._update(); c._tick(false); return c;
  };
  // sin entity pero con ventana: valido
  let c2 = sinEquipo({ window_entity: "binary_sensor.v1" });
  ok("acepta config sin entity", !!c2._config, "no acepto");
  ok("sin power_entity el rayo se oculta",
     c2._rows.power.querySelector(".picon").style.display === "none",
     c2._rows.power.querySelector(".picon").style.display);
  // con power_entity el rayo vuelve
  c2 = sinEquipo({ power_entity: "sensor.pot" });
  ok("con power_entity el rayo se dibuja",
     c2._rows.power.querySelector(".picon").style.display === "",
     c2._rows.power.querySelector(".picon").style.display);
  // config totalmente vacia: error claro
  try { new CARD().setConfig({}); ok("config vacia lanza error", false, "no lanzo"); }
  catch (e) { ok("config vacia lanza error claro", /al menos una entidad/.test(e.message), e.message); }
}

console.log("\n--- caso 7e: more-info al tocar");
c = mkF({ entity: "climate.dorm", power_entity: "sensor.pot", window_entity: "binary_sensor.ventana", temp_entity: "sensor.temp" });
let fired = null;
c.dispatchEvent = (ev) => { fired = ev; return true; };
global.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };
c._moreInfo("sensor.pot");
ok("dispara hass-more-info",      fired && fired.type === "hass-more-info", fired && fired.type);
ok("con el entityId correcto",    fired.detail.entityId === "sensor.pot", fired.detail);
ok("composed:true (sale del shadow DOM)", fired.composed === true, fired.composed);
fired = null; c._moreInfo(undefined);
ok("sin entidad no dispara nada", fired === null, fired);

console.log("\n--- caso 7g: base_card_style se inyecta en el shadow del card envuelto");
{
  const c = new CARD(); c.setConfig({ entity: "climate.dorm", base_card_style: "mc-temperature{color:red}" });
  c._hass = hass;
  const root = makeEl("root"); root._q["style[data-acrc]"] = null;
  const inner = { shadowRoot: { querySelector: (sel) => (sel === "ha-card" ? makeEl("ha-card") : root._injected || null), appendChild: (x) => { root._injected = x; return x; } } };
  c._inner = inner;
  c._stripInnerCard();
  ok("crea el <style> dentro del shadow", !!root._injected, root._injected);
  ok("con el CSS pedido", root._injected.textContent === "mc-temperature{color:red}", root._injected.textContent);
  ok("lo marca con data-acrc", root._injected._attrs["data-acrc"] === "", root._injected._attrs);
  const antes = root._injected;
  c._injectInnerStyle();
  ok("no duplica el <style> al refrescar", root._injected === antes, "se creo otro");

  // mapa selector -> css, para un shadow root anidado
  const nested = makeEl("nestedRoot");
  const hijo = makeEl("mc-temperature");
  hijo.shadowRoot = { querySelector: () => nested._st || null, appendChild: (x) => { nested._st = x; return x; } };
  const c3 = new CARD();
  c3.setConfig({ entity: "climate.dorm", base_card_style: { "": "a{}", "mc-temperature": ".state__value{}" } });
  c3._hass = hass;
  const raiz = { _st: null };
  c3._inner = { shadowRoot: {
    querySelector: (sel) => (sel === "mc-temperature" ? hijo : (sel.startsWith("style") ? raiz._st : makeEl("x"))),
    appendChild: (x) => { raiz._st = x; return x; } } };
  c3._injectInnerStyle();
  ok("inyecta en el shadow anidado", nested._st && nested._st.textContent === ".state__value{}", nested._st);
  ok("y tambien en el de arriba",    raiz._st && raiz._st.textContent === "a{}", raiz._st);

  const c2 = new CARD(); c2.setConfig({ entity: "climate.dorm" }); c2._hass = hass;
  const root2 = makeEl("root");
  c2._inner = { shadowRoot: { querySelector: () => null, appendChild: (x) => { root2._injected = x; } } };
  c2._injectInnerStyle();
  ok("sin base_card_style no inyecta nada", !root2._injected, root2._injected);
}

console.log("\n--- caso 7j: el card interno no repite el nombre");
{
  let visto = null;
  global.window.loadCardHelpers = async () => ({
    createCardElement: async (x) => { visto = x; const e = makeEl("card"); e.shadowRoot = null; return e; },
  });
  const probar = async (cfg) => { visto = null; const k = new CARD(); k.setConfig(cfg); k._hass = hass;
    try { await k._build(); } catch (e) {} return visto; };
  return probar({ entity: "climate.dorm", name: "Dormitorio" }).then((v1) =>
    probar({ entity: "climate.dorm" }).then((v2) => {
      ok("con name, al interno se le manda un espacio", v1 && v1.name === " ", v1);
      ok("sin name, no se le manda nada",               v2 && v2.name === undefined, v2);

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
cfgFull.name = "Dormitorio";
cfgFull.icon = "mdi:snowflake";
const flat = ED.toForm(cfgFull);
ok("el form recibe el nombre", flat.name === "Dormitorio", flat.name);
ok("el form recibe el icono",  flat.icon === "mdi:snowflake", flat.icon);
ok("aplana timer.entity",         flat.timer_entity === "timer.t_idle", flat);
ok("aplana timer.minutes_entity", flat.timer_minutes_entity === "input_number.mins", flat);
ok("no expone base_card al form", flat.base_card === undefined, flat);

const back = ED.fromForm(cfgFull, flat);
ok("reconstruye timer anidado", JSON.stringify(back.timer) === JSON.stringify(cfgFull.timer), back.timer);
ok("PRESERVA base_card",        JSON.stringify(back.base_card) === JSON.stringify(cfgFull.base_card), back.base_card);
ok("conserva el type",          back.type === "custom:ac-room-card", back.type);

const cfgFans = { type: "custom:ac-room-card", entity: "climate.dorm",
  fans: [{ entity: "fan.uno", name: "Techo", icon: "mdi:ceiling-fan" }, "fan.dos"] };
const flatF = ED.toForm(cfgFans);
ok("el form recibe solo entity_id", JSON.stringify(flatF.fans) === JSON.stringify(["fan.uno","fan.dos"]), flatF.fans);
const backF = ED.fromForm(cfgFans, flatF);
ok("conserva el objeto con nombre", backF.fans[0].name === "Techo", backF.fans);
ok("y el que era string sigue string", backF.fans[1] === "fan.dos", backF.fans);
ok("expone un campo de nombre por ventilador", flatF.fan_name_0 === "Techo" && flatF.fan_name_1 === "", flatF);

// renombrar sin tocar la lista
const renombrado = ED.fromForm(cfgFans, { ...flatF, fan_name_1: "Ventana" });
ok("renombrar el segundo lo vuelve objeto", renombrado.fans[1].name === "Ventana", renombrado.fans);
ok("y no pierde el icono del primero",      renombrado.fans[0].icon === "mdi:ceiling-fan", renombrado.fans);
ok("no filtra fan_name_* a la config",      Object.keys(renombrado).every(k => !/^fan_name_/.test(k)), Object.keys(renombrado));

// borrar el nombre lo devuelve a entity_id simple
const sinNombre = ED.fromForm({ type:"custom:ac-room-card", entity:"climate.dorm", fans:[{entity:"fan.dos", name:"X"}] },
                              { fans:["fan.dos"], fan_name_0: "" });
ok("borrar el nombre deja el entity_id suelto", sinNombre.fans[0] === "fan.dos", sinNombre.fans);

// quitar un ventilador no debe correr los nombres al de al lado
const quitandoElPrimero = ED.fromForm(cfgFans, { ...flatF, fans: ["fan.dos"] });
ok("al cambiar la lista los nombres siguen a su entidad",
   quitandoElPrimero.fans[0] === "fan.dos", quitandoElPrimero.fans);

const esq = ED.buildSchema({ fans: ["fan.uno", "fan.dos"] });
ok("el esquema agrega los campos de nombre", JSON.stringify(esq).includes("fan_name_1"), "falta fan_name_1");
const esqVacio = ED.buildSchema({});
ok("sin ventiladores no agrega campos", !JSON.stringify(esqVacio).includes("fan_name_"), "sobran campos");

// ventanas: el form aplana, y el battery de cada una sobrevive
const cfgWin = { type:"custom:ac-room-card", entity:"climate.dorm",
  window_entity: [{ entity:"binary_sensor.v1", battery:"sensor.pila_ok" }, "binary_sensor.v2"] };
const flatW = ED.toForm(cfgWin);
ok("el form recibe solo los entity_id de ventana",
   JSON.stringify(flatW.window_entity) === JSON.stringify(["binary_sensor.v1","binary_sensor.v2"]), flatW.window_entity);
const backW = ED.fromForm(cfgWin, flatW);
ok("conserva el battery de la primera", backW.window_entity[0].battery === "sensor.pila_ok", backW.window_entity);
ok("y la segunda sigue siendo string",  backW.window_entity[1] === "binary_sensor.v2", backW.window_entity);
const sinWin = ED.fromForm(cfgWin, { ...flatW, window_entity: [] });
ok("lista vacia quita las ventanas", sinWin.window_entity === undefined, sinWin.window_entity);

const sinFans = ED.fromForm(cfgFans, { ...flatF, fans: [] });
ok("lista vacia quita la clave", sinFans.fans === undefined, sinFans.fans);

const cfgModes = { type: "custom:ac-room-card", entity: "input_boolean.frio", modes: MODES };
const flatM = ED.toForm(cfgModes);
ok("aplana el boolean de frio", flatM.mode_cold_entity === "input_boolean.frio", flatM);
ok("aplana el boolean de calor", flatM.mode_heat_entity === "input_boolean.calor", flatM);
const backM = ED.fromForm(cfgModes, flatM);
ok("reconstruye modes con nombre e icono", JSON.stringify(backM.modes) === JSON.stringify(MODES), backM.modes);
const soloFrio = ED.fromForm(cfgModes, { ...flatM, mode_heat_entity: "" });
ok("quitar calor deja un solo modo", soloFrio.modes.length === 1 && soloFrio.modes[0].name === "Frio", soloFrio.modes);

let roundtrip = ED.fromForm(cfgFull, flat);
ok("nombre sobrevive el ida y vuelta", roundtrip.name === "Dormitorio", roundtrip.name);
const cleared = ED.fromForm(cfgFull, { ...flat, window_entity: "", timer_entity: undefined, name: "" });
ok("borrar el nombre quita la clave", cleared.name === undefined, cleared.name);
ok("borrar ventana quita la clave", cleared.window_entity === undefined, cleared);
ok("borrar timer quita el bloque",  cleared.timer === undefined, cleared);
ok("y aun asi conserva base_card",  !!cleared.base_card, cleared.base_card);
ok("no toca lo que no maneja",      cleared.power_entity === "sensor.pot", cleared.power_entity);

console.log("\n--- caso 9: ac-rooms-card (vista compacta)");
{
  const ROOMS = DEFS["ac-rooms-card"];
  ok("el rooms card esta registrado", !!ROOMS, Object.keys(DEFS));

  hass.states["binary_sensor.v1"].state = "on";   // una abierta, la otra cerrada
  hass.states["binary_sensor.v2"].state = "off";
  hass.states["climate.conFan"].attributes.current_temperature = 21.64;
  hass.states["climate.conFan"].attributes.temperature = 26;
  const mkR = (cfg) => {
    const c = new ROOMS(); c.setConfig(cfg); c._hass = hass; c._build(); c._update(); return c;
  };
  const c9 = mkR({ rooms: [
    { entity: "climate.conFan", name: "Pieza", power_entity: "sensor.pot", temp_entity: "sensor.temp",
      window_entity: ["binary_sensor.v1", "binary_sensor.v2"], fans: ["fan.uno"] },
    { entity: "input_boolean.frio", name: "IR",
      modes: [{ entity: "input_boolean.frio" }, { entity: "input_boolean.calor" }] },
  ]});
  const f0 = c9._filas[0].fila, f1 = c9._filas[1].fila;
  ok("una fila por pieza",        c9._filas.length === 2, c9._filas.length);
  ok("nombre de la pieza",        f0.querySelector(".rname").textContent === "Pieza", f0.querySelector(".rname").textContent);
  ok("target = la consigna del equipo", f0.querySelector(".tgt").textContent === "26\u00b0", f0.querySelector(".tgt").textContent);
  ok("actual = lo que mide el equipo",   f0.querySelector(".act").textContent === "21.6\u00b0", f0.querySelector(".act").textContent);
  ok("real  = el sensor de la pieza",    f0.querySelector(".real").textContent === "22.6\u00b0", f0.querySelector(".real").textContent);
  ok("las tres son distintas entre si",
     new Set([f0.querySelector(".tgt").textContent, f0.querySelector(".act").textContent,
              f0.querySelector(".real").textContent]).size === 3,
     [f0.querySelector(".tgt").textContent, f0.querySelector(".act").textContent, f0.querySelector(".real").textContent]);
  const cSinReal = mkR({ rooms: [{ entity: "climate.conFan", name: "P" }] });
  ok("sin temp_entity la columna real queda vacia",
     cSinReal._filas[0].fila.querySelector(".real").textContent === "",
     cSinReal._filas[0].fila.querySelector(".real").textContent);
  ok("potencia redondeada",       f0.querySelector(".pw").textContent === "1234 W", f0.querySelector(".pw").textContent);
  ok("ventana naranja si va 1/2", f0.querySelector(".win").className === "win some", f0.querySelector(".win").className);
  ok("climate encendido -> boton on", f0.querySelector(".pwr").className === "pwr on", f0.querySelector(".pwr").className);
  ok("pieza IR con calor on tambien marca on", f1.querySelector(".pwr").className === "pwr on", f1.querySelector(".pwr").className);
  ok("sin ventanas la columna se reserva igual", f1.querySelector(".winwrap").style.visibility === "hidden", f1.querySelector(".winwrap").style.visibility);

  calls.length = 0;
  f0.querySelector(".pwr")._ev.click({ stopPropagation() {} });
  ok("apagar un climate llama climate.turn_off",
     calls[0].d === "climate" && calls[0].srv === "turn_off" && calls[0].data.entity_id === "climate.conFan", calls[0]);
  calls.length = 0;
  f1.querySelector(".pwr")._ev.click({ stopPropagation() {} });
  ok("apagar una pieza IR apaga el boolean encendido",
     calls[0].d === "input_boolean" && calls[0].srv === "turn_off" && calls[0].data.entity_id === "input_boolean.calor", calls[0]);

  calls.length = 0;
  c9._filas[0].btns[0]._ev.click({ stopPropagation() {} });
  ok("el ventilador de la fila togglea", calls[0].d === "homeassistant" && calls[0].srv === "toggle", calls[0]);

  let ev = null;
  c9.dispatchEvent = (e) => { ev = e; return true; };
  const c9mi = mkR({ popup: false, rooms: [{ entity: "climate.conFan", name: "Pieza" }] });
  c9mi.dispatchEvent = (e) => { ev = e; return true; };
  c9mi._filas[0].fila.querySelector(".rname")._ev.click();
  ok("con popup:false el nombre abre mas-info", ev && ev.detail.entityId === "climate.conFan", ev && ev.detail);

  // sort: active pone las encendidas primero
  hass.states["climate.conFan"].state = "off";
  const c10 = mkR({ sort: "active", rooms: [
    { entity: "climate.conFan", name: "Apagada" },
    { entity: "input_boolean.frio", name: "Encendida",
      modes: [{ entity: "input_boolean.calor" }] },
  ]});
  ok("sort:active deja la encendida arriba",
     Number(c10._filas[1].fila.style.order) < Number(c10._filas[0].fila.style.order),
     [c10._filas[0].fila.style.order, c10._filas[1].fila.style.order]);
  hass.states["climate.conFan"].state = "cool";

  console.log("\n  -- color de la fila segun el modo --");
  hass.states["climate.modo"] = { state: "cool", attributes: {} };
  const mode = (st) => { hass.states["climate.modo"].state = st;
    return mkR({ rooms: [{ entity: "climate.modo", name: "M" }] })._filas[0].fila.className; };
  ok("cool -> celeste",  /\bm-cool\b/.test(mode("cool")), mode("cool"));
  ok("heat -> naranjo",  /\bm-heat\b/.test(mode("heat")), mode("heat"));
  ok("dry  -> su propio tono", /\bm-dry\b/.test(mode("dry")), mode("dry"));
  ok("off  -> sin color", !/\bm-/.test(mode("off")), mode("off"));
  ok("unavailable -> sin color", !/\bm-/.test(mode("unavailable")), mode("unavailable"));

  // por input_boolean se deduce del nombre
  hass.states["input_boolean.calor"].state = "on";
  hass.states["input_boolean.frio"].state = "off";
  const ir = (modos) => mkR({ rooms: [{ entity: "input_boolean.frio", name: "IR", modes: modos }] })._filas[0].fila.className;
  ok("modo llamado Calor -> naranjo",
     /\bm-heat\b/.test(ir([{ entity: "input_boolean.frio", name: "Frio" }, { entity: "input_boolean.calor", name: "Calor" }])),
     ir([{ entity: "input_boolean.frio", name: "Frio" }, { entity: "input_boolean.calor", name: "Calor" }]));
  hass.states["input_boolean.calor"].state = "off";
  hass.states["input_boolean.frio"].state = "on";
  ok("modo llamado Frio -> celeste",
     /\bm-cool\b/.test(ir([{ entity: "input_boolean.frio", name: "Frio" }, { entity: "input_boolean.calor", name: "Calor" }])),
     ir([{ entity: "input_boolean.frio", name: "Frio" }, { entity: "input_boolean.calor", name: "Calor" }]));
  ok("se puede declarar hvac a mano",
     /\bm-heat\b/.test(ir([{ entity: "input_boolean.frio", name: "Uno", hvac: "heat" }])),
     ir([{ entity: "input_boolean.frio", name: "Uno", hvac: "heat" }]));
  const neutro = mkR({ rooms: [{ entity: "input_boolean.neutro", name: "N",
    modes: [{ entity: "input_boolean.neutro", name: "Uno" }] }] })._filas[0].fila.className;
  ok("nombre y entity que no dicen nada -> sin color", !/\bm-/.test(neutro), neutro);
  ok("tambien se deduce del entity_id",
     /\bm-cool\b/.test(ir([{ entity: "input_boolean.frio", name: "Uno" }])),
     ir([{ entity: "input_boolean.frio", name: "Uno" }]));
  hass.states["input_boolean.frio"].state = "off";
  hass.states["input_boolean.calor"].state = "on";

  console.log("\n  -- temporizadores en la fila --");
  const c11 = mkR({ rooms: [
    { entity: "climate.conFan", name: "Corriendo",
      timer: { entity: "timer.t_run", minutes_entity: "input_number.mins", button_entity: "input_button.b" } },
    { entity: "climate.conFan", name: "Parada",
      timer: { entity: "timer.t_idle", minutes_entity: "input_number.mins", button_entity: "input_button.b" } },
    { entity: "climate.conFan", name: "Sin timer" },
  ]});
  const t0 = c11._filas[0].fila.querySelector(".tmr");
  const t1 = c11._filas[1].fila.querySelector(".tmr");
  const t2 = c11._filas[2].fila.querySelector(".tmr");
  ok("corriendo muestra la cuenta", /^\d+:\d\d$/.test(t0.querySelector(".tleft").textContent), t0.querySelector(".tleft").textContent);
  ok("corriendo se marca .on",      t0.className === "tmr on", t0.className);
  ok("parada muestra solo el icono", t1.querySelector(".tleft").textContent === "" && t1.style.visibility === "", [t1.className, t1.style.visibility]);
  ok("el tooltip de la parada dice los minutos", /60 min/.test(t1.title), t1.title);
  ok("sin timer configurado la columna se reserva", t2.style.visibility === "hidden", t2.style.visibility);

  calls.length = 0;
  t0._ev.click({ stopPropagation() {} });
  ok("tocar el que corre cancela", calls[0].d === "timer" && calls[0].srv === "cancel", calls[0]);
  calls.length = 0;
  t1._ev.click({ stopPropagation() {} });
  ok("tocar el parado aprieta el input_button", calls[0].d === "input_button" && calls[0].srv === "press", calls[0]);

  hass.states["climate.conFan"].state = "off";
  const c12 = mkR({ rooms: [{ entity: "climate.conFan", name: "Apagada",
    timer: { entity: "timer.t_idle", minutes_entity: "input_number.mins" } }] });
  ok("apagada y sin contar, el timer se esconde",
     c12._filas[0].fila.querySelector(".tmr").style.visibility === "hidden",
     c12._filas[0].fila.querySelector(".tmr").style.visibility);
  c12._tick(false);
  hass.states["climate.conFan"].state = "cool";
  c11._tick(false);

  console.log("\n  -- columnas configurables --");
  const cCols = mkR({ columns: ["temps", "power"], rooms: [
    { entity: "climate.conFan", name: "Pieza", power_entity: "sensor.pot",
      window_entity: ["binary_sensor.v1"], fans: ["fan.uno", "fan.dos"],
      timer: { entity: "timer.t_run" } }]});
  const fc = cCols._filas[0].fila;
  ok("temps visible",        fc.querySelector(".temps").style.display !== "none", fc.querySelector(".temps").style.display);
  ok("power visible",        fc.querySelector(".pw").style.display !== "none", fc.querySelector(".pw").style.display);
  ok("ventana fuera",        fc.querySelector(".winwrap").style.display === "none", fc.querySelector(".winwrap").style.display);
  ok("timer fuera",          fc.querySelector(".tmr").style.display === "none", fc.querySelector(".tmr").style.display);
  ok("ventiladores fuera",   fc.querySelector(".fans").style.display === "none", fc.querySelector(".fans").style.display);
  ok("sin columna de fans no se crean botones", cCols._filas[0].btns.length === 0, cCols._filas[0].btns.length);
  ok("y --acrc-fans queda en 1", fc.parentNode.style.getPropertyValue("--acrc-fans") === "1",
     fc.parentNode.style.getPropertyValue("--acrc-fans"));

  const cDef = mkR({ rooms: [{ entity: "climate.conFan", name: "P", fans: ["fan.uno"] }] });
  // el encabezado lleva el rayo sobre la columna de potencia
  const cHead = mkR({ rooms: [{ entity: "climate.conFan", name: "P", power_entity: "sensor.pot" }] });
  const head = cHead._filas[0].fila.parentNode.children[0];
  ok("hay fila de encabezado",   head && head.className === "room head", head && head.className);
  ok("con las tres etiquetas",   head.querySelector(".tgt").textContent === "Target" &&
                                 head.querySelector(".act").textContent === "Actual" &&
                                 head.querySelector(".real").textContent === "Real",
     [head.querySelector(".tgt").textContent, head.querySelector(".act").textContent, head.querySelector(".real").textContent]);
  ok("y el rayo sobre la potencia", /mdi:flash/.test(head.innerHTML), head.innerHTML);
  const cSinPw = mkR({ columns: ["temps"], rooms: [{ entity: "climate.conFan", name: "P" }] });
  const head2 = cSinPw._filas[0].fila.parentNode.children[0];
  ok("sin columna de potencia, no hay rayo", !/mdi:flash/.test(head2.innerHTML), head2.innerHTML);

  ok("sin `columns` se dibujan todas",
     cDef._filas[0].fila.querySelector(".winwrap").style.display !== "none" &&
     cDef._filas[0].fila.querySelector(".fans").style.display !== "none", "alguna quedo fuera");

  console.log("\n  -- columnas alineadas y popup --");
  const c13 = mkR({ rooms: [
    { entity: "climate.conFan", name: "Una",  fans: ["fan.uno"] },
    { entity: "climate.conFan", name: "Tres", fans: ["fan.uno", "fan.dos", "fan.uno"] },
  ]});
  const cont13 = c13._filas[0].fila.parentNode;
  ok("las dos filas comparten contenedor", cont13 === c13._filas[1].fila.parentNode, "no lo comparten");
  ok("--acrc-fans se fija con el maximo (3)",
     cont13.style.getPropertyValue("--acrc-fans") === "3",
     cont13.style.getPropertyValue("--acrc-fans"));
  const c13b = mkR({ rooms: [{ entity: "climate.conFan", name: "Sin fans" }] });
  ok("sin ventiladores el minimo es 1",
     c13b._filas[0].fila.parentNode.style.getPropertyValue("--acrc-fans") === "1",
     c13b._filas[0].fila.parentNode.style.getPropertyValue("--acrc-fans"));

  const c14 = mkR({ rooms: [{ entity: "climate.conFan", name: "Pieza" }] });
  let creado = null;
  global.window.loadCardHelpers = async () => ({ createCardElement: async (cfg) => { creado = cfg; return makeEl("card"); } });
  return (async () => {
    await c14._openPopup(c14._config.rooms[0]);
    ok("el popup crea un ac-room-card", creado && creado.type === "custom:ac-room-card", creado);
    ok("con la config de la pieza",     creado.entity === "climate.conFan" && creado.name === "Pieza", creado);
    ok("el overlay queda montado",      !!c14._overlay, c14._overlay);
    c14._closePopup();
    ok("cerrar lo desmonta",            c14._overlay === null, c14._overlay);
  })().then(() => {

  try { new ROOMS().setConfig({}); ok("sin rooms lanza error", false, "no lanzo"); }
  catch (e) { ok("sin rooms lanza error claro", /rooms/.test(e.message), e.message); }

  console.log(fail === 0 ? "\n=== TODO PASA ===" : `\n=== ${fail} FALLAS ===`);
  process.exit(fail ? 1 : 0);
  });
}
  })); }

console.log(fail === 0 ? "\n=== TODO PASA ===" : `\n=== ${fail} FALLAS ===`);
process.exit(fail ? 1 : 0);
