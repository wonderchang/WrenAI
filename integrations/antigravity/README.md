# Wren AI plugin for Google Antigravity

Connects Antigravity to a local Wren project over MCP: governed semantic SQL,
the project's rules from `get_instructions`, and two inline chart tools
rendered as [MCP Apps](https://github.com/modelcontextprotocol/ext-apps)
(`ui://` resources).

This plugin runs the open-source Wren engine on your machine (stdio, no
network listener). It is not the Wren AI Cloud integration.

> Status: pre-release. The server imports `wren.cli._build_engine`, which is
> private in `wrenai` 0.18.0, and only macOS has been tested.

## Requirements

- Antigravity 2.34+ (app or `agy` CLI)
- [`uv`](https://docs.astral.sh/uv/) on `PATH`; the plugin launches `wrenai` with it
- A Wren project with a built `target/mdl.json` (`wren context build`) and a
  `WREN_HOME` holding a profile for its data source

## Install

```bash
git clone https://github.com/Canner/WrenAI
agy plugin install WrenAI/integrations/antigravity
```

Then open Customizations > Plugins > Wren AI in Antigravity, fill in
`WREN_PROJECT_DIR` and `WREN_HOME_DIR`, and enable it.

After reinstalling, quit Antigravity fully (and any `agy` session): a running
MCP server keeps the old code and tool list.

## Chart tools

Both tools take the final SQL, run it through the Wren semantic layer and send
the rows to the chart frame, so the numbers always come from Wren. They differ
in who designs the chart.

| Tool | The agent sends | Guarantees |
|---|---|---|
| `visualize` | a chart type (`bar`, `line`, `area`, `scatter`, `histogram`, `heatmap`, `table`) and column names | Validated palette in light and dark mode, shape encoding past three colors, label contrast, a data table |
| `show_vega` | a Vega-Lite v6 spec without data | Spec checked against the Vega-Lite schema (errors name the bad property); `data`, URLs, color scales and `config` are rejected or removed, so the theme palette applies |

The model sees a short summary with the first eight rows; the frame receives
all rows (up to `limit`, default 500, max 5000).

## Layout

| Path | What |
|---|---|
| `.antigravity-plugin/plugin.json` | Plugin manifest |
| `mcp_config.json` | Launches the server with `uv run`; declares the two setup variables |
| `server/wren_apps_server.py` | Wren's MCP server (`wren.mcp_server.build_server`) plus `visualize`, `show_vega` and their `ui://` resources |
| `server/chart.html`, `server/vega.html` | Built chart frames (generated) |
| `server/vega-lite.schema.json.gz` | Vega-Lite schema matching the canvas version (generated) |
| `app/` | Frame sources |
| `skills/wren-semantic-analytics/` | Agent skill: how to use the Wren tools and pick a chart tool |

## Develop

```bash
cd app
npm ci
node build.mjs             # rebuilds the generated files in server/
node build.mjs --preview   # also dist/preview.html and dist/vega-preview.html from the samples
```

The frames are single self-contained HTML files because the MCP Apps default
CSP blocks external scripts and styles. The canvas runs Vega with its
expression interpreter, so it needs no `eval`.
