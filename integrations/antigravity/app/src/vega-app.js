// Wren canvas app: renders a Vega-Lite spec written by the agent, with rows the
// server fetched through Wren. Uses the Vega interpreter so no eval is needed
// under the MCP Apps CSP.
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { renderVega } from "./vega-render.js";

const root = document.getElementById("root");
const app = new App({ name: "Wren canvas", version: "0.1.0" }, {});
let current = null;

function theme(ctx) {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (current) renderVega(root, current);
}

app.ontoolinput = () => { root.textContent = "Running query through Wren…"; };
app.ontoolresult = (result) => {
  current = result.structuredContent;
  renderVega(root, current);
};
app.onhostcontextchanged = theme;

await app.connect();
theme(app.getHostContext());
