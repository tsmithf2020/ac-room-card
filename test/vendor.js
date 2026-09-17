// mini-climate-card viene incluido dentro de ac-room-card.js. Esto revisa
// que el bloque este bien armado y que no se ejecute si ya hay un
// mini-climate registrado. Que sea identico al release lo revisa
// `node scripts/vendor-mini-climate.mjs --check`, que necesita red.
const fs = require("fs");
const path = require("path");

let fail = 0;
const ok = (n, c, got) => {
  console.log((c ? "  PASA  " : "  FALLA ") + n + (c ? "" : "   -> " + JSON.stringify(got)));
  if (!c) fail++;
};

const src = fs.readFileSync(path.join(__dirname, "..", "ac-room-card.js"), "utf8").replace(/\r\n/g, "\n");
const INI = "/* >>> mini-climate-card (incluido) >>> */";
const FIN = "/* <<< mini-climate-card (incluido) <<< */";
const cuenta = (s) => src.split(s).length - 1;

console.log("\n--- el bloque incluido");
ok("una sola marca de inicio y una de fin", cuenta(INI) === 1 && cuenta(FIN) === 1, [cuenta(INI), cuenta(FIN)]);
const bloque = src.slice(src.indexOf(INI), src.indexOf(FIN));
ok("trae el copyright de Artem Sedykh", bloque.includes("Copyright (c) 2020 Artem Sedykh"), "");
ok("y el texto de la licencia MIT", bloque.includes("Permission is hereby granted, free of charge"), "");
const m = /const MINI_CLIMATE_BUNDLED = "(v\d+\.\d+\.\d+)";/.exec(bloque);
ok("dice que version trae", !!m, "");
ok("y esa version sale en el encabezado", !!m && bloque.includes(` * mini-climate-card ${m[1]} - `), "");
ok("va protegido: solo si nadie registro mini-climate antes",
   bloque.includes('!window.customElements.get("mini-climate")'), "");
ok("va despues de registrar las tarjetas propias",
   src.indexOf(INI) > src.lastIndexOf('customElements.define("ac-room-card"'), "");

console.log("\n--- con mini-climate ya registrado no se ejecuta");
function makeEl(tag) {
  return { tag, style: {}, dataset: {}, children: [], appendChild(c) { return c; },
    setAttribute() {}, addEventListener() {}, querySelector() { return null; } };
}
const DEFS = {};
const registro = {
  get: (n) => (n === "mini-climate" ? class {} : undefined),
  define: (n, c) => { DEFS[n] = c; },
};
global.HTMLElement = class { attachShadow() { return (this.shadowRoot = makeEl("root")); } };
global.document = { createElement: makeEl, addEventListener() {}, removeEventListener() {} };
global.customElements = registro;
global.window = { customCards: [], customElements: registro };
let error = null;
try { require("../ac-room-card.js"); } catch (e) { error = e; }
ok("cargar el archivo no revienta", error === null, error && error.message);
ok("registra sus tarjetas", !!DEFS["ac-room-card"] && !!DEFS["ac-rooms-card"], Object.keys(DEFS));
ok("y no vuelve a registrar mini-climate", !DEFS["mini-climate"], Object.keys(DEFS));
ok("ni lo agrega de nuevo al selector de tarjetas",
   !global.window.customCards.some((c) => c.type === "mini-climate"), global.window.customCards.map((c) => c.type));

console.log(fail === 0 ? "\n=== TODO PASA ===" : `\n=== ${fail} FALLAS ===`);
process.exit(fail ? 1 : 0);
