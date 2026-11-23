// Bundle the app into one self-contained HTML (the MCP Apps default CSP blocks
// external scripts and styles).
//   node build.mjs            -> ../server/chart.html, vega.html, vega-lite.schema.json.gz
//   node build.mjs --preview  -> also dist/preview.html (renders samples/*.json, or
//                                $SAMPLES_DIR/*.json, without a host)
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const css = readFileSync("src/styles.css", "utf8");

async function bundle(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, format: "esm", minify: true, write: false, target: "es2022" });
  return out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
}

function page(js, extra = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${extra}<div id="root">Waiting for data…</div><script type="module">${js}</script></body></html>`;
}

const html = page(await bundle("src/main.js"));
mkdirSync("../server", { recursive: true });
writeFileSync("../server/chart.html", html);
console.log("wrote server/chart.html", html.length, "bytes");
const canvas = page(await bundle("src/vega-app.js"));
writeFileSync("../server/vega.html", canvas);
console.log("wrote server/vega.html", canvas.length, "bytes");
// The server validates agent specs against the same Vega-Lite version the canvas runs.
const schema = JSON.stringify(JSON.parse(readFileSync("node_modules/vega-lite/build/vega-lite-schema.json", "utf8")));
const gz = gzipSync(schema, { level: 9 });
writeFileSync("../server/vega-lite.schema.json.gz", gz);
console.log("wrote server/vega-lite.schema.json.gz", gz.length, "bytes");

if (process.argv.includes("--preview")) {
  const dir = process.env.SAMPLES_DIR || "samples";
  const samples = readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
  const data = `<script>window.SAMPLES=${JSON.stringify(samples).replace(/</g, "\\u003c")}</script>`;
  mkdirSync("dist", { recursive: true });
  writeFileSync("dist/preview.html", page(await bundle("src/preview.js"), data));
  console.log("wrote app/dist/preview.html with", samples.length, "samples");
  const vdir = process.env.VEGA_SAMPLES_DIR || "samples-vega";
  const vs = readdirSync(vdir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(`${vdir}/${f}`, "utf8")));
  const vdata = `<script>window.VEGA_SAMPLES=${JSON.stringify(vs).replace(/</g, "\\u003c")}</script>`;
  writeFileSync("dist/vega-preview.html", page(await bundle("src/vega-preview.js"), vdata));
  console.log("wrote app/dist/vega-preview.html with", vs.length, "samples");
}
