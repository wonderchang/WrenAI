"""Wren MCP server + one MCP Apps tool (`visualize`) that renders results inline.

Uses `wrenai` as a library: all standard Wren tools come from
`wren.mcp_server.build_server`; this file only adds the chart tool and its
`ui://` resource. Run:

    uv run --no-project --python 3.12 --with "wrenai[mcp]==0.18.0" python server/wren_apps_server.py --project <wren project>
"""

from __future__ import annotations

import argparse
import datetime as dt
import decimal
import gzip
import json
import os
from pathlib import Path

from jsonschema import Draft7Validator
from mcp.types import CallToolResult, TextContent
from wren.cli import (
    _build_engine,  # private in 0.18.0; same call `wren serve mcp` makes
)
from wren.context import discover_project_path
from wren.mcp_server import ServeContext, build_server

APP_URI = "ui://wren/chart.html"
APP_HTML = Path(os.environ.get("WREN_CHART_HTML", Path(__file__).parent / "chart.html"))
CHARTS = ("bar", "line", "area", "scatter", "histogram", "heatmap", "table")
# Columns each chart type needs, by parameter name.
REQUIRED = {
    "bar": ("x", "y"),
    "line": ("x", "y"),
    "area": ("x", "y"),
    "scatter": ("x", "y"),
    "histogram": ("x",),
    "heatmap": ("x", "y", "value"),
    "table": (),
}
REF_KEYS = ("x0", "x1", "y0", "y1")
CANVAS_URI = "ui://wren/vega.html"
CANVAS_HTML = Path(
    os.environ.get("WREN_CANVAS_HTML", Path(__file__).parent / "vega.html")
)
VL_SCHEMA = Path(__file__).parent / "vega-lite.schema.json.gz"
# Keys that would load data or code from elsewhere; the rows always come from Wren.
FORBIDDEN_KEYS = {"data", "datasets", "url", "href"}
COLOR_CHANNELS = {"color", "fill", "stroke"}
# Error kinds that tell the agent what to write instead, most useful first.
ERROR_RANK = {"enum": 3, "additionalProperties": 2, "required": 1}
_validator: Draft7Validator | None = None


def _vl_error(spec: dict) -> str | None:
    """Validate against the Vega-Lite schema; return the most actionable error."""
    global _validator
    if _validator is None:
        _validator = Draft7Validator(
            json.loads(gzip.decompress(VL_SCHEMA.read_bytes()))
        )
    errors = list(_validator.iter_errors({**spec, "data": {"values": []}}))
    if not errors:
        return None

    def leaves(err):
        if not err.context:
            yield err
            return
        for c in err.context:
            yield from leaves(c)

    e = max(
        (leaf for top in errors for leaf in leaves(top)),
        key=lambda x: (len(x.absolute_path), ERROR_RANK.get(x.validator, 0)),
    )
    where = "/".join(map(str, e.absolute_path)) or "(top level)"
    return f"{where}: {e.message[:400]}"


def _strip_colors(spec: dict) -> list[str]:
    """Drop color scales, config and hidden color legends.

    The theme's validated palette then applies and every color has a legend.
    Keeps `scale.domain`, which sets the legend order. Returns what was removed.
    """
    removed = []
    if "config" in spec:
        del spec["config"]
        removed.append("config")

    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                if k in COLOR_CHANNELS and isinstance(v, dict):
                    if "legend" in v and v["legend"] is None:
                        # Color must never be the only key to identity.
                        del v["legend"]
                        removed.append(".".join([*path, k, "legend"]))
                    scale = v.get("scale")
                    if isinstance(scale, dict):
                        for key in ("range", "scheme"):
                            if key in scale:
                                del scale[key]
                                removed.append(".".join([*path, k, "scale", key]))
                walk(v, [*path, k])
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, [*path, str(i)])

    walk(spec, [])
    return removed


