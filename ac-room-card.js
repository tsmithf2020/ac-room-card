/*!
 * ac-room-card
 * Envuelve el card `thermostat` integrado de Home Assistant y le agrega
 * filas opcionales de potencia, energia y sensor de ventana.
 *
 * No copia codigo de Home Assistant: instancia el card integrado en runtime
 * a traves de loadCardHelpers(). Licencia MIT (ver LICENSE).
 */

const VERSION = "0.3.0";

const T = {
  power: "Potencia",
  today: "Hoy",
  month: "Mes",
  window: "Ventana",
  open: "Abierta",
  closed: "Cerrada",
  warn: "Ventana abierta con el aire andando",
  unavailable: "no disponible",
};

class AcRoomCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._inner = null;
    this._rows = {};
    this._built = false;
  }

  static getStubConfig(hass, entities) {
    const climate = (entities || []).find((e) => e.startsWith("climate."));
    return { entity: climate || "climate.example" };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("Falta 'entity' (una entidad climate.* o un input_boolean/switch)");
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
    if (this._config.base_card) return 4;
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
    const domain = cfg.entity.split(".")[0];

    const helpers = await window.loadCardHelpers();

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
      if (cfg.name) innerCfg.name = cfg.name;
      if (cfg.features) innerCfg.features = cfg.features;
    }

    this._inner = await helpers.createCardElement(innerCfg);
    this._inner.hass = this._hass;

    const card = document.createElement("ha-card");
    card.className = "root";

    const innerWrap = document.createElement("div");
    innerWrap.className = "inner";
    innerWrap.appendChild(this._inner);
    card.appendChild(innerWrap);

    const footer = document.createElement("div");
    footer.className = "footer";
    card.appendChild(footer);

    this._rows.power = this._addRow(footer, "mdi:flash", cfg.labels.power, true);
    this._rows.energy = this._addRow(footer, "mdi:lightning-bolt-outline", cfg.labels.today);

    const warn = document.createElement("div");
    warn.className = "warn";
    warn.innerHTML = `<ha-icon icon="mdi:alert"></ha-icon><span></span>`;
    card.appendChild(warn);
    this._rows.warn = warn;

    this.shadowRoot.innerHTML = "";
    this.shadowRoot.appendChild(this._style());
    this.shadowRoot.appendChild(card);

    this._stripInnerCard();
  }

  _addRow(parent, icon, label, withWindow) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML =
      `<ha-icon icon="${icon}"></ha-icon>` +
      `<span class="label">${label}</span>` +
      `<span class="value"></span>` +
      (withWindow ? `<ha-icon class="win"></ha-icon>` : "");
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
      const u = st.attributes.unit_of_measurement;
      text = u ? `${st.state} ${u}` : st.state;
    }
    return { text, missing: false, state: st };
  }

  _update() {
    const cfg = this._config;
    const L = cfg.labels;

    /* Fila unica: potencia y, pegado al lado, el simbolo de ventana.
       Verde = cerrada, rojo = abierta, gris = sin dato. */
    let windowOpen = false;
    const win = this._rows.power.querySelector(".win");
    if (!cfg.window_entity) {
      win.style.display = "none";
    } else {
      win.style.display = "";
      const st = this._hass.states[cfg.window_entity];
      if (!st || st.state === "unavailable" || st.state === "unknown") {
        win.setAttribute("icon", "mdi:window-closed-variant");
        win.className = "win unknown";
        win.setAttribute("title", `${L.window}: ${L.unavailable}`);
      } else {
        windowOpen = st.state === "on";
        win.setAttribute("icon", windowOpen ? "mdi:window-open-variant" : "mdi:window-closed-variant");
        win.className = windowOpen ? "win open" : "win closed";
        win.setAttribute("title", `${L.window}: ${windowOpen ? L.open : L.closed}`);
      }
    }

    const p = this._fmt(cfg.power_entity);
    if (!p && !cfg.window_entity) {
      this._rows.power.style.display = "none";
    } else {
      this._rows.power.style.display = "";
      this._rows.power.querySelector(".label").textContent = p ? L.power : "";
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
    const main = this._hass.states[cfg.entity];
    const acOn = main && main.state !== "off" && main.state !== "unavailable" && main.state !== "unknown";
    const show = !!cfg.show_warning && windowOpen && acOn;
    this._rows.warn.style.display = show ? "flex" : "none";
    if (show) this._rows.warn.querySelector("span").textContent = L.warn;
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
      .row .win { margin-left: 10px; --mdc-icon-size: 20px; flex: 0 0 auto; }
      .row .win.closed  { color: var(--success-color, #43a047); }
      .row .win.open    { color: var(--error-color, #db4437); }
      .row .win.unknown { color: var(--disabled-text-color, #9e9e9e); }
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
