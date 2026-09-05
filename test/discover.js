// Descubrimiento automatico de piezas del ac-rooms-card.
// Va aparte de smoke.js porque necesita promesas y ese archivo ya tiene
// su propia cadena; mezclarlas hacia el cierre ilegible.
function makeEl(tag) {
  const el = { tag, className:"", innerHTML:"", textContent:"",
    style:{ _v:{}, setProperty(k,v){this._v[k]=v;}, getPropertyValue(k){return this._v[k];} },
    children:[], _q:{}, _attrs:{}, dataset:{},
    appendChild(c){ this.children.push(c); if(c) c.parentNode=this; return c; },
    remove(){ this._removed=true; },
    setAttribute(k,v){ this._attrs[k]=v; }, getAttribute(k){ return this._attrs[k]; },
    addEventListener(e,f){ (this._ev=this._ev||{})[e]=f; },
    querySelector(){ return this._q.__ || (this._q.__ = makeEl("stub")); },
    classList:{ _s:new Set(), add(){}, remove(){}, toggle(){}, contains(){return false;} } };
  return el;
}
global.HTMLElement = class { attachShadow(){ return (this.shadowRoot = makeEl("root")); } };
global.document = { createElement: makeEl, addEventListener(){}, removeEventListener(){} };
const DEFS = {};
global.customElements = { get: () => undefined, define: (n,c) => { DEFS[n]=c; } };
global.window = { customCards: [], location: { pathname: "/lovelace/aires-mobile" } };
require("../ac-room-card.js");
const ROOMS = DEFS["ac-rooms-card"];

let fail = 0;
const ok = (n,c,got) => { console.log((c?"  PASA  ":"  FALLA ")+n+(c?"":"   -> "+JSON.stringify(got))); if(!c) fail++; };

const lov = { views: [
  { path:"aires", sections:[{ cards:[
      { type:"custom:ac-room-card", name:"Dorm", entity:"climate.x" },
      { type:"tile", entity:"sensor.pot" },
      { type:"custom:stack-in-card", cards:[ { type:"custom:ac-room-card", name:"Garage" } ] },
  ]}]},
  { path:"otra", cards:[ { type:"custom:ac-room-card", name:"Ajena" } ] },
]};
const hassOK   = { states:{}, callWS: async () => lov };
const hassMal  = { states:{}, callWS: async () => { throw new Error("sin conexion"); } };
const nuevo = (cfg, h) => { const c = new ROOMS(); c.setConfig(cfg); c._hass = h; return c; };

(async () => {
  console.log("--- descubrimiento automatico de piezas ---");
  let p = await nuevo({}, hassOK)._descubrir();
  ok("descubre las ac-room-card del dashboard", p.length === 3, p.map(x=>x.name));
  ok("entra en stack-in-card anidados", p.some(x=>x.name==="Garage"), p.map(x=>x.name));
  ok("ignora lo que no es ac-room-card", !p.some(x=>x.type==="tile"), p.map(x=>x.type));
  ok("conserva la config completa de cada una", p[0].entity === "climate.x", p[0]);

  p = await nuevo({ discover_view:"aires" }, hassOK)._descubrir();
  ok("discover_view limita a una vista", p.length===2 && !p.some(x=>x.name==="Ajena"), p.map(x=>x.name));

  p = await nuevo({ rooms:[{ entity:"climate.y" }] }, hassOK)._descubrir();
  ok("con rooms explicito no descubre", p.length===1 && p[0].entity==="climate.y", p);

  p = await nuevo({ exclude:["Ajena","Garage"] }, hassOK)._descubrir();
  ok("exclude por nombre saca esas piezas", p.length===1 && p[0].name==="Dorm", p.map(x=>x.name));
  p = await nuevo({ exclude:["climate.x"] }, hassOK)._descubrir();
  ok("exclude tambien acepta entity_id", !p.some(x=>x.entity==="climate.x"), p.map(x=>x.name));
  p = await nuevo({ rooms:[{name:"A"},{name:"B"}], exclude:["B"] }, hassOK)._descubrir();
  ok("exclude aplica tambien a la lista escrita a mano", p.length===1 && p[0].name==="A", p.map(x=>x.name));
  p = await nuevo({ exclude:[] }, hassOK)._descubrir();
  ok("exclude vacio no saca nada", p.length===3, p.length);

  console.log("\n--- editor del rooms card ---");
  const ED = DEFS["ac-rooms-card-editor"];
  ok("el editor esta registrado", !!ED, Object.keys(DEFS));
  {
    const e = new ED(); e.setConfig({}); e._hass = hassOK;
    const op = await e._cargarOpciones();
    ok("ofrece las piezas encontradas para excluir",
       op.piezas.length===3 && op.piezas.includes("Garage"), op.piezas);
    ok("ofrece las vistas del dashboard", op.vistas.map(v=>v.value).join(",")==="aires,otra",
       op.vistas.map(v=>v.value));
    const esq = JSON.stringify(e._esquema(op));
    for (const k of ["title","discover_view","columns","exclude","sort","popup"])
      ok("el formulario tiene "+k, esq.includes('"'+k+'"'), k);
  }

  p = await nuevo({}, hassMal)._descubrir();
  ok("si el websocket falla devuelve vacio, sin romper", Array.isArray(p) && p.length===0, p);

  console.log(fail===0 ? "\n=== TODO PASA ===" : `\n=== ${fail} FALLAS ===`);
  process.exit(fail?1:0);
})();
