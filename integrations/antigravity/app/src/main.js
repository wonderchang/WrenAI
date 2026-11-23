// Wren chart app: host bridge. Receives a `visualize` result from Antigravity
// (or any MCP Apps host) and hands it to the renderer.
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { render, fmt } from "./render.js";

const root = document.getElementById("root");
const app = new App({ name: "Wren chart", version: "0.2.0" }, {});
let canMessage = false;
let current = null;

// Clicking a mark asks the agent about it, in the user's name.
async function onPick(row) {
  if (!canMessage) return;
  const fields = Object.entries(row).slice(0, 10).map(([k, v]) => `${k}=${fmt(v)}`).join(", ");
  await app.sendMessage({
    role: "user",
    content: [{ type: "text", text: `About this point on the chart "${current?.title || "Wren query"}" (${fields}): what does it tell us?` }],
  });
}

function theme(ctx) {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
}

app.ontoolinput = () => { root.textContent = "Running query through Wren…"; };
app.ontoolresult = (result) => {
  current = result.structuredContent;
  render(root, current, { onPick });
};
app.onhostcontextchanged = theme;

await app.connect();
theme(app.getHostContext());
canMessage = Boolean(app.getHostCapabilities()?.message);
