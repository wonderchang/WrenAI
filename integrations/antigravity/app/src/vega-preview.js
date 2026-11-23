// Dev-only preview for the canvas: renders window.VEGA_SAMPLES without a host.
import { renderVega } from "./vega-render.js";

const params = new URLSearchParams(location.search);
if (params.get("theme")) document.documentElement.dataset.theme = params.get("theme");
const host = document.getElementById("root");
host.replaceChildren();
for (const spec of window.VEGA_SAMPLES || []) {
  const box = document.createElement("section");
  box.style.cssText = "position:relative;max-width:680px;margin:0 0 28px;padding-bottom:12px;border-bottom:1px solid var(--rule)";
  host.appendChild(box);
  await renderVega(box, spec);
}
