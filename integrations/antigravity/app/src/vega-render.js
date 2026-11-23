// Vega-Lite renderer shared by the canvas app and the dev preview.
import { parse, View } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import { compile } from "vega-lite";
import { table } from "./render.js";

let view = null;

// Theme config from the CSS tokens, so agent specs inherit the validated
// palette and both modes unless they set colors explicitly.
function config() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const cat = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--s${i}`));
  const seq = [1, 2, 3, 4, 5, 6, 7].map((i) => v(`--q${i}`));
  const ink = v("--ink"), ink2 = v("--ink-2"), rule = v("--rule");
  return {
    background: null,
    font: "system-ui, sans-serif",
    range: { category: cat, ordinal: seq, ramp: seq, heatmap: seq },
    mark: { color: cat[0] },
    bar: { cornerRadiusEnd: 4, discreteBandSize: { band: 0.8 } },
    line: { strokeWidth: 2 },
    point: { size: 64, filled: true },
    axis: { labelColor: ink2, titleColor: ink2, gridColor: rule, domainColor: rule, tickColor: rule, labelFontSize: 11, titleFontSize: 11 },
    legend: { labelColor: ink, titleColor: ink2, labelFontSize: 12, titleFontSize: 11 },
    title: { color: ink, fontSize: 14, anchor: "start" },
    text: { color: ink },
    view: { stroke: null },
  };
}

export async function renderVega(root, d) {
  view?.finalize();
  view = null;
  root.replaceChildren();
  const el = (tag, cls, parent, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    parent.appendChild(n);
    return n;
  };
  if (!d || !d.spec || !Array.isArray(d.rows)) { root.textContent = "No data."; return; }
  const head = el("div", "head", root);
  el("div", "title", head, d.title || d.spec.title || "Wren query");
  el("div", "meta", head, `${d.rows.length} rows · via Wren semantic layer · chart spec by the agent`);
  const box = el("div", "vega", root);
  try {
    const spec = { ...d.spec, data: { values: d.rows } };
    if (d.title) delete spec.title;
    if (spec.width == null && !spec.facet && !spec.hconcat && !spec.concat) spec.width = "container";
    const vg = compile(spec, { config: config() }).spec;
    view = new View(parse(vg, null, { ast: true }), {
      expr: expressionInterpreter,
      renderer: "svg",
      container: box,
      hover: true,
    });
    await view.runAsync();
  } catch (e) {
    el("div", "note", box, `Could not draw this spec: ${e.message}`);
  }
  const dt = el("details", "", root);
  el("summary", "", dt, "Data");
  table(dt, d.rows);
  const sp = el("details", "", root);
  el("summary", "", sp, "Chart spec");
  el("pre", "", sp, JSON.stringify(d.spec, null, 2));
  const sq = el("details", "", root);
  el("summary", "", sq, "SQL");
  el("pre", "", sq, d.sql || "");
}
