// Incluye mini-climate-card dentro de ac-room-card.js, para que la vista
// compacta funcione sin instalar nada aparte.
//
//   node scripts/vendor-mini-climate.mjs           el ultimo release
//   node scripts/vendor-mini-climate.mjs v3.5.0    ese release
//   node scripts/vendor-mini-climate.mjs --check   falla si el bloque incluido
//                                                  no es identico al bundle y
//                                                  la licencia de su release
//
// El bloque va entre dos marcas y se arma siempre igual a partir del tag, la
// licencia y el bundle publicados. Por eso --check puede rehacerlo y comparar
// byte a byte: asi se sabe que nadie lo toco a mano.
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "artem-sedykh/mini-climate-card";
const FILE = new URL("../ac-room-card.js", import.meta.url);
const INI = "/* >>> mini-climate-card (incluido) >>> */";
const FIN = "/* <<< mini-climate-card (incluido) <<< */";

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": "ac-room-card-vendor" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

const limpio = (s) => s.replace(/\r\n/g, "\n").replace(/\n+$/, "");

export function armarBloque(tag, licencia, bundle) {
  const lic = limpio(licencia).split("\n").map((l) => (l ? ` * ${l}` : " *")).join("\n");
  return [
    INI,
    "/*!",
    ` * mini-climate-card ${tag} - https://github.com/${REPO}`,
    " * Copia exacta del bundle publicado en ese release, incluida para que la vista",
    " * compacta funcione sin instalar nada aparte. No se edita a mano: se actualiza",
    " * con `node scripts/vendor-mini-climate.mjs`.",
    " *",
    lic,
    " */",
    `const MINI_CLIMATE_BUNDLED = "${tag}";`,
    "// Solo si nadie lo registro antes (por ejemplo, instalado aparte por HACS).",
    "// Sin window.customElements, como en los tests con Node, no se ejecuta.",
    'if (typeof window !== "undefined" && window.customElements && !window.customElements.get("mini-climate")) {',
    limpio(bundle),
    "}",
    FIN,
  ].join("\n");
}

async function bajar(tag) {
  const [licencia, bundle] = await Promise.all([
    get(`https://raw.githubusercontent.com/${REPO}/${tag}/LICENSE`),
    get(`https://github.com/${REPO}/releases/download/${tag}/mini-climate-card-bundle.js`),
  ]);
  return armarBloque(tag, licencia, bundle);
}

async function main() {
  const src = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
  const i = src.indexOf(INI);
  const j = src.indexOf(FIN);
  if (i < 0 || j < 0 || j < i) {
    throw new Error("No encuentro las marcas del bloque de mini-climate en ac-room-card.js");
  }
  const actual = src.slice(i, j + FIN.length);
  const arg = process.argv[2];

  if (arg === "--check") {
    const m = /const MINI_CLIMATE_BUNDLED = "([^"]+)"/.exec(actual);
    if (!m) throw new Error("El bloque no dice que version de mini-climate trae");
    const esperado = await bajar(m[1]);
    if (esperado !== actual) {
      console.error(`FALLA: el mini-climate-card ${m[1]} incluido no es identico al del release.`);
      process.exit(1);
    }
    console.log(`OK: mini-climate-card ${m[1]} incluido es identico al del release.`);
    return;
  }

  const tag = arg || JSON.parse(await get(`https://api.github.com/repos/${REPO}/releases/latest`)).tag_name;
  const nuevo = await bajar(tag);
  writeFileSync(FILE, src.slice(0, i) + nuevo + src.slice(j + FIN.length));
  console.log(`mini-climate-card ${tag} incluido en ac-room-card.js.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
