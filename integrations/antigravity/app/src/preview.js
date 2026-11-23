// Dev-only preview: renders every sample spec without an MCP host.
// ?theme=dark forces the dark tokens.
import { render } from "./render.js";

const params = new URLSearchParams(location.search);
if (params.get("theme")) document.documentElement.dataset.theme = params.get("theme");
const host = document.getElementById("root");
host.replaceChildren();
for (const spec of window.SAMPLES || []) {
  const box = document.createElement("section");
  box.style.cssText = "position:relative;max-width:680px;margin:0 0 28px;padding-bottom:12px;border-bottom:1px solid var(--rule)";
  host.appendChild(box);
  render(box, spec, { onPick: (row) => console.log("pick", row) });
}
