/*!
 * ac-room-card
 * Envuelve el card `thermostat` integrado de Home Assistant y le agrega
 * filas opcionales de potencia, energia y sensor de ventana.
 *
 * No copia codigo de Home Assistant: instancia el card integrado en runtime
 * a traves de loadCardHelpers(). Licencia MIT (ver LICENSE).
 */

const VERSION = "0.27.1";

const T = {
  today: "Hoy",
  month: "Mes",
  window: "Ventana",
  open: "Abierta",
  closed: "Cerrada",
  warn: "Ventana abierta con el aire andando",
  target: "Target",
  actual: "Actual",
  real: "Real",
  schedule: "Programar",
  cancel: "Cancelar",
  offIn: "Apaga en",
  min: "min",
  off: "Apagado",
  isOn: "encendido",
  isOff: "apagado",
  speed: "Velocidad del ventilador",
  windows: "Ventanas",
  batLow: "pila baja",
  unavailable: "no disponible",
};

/* ---------- helpers compartidos ---------- */

/* Acepta "sensor.x" o {entity, ...} y devuelve siempre objetos. */
function normEntries(v) {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v])
    .map((x) => (typeof x === "string" ? { entity: x } : x))
    .filter((x) => x && x.entity);
}

/* closed / some / all / unknown, mas el detalle para el tooltip. */
function computeWindows(hass, lista, L) {
  let abiertas = 0, conocidas = 0;
  const detalle = [];
  for (const w of lista) {
    const st = hass.states[w.entity];
    const nombre = w.name || (st && st.attributes.friendly_name) || w.entity;
    if (!st || st.state === "unavailable" || st.state === "unknown") {
      detalle.push(`${nombre}: ${L.unavailable}`);
      continue;
    }
    conocidas++;
    const abierta = st.state === "on";
    if (abierta) abiertas++;
    detalle.push(`${nombre}: ${abierta ? L.open : L.closed}`);
  }
  let estado = "unknown";
  if (conocidas > 0) estado = abiertas === 0 ? "closed" : (abiertas === conocidas ? "all" : "some");
  return { estado, abiertas, conocidas, detalle, lista };
}

function batteriesLow(hass, lista, umbral) {
  const bajos = [];
  for (const w of lista) {
    if (!w.battery) continue;
    const st = hass.states[w.battery];
    if (!st) continue;
    const v = parseFloat(st.state);
    if (!Number.isNaN(v) && v <= umbral) {
      bajos.push(`${w.name || st.attributes.friendly_name || w.battery}: ${v}%`);
    }
  }
  return bajos;
}

/* Segundos que le quedan a un timer, o null si esta parado. */
function remainingSecs(hass, entityId) {
  const st = entityId && hass.states[entityId];
  if (!st) return null;
  if (st.state === "active" && st.attributes.finishes_at) {
    const s = Math.round(new Date(st.attributes.finishes_at).getTime() / 1000 - Date.now() / 1000);
    return s > 0 ? s : 0;
  }
  if (st.state === "paused" && st.attributes.remaining) {
    const [h, m, x] = String(st.attributes.remaining).split(":").map(Number);
    return h * 3600 + m * 60 + (x || 0);
  }
  return null;
}

function hms(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
}

function moreInfo(el, entityId) {
  if (!entityId) return;
  el.dispatchEvent(new CustomEvent("hass-more-info", {
    detail: { entityId }, bubbles: true, composed: true,
  }));
}

class AcRoomCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._inner = null;
    this._rows = {};
    this._built = false;
  }

  static getConfigElement() {
    return document.createElement("ac-room-card-editor");
  }

  static getStubConfig(hass, entities) {
    const climate = (entities || []).find((e) => e.startsWith("climate."));
    return { entity: climate || "climate.example" };
  }

  setConfig(config) {
    // `entity` ya no es obligatoria: sirve una tarjeta sin equipo de clima,
    // por ejemplo un garage con solo sensor de puerta y ventiladores.
    const algo = config && (config.entity || config.base_card || config.power_entity ||
      config.window_entity || config.temp_entity ||
      (config.fans && config.fans.length) || (config.modes && config.modes.length) ||
      (config.timer && config.timer.entity));
    if (!algo) {
      throw new Error("Configura al menos una entidad (equipo, potencia, ventana, temperatura, ventiladores o temporizador)");
    }
    this._config = {
      labels: {},
      ...config,
      labels: { ...T, ...(config.labels || {}) },
    };
    // Un cambio de config obliga a reconstruir el card interno.
    this._built = false;
    this._inner = null;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    if (!this._config) return 3;
    const extra = this._config.timer && this._config.timer.entity ? 1 : 0;
    if (this._config.base_card) return 4 + extra;
    if (!this._config.entity) return 2;
    return this._config.entity.startsWith("climate.") ? 6 : 3;
  }

  /* ---------- construccion ---------- */

  async _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) {
      this._built = true; // antes del await, para no construir dos veces
      try {
        await this._build();
      } catch (err) {
        this._built = false;
        this._renderError(err);
        return;
      }
    }
    if (this._inner) this._inner.hass = this._hass;
    this._update();
  }

  async _build() {
    const cfg = this._config;
    const domain = cfg.entity ? cfg.entity.split(".")[0] : "";

    const helpers = await window.loadCardHelpers();

    // Con `modes` el propio card dibuja el selector, asi que no hace falta
    // envolver nada salvo que se pida un base_card explicito.
    // Sin card arriba cuando: se pide explicitamente (base_card: false), hay
    // selector de modos propio, o no hay equipo que mostrar.
    const skipInner = cfg.base_card === false ||
      (!cfg.base_card && ((Array.isArray(cfg.modes) && cfg.modes.length > 0) || !cfg.entity));

    // base_card permite envolver CUALQUIER card (custom:mini-climate,
    // custom:simple-thermostat, etc). Sin el, se usa el thermostat integrado
    // para entidades climate y un tile para el resto.
    let innerCfg;
    if (cfg.base_card) {
      innerCfg = { ...cfg.base_card };
      if (!innerCfg.entity) innerCfg.entity = cfg.entity;
    } else {
      innerCfg =
        domain === "climate"
          ? { type: "thermostat", entity: cfg.entity }
          : { type: "tile", entity: cfg.entity, features_position: "bottom", vertical: false };
      // cfg.name pinta el encabezado propio. Al card interno se le manda un
      // espacio para que no repita el friendly_name debajo del encabezado.
      if (cfg.name) innerCfg.name = " ";
      if (cfg.features) innerCfg.features = cfg.features;
    }

    if (!skipInner) {
      this._inner = await helpers.createCardElement(innerCfg);
      this._inner.hass = this._hass;
    }

    const card = document.createElement("ha-card");
    card.className = "root";

    if (cfg.name) {
      const head = document.createElement("div");
      head.className = "header";
      head.innerHTML =
        (cfg.icon ? `<ha-icon class="hicon" icon="${cfg.icon}"></ha-icon>` : "") +
        `<span class="title"></span>`;
      head.querySelector(".title").textContent = cfg.name;
      card.appendChild(head);
    }

    if (this._inner) {
      const innerWrap = document.createElement("div");
      innerWrap.className = "inner";
      innerWrap.appendChild(this._inner);
      card.appendChild(innerWrap);
    }

    if (Array.isArray(cfg.modes) && cfg.modes.length) {
      const mr = document.createElement("div");
      mr.className = "moderow";
      const mk = (label, icon, idx) => {
        const b = document.createElement("button");
        b.className = "mode";
        b.dataset.idx = String(idx);
        b.innerHTML = (icon ? `<ha-icon icon="${icon}"></ha-icon>` : "") + `<span></span>`;
        b.querySelector("span").textContent = label;
        b.addEventListener("click", () => this._setMode(idx));
        mr.appendChild(b);
        return b;
      };
      this._modeBtns = [mk(cfg.labels.off, "mdi:power", -1)];
      cfg.modes.forEach((m, i) => this._modeBtns.push(mk(m.name || m.entity, m.icon, i)));
      card.appendChild(mr);
      this._rows.modes = mr;
    }

    const footer = document.createElement("div");
    footer.className = "footer";
    card.appendChild(footer);

    this._rows.power = this._addRow(footer, "mdi:flash", null, true);
    this._rows.energy = this._addRow(footer, "mdi:lightning-bolt-outline", cfg.labels.today);

    if (this._fanModeSupported()) this._buildFanMode();

    /* Por defecto todos van en la linea de datos: caben de sobra y se lee
       mejor que con una fila aparte. `auto` deja el comportamiento viejo (uno
       en la linea, dos o mas en fila propia) y `row` fuerza la fila. */
    const fans = this._fanList();
    const modo = cfg.fans_position || "inline";
    const enLinea = fans.length > 0 &&
      (modo === "inline" || (modo === "auto" && fans.length === 1));
    this._fansInline = enLinea;
    if (enLinea) {
      // position: "start" los pone antes de la potencia; el resto va al final
      const fin = this._rows.power.querySelector(".fanslot");
      const ini = this._rows.power.querySelector(".preslot");
      this._fanBtns = fans.map((f) => {
        const b = this._makeFanBtn(f);
        (f.position === "start" && ini ? ini : fin).appendChild(b);
        return b;
      });
    } else if (fans.length) {
      this._fanBtns = [];  // la fila va despues del temporizador
    }

    if (cfg.timer && cfg.timer.entity) {
      const t = document.createElement("div");
      t.className = "timerrow";
      t.innerHTML =
        `<ha-icon class="tico" icon="mdi:timer-outline"></ha-icon>` +
        `<button class="step minus" title="-">\u2212</button>` +
        `<span class="mins"></span>` +
        `<button class="step plus" title="+">+</button>` +
        `<button class="go"></button>`;
      card.appendChild(t);
      this._rows.timer = t;
      t.querySelector(".minus").addEventListener("click", () => this._nudge(-1));
      t.querySelector(".plus").addEventListener("click", () => this._nudge(1));
      t.querySelector(".go").addEventListener("click", () => this._go());
    }

    if (fans.length && !enLinea) {
      const fr = document.createElement("div");
      fr.className = "fanrow";
      for (const f of fans) {
        const b = this._makeFanBtn(f);
        fr.appendChild(b);
        this._fanBtns.push(b);
      }
      card.appendChild(fr);
      this._rows.fans = fr;
    }

    const warn = document.createElement("div");
    warn.className = "warn";
    warn.innerHTML = `<ha-icon icon="mdi:alert"></ha-icon><span></span>`;
    card.appendChild(warn);
    this._rows.warn = warn;

    this.shadowRoot.innerHTML = "";
    this.shadowRoot.appendChild(this._style());
    this.shadowRoot.appendChild(card);

    if (this._inner) this._stripInnerCard();
  }

  _addRow(parent, icon, label, withWindow) {
    const row = document.createElement("div");
    row.className = "row";
    if (withWindow) row.className = "row main";
    row.innerHTML =
      (withWindow ? `<span class="preslot"></span>` : "") +
      `<ha-icon class="picon" icon="${icon}"></ha-icon>` +
      (label === null ? "" : `<span class="label">${label}</span>`) +
      `<span class="value"></span>` +
      (withWindow
        ? `<span class="winwrap"><ha-icon class="win"></ha-icon>` +
          `<span class="batdot"></span></span>` +
          `<ha-icon class="tempicon" icon="mdi:thermometer"></ha-icon>` +
          `<span class="temp"></span>` +
          `<span class="fanslot"></span>` +
          `<span class="fmslot"></span>`
        : "");
    parent.appendChild(row);
    return row;
  }

  /* El card interno trae su propio <ha-card>. Le sacamos borde y fondo para
     que no se vea un marco dentro de otro. Vive en shadow DOM, asi que hay
     que entrar a buscarlo; si no aparece, el card igual funciona. */
  _stripInnerCard(tries = 0) {
    const inner = this._inner;
    if (!inner) return;
    const target = inner.shadowRoot && inner.shadowRoot.querySelector("ha-card");
    if (!target) {
      if (tries < 10) setTimeout(() => this._stripInnerCard(tries + 1), 60);
      return;
    }
    target.style.boxShadow = "none";
    target.style.border = "none";
    target.style.background = "none";
    target.style.borderRadius = "0";
    this._injectInnerStyle();
  }

  /* base_card_style: CSS inyectado DENTRO del shadow root del card envuelto.
     Acepta un string, o un mapa selector -> css para llegar a shadow roots
     anidados (por ejemplo mc-temperature, que tiene el suyo propio). */
  _injectInnerStyle(tries = 0) {
    const cfg = this._config.base_card_style;
    const root = this._inner && this._inner.shadowRoot;
    if (!cfg || !root) return;
    const mapa = typeof cfg === "string" ? { "": cfg } : cfg;
    let faltan = false;
    for (const [sel, css] of Object.entries(mapa)) {
      let destino = root;
      if (sel) {
        const el = root.querySelector(sel);
        // Los elementos anidados montan despues; se reintenta.
        if (!el || !el.shadowRoot) { faltan = true; continue; }
        destino = el.shadowRoot;
      }
      const marca = `style[data-acrc="${sel}"]`;
      let st = destino.querySelector(marca);
      if (!st) {
        st = document.createElement("style");
        st.setAttribute("data-acrc", sel);
        destino.appendChild(st);
      }
      if (st.textContent !== css) st.textContent = css;
    }
    if (faltan && tries < 15) setTimeout(() => this._injectInnerStyle(tries + 1), 100);
  }

  _renderError(err) {
    this.shadowRoot.innerHTML =
      `<ha-card style="padding:16px;color:var(--error-color,#db4437)">` +
      `ac-room-card: ${err && err.message ? err.message : err}</ha-card>`;
  }

  /* ---------- datos ---------- */

  _fmt(entityId) {
    if (!entityId) return null;
    const st = this._hass.states[entityId];
    if (!st) return { text: this._config.labels.unavailable, missing: true };
    if (st.state === "unavailable" || st.state === "unknown") {
      return { text: this._config.labels.unavailable, missing: true };
    }
    let text;
    if (typeof this._hass.formatEntityState === "function") {
      text = this._hass.formatEntityState(st);
    } else {
      const n = Number(st.state);
      let v = st.state;
      // Sin formatEntityState, un sensor como 22.6000003814697 se veria entero.
      if (!Number.isNaN(n) && /\.\d{3,}/.test(st.state)) v = n.toFixed(1);
      const u = st.attributes.unit_of_measurement;
      text = u ? `${v} ${u}` : v;
    }
    return { text, missing: false, state: st };
  }

  _update() {
    const cfg = this._config;
    const L = cfg.labels;

    /* Fila unica: potencia y, pegado al lado, el simbolo de ventana.
       Verde todas cerradas, naranjo algunas, rojo todas, gris sin dato. */
    const win = this._rows.power.querySelector(".win");
    const wrap = this._rows.power.querySelector(".winwrap");
    const dot = this._rows.power.querySelector(".batdot");
    const w = this._windowState();
    let windowOpen = false;
    if (!wrap || !win || !dot) {
      // Nunca deberia pasar; si pasa, es preferible perder el icono de
      // ventana antes que abortar _update y dejar el card entero en blanco.
      windowOpen = w.abiertas > 0;
    } else if (!w.lista.length) {
      wrap.style.display = "none";
    } else {
      wrap.style.display = "";
      windowOpen = w.abiertas > 0;
      const CLASES = { closed: "win closed", some: "win some", all: "win open", unknown: "win unknown" };
      win.className = CLASES[w.estado];
      win.setAttribute("icon", windowOpen ? "mdi:window-open-variant" : "mdi:window-closed-variant");
      const resumen = w.lista.length > 1 ? ` (${w.abiertas}/${w.conocidas})` : "";
      win.setAttribute("title", `${L.window}${resumen}\n${w.detalle.join("\n")}`);

      const bajos = this._batteryLow();
      dot.style.display = bajos.length ? "" : "none";
      if (bajos.length) dot.setAttribute("title", `${L.batLow}\n${bajos.join("\n")}`);
    }

    // Temperatura de la pieza, a la derecha del simbolo de ventana
    const tIcon = this._rows.power.querySelector(".tempicon");
    const tVal = this._rows.power.querySelector(".temp");
    const t = this._fmt(cfg.temp_entity);
    if (!t) {
      tIcon.style.display = "none";
      tVal.style.display = "none";
    } else {
      tIcon.style.display = "";
      tVal.style.display = "";
      tVal.textContent = t.text;
    }

    const p = this._fmt(cfg.power_entity);
    if (!p && !cfg.window_entity && !cfg.temp_entity) {
      this._rows.power.style.display = "none";
    } else {
      this._rows.power.style.display = "";
      // El rayo es del sensor de potencia: sin sensor, no se dibuja.
      const pic = this._rows.power.querySelector(".picon");
      if (pic) pic.style.display = cfg.power_entity ? "" : "none";
      this._rows.power.querySelector(".value").textContent = p ? p.text : "";
    }

    // Energia: hoy y/o mes, en su propia fila (opcional)
    const today = this._fmt(cfg.energy_today_entity);
    const month = this._fmt(cfg.energy_month_entity);
    if (!today && !month) {
      this._rows.energy.style.display = "none";
    } else {
      this._rows.energy.style.display = "";
      const parts = [];
      if (today) parts.push(`${L.today} ${today.text}`);
      if (month) parts.push(`${L.month} ${month.text}`);
      this._rows.energy.querySelector(".label").textContent = "";
      this._rows.energy.querySelector(".value").textContent = parts.join(" \u00b7 ");
    }

    // Aviso opcional (por defecto apagado: el icono rojo ya lo dice)
    let acOn;
    if (Array.isArray(cfg.modes) && cfg.modes.length) {
      acOn = this._activeMode() >= 0;
    } else {
      const main = cfg.entity ? this._hass.states[cfg.entity] : null;
      acOn = !!main && main.state !== "off" && main.state !== "unavailable" && main.state !== "unknown";
    }
    const show = !!cfg.show_warning && windowOpen && acOn;
    this._rows.warn.style.display = show ? "flex" : "none";
    if (show) this._rows.warn.querySelector("span").textContent = L.warn;

    this._bindMoreInfo(this._rows.power.querySelector(".picon"), () => cfg.power_entity);
    this._bindMoreInfo(this._rows.power.querySelector(".value"), () => cfg.power_entity);
    this._bindMoreInfo(this._rows.power.querySelector(".win"), () => {
      const w = this._windowState();
      const abierta = w.lista.find((x) => {
        const st = this._hass.states[x.entity];
        return st && st.state === "on";
      });
      return (abierta || w.lista[0] || {}).entity;
    });
    this._bindMoreInfo(this._rows.power.querySelector(".tempicon"), () => cfg.temp_entity);
    this._bindMoreInfo(this._rows.power.querySelector(".temp"), () => cfg.temp_entity);

    this._updateFanMode();
    this._updateFans();
    this._updateModes();
    this._updateTimer();
  }

  /* ---------- ventanas ---------- */

  _windowList() {
    return normEntries(this._config.window_entity);
  }

  /* closed = todas cerradas, some = algunas, all = todas abiertas.
     Con una sola ventana `some` no puede ocurrir, asi que el naranjo
     aparece solo cuando de verdad hay algo parcial. */
  _windowState() {
    return computeWindows(this._hass, this._windowList(), this._config.labels);
  }

  /* Pila baja de cualquiera de los sensores de ventana. Es una falla
     silenciosa: el sensor deja de reportar y la ventana parece cerrada. */
  _batteryLow() {
    const umbral = this._config.battery_warn === undefined ? 20 : Number(this._config.battery_warn);
    return batteriesLow(this._hass, this._windowList(), umbral);
  }

  /* ---------- interaccion ---------- */

  /* Abre el dialogo estandar de Home Assistant. composed:true es obligatorio:
     sin eso el evento no sale del shadow DOM del card. */
  _moreInfo(entityId) {
    moreInfo(this, entityId);
  }

  _bindMoreInfo(el, getEntity) {
    if (!el || el._bound) return;
    el._bound = true;
    el.style.cursor = "pointer";
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._moreInfo(getEntity());
    });
  }

  /* ---------- ventiladores ---------- */

  _fanList() {
    return normEntries(this._config.fans);
  }

  _fanIsOn(entityId) {
    const st = this._hass.states[entityId];
    return !!st && st.state === "on";
  }

  _toggleFan(entityId) {
    // homeassistant.toggle sirve para fan, switch y tambien para los
    // ventiladores que quedaron expuestos como light.
    this._hass.callService("homeassistant", "toggle", { entity_id: entityId });
  }

  _makeFanBtn(f) {
    const b = document.createElement("button");
    b.className = "fan";
    b.dataset.entity = f.entity;
    const st = this._hass.states[f.entity];
    b.dataset.label = f.name || (st && st.attributes.friendly_name) || f.entity;
    // color propio para el estado encendido; sin esto se usa el verde comun
    if (f.color) b.dataset.color = f.color;
    b.innerHTML = `<ha-icon icon="${f.icon || "mdi:fan"}"></ha-icon>`;
    b.addEventListener("click", () => this._toggleFan(f.entity));
    return b;
  }

  _updateFans() {
    if (!this._fanBtns) return;
    const L = this._config.labels;
    for (const b of this._fanBtns) {
      const st = this._hass.states[b.dataset.entity];
      const on = !!st && st.state === "on";
      b.className = on ? "fan on" : "fan off";
      b.style.color = on && b.dataset.color ? b.dataset.color : "";
      // Sin nombre visible: el tooltip es lo que distingue un ventilador de otro
      b.title = `${b.dataset.label}: ${!st ? L.unavailable : on ? L.isOn : L.isOff}`;
    }
  }

  /* ---------- velocidad del ventilador del equipo ---------- */

  _fanModeSupported() {
    if (!this._config.fan_mode || !this._config.entity) return false;
    const st = this._hass.states[this._config.entity];
    return !!(st && Array.isArray(st.attributes.fan_modes) && st.attributes.fan_modes.length);
  }

  _buildFanMode() {
    const slot = this._rows.power.querySelector(".fmslot");
    const wrap = document.createElement("span");
    wrap.className = "fanmode";
    wrap.innerHTML = `<ha-icon icon="mdi:fan"></ha-icon><select></select>`;
    const sel = wrap.querySelector("select");
    sel.title = this._config.labels.speed;
    // change, no click: asi el desplegable nativo muestra las opciones y
    // recien al elegir una se llama al servicio.
    sel.addEventListener("change", () => {
      this._hass.callService("climate", "set_fan_mode", {
        entity_id: this._config.entity,
        fan_mode: sel.value,
      });
    });
    slot.appendChild(wrap);
    this._fanModeEl = wrap;
  }

  _prettyMode(m) {
    const custom = this._config.fan_mode_names || {};
    if (custom[m]) return custom[m];
    return String(m).charAt(0).toUpperCase() + String(m).slice(1);
  }

  _updateFanMode() {
    if (!this._fanModeEl || !this._config.entity) return;
    const st = this._hass.states[this._config.entity];
    const modes = (st && st.attributes.fan_modes) || [];
    const actual = st && st.attributes.fan_mode;
    const sel = this._fanModeEl.querySelector("select");
    const firma = modes.join("|");
    if (sel._firma !== firma) {
      sel._firma = firma;
      sel.innerHTML = "";
      for (const m of modes) {
        const o = document.createElement("option");
        o.value = m;
        o.textContent = this._prettyMode(m);
        sel.appendChild(o);
      }
    }
    if (actual !== undefined && sel.value !== actual) sel.value = actual;
    const apagado = !st || st.state === "off" || st.state === "unavailable";
    this._fanModeEl.className = apagado ? "fanmode off" : "fanmode";
  }

  /* ---------- modos (frio / calor) ---------- */

  _activeMode() {
    const modes = this._config.modes || [];
    for (let i = 0; i < modes.length; i++) {
      const st = this._hass.states[modes[i].entity];
      if (st && st.state === "on") return i;
    }
    return -1;
  }

  /* Apaga primero los otros y despues prende el elegido: si cada boolean
     dispara una escena IR, el orden inverso dejaria el equipo apagado. */
  _setMode(idx) {
    const modes = this._config.modes || [];
    modes.forEach((m, i) => {
      if (i !== idx && this._hass.states[m.entity] && this._hass.states[m.entity].state === "on") {
        this._hass.callService("input_boolean", "turn_off", { entity_id: m.entity });
      }
    });
    if (idx >= 0 && modes[idx]) {
      this._hass.callService("input_boolean", "turn_on", { entity_id: modes[idx].entity });
    }
  }

  _updateModes() {
    if (!this._modeBtns) return;
    const active = this._activeMode();
    this._modeBtns.forEach((b) => {
      b.className = Number(b.dataset.idx) === active ? "mode on" : "mode";
    });
  }

  /* ---------- timer ---------- */

  _timerCfg() {
    return (this._config && this._config.timer) || null;
  }

  _minsEntity() {
    const t = this._timerCfg();
    return t && t.minutes_entity ? this._hass.states[t.minutes_entity] : null;
  }

  _nudge(dir) {
    const t = this._timerCfg();
    const st = this._minsEntity();
    if (!t || !st) return;
    const step = Number(st.attributes.step) || 1;
    const min = Number(st.attributes.min);
    const max = Number(st.attributes.max);
    let v = Number(st.state) + dir * step;
    if (!Number.isNaN(min)) v = Math.max(min, v);
    if (!Number.isNaN(max)) v = Math.min(max, v);
    this._hass.callService("input_number", "set_value", {
      entity_id: t.minutes_entity,
      value: v,
    });
  }

  _go() {
    const t = this._timerCfg();
    if (!t) return;
    const st = this._hass.states[t.entity];
    if (st && (st.state === "active" || st.state === "paused")) {
      this._hass.callService("timer", "cancel", { entity_id: t.entity });
      return;
    }
    if (t.button_entity) {
      // Deja que corra la automatizacion existente (valida que el aire este andando)
      this._hass.callService("input_button", "press", { entity_id: t.button_entity });
    } else {
      const mins = this._minsEntity();
      const secs = Math.round((mins ? Number(mins.state) : 0) * 60);
      if (secs > 0) {
        this._hass.callService("timer", "start", { entity_id: t.entity, duration: secs });
      }
    }
  }

  _remainingSecs() {
    const t = this._timerCfg();
    return t ? remainingSecs(this._hass, t.entity) : null;
  }

  _hms(s) {
    return hms(s);
  }

  _updateTimer() {
    const row = this._rows.timer;
    if (!row) return;
    const L = this._config.labels;
    const secs = this._remainingSecs();
    const running = secs !== null;

    row.className = running ? "timerrow running" : "timerrow";
    row.querySelector(".tico").setAttribute("icon", running ? "mdi:timer-sand" : "mdi:timer-outline");
    row.querySelector(".minus").style.display = running ? "none" : "";
    row.querySelector(".plus").style.display = running ? "none" : "";
    row.querySelector(".go").textContent = running ? L.cancel : L.schedule;

    if (running) {
      row.querySelector(".mins").textContent = `${L.offIn} ${this._hms(secs)}`;
    } else {
      const st = this._minsEntity();
      row.querySelector(".mins").textContent = st ? `${Math.round(Number(st.state))} ${L.min}` : "";
    }
    this._tick(running);
  }

  /* Cuenta regresiva local: evita depender de un sensor de plantilla que
     escriba en el recorder cada segundo. */
  _tick(on) {
    if (on && !this._ticker) {
      this._ticker = setInterval(() => this._updateTimer(), 1000);
    } else if (!on && this._ticker) {
      clearInterval(this._ticker);
      this._ticker = null;
    }
  }

  disconnectedCallback() {
    this._tick(false);
  }

  _setRow(row, data) {
    if (!data) {
      row.style.display = "none";
      return;
    }
    row.style.display = "";
    row.querySelector(".value").textContent = data.text;
  }

  _style() {
    const s = document.createElement("style");
    s.textContent = `
      .root { overflow: hidden; }
      .inner { display: block; }
      .header {
        display: flex; align-items: center; gap: 8px;
        padding: 14px 16px 0 16px;
        font-size: 16px; font-weight: 500;
        color: var(--primary-text-color);
      }
      .header .hicon { --mdc-icon-size: 22px; color: var(--state-icon-color, #44739e); flex: 0 0 auto; }
      .footer { padding: 0 16px 8px 16px; }
      .row {
        display: flex; align-items: center; gap: 10px;
        padding: 7px 0; font-size: 14px;
        border-top: 1px solid var(--divider-color, #e0e0e0);
        color: var(--primary-text-color);
      }
      .row ha-icon { --mdc-icon-size: 20px; color: var(--state-icon-color, var(--paper-item-icon-color, #44739e)); flex: 0 0 auto; }
      .row .label { color: var(--secondary-text-color); flex: 0 0 auto; }
      .row .value { margin-left: auto; text-align: right; font-weight: 500; }
      .row.main .value { margin-left: 0; }
      .row .tempicon { margin-left: 14px; --mdc-icon-size: 20px; flex: 0 0 auto;
        color: var(--state-icon-color, var(--paper-item-icon-color, #44739e)); }
      .row .temp { margin-left: 4px; font-weight: 500; }
      .row .win { margin-left: 10px; --mdc-icon-size: 20px; flex: 0 0 auto; }
      .row .winwrap { position: relative; display: inline-flex; margin-left: 10px; }
      .row .win { margin-left: 0; }
      .row .win.closed  { color: var(--success-color, #43a047); }
      .row .win.some    { color: var(--warning-color, #ffa600); }
      .row .win.open    { color: var(--error-color, #db4437); }
      .row .win.unknown { color: var(--disabled-text-color, #9e9e9e); }
      .row .batdot {
        display: none; position: absolute; right: -1px; bottom: -1px;
        width: 7px; height: 7px; border-radius: 50%;
        background: var(--error-color, #db4437);
        box-shadow: 0 0 0 1.5px var(--card-background-color, #fff);
      }
      .fanmode {
        display: inline-flex; align-items: center; gap: 4px; margin-left: 12px;
        color: var(--state-icon-color, #44739e);
      }
      .fanmode ha-icon { --mdc-icon-size: 20px; }
      .fanmode select {
        font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
        color: var(--primary-text-color); background: transparent;
        border: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px;
        padding: 2px 4px;
      }
      .fanmode.off { opacity: .55; }
      .row .preslot { display: inline-flex; gap: 10px; margin-right: 10px; }
      .row .preslot:empty { display: none; }
      .row .fanslot { margin-left: 12px; display: inline-flex; gap: 10px; }
      .row .fanslot:empty { margin-left: 0; }
      /* Sin marco ni fondo: al lado del rayo y del termometro, que son
         iconos pelados, un boton encajonado desentona. */
      .fan {
        display: inline-flex; align-items: center;
        font: inherit; cursor: pointer;
        border: none; background: transparent; padding: 0;
      }
      /* La regla .row ha-icon fija el color de TODOS los iconos de la fila,
         incluido el del ventilador, y le ganaba a la herencia de .fan.on y
         .fan.off: el icono nunca cambiaba de color. inherit devuelve el mando
         al boton. */
      .fan ha-icon { --mdc-icon-size: 20px; color: inherit; }
      .fan.on  { color: var(--success-color, #43a047); }
      .fan.on ha-icon { animation: acrc-spin 2s linear infinite; }
      .fan.off { color: var(--info-color, #039be5); }
      .fan:hover { opacity: .7; }
      @keyframes acrc-spin { to { transform: rotate(360deg); } }
      .fanrow {
        display: flex; flex-wrap: wrap; gap: 14px;
        padding: 7px 16px 10px 16px;
        border-top: 1px solid var(--divider-color, #e0e0e0);
      }
      .moderow {
        display: flex; gap: 6px; padding: 10px 16px 4px 16px;
      }
      .moderow .mode {
        flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
        font: inherit; font-size: 13px; cursor: pointer; padding: 6px 4px;
        border: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px;
        background: transparent; color: var(--secondary-text-color);
      }
      .moderow .mode ha-icon { --mdc-icon-size: 18px; }
      .moderow .mode:hover { background: var(--secondary-background-color, #f0f0f0); }
      .moderow .mode.on {
        border-color: var(--primary-color, #03a9f4);
        color: var(--primary-color, #03a9f4);
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, transparent);
        font-weight: 500;
      }
      .timerrow {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 16px 12px 16px;
        border-top: 1px solid var(--divider-color, #e0e0e0);
      }
      .timerrow ha-icon { --mdc-icon-size: 20px; color: var(--state-icon-color, #44739e); flex: 0 0 auto; }
      .timerrow.running ha-icon { color: var(--warning-color, #ffa600); }
      .timerrow .mins { font-size: 14px; font-weight: 500; min-width: 64px; }
      .timerrow.running .mins { color: var(--warning-color, #ffa600); }
      .timerrow button {
        font: inherit; font-size: 13px; cursor: pointer;
        border: 1px solid var(--divider-color, #e0e0e0);
        background: transparent; color: var(--primary-text-color);
        border-radius: 6px; padding: 3px 9px;
      }
      .timerrow button:hover { background: var(--secondary-background-color, #f0f0f0); }
      .timerrow .step { min-width: 28px; }
      .timerrow .go { margin-left: auto; color: var(--primary-color, #03a9f4); font-weight: 500; }
      .timerrow.running .go { color: var(--error-color, #db4437); }
      .warn {
        display: none; align-items: center; gap: 8px;
        margin: 0 12px 12px 12px; padding: 8px 12px; border-radius: 8px;
        background: color-mix(in srgb, var(--warning-color, #ffa600) 18%, transparent);
        color: var(--primary-text-color); font-size: 13px;
      }
      .warn ha-icon { --mdc-icon-size: 18px; color: var(--warning-color, #ffa600); }
    `;
    return s;
  }
}


