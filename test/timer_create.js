// Crear el temporizador desde el editor: los minutos, el timer y la
// automatizacion que apaga el aire. Con un Home Assistant de mentira que
// anota lo que se le pide. Suite aparte, con su shim.
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

const ED = DEFS["ac-room-card-editor"];
const crear = ED.crearTemporizador;
const apagar = ED.timerOffActions;

let fail = 0;
const ok = (n, c, got) => {
  console.log((c ? "  PASA  " : "  FALLA ") + n + (c ? "" : "   -> " + JSON.stringify(got)));
  if (!c) fail++;
};

function hassFalso(admin = true) {
  const h = {
    language: "es",
    user: { is_admin: admin },
    states: { "climate.dorm": { state: "cool", attributes: { friendly_name: "Dorm Principal" } } },
    ws: [], api: [],
    callWS: async (msg) => {
      h.ws.push(msg);
      if (msg.type === "input_number/create") return { id: "apagar_dormitorio_en" };
      if (msg.type === "timer/create") return { id: "temporizador_dormitorio" };
      throw new Error("inesperado " + msg.type);
    },
    callApi: async (method, path, body) => { h.api.push({ method, path, body }); return { result: "ok" }; },
  };
  return h;
}

(async () => {
  console.log("\n--- como se apaga cada tipo de aire");
  ok("climate: climate.turn_off", JSON.stringify(apagar({ entity: "climate.dorm" })) ===
     JSON.stringify([{ action: "climate.turn_off", target: { entity_id: "climate.dorm" } }]), apagar({ entity: "climate.dorm" }));
  ok("IR con escena de Apagar: scene.turn_on",
     apagar({ modes: [{ entity: "scene.frio" }], off_entity: "scene.apagar" })[0].action === "scene.turn_on", "");
  ok("IR con boton de Apagar: se aprieta",
     apagar({ modes: [{ entity: "scene.frio" }], off_entity: "input_button.apagar" })[0].action === "input_button.press", "");
  const bools = apagar({ entity: "input_boolean.ac", modes: [{ entity: "input_boolean.ac" }, { entity: "input_boolean.ac_calor" }] });
  ok("IR con booleans: los baja todos, sin repetir",
     bools[0].action === "homeassistant.turn_off" && JSON.stringify(bools[0].target.entity_id) === '["input_boolean.ac","input_boolean.ac_calor"]', bools);
  ok("solo escenas y sin Apagar: no hay como apagarlo", apagar({ modes: [{ entity: "scene.frio" }] }) === null, "");
  ok("sin equipo: tampoco", apagar({ name: "Garage", temp_entity: "sensor.t" }) === null, "");

  console.log("\n--- crear el temporizador de un climate");
  let h = hassFalso();
  const cfg = { type: "custom:ac-room-card", entity: "climate.dorm", name: "Dormitorio", power_entity: "sensor.p" };
  const nuevo = await crear(h, cfg, "es");
  const [num, tim] = h.ws;
  ok("crea los minutos", num.type === "input_number/create" && num.name === "Apagar Dormitorio en" &&
     num.min === 0 && num.max === 480 && num.step === 15 && num.unit_of_measurement === "min", num);
  ok("crea el timer", tim.type === "timer/create" && tim.name === "Temporizador Dormitorio" && tim.duration === "00:00:00", tim);
  ok("y una sola automatizacion", h.api.length === 1 && h.api[0].method === "POST" &&
     h.api[0].path === "config/automation/config/ac_room_card_temporizador_dormitorio", h.api);
  const auto = h.api[0].body;
  ok("con su id y un nombre claro", auto.id === "ac_room_card_temporizador_dormitorio" &&
     auto.alias === "Apagar Dormitorio al terminar el temporizador", auto);
  ok("single y en silencio: apagar el aire la vuelve a disparar y no debe ensuciar el log",
     auto.mode === "single" && auto.max_exceeded === "silent", [auto.mode, auto.max_exceeded]);
  ok("se dispara al terminar el timer", auto.triggers[0].trigger === "event" && auto.triggers[0].event_type === "timer.finished" &&
     auto.triggers[0].event_data.entity_id === "timer.temporizador_dormitorio", auto.triggers[0]);
  ok("y al terminar apaga el climate", auto.actions[0].choose[0].sequence[0].action === "climate.turn_off", auto.actions[0].choose[0]);
  ok("si lo apagan a mano, cancela la cuenta", auto.triggers[1].entity_id === "climate.dorm" && auto.triggers[1].to === "off" &&
     auto.actions[0].choose[1].sequence[0].action === "timer.cancel", auto);
  ok("pero solo si el timer esta corriendo", auto.actions[0].choose[1].conditions[1].state === "active", auto.actions[0].choose[1]);
  ok("deja la tarjeta configurada", nuevo.timer.entity === "timer.temporizador_dormitorio" &&
     nuevo.timer.minutes_entity === "input_number.apagar_dormitorio_en" && !nuevo.timer.button_entity, nuevo.timer);
  ok("sin tocar el resto", nuevo.power_entity === "sensor.p" && nuevo.type === "custom:ac-room-card", nuevo);

  console.log("\n--- otros casos");
  h = hassFalso();
  await crear(h, { entity: "climate.dorm" }, "en");
  ok("sin name usa el del equipo, y en ingles", h.ws[0].name === "Turn off Dorm Principal in" && h.ws[1].name === "Dorm Principal timer", h.ws);
  h = hassFalso();
  await crear(h, { name: "Living", modes: [{ entity: "scene.frio" }], off_entity: "scene.apagar" }, "es");
  const ir = h.api[0].body;
  ok("IR por escenas: apaga con la escena", ir.actions[0].choose[0].sequence[0].action === "scene.turn_on", ir);
  ok("y sin disparador de apagado a mano (no hay estado que mirar)", ir.triggers.length === 1 && ir.actions[0].choose.length === 1, ir.triggers);
  h = hassFalso(false);
  let err = null;
  try { await crear(h, cfg, "es"); } catch (e) { err = e; }
  ok("sin ser administrador no crea nada", err && /administrador/.test(err.message) && h.ws.length === 0 && h.api.length === 0, err && err.message);
  h = hassFalso();
  err = null;
  try { await crear(h, { name: "Garage", temp_entity: "sensor.t" }, "es"); } catch (e) { err = e; }
  ok("sin como apagar el aire tampoco", err && /Primero elige el equipo/.test(err.message) && h.ws.length === 0, err && err.message);

  console.log("\n--- el boton en el editor");
  const e = new ED();
  e._hass = hassFalso();
  e.setConfig(cfg);
  const boton = e._timerBtn.root.children[0];
  const estado = e._timerBtn.root.children[1];
  ok("se ve si el aire no tiene timer", boton.style.display === "" && e._timerBtn.root.style.display === "flex",
     [boton.style.display, e._timerBtn.root.style.display]);
  await boton._ev.click();
  const ultimo = e._eventos[e._eventos.length - 1].detail.config;
  ok("al tocarlo guarda la tarjeta con el timer", ultimo.timer && ultimo.timer.entity === "timer.temporizador_dormitorio", ultimo);
  ok("sin campos internos en la config", ultimo.creados === undefined, Object.keys(ultimo));
  ok("avisa que quedo listo", /^Listo: timer\.temporizador_dormitorio/.test(estado.textContent), estado.textContent);
  ok("y el boton se esconde", boton.style.display === "none", boton.style.display);

  const e2 = new ED();
  e2._hass = hassFalso();
  e2.setConfig({ entity: "climate.dorm", timer: { entity: "timer.ya" } });
  ok("con timer ya puesto no aparece", e2._timerBtn.root.style.display === "none", e2._timerBtn.root.style.display);

  const e3 = new ED();
  e3._hass = hassFalso(false);
  e3.setConfig(cfg);
  await e3._timerBtn.root.children[0]._ev.click();
  ok("si falla, muestra el error en rojo", /administrador/.test(e3._timerBtn.root.children[1].textContent) &&
     /error-color/.test(e3._timerBtn.root.children[1].style.color), e3._timerBtn.root.children[1]);

  console.log(fail === 0 ? "\n=== TODO PASA ===" : `\n=== ${fail} FALLAS ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log("  FALLA con excepcion: " + (err && err.stack || err)); process.exit(1); });