def _check_spec(spec: dict, cols: set[str]) -> None:
    """Reject specs that load their own data or name columns the result lacks."""
    fields: set[str] = set()
    derived: set[str] = set()

    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                if k in FORBIDDEN_KEYS:
                    raise ValueError(
                        f"spec must not set {'.'.join(path + [k])}; the rows come from the SQL"
                    )
                if k == "field" and isinstance(v, str):
                    fields.add(v.split(".")[0].replace("\\", ""))
                if k == "fold":
                    derived.update(("key", "value"))  # fold's default output names
                if k == "as":
                    for a in v if isinstance(v, list) else [v]:
                        if isinstance(a, str):
                            derived.add(a)
                walk(v, path + [k])
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, path + [str(i)])

    walk(spec, [])
    unknown = sorted(fields - cols - derived)
    if unknown:
        raise ValueError(
            f"spec uses fields {unknown} that are not result columns {sorted(cols)}"
        )


def _plain(v):
    if isinstance(v, (dt.date, dt.datetime, dt.time)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    return v


def _resolve_reference(ref: dict, rows: list[dict]) -> dict:
    """Reference bounds may be numbers or column names (meaning that column's mean)."""
    out = {}
    for k in REF_KEYS:
        v = ref.get(k)
        if v is None:
            continue
        if isinstance(v, (int, float)):
            out[k] = float(v)
            continue
        vals = [r[v] for r in rows if isinstance(r.get(v), (int, float))]
        if not vals:
            raise ValueError(
                f"reference {k}={v!r} is neither a number nor a numeric column"
            )
        out[k] = sum(vals) / len(vals)
    if not out:
        raise ValueError(f"reference needs at least one of {REF_KEYS}")
    if ref.get("label"):
        out["label"] = str(ref["label"])
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    args = ap.parse_args()

    project = discover_project_path(args.project)
    engine = _build_engine(
        str(project / "target" / "mdl.json"), None, None, conn_required=True
    )
    ctx = ServeContext(
        project=project, engine=engine, allow_write=False, no_connect=False
    )
    mcp = build_server(ctx)

    @mcp.tool(
        title="Visualize a Wren query",
        meta={"ui": {"resourceUri": APP_URI}},
    )
    def visualize(
        sql: str,
        chart: str = "bar",
        x: str | None = None,
        y: str | None = None,
        series: str | None = None,
        stacked: bool = False,
        color: str | None = None,
        label: str | None = None,
        value: str | None = None,
        bins: int = 20,
        equal_aspect: bool = False,
        reference: list[dict] | None = None,
        title: str | None = None,
        limit: int = 500,
    ) -> CallToolResult:
        """Run SQL through the Wren semantic layer and render it as an interactive chart for the user.

        Use after you know the answer's shape, to show it visually. Column
        arguments name columns of the SQL result.

        chart:
          bar        x = category, y = number; `series` groups bars, `stacked` stacks them
          line, area x = time or number, y = number; `series` draws one line per value
          scatter    x, y = numbers; `color` = category column, `label` = short text
                     drawn inside each point (e.g. an order number), `equal_aspect`
                     keeps one unit the same length on both axes (positions, maps)
          histogram  x = number; `bins` = bin count
          heatmap    x, y = categories, `value` = number for the cell shade
          table      sortable table of the rows
        reference: optional lines, bands or boxes drawn behind the marks, e.g.
          [{"y0": 120, "label": "target"}] (horizontal line) or
          [{"x0": -1, "x1": 1, "y0": "low", "y1": "high"}] (box). Each bound is a
          number or a result column name, which uses that column's mean.
        Categories and series appear in result row order, so use ORDER BY to
        control it. Up to 8 colors; more categories fold into "Other".
        `limit` caps the rows charted (default 500, max 5000); raise it for a
        histogram so the distribution is not truncated.
        """
        if chart not in CHARTS:
            raise ValueError(f"chart must be one of {CHARTS}")
        limit = max(1, min(int(limit), 5000))
        table = engine.query(sql, limit)
        rows = [{k: _plain(v) for k, v in r.items()} for r in table.to_pylist()]
        cols = set(table.column_names)
        given = {"x": x, "y": y, "value": value}
        missing = [p for p in REQUIRED[chart] if not given[p] or given[p] not in cols]
        optional = {"series": series, "color": color, "label": label}
        missing += [p for p, c in optional.items() if c and c not in cols]
        if missing:
            raise ValueError(
                f"{chart} needs result columns for {missing}; result columns are {sorted(cols)}"
            )
        refs = [_resolve_reference(r, rows) for r in (reference or [])]
        preview = rows[:8]
        summary = (
            f"Rendered a {chart} chart for the user ({len(rows)} rows; columns: "
            f"{', '.join(table.column_names)}). First rows: {preview}"
        )
        spec = {
            "chart": chart,
            "x": x,
            "y": y,
            "series": series,
            "stacked": stacked,
            "color": color,
            "label": label,
            "value": value,
            "bins": bins,
            "equal_aspect": equal_aspect,
            "reference": refs,
            "title": title,
            "sql": sql,
            "rows": rows,
        }
        return CallToolResult(
            content=[TextContent(type="text", text=summary)],
            structuredContent={
                k: v for k, v in spec.items() if v not in (None, [], False)
            },
        )

    @mcp.tool(
        title="Draw a Wren query with a Vega-Lite spec",
        meta={"ui": {"resourceUri": CANVAS_URI}},
    )
    def show_vega(
        sql: str, spec: dict, title: str | None = None, limit: int = 500
    ) -> CallToolResult:
        """Run SQL through the Wren semantic layer and draw the rows with a Vega-Lite v6 spec you write.

        Use this when a chart would help and you want full control of its form.
        The server runs `sql` and supplies the rows as the spec's data, so do
        not put `data`, `datasets` or any URL in the spec; refer to result
        columns by name in `field`. Layers, transforms (`calculate`, `filter`,
        `aggregate`, `window`, ...), `datum` constants and facets all work.
        Colors come from a validated light/dark theme: color scale `range` and
        `scheme` and any `config` are removed, but `scale.domain` is kept, so
        use it to order categories; `legend: null` on a color channel is
        removed. The spec is checked against the Vega-Lite
        schema and an invalid one returns an error naming the bad property.
        The width defaults to the frame width. `limit` caps the rows (default 500, max 5000).
        """
        if not isinstance(spec, dict):
            raise TypeError("spec must be a Vega-Lite JSON object")
        limit = max(1, min(int(limit), 5000))
        table = engine.query(sql, limit)
        rows = [{k: _plain(v) for k, v in r.items()} for r in table.to_pylist()]
        spec = {k: v for k, v in spec.items() if k != "$schema"}
        _check_spec(spec, set(table.column_names))
        if err := _vl_error(spec):
            raise ValueError(f"not a valid Vega-Lite v6 spec at {err}")
        removed = _strip_colors(spec)
        summary = (
            f"Drew the spec for the user ({len(rows)} rows; columns: "
            f"{', '.join(table.column_names)}). First rows: {rows[:8]}."
        )
        if removed:
            summary += (
                f" Removed {', '.join(removed)}: colors come from the theme and "
                "color legends stay visible, so do not set these."
            )
        out = {"spec": spec, "sql": sql, "rows": rows}
        if title:
            out["title"] = title
        return CallToolResult(
            content=[TextContent(type="text", text=summary)], structuredContent=out
        )

    @mcp.resource(
        CANVAS_URI,
        name="Wren canvas",
        mime_type="text/html;profile=mcp-app",
        meta={"ui": {"prefersBorder": True}},
    )
    def canvas_app() -> str:
        return CANVAS_HTML.read_text()

    @mcp.resource(
        APP_URI,
        name="Wren chart",
        mime_type="text/html;profile=mcp-app",
        meta={"ui": {"prefersBorder": True}},
    )
    def chart_app() -> str:
        return APP_HTML.read_text()

    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