/* ---------- editor visual ---------- */

const EDITOR_LABELS = {
  entity: "Equipo (opcional: sin el, no se dibuja tarjeta arriba)",
  name: "Nombre que se muestra arriba",
  window_entity: "Ventanas (verde todas cerradas, naranjo algunas, rojo todas)",
  battery_warn: "Avisar pila baja bajo (%)",
  fans: "Ventiladores (uno va en la linea; dos o mas, en su propia fila)",
  fan_mode: "Mostrar la velocidad del ventilador del equipo",
  fans_position: "Donde van los ventiladores",
  mode_cold_entity: "Boolean de FRIO (equipos sin entidad climate)",
  mode_heat_entity: "Boolean de CALOR (opcional)",
  icon: "Icono del encabezado (opcional)",
  power_entity: "Potencia",
  temp_entity: "Temperatura de la pieza",
  window_entity: "Sensor de ventana",
  energy_today_entity: "Energia de hoy",
  energy_month_entity: "Energia del mes",
  timer_entity: "Temporizador",
  timer_minutes_entity: "Minutos (input_number)",
  timer_button_entity: "Boton que dispara tu automatizacion",
  show_warning: "Avisar por texto si la ventana esta abierta con el aire andando",
};

function normFans(list) {
  if (!list) return [];
  return (Array.isArray(list) ? list : [list])
    .map((x) => (typeof x === "string" ? { entity: x } : x))
    .filter((x) => x && x.entity);
}

