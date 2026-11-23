---
name: wren-semantic-analytics
description: Answer data questions through the Wren AI MCP server (semantic layer, business rules, knowledge). Use for any question about metrics, trends, comparisons, breakdowns or "what should I do" questions that need numbers from the connected Wren project.
---

# Wren semantic analytics

1. Call `get_instructions` first and follow every rule it returns. These are
   the organization's definitions, thresholds and report format; they win over
   general habits.
2. Find the right objects with `list_models`, `describe_model`, `list_cubes`
   and `describe_cube`. Check `list_knowledge` and `recall_queries` for curated
   examples before writing new SQL.
3. Query only through `run_sql` or `query_cube`. Never read raw files or the
   database directly.
4. Prefer cube measures for rates; never average rates.
5. In the answer, give the sample size and date window behind every number,
   and say "not enough data" when a sample is below the rules' minimum.
6. When a chart would help the user, draw it from the final SQL. Both tools
   run the SQL through Wren, so the numbers stay governed; they differ in who
   designs the chart:
   - `visualize` (default): a fixed set of forms with accessible colors,
     shapes and labels built in. Pick the form by the question: `bar` to
     compare categories, `line`/`area` for change over time, `scatter` for two
     measures or positions, `histogram` for a distribution, `heatmap` for two
     categories crossed, `table` when exact values matter more than shape.
   - `show_vega`: you write a Vega-Lite v6 spec for anything `visualize`
     cannot express (extra layers, reference grids, facets, custom
     transforms). Do not put data or colors in it; refer to result columns by
     name and use `scale.domain` to order categories. Keep data marks
     opaque (opacity 0.7 or more) so their colors stay readable in dark mode,
     and place text labels so they do not overlap marks or each other. If it
     returns a schema error, fix the named property and call it again.
   Check `get_instructions` for chart recipes the organization has defined.
   The chart renders inline; keep your text answer short and refer to it.