const fanIds = (list) => normFans(list).map((f) => f.entity);

/* El esquema se arma en cada render porque los campos de nombre dependen de
   cuantos ventiladores haya elegidos. */
function buildSchema(config) {
  const schema = BASE_SCHEMA.slice();
  const fans = fanIds((config || {}).fans);
  if (fans.length) {
    schema.push({
      name: "",
      type: "grid",
      schema: fans.map((_, i) => ({ name: `fan_name_${i}`, selector: { text: {} } })),
    });
  }
  return schema;
}

const BASE_SCHEMA = [
  { name: "entity",
    selector: { entity: { domain: ["climate", "input_boolean", "switch"] } } },
  { name: "", type: "grid", schema: [
    { name: "name", selector: { text: {} } },
    { name: "icon", selector: { icon: {} } },
  ]},
  { name: "", type: "grid", schema: [
    { name: "power_entity", selector: { entity: { domain: "sensor", device_class: "power" } } },
    { name: "temp_entity", selector: { entity: { domain: "sensor", device_class: "temperature" } } },
  ]},
  { name: "", type: "grid", schema: [
    { name: "mode_cold_entity", selector: { entity: { domain: ["input_boolean", "switch"] } } },
    { name: "mode_heat_entity", selector: { entity: { domain: ["input_boolean", "switch"] } } },
  ]},
  { name: "window_entity", selector: { entity: { domain: "binary_sensor", multiple: true } } },
  { name: "fans", selector: { entity: { domain: ["fan", "switch", "light"], multiple: true } } },
  { name: "fans_position", selector: { select: { mode: "dropdown", options: [
      { value: "inline", label: "En la linea de datos (por defecto)" },
      { value: "auto", label: "Uno en la linea, varios en fila propia" },
      { value: "row", label: "Siempre en fila propia" }] } } },
  { name: "", type: "grid", schema: [
    { name: "energy_today_entity", selector: { entity: { domain: "sensor", device_class: "energy" } } },
    { name: "energy_month_entity", selector: { entity: { domain: "sensor", device_class: "energy" } } },
  ]},
  { name: "", type: "grid", schema: [
    { name: "timer_entity", selector: { entity: { domain: "timer" } } },
    { name: "timer_minutes_entity", selector: { entity: { domain: "input_number" } } },
  ]},
  { name: "timer_button_entity", selector: { entity: { domain: "input_button" } } },
  { name: "", type: "grid", schema: [
    { name: "battery_warn", selector: { number: { min: 0, max: 100, step: 5, mode: "box" } } },
    { name: "fan_mode", selector: { boolean: {} } },
    { name: "show_warning", selector: { boolean: {} } },
  ]},
];

/* El formulario es plano; la config guarda el timer anidado. Estas dos
   funciones traducen entre ambos y son las que cubren los tests. */
function toForm(config) {
  const c = config || {};
  const t = c.timer || {};
  const out = {};
  for (const k of ["entity", "name", "icon", "power_entity", "temp_entity",
                   "energy_today_entity", "energy_month_entity",
                   "battery_warn", "fan_mode", "fans_position", "show_warning"]) {
    if (c[k] !== undefined) out[k] = c[k];
  }
  const wins = normFans(c.window_entity);
  if (wins.length) out.window_entity = wins.map((x) => x.entity);
  const fans = normFans(c.fans);
  if (fans.length) {
    out.fans = fans.map((f) => f.entity);
    fans.forEach((f, i) => {
      out[`fan_name_${i}`] = f.name || "";
    });
  }
  const m = Array.isArray(c.modes) ? c.modes : [];
  if (m[0] && m[0].entity) out.mode_cold_entity = m[0].entity;
  if (m[1] && m[1].entity) out.mode_heat_entity = m[1].entity;
  if (t.entity) out.timer_entity = t.entity;
  if (t.minutes_entity) out.timer_minutes_entity = t.minutes_entity;
  if (t.button_entity) out.timer_button_entity = t.button_entity;
  return out;
}

function fromForm(prev, data) {
  // Arranca de la config previa para NO perder base_card, labels ni nada
  // que el formulario no maneje.
  const out = { ...(prev || {}) };
  const d = { ...(data || {}) };

  for (const k of ["entity", "name", "icon", "power_entity", "temp_entity",
                   "energy_today_entity", "energy_month_entity",
                   "battery_warn", "fan_mode", "fans_position", "show_warning"]) {
    const v = d[k];
    if (v === undefined || v === "" || v === null || v === false) delete out[k];
    else out[k] = v;
  }

  // Ventanas: el form da entity_id sueltos; conserva el `battery` y el
  // `name` de las que ya estaban configuradas como objeto.
  const prevWins = normFans((prev || {}).window_entity);
  if (Array.isArray(d.window_entity) && d.window_entity.length) {
    out.window_entity = d.window_entity.map((id) => {
      const old = prevWins.find((x) => x.entity === id);
      return old && (old.battery || old.name) ? old : id;
    });
  } else {
    delete out.window_entity;
  }

  // Ventiladores. Los nombres vienen en campos fan_name_<i>, que son por
  // posicion; si la lista misma acaba de cambiar esos indices ya no calzan,
  // asi que en ese caso se conservan los nombres buscando por entidad y el
  // siguiente render vuelve a poblar el formulario correctamente.
  const prevFans = normFans((prev || {}).fans);
  if (Array.isArray(d.fans) && d.fans.length) {
    const listaCambio =
      prevFans.length !== d.fans.length ||
      prevFans.some((f, i) => f.entity !== d.fans[i]);
    out.fans = d.fans.map((id, i) => {
      const old = prevFans.find((f) => f.entity === id) || {};
      const nombre = listaCambio
        ? old.name
        : String(d[`fan_name_${i}`] === undefined ? old.name || "" : d[`fan_name_${i}`]).trim();
      const obj = { entity: id };
      if (nombre) obj.name = nombre;
      if (old.icon) obj.icon = old.icon;
      // Sin nombre ni icono propios, se guarda como simple entity_id
      return obj.name || obj.icon ? obj : id;
    });
  } else {
    delete out.fans;
  }
  // Los fan_name_* son del formulario, nunca de la config del card
  for (const k of Object.keys(out)) if (/^fan_name_\d+$/.test(k)) delete out[k];

  // Reconstruye `modes` conservando nombre e icono si ya existian
  const prevModes = Array.isArray((prev || {}).modes) ? prev.modes : [];
  const modes = [];
  if (d.mode_cold_entity) {
    modes.push({ ...(prevModes[0] || { name: "Frio", icon: "mdi:snowflake" }), entity: d.mode_cold_entity });
  }
  if (d.mode_heat_entity) {
    modes.push({ ...(prevModes[1] || { name: "Calor", icon: "mdi:fire" }), entity: d.mode_heat_entity });
  }
  if (modes.length) out.modes = modes;
  else delete out.modes;

  if (d.timer_entity) {
    const t = { entity: d.timer_entity };
    if (d.timer_minutes_entity) t.minutes_entity = d.timer_minutes_entity;
    if (d.timer_button_entity) t.button_entity = d.timer_button_entity;
    out.timer = t;
  } else {
    delete out.timer;
  }
  out.type = (prev && prev.type) || "custom:ac-room-card";
  return out;
}

class AcRoomCardEditor extends HTMLElement {
  static get toForm() { return toForm; }
  static get buildSchema() { return buildSchema; }
  static get fromForm() { return fromForm; }

  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (schema) => {
        const m = /^fan_name_(\d+)$/.exec(schema.name || "");
        if (m) {
          const id = fanIds(this._config.fans)[Number(m[1])];
          const st = id && this._hass && this._hass.states[id];
          const base = (st && st.attributes.friendly_name) || id || "";
          return `Nombre de ${base}`;
        }
        return EDITOR_LABELS[schema.name] || schema.name;
      };
      this._form.addEventListener("value-changed", (ev) => {
        const cfg = fromForm(this._config, ev.detail.value);
        this._config = cfg;
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: cfg }, bubbles: true, composed: true,
        }));
      });
      this.appendChild(this._form);

      this._note = document.createElement("div");
      this._note.style.cssText = "padding:8px 4px 0;font-size:12px;color:var(--secondary-text-color)";
      this.appendChild(this._note);
    }
    this._form.hass = this._hass;
    this._form.schema = buildSchema(this._config);
    this._form.data = toForm(this._config);
    this._note.textContent = this._config.base_card
      ? `El card de arriba (${this._config.base_card.type}) se conserva; se edita en YAML.`
      : "Sin base_card se usa el termostato integrado de Home Assistant.";
  }
}

if (!customElements.get("ac-room-card-editor")) {
  customElements.define("ac-room-card-editor", AcRoomCardEditor);
}


/* ==================================================================
   ac-rooms-card - vista compacta, una linea por pieza.
   Pensada para el celular: cada pieza acepta el mismo bloque de
   configuracion que ac-room-card, para copiar y pegar.
   ================================================================== */

const RT = {
  off: "Apagado",
  unavailable: "no disponible",
  window: "Ventanas",
  open: "Abierta",
  closed: "Cerrada",
  batLow: "pila baja",
  target: "Target",
  actual: "Actual",
  real: "Real",
  schedule: "Programar",
  cancel: "Cancelar",
  min: "min",
  empty: "Configura al menos una pieza en `rooms`",
};

class AcRoomsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._filas = [];
  }

  static getConfigElement() {
    return document.createElement("ac-rooms-card-editor");
  }

  static getStubConfig(hass, entities) {
    const c = (entities || []).filter((e) => e.startsWith("climate.")).slice(0, 3);
    return { rooms: c.map((e) => ({ entity: e })) };
  }

  setConfig(config) {
    // `rooms` es opcional: sin el, se descubren solas leyendo el dashboard.
    if (!config) throw new Error(RT.empty);
    if (config.rooms !== undefined && config.rooms !== "auto" &&
        (!Array.isArray(config.rooms) || !config.rooms.length)) {
      throw new Error(RT.empty);
    }
    this._config = { ...config, labels: { ...RT, ...(config.labels || {}) } };
    this._built = false;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    const n = (this._piezas || (Array.isArray(this._config && this._config.rooms) ? this._config.rooms : [])).length;
    return 1 + Math.ceil((n || 3) * 0.7);
  }

  /* ---------- estado de una pieza ---------- */

  /* Que columnas se dibujan. Por defecto todas; el detalle completo de cada
     pieza siempre esta a un toque, en el popup. */
  _cols() {
    const c = this._config.columns;
    return new Set(Array.isArray(c) && c.length ? c : ["temps", "power", "window", "timer", "fans"]);
  }

  _modos(r) {
    return normEntries(r.modes);
  }

  _encendida(r) {
    const modos = this._modos(r);
    if (modos.length) {
      return modos.some((m) => {
        const st = this._hass.states[m.entity];
        return st && st.state === "on";
      });
    }
    const st = this._hass.states[r.entity];
    return !!st && !["off", "unavailable", "unknown"].includes(st.state);
  }

  /* Modo en marcha, para pintar la fila. Con entidad climate es su estado;
     con modos por input_boolean se deduce del nombre o del entity_id, o se
     puede declarar a mano con `hvac` en cada modo. */
  _hvac(r) {
    const modos = this._modos(r);
    if (modos.length) {
      const activo = modos.find((m) => {
        const st = this._hass.states[m.entity];
        return st && st.state === "on";
      });
      if (!activo) return null;
      if (activo.hvac) return activo.hvac;
      const txt = ((activo.name || "") + " " + activo.entity).toLowerCase();
      if (/heat|calor|calef/.test(txt)) return "heat";
      if (/cool|frio|fr\u00edo|cold/.test(txt)) return "cool";
      return null;
    }
    const st = this._hass.states[r.entity];
    if (!st || ["off", "unavailable", "unknown"].includes(st.state)) return null;
    return st.state;
  }

  _toggle(r) {
    const modos = this._modos(r);
    if (modos.length) {
      if (this._encendida(r)) {
        for (const m of modos) {
          const st = this._hass.states[m.entity];
          if (st && st.state === "on") {
            this._hass.callService("input_boolean", "turn_off", { entity_id: m.entity });
          }
        }
      } else {
        this._hass.callService("input_boolean", "turn_on", { entity_id: modos[0].entity });
      }
      return;
    }
    const dominio = r.entity.split(".")[0];
    this._hass.callService(dominio, this._encendida(r) ? "turn_off" : "turn_on", {
      entity_id: r.entity,
    });
  }

  /* Tres lecturas distintas y a proposito separadas:
       target = la consigna del equipo
       actual = lo que mide el propio equipo
       real   = el sensor independiente de la pieza (temp_entity)
     Los dos ultimos casi nunca coinciden: el equipo mide en su carcasa. */
  _temps(r) {
    const st = this._hass.states[r.entity];
    const dec = (v) => {
      const n = parseFloat(v);
      return Number.isNaN(n) ? null : Math.round(n * 10) / 10;
    };
    const attr = (k) => (st && st.attributes[k] !== undefined && st.attributes[k] !== null
      ? dec(st.attributes[k]) : null);
    const rs = r.temp_entity && this._hass.states[r.temp_entity];
    return {
      target: attr("temperature"),
      actual: attr("current_temperature"),
      real: rs && !["unavailable", "unknown"].includes(rs.state) ? dec(rs.state) : null,
    };
  }

  /* Corriendo: cancela. Parado: arranca, apretando el input_button del
     usuario si lo hay, para que su automatizacion siga mandando. */
  _toggleTimer(r) {
    const t = r.timer;
    if (!t || !t.entity) return;
    if (remainingSecs(this._hass, t.entity) !== null) {
      this._hass.callService("timer", "cancel", { entity_id: t.entity });
      return;
    }
    if (t.button_entity) {
      this._hass.callService("input_button", "press", { entity_id: t.button_entity });
    } else {
      const mins = t.minutes_entity && this._hass.states[t.minutes_entity];
      const secs = Math.round((mins ? Number(mins.state) : 0) * 60);
      if (secs > 0) this._hass.callService("timer", "start", { entity_id: t.entity, duration: secs });
    }
  }

  /* Abre la pieza completa en un ac-room-card sobre el dashboard, para no
     tener que meter todo en una linea que en el telefono no cabe. */
  async _openPopup(r) {
    if (this._overlay) return;
    const helpers = await window.loadCardHelpers();
    const cfg = { type: "custom:ac-room-card", ...r };
    delete cfg.popup;
    const card = await helpers.createCardElement(cfg);
    card.hass = this._hass;
    this._popupCard = card;

    const ov = document.createElement("div");
    ov.className = "ov";
    const caja = document.createElement("div");
    caja.className = "ovbox";
    caja.appendChild(card);
    ov.appendChild(caja);
    ov.addEventListener("click", (ev) => { if (ev.target === ov) this._closePopup(); });
    this._escHandler = (ev) => { if (ev.key === "Escape") this._closePopup(); };
    document.addEventListener("keydown", this._escHandler);
    this.shadowRoot.appendChild(ov);
    this._overlay = ov;
  }

  _closePopup() {
    if (!this._overlay) return;
    this._overlay.remove();
    this._overlay = null;
    this._popupCard = null;
    if (this._escHandler) {
      document.removeEventListener("keydown", this._escHandler);
      this._escHandler = null;
    }
  }

  _tick(on) {
    if (on && !this._ticker) this._ticker = setInterval(() => this._update(), 1000);
    else if (!on && this._ticker) { clearInterval(this._ticker); this._ticker = null; }
  }

  disconnectedCallback() {
    this._tick(false);
    this._closePopup();
  }

  /* Sin `rooms`, se leen del propio dashboard: cualquier ac-room-card que
     exista pasa a ser una fila, sin tener que repetir su configuracion. */
  /* Quita las piezas excluidas. Se puede excluir por nombre (lo que se ve) o
     por entity_id, para que sirva tambien con piezas sin nombre. */
  _filtrar(lista) {
    const ex = this._config.exclude;
    if (!Array.isArray(ex) || !ex.length) return lista;
    const fuera = new Set(ex);
    return lista.filter((r) => !fuera.has(r.name) && !fuera.has(r.entity));
  }

  async _descubrir() {
    const cfg = this._config;
    if (Array.isArray(cfg.rooms) && cfg.rooms.length) return this._filtrar(cfg.rooms);
    const partes = String((window.location && window.location.pathname) || "").split("/").filter(Boolean);
    const url_path = partes[0] && partes[0] !== "lovelace" ? partes[0] : null;
    let lov;
    try {
      lov = await this._hass.callWS({ type: "lovelace/config", url_path });
    } catch (e) {
      return [];
    }
    const encontradas = [];
    const recorrer = (o) => {
      if (Array.isArray(o)) { o.forEach(recorrer); return; }
      if (!o || typeof o !== "object") return;
      if (o.type === "custom:ac-room-card") { encontradas.push(o); return; }
      if (Array.isArray(o.cards)) recorrer(o.cards);
      if (Array.isArray(o.sections)) recorrer(o.sections);
    };
    const vistas = (lov && lov.views ? lov.views : [])
      .filter((v) => !cfg.discover_view || v.path === cfg.discover_view);
    vistas.forEach(recorrer);
    return this._filtrar(encontradas);
  }

  /* ---------- construccion ---------- */

  async _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) {
      this._built = true;
      this._piezas = await this._descubrir();
      this._build();
    }
    this._update();
  }

  _build() {
    const card = document.createElement("ha-card");
    if (this._config.title) {
      const h = document.createElement("div");
      h.className = "title";
      h.textContent = this._config.title;
      card.appendChild(h);
    }
    const cont = document.createElement("div");
    cont.className = "rooms";
    card.appendChild(cont);

    // Las etiquetas van una vez como encabezado de columna. Repetirlas en
    // cada una de las filas seria ruido puro.
    /* El encabezado tiene que llevar los MISMOS huecos que las filas y en el
       mismo orden, o las columnas dejan de calzar. */
    const cols0 = this._cols();
    if (["temps", "power", "timer", "window", "fans"].some((k) => cols0.has(k))) {
      const L0 = this._config.labels;
      const head = document.createElement("div");
      head.className = "room head";
      head.innerHTML =
        `<span class="pwrsp"></span><span class="rname"></span>` +
        (cols0.has("temps")
          ? `<span class="temps"><span class="tgt"></span>` +
            `<span class="act"></span><span class="real"></span></span>` : "") +
        (cols0.has("power")  ? `<span class="pw"><ha-icon icon="mdi:flash"></ha-icon></span>` : "") +
        (cols0.has("timer")  ? `<span class="tmr"><ha-icon icon="mdi:timer-outline"></ha-icon></span>` : "") +
        (cols0.has("window") ? `<span class="winwrap"><ha-icon icon="mdi:window-closed-variant"></ha-icon></span>` : "") +
        (cols0.has("fans")   ? `<span class="fans"><ha-icon icon="mdi:fan"></ha-icon></span>` : "");
      if (cols0.has("temps")) {
        head.querySelector(".tgt").textContent = L0.target;
        head.querySelector(".act").textContent = L0.actual;
        head.querySelector(".real").textContent = L0.real;
      }
      cont.appendChild(head);
    }

    // Ancho fijo para la columna de ventiladores segun la pieza que mas
    // tiene, para que el icono de ventana caiga siempre en el mismo x.
    const cols = this._cols();
    const piezas = this._piezas || [];
    const maxFans = cols.has("fans")
      ? Math.max(1, ...piezas.map((r) => normEntries(r.fans).length))
      : 1;
    cont.style.setProperty("--acrc-fans", String(maxFans));

    this._filas = piezas.map((r) => {
      const fila = document.createElement("div");
      fila.className = "room";
      fila.innerHTML =
        `<button class="pwr" title=""><ha-icon icon="mdi:power"></ha-icon></button>` +
        `<span class="rname"></span>` +
        `<span class="temps"><span class="tgt"></span>` +
        `<span class="act"></span><span class="real"></span></span>` +
        `<span class="pw"></span>` +
        `<button class="tmr"><ha-icon></ha-icon><span class="tleft"></span></button>` +
        `<span class="winwrap"><ha-icon class="win"></ha-icon>` +
        `<span class="batdot"></span></span>` +
        `<span class="fans"></span>`;
      fila.querySelector(".pwr").addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._toggle(r);
      });
      const abrir = () => (this._config.popup === false
        ? moreInfo(this, r.entity)
        : this._openPopup(r));
      fila.querySelector(".rname").addEventListener("click", abrir);
      fila.querySelector(".temps").addEventListener("click", abrir);
      fila.querySelector(".pw").addEventListener("click", (ev) => {
        ev.stopPropagation();
        moreInfo(this, r.power_entity || r.entity);
      });
      fila.querySelector(".tmr").addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._toggleTimer(r);
      });
      fila.querySelector(".win").addEventListener("click", (ev) => {
        ev.stopPropagation();
        const lista = normEntries(r.window_entity);
        const abierta = lista.find((x) => {
          const st = this._hass.states[x.entity];
          return st && st.state === "on";
        });
        moreInfo(this, (abierta || lista[0] || {}).entity);
      });
      // Ventiladores: se crean una vez, aca, porque son fijos por config
      const slot = fila.querySelector(".fans");
      const btns = [];
      for (const f of (cols.has("fans") ? normEntries(r.fans) : [])) {
        const b = document.createElement("button");
        b.className = "rfan";
        b.dataset.entity = f.entity;
        const st = this._hass.states[f.entity];
        b.dataset.label = f.name || (st && st.attributes.friendly_name) || f.entity;
        // color propio para el estado encendido; sin esto se usa el verde comun
    if (f.color) b.dataset.color = f.color;
    b.innerHTML = `<ha-icon icon="${f.icon || "mdi:fan"}"></ha-icon>`;
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._hass.callService("homeassistant", "toggle", { entity_id: f.entity });
        });
        slot.appendChild(b);
        btns.push(b);
      }
      // Columnas apagadas: fuera del flujo, para que no reserven hueco.
      for (const [clave, sel] of [["temps", ".temps"], ["power", ".pw"],
                                  ["window", ".winwrap"], ["timer", ".tmr"],
                                  ["fans", ".fans"]]) {
        if (!cols.has(clave)) fila.querySelector(sel).style.display = "none";
      }

      cont.appendChild(fila);
      return { r, fila, btns };
    });

    this.shadowRoot.innerHTML = "";
    this.shadowRoot.appendChild(this._style());
    this.shadowRoot.appendChild(card);
  }

  _update() {
    const L = this._config.labels;
    if (this._popupCard) this._popupCard.hass = this._hass;
    let hayTimer = false;
    const orden = this._config.sort === "active" ? [...this._filas].sort(
      (a, b) => Number(this._encendida(b.r)) - Number(this._encendida(a.r))) : this._filas;
    orden.forEach((f, i) => { f.fila.style.order = String(i); });

    for (const { r, fila, btns } of this._filas) {
      const st = this._hass.states[r.entity];
      const on = this._encendida(r);
      const noExiste = !st;

      const modo = this._hvac(r);
      fila.className = "room" + (on ? " on" : "") + (noExiste ? " gone" : "") +
        (modo ? " m-" + modo : "");
      const pwr = fila.querySelector(".pwr");
      pwr.className = on ? "pwr on" : "pwr";
      pwr.title = on ? "" : L.off;

      fila.querySelector(".rname").textContent =
        r.name || (st && st.attributes.friendly_name) || r.entity;

      const t3 = this._temps(r);
      const pon = (sel, v) => {
        fila.querySelector(sel).textContent = v === null ? "" : `${v}°`;
      };
      pon(".tgt", t3.target);
      pon(".act", t3.actual);
      pon(".real", t3.real);

      const pEl = fila.querySelector(".pw");
      const ps = r.power_entity && this._hass.states[r.power_entity];
      pEl.textContent = ps && !["unavailable", "unknown"].includes(ps.state)
        ? `${Math.round(parseFloat(ps.state) || 0)} W` : "";

      const lista = normEntries(r.window_entity);
      const wrap = fila.querySelector(".winwrap");
      const win = fila.querySelector(".win");
      const dot = fila.querySelector(".batdot");
      if (!lista.length) {
        // visibility, no display: la columna se mantiene para que el icono
        // caiga en el mismo x en todas las filas.
        wrap.style.visibility = "hidden";
      } else {
        wrap.style.visibility = "";
        const w = computeWindows(this._hass, lista, L);
        const CLASES = { closed: "win closed", some: "win some", all: "win open", unknown: "win unknown" };
        win.className = CLASES[w.estado];
        win.setAttribute("icon", w.abiertas ? "mdi:window-open-variant" : "mdi:window-closed-variant");
        const resumen = lista.length > 1 ? ` (${w.abiertas}/${w.conocidas})` : "";
        win.setAttribute("title", `${L.window}${resumen}\n${w.detalle.join("\n")}`);
        const umbral = r.battery_warn === undefined ? 20 : Number(r.battery_warn);
        const bajos = batteriesLow(this._hass, lista, umbral);
        dot.style.display = bajos.length ? "" : "none";
        if (bajos.length) dot.setAttribute("title", `${L.batLow}\n${bajos.join("\n")}`);
      }

      const tmr = fila.querySelector(".tmr");
      const t = r.timer;
      const restan = t && t.entity ? remainingSecs(this._hass, t.entity) : null;
      if (!t || !t.entity || (restan === null && !on)) {
        // Parado y con la pieza apagada no aporta nada: ocupa espacio y no
        // se puede arrancar un timer de un equipo que no esta andando.
        tmr.style.visibility = "hidden";
      } else {
        tmr.style.visibility = "";
        const corriendo = restan !== null;
        if (corriendo) hayTimer = true;
        tmr.className = corriendo ? "tmr on" : "tmr";
        tmr.querySelector("ha-icon").setAttribute("icon", corriendo ? "mdi:timer-sand" : "mdi:timer-outline");
        tmr.querySelector(".tleft").textContent = corriendo ? hms(restan) : "";
        const mins = t.minutes_entity && this._hass.states[t.minutes_entity];
        tmr.title = corriendo ? L.cancel : (mins ? `${Math.round(Number(mins.state))} ${L.min}` : L.schedule);
      }

      for (const b of btns) {
        const fst = this._hass.states[b.dataset.entity];
        const fon = !!fst && fst.state === "on";
        b.className = fon ? "rfan on" : "rfan off";
        b.title = `${b.dataset.label}: ${!fst ? L.unavailable : fon ? "on" : "off"}`;
      }
    }

    this._tick(hayTimer);
  }

  _style() {
    const s = document.createElement("style");
    s.textContent = `
      ha-card { overflow: hidden; }
      .title { padding: 16px 18px 6px; font-size: 18px; font-weight: 500;
               color: var(--primary-text-color); }
      .rooms { display: flex; flex-direction: column; padding: 4px 0 8px; }
      .room {
        display: flex; align-items: center; gap: 11px;
        padding: 7px 16px; min-height: 54px;
        font-size: 16px; color: var(--primary-text-color);
      }
      .room + .room { border-top: 1px solid var(--divider-color, #e0e0e0); }
      .room.head { border-top: none; }
      .room.gone { opacity: .4; }
      /* La fila entera se tine segun el modo en marcha. */
      .room.m-cool { background: color-mix(in srgb, var(--info-color, #039be5) 13%, transparent); }
      .room.m-heat { background: color-mix(in srgb, var(--warning-color, #ff9800) 15%, transparent); }
      .room.m-dry  { background: color-mix(in srgb, var(--success-color, #43a047) 10%, transparent); }
      .room.m-cool .pwr.on { background: var(--info-color, #039be5); }
      .room.m-heat .pwr.on { background: var(--warning-color, #ff9800); }
      .pwr {
        flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
        width: 42px; height: 42px; border-radius: 50%; cursor: pointer;
        border: none; background: var(--secondary-background-color, #f1f1f1);
        color: var(--secondary-text-color); padding: 0;
      }
      .pwr ha-icon { --mdc-icon-size: 24px; }
      .pwr.on { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
      .rname { flex: 1 1 auto; min-width: 72px; cursor: pointer;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .room.on .rname { font-weight: 500; }
      .temps { flex: 0 0 auto; display: inline-flex; cursor: pointer;
               font-variant-numeric: tabular-nums;
               color: var(--primary-text-color); white-space: nowrap; }
      .temps > span { width: 52px; text-align: right; }
      .temps .real { color: var(--primary-color, #03a9f4); font-weight: 500; }
      .head {
        min-height: 0; padding-top: 2px; padding-bottom: 2px;
        font-size: 9px; letter-spacing: .05em; text-transform: uppercase;
        font-weight: 500; color: var(--secondary-text-color);
      }
      .head .temps > span { overflow: hidden; text-overflow: clip; }
      .head .temps > span, .head .pw { color: inherit; font-weight: 500; }
      .head .pw { display: inline-flex; justify-content: flex-end; align-items: center; }
      .head .tmr, .head .winwrap, .head .fans {
        display: inline-flex; align-items: center; justify-content: flex-start;
        color: inherit; border: none; background: none; padding: 0;
      }
      .head ha-icon { --mdc-icon-size: 14px; color: inherit; }
      .head .pwrsp { flex: 0 0 auto; width: 42px; }
      .head .rname { min-width: 72px; }
      .room.head + .room { border-top: 1px solid var(--divider-color, #e0e0e0); }
      .pw { flex: 0 0 auto; cursor: pointer; width: 52px; text-align: right;
            color: var(--secondary-text-color); font-variant-numeric: tabular-nums;
            white-space: nowrap; }
      .winwrap { position: relative; display: inline-flex; flex: 0 0 auto; width: 24px; }
      .win { --mdc-icon-size: 24px; cursor: pointer; }
      .win.closed  { color: var(--success-color, #43a047); }
      .win.some    { color: var(--warning-color, #ffa600); }
      .win.open    { color: var(--error-color, #db4437); }
      .win.unknown { color: var(--disabled-text-color, #9e9e9e); }
      .batdot { display: none; position: absolute; right: -1px; bottom: -1px;
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--error-color, #db4437);
        box-shadow: 0 0 0 1.5px var(--card-background-color, #fff); }
      .tmr {
        display: inline-flex; align-items: center; gap: 3px;
        flex: 0 0 auto; width: 62px; justify-content: flex-start;
        border: none; background: transparent; padding: 0; cursor: pointer;
        font: inherit; font-size: 14px; font-variant-numeric: tabular-nums;
        color: var(--secondary-text-color);
      }
      .tmr ha-icon { --mdc-icon-size: 22px; color: inherit; }
      .tmr.on { color: var(--warning-color, #ffa600); font-weight: 500; }
      .fans { display: inline-flex; gap: 10px; flex: 0 0 auto;
              width: calc(var(--acrc-fans, 1) * 24px + (var(--acrc-fans, 1) - 1) * 10px);
              justify-content: flex-start; }
      .rfan { border: none; background: transparent; padding: 0; cursor: pointer;
              display: inline-flex; }
      .rfan ha-icon { --mdc-icon-size: 24px; color: inherit; }
      .rfan.on  { color: var(--success-color, #43a047); }
      .rfan.on ha-icon { animation: acrc-spin 2s linear infinite; }
      .rfan.off { color: var(--info-color, #039be5); }
      @keyframes acrc-spin { to { transform: rotate(360deg); } }
      .ov {
        position: fixed; inset: 0; z-index: 9;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, .45); padding: 16px;
        animation: acrc-in .12s ease-out;
      }
      .ovbox { width: 100%; max-width: 420px; max-height: 88vh; overflow: auto; }
      @keyframes acrc-in { from { opacity: 0 } to { opacity: 1 } }
      /* Antes la potencia se escondia bajo 420px. Se prefiere apretar las
         columnas: en un telefono el consumo es justo lo que se quiere ver. */
      /* Ojo con los shorthand aca: .head tambien es un .room, y estas reglas
         van despues, asi que con la misma especificidad le ganan. El tamano de
         letra y el padding vertical se aplican solo a las filas de datos; el
         gap y el padding lateral SI van a las dos, porque son los que alinean
         las columnas con su encabezado. */
      @media (max-width: 460px) {
        .room { gap: 7px; padding-left: 10px; padding-right: 10px; }
        .room:not(.head) { padding-top: 6px; padding-bottom: 6px; font-size: 15px; }
        .temps > span { width: 46px; }
        .pw { width: 46px; }
        .tmr { width: 54px; }
      }
      @media (max-width: 360px) {
        .room { gap: 5px; padding-left: 8px; padding-right: 8px; }
        .room:not(.head) { padding-top: 6px; padding-bottom: 6px; font-size: 14px; }
        .temps > span { width: 42px; }
        .pw { width: 42px; }
        .rname { min-width: 56px; }
      }
    `;
    return s;
  }
}


const ROOMS_LABELS = {
  title: "Titulo",
  discover_view: "Buscar solo en esta vista (vacio = todo el dashboard)",
  columns: "Columnas de cada linea",
  sort: "Orden",
  popup: "Al tocar una pieza, abrir su tarjeta completa",
  exclude: "Piezas a excluir",
};

class AcRoomsCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  /* Las opciones de "excluir" y de "vista" salen del propio dashboard, para
     que sean las piezas y vistas que el usuario realmente tiene. */
  async _cargarOpciones() {
    if (this._opciones) return this._opciones;
    const partes = String((window.location && window.location.pathname) || "").split("/").filter(Boolean);
    const url_path = partes[0] && partes[0] !== "lovelace" ? partes[0] : null;
    let lov = null;
    try { lov = await this._hass.callWS({ type: "lovelace/config", url_path }); } catch (e) { lov = null; }
    const piezas = [];
    const vistas = [];
    const recorrer = (o) => {
      if (Array.isArray(o)) { o.forEach(recorrer); return; }
      if (!o || typeof o !== "object") return;
      if (o.type === "custom:ac-room-card") {
        const v = o.name || o.entity;
        if (v && !piezas.includes(v)) piezas.push(v);
        return;
      }
      if (Array.isArray(o.cards)) recorrer(o.cards);
      if (Array.isArray(o.sections)) recorrer(o.sections);
    };
    for (const v of (lov && lov.views ? lov.views : [])) {
      if (v.path) vistas.push({ value: v.path, label: `${v.title || v.path} (${v.path})` });
      recorrer(v);
    }
    this._opciones = { piezas, vistas };
    return this._opciones;
  }

  _esquema(op) {
    return [
      { name: "title", selector: { text: {} } },
      { name: "discover_view", selector: { select: { mode: "dropdown", options: op.vistas } } },
      { name: "columns", selector: { select: { multiple: true, mode: "list", options: [
        { value: "temps", label: "Temperaturas" },
        { value: "power", label: "Potencia" },
        { value: "window", label: "Ventanas" },
        { value: "timer", label: "Temporizador" },
        { value: "fans", label: "Ventiladores y conmutables" },
      ] } } },
      { name: "exclude", selector: { select: { multiple: true, mode: "list",
        options: op.piezas.map((p) => ({ value: p, label: p })) } } },
      { name: "", type: "grid", schema: [
        { name: "sort", selector: { select: { mode: "dropdown", options: [
          { value: "configured", label: "Como estan en el dashboard" },
          { value: "active", label: "Las encendidas primero" },
        ] } } },
        { name: "popup", selector: { boolean: {} } },
      ]},
    ];
  }

  async _render() {
    if (!this._config || !this._hass) return;
    const op = await this._cargarOpciones();
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (sc) => ROOMS_LABELS[sc.name] || sc.name;
      this._form.addEventListener("value-changed", (ev) => {
        const d = { ...ev.detail.value };
        const cfg = { ...this._config, ...d, type: this._config.type || "custom:ac-rooms-card" };
        for (const k of ["title", "discover_view", "columns", "exclude", "sort"]) {
          const v = cfg[k];
          if (v === undefined || v === "" || v === null || (Array.isArray(v) && !v.length)) delete cfg[k];
        }
        if (cfg.popup !== false) delete cfg.popup;   // true es el default
        this._config = cfg;
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: cfg }, bubbles: true, composed: true,
        }));
      });
      this.appendChild(this._form);
      this._nota = document.createElement("div");
      this._nota.style.cssText = "padding:8px 4px 0;font-size:12px;color:var(--secondary-text-color)";
      this.appendChild(this._nota);
    }
    this._form.hass = this._hass;
    this._form.schema = this._esquema(op);
    const d = { popup: this._config.popup !== false };
    for (const k of ["title", "discover_view", "columns", "exclude", "sort"]) {
      if (this._config[k] !== undefined) d[k] = this._config[k];
    }
    this._form.data = d;
    this._nota.textContent = Array.isArray(this._config.rooms) && this._config.rooms.length
      ? "Esta tarjeta tiene una lista de piezas escrita a mano; se usa esa en vez de buscarlas."
      : `Se agregan solas todas las tarjetas de pieza que encuentre (${op.piezas.length} ahora mismo).`;
  }

  static get filtrar() { return null; }
}

if (!customElements.get("ac-rooms-card-editor")) {
  customElements.define("ac-rooms-card-editor", AcRoomsCardEditor);
}

if (!customElements.get("ac-rooms-card")) {
  customElements.define("ac-rooms-card", AcRoomsCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ac-rooms-card",
  name: "AC Rooms Card",
  description: "Vista compacta de varias piezas, una linea por cada una",
  preview: false,
});

if (!customElements.get("ac-room-card")) {
  customElements.define("ac-room-card", AcRoomCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ac-room-card",
  name: "AC Room Card",
  description: "Termostato con potencia, energia y sensor de ventana",
  preview: false,
});

console.info(`%c AC-ROOM-CARD %c v${VERSION} `,
  "color:white;background:#44739e;font-weight:700",
  "color:#44739e;background:white;font-weight:700");
