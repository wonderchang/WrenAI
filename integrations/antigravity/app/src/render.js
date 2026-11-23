// Pure rendering: turns a `visualize` result (structuredContent) into DOM.
// No host or SDK code here, so the same module drives the MCP App and the
// local preview page.
//
// Spec (all optional except chart and rows):
//   chart      bar | line | area | scatter | histogram | heatmap | table
//   x, y       column names (bar/line/area/scatter; heatmap categories)
//   series     column that splits bar/line/area into series
//   stacked    bar only: stack series instead of grouping
//   color      scatter: categorical column for point color
//   label      scatter: column drawn inside each point (e.g. an order number)
//   value      heatmap: numeric column for cell shade
//   bins       histogram bin count (default 20)
//   equal_aspect  scatter: same pixels per unit on both axes
//   reference  [{x0?, x1?, y0?, y1?, label?}] lines, bands or rects (numbers)
//   title, sql, rows

const NS = "http://www.w3.org/2000/svg";
const SLOTS = 8; // categorical palette size (CSS --s1..--s8)
const ALL_PAIRS_SAFE = 3; // scatter: past this many colors, add shape encoding
const SHAPES = ["circle", "square", "diamond", "triangle"];
const SEQ_STEPS = 7; // heatmap ramp (CSS --q1..--q7)

// ---------- small helpers ----------
function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") n.setAttribute("style", v);
    else n.setAttribute(k, v);
  }
  if (parent) parent.appendChild(n);
  return n;
}
function html(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}
function svgText(parent, x, y, s, cls, anchor = "start") {
  const t = el("text", { x, y, class: cls, "text-anchor": anchor }, parent);
  t.textContent = s;
  return t;
}
const num = (v) => (v == null || v === "" ? NaN : Number(v));
const isNum = (v) => Number.isFinite(num(v));

export function fmt(v) {
  if (v == null) return "–";
  if (typeof v !== "number") return String(v);
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e4) return (v / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "K";
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  if (a < 1) return v.toFixed(3);
  return v.toFixed(a < 10 ? 2 : 1);
}

// Clean axis ticks (d3-style "nice" steps of 1, 2, 5 x 10^n).
function ticks(lo, hi, count = 5) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / count;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const out = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(+v.toFixed(12));
  return out;
}

// Category list in first-seen order; past the palette size, fold into "Other".
function categories(rows, col) {
  const seen = [];
  for (const r of rows) {
    const k = String(r[col]);
    if (!seen.includes(k)) seen.push(k);
  }
  if (seen.length <= SLOTS) return { list: seen, key: (r) => String(r[col]) };
  const keep = seen.slice(0, SLOTS - 1);
  return {
    list: [...keep, "Other"],
    key: (r) => (keep.includes(String(r[col])) ? String(r[col]) : "Other"),
  };
}
const slot = (i) => `var(--s${(i % SLOTS) + 1})`;

// ---------- tooltip ----------
function tooltip(root) {
  const tip = html("div", "tip", root);
  tip.hidden = true;
  return {
    show(evt, lines) {
      tip.replaceChildren();
      for (const [k, v, color] of lines) {
        const row = html("div", "tip-row", tip);
        if (color) html("i", "key", row).style.background = color;
        html("span", "tip-k", row, k);
        html("span", "tip-v", row, v);
      }
      tip.hidden = false;
      const box = root.getBoundingClientRect();
      let left = evt.clientX - box.left + 12;
      const top = evt.clientY - box.top + 12;
      if (left + tip.offsetWidth > box.width) left -= tip.offsetWidth + 24;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${top}px`;
    },
    hide() { tip.hidden = true; },
  };
}
function rowLines(r, max = 8) {
  return Object.entries(r).slice(0, max).map(([k, v]) => [k, fmt(v)]);
}

// ---------- frame: axes, grid, reference marks ----------
const W = 640, H = 320, M = { l: 56, r: 16, t: 14, b: 40 };

function tickFmt(t) {
  const step = t.length > 1 ? Math.abs(t[1] - t[0]) : 1;
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const big = Math.max(...t.map(Math.abs)) >= 1e4;
  return (v) => (big ? fmt(v) : v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
}

function linearAxis(svg, scale, domain, orient, label, box) {
  const tv = ticks(domain[0], domain[1]);
  const f = tickFmt(tv);
  for (const v of tv) {
    if (v < domain[0] - 1e-9 || v > domain[1] + 1e-9) continue;
    if (orient === "y") {
      const yy = scale(v);
      el("line", { x1: box.l, x2: box.r, y1: yy, y2: yy, class: "grid" }, svg);
      svgText(svg, box.l - 8, yy + 4, f(v), "tick", "end");
    } else {
      const xx = scale(v);
      el("line", { x1: xx, x2: xx, y1: box.t, y2: box.b, class: "grid" }, svg);
      svgText(svg, xx, box.b + 16, f(v), "tick", "middle");
    }
  }
  if (orient === "y") svgText(svg, box.l, box.t - 2, label || "", "axis-label");
  else svgText(svg, box.r, box.b + 32, label || "", "axis-label", "end");
}

function drawReferences(svg, refs, sx, sy, box) {
  for (const ref of refs || []) {
    const has = (k) => typeof ref[k] === "number";
    const x0 = has("x0") ? sx(ref.x0) : box.l, x1 = has("x1") ? sx(ref.x1) : box.r;
    const y0 = has("y0") ? sy(ref.y0) : box.b, y1 = has("y1") ? sy(ref.y1) : box.t;
    const isLineY = has("y0") && !has("y1") && !has("x0") && !has("x1");
    const isLineX = has("x0") && !has("x1") && !has("y0") && !has("y1");
    if (isLineY) el("line", { x1: box.l, x2: box.r, y1: y0, y2: y0, class: "ref" }, svg);
    else if (isLineX) el("line", { x1: x0, x2: x0, y1: box.t, y2: box.b, class: "ref" }, svg);
    else {
      el("rect", {
        x: Math.min(x0, x1), y: Math.min(y0, y1),
        width: Math.abs(x1 - x0), height: Math.abs(y1 - y0), class: "ref ref-area",
      }, svg);
    }
    if (ref.label) {
      const lx = isLineY ? box.r : Math.min(x0, x1) + 4;
      const ly = isLineY ? y0 - 4 : Math.min(y0, y1) - 4;
      svgText(svg, lx, ly, ref.label, "ref-label", isLineY ? "end" : "start");
    }
  }
}

function refExtent(refs, a, b) {
  const v = [];
  for (const ref of refs || []) for (const k of [a, b]) if (typeof ref[k] === "number") v.push(ref[k]);
  return v;
}

// ---------- bar ----------
function barChart(root, d, ctx) {
  const { rows, x, y, series, stacked } = d;
  const cats = [...new Set(rows.map((r) => String(r[x])))];
  const ser = series ? categories(rows, series) : { list: ["_"], key: () => "_" };
  // value[cat][series]
  const val = new Map(cats.map((c) => [c, new Map()]));
  for (const r of rows) {
    const m = val.get(String(r[x]));
    const k = ser.key(r);
    m.set(k, (m.get(k) || 0) + (num(r[y]) || 0));
  }
  let lo = 0, hi = 0;
  for (const m of val.values()) {
    const vs = [...m.values()];
    if (stacked) {
      hi = Math.max(hi, vs.filter((v) => v > 0).reduce((a, b) => a + b, 0));
      lo = Math.min(lo, vs.filter((v) => v < 0).reduce((a, b) => a + b, 0));
    } else {
      hi = Math.max(hi, ...vs); lo = Math.min(lo, ...vs);
    }
  }
  const t = ticks(lo, hi); const dom = [t[0], t[t.length - 1]];
  const box = { l: M.l, r: W - M.r, t: M.t, b: H - M.b };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart" }, root);
  const sy = (v) => box.t + (box.b - box.t) * (1 - (v - dom[0]) / (dom[1] - dom[0]));
  linearAxis(svg, sy, dom, "y", y, box);
  const band = (box.r - box.l) / cats.length;
  const groups = stacked ? 1 : ser.list.length;
  const bw = Math.min(24, (band * 0.7 - 2 * (groups - 1)) / groups);
  const groupW = bw * groups + 2 * (groups - 1);
  cats.forEach((c, ci) => {
    const m = val.get(c);
    let pos = 0, neg = 0;
    ser.list.forEach((k, si) => {
      if (!m.has(k)) return;
      const v = m.get(k);
      const left = box.l + ci * band + (band - groupW) / 2 + (stacked ? 0 : si * (bw + 2));
      let v0, v1;
      if (stacked) {
        if (v >= 0) { v0 = pos; v1 = pos + v; pos = v1; } else { v0 = neg; v1 = neg + v; neg = v1; }
      } else { v0 = 0; v1 = v; }
      const top = Math.min(sy(v0), sy(v1)), bot = Math.max(sy(v0), sy(v1));
      // 2px surface gap between stacked segments
      const gap = stacked && si > 0 ? 1 : 0;
      const hgt = Math.max(0, bot - top - gap);
      const isEnd = !stacked || si === ser.list.length - 1 || !ser.list.slice(si + 1).some((kk) => m.has(kk));
      const mark = el("path", {
        d: roundedBar(left, v >= 0 ? top : top + gap, bw, hgt, isEnd ? 4 : 0, v >= 0),
        class: "mark", style: `fill:${slot(si)}`,
      }, svg);
      mark.addEventListener("mousemove", (e) => ctx.tip.show(e, [
        [x, c], ...(series ? [[series, k, slot(si)]] : []), [y, fmt(v)],
      ]));
      mark.addEventListener("mouseleave", ctx.tip.hide);
      mark.addEventListener("click", () => ctx.onPick({ [x]: c, ...(series ? { [series]: k } : {}), [y]: v }));
    });
  });
  const step = Math.ceil(cats.length / Math.floor((box.r - box.l) / 56));
  cats.forEach((c, i) => {
    if (i % step) return;
    svgText(svg, box.l + i * band + band / 2, box.b + 16, c.length > 10 ? c.slice(0, 9) + "…" : c, "tick", "middle");
  });
  svgText(svg, box.r, box.b + 32, x, "axis-label", "end");
  el("line", { x1: box.l, x2: box.r, y1: sy(0), y2: sy(0), class: "baseline" }, svg);
  if (series) legend(root, ser.list.map((k, i) => [k, slot(i)]));
}

// Bar with a rounded data end and a square baseline end.
function roundedBar(x, y, w, h, r, up) {
  r = Math.min(r, w / 2, h);
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return up
    ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
    : `M${x},${y}H${x + w}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x + r}Q${x},${y + h} ${x},${y + h - r}Z`;
}

// ---------- line / area ----------
function lineChart(root, d, ctx, area) {
  const { rows, x, y, series } = d;
  const ser = series ? categories(rows, series) : { list: ["_"], key: () => "_" };
  const numericX = rows.every((r) => isNum(r[x]));
  const xs = numericX ? [...new Set(rows.map((r) => num(r[x])))].sort((a, b) => a - b)
    : [...new Set(rows.map((r) => String(r[x])))];
  const pts = new Map(ser.list.map((k) => [k, new Map()]));
  for (const r of rows) pts.get(ser.key(r)).set(numericX ? num(r[x]) : String(r[x]), num(r[y]));
  // Lines show change, so the axis fits the data (and any reference lines);
  // areas encode magnitude by their fill, so they keep the zero baseline.
  const ys = [...rows.map((r) => num(r[y])).filter(Number.isFinite), ...refExtent(d.reference, "y0", "y1")];
  const t = ticks(area ? Math.min(0, ...ys) : Math.min(...ys), Math.max(...ys)); const dom = [t[0], t[t.length - 1]];
  const box = { l: M.l, r: W - M.r, t: M.t, b: H - M.b };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart" }, root);
  const sy = (v) => box.t + (box.b - box.t) * (1 - (v - dom[0]) / (dom[1] - dom[0]));
  const sx = numericX
    ? (v) => box.l + (box.r - box.l) * (v - xs[0]) / ((xs[xs.length - 1] - xs[0]) || 1)
    : (v) => box.l + (box.r - box.l) * (xs.indexOf(v) + 0.5) / xs.length;
  linearAxis(svg, sy, dom, "y", y, box);
  if (numericX) linearAxis(svg, sx, [xs[0], xs[xs.length - 1]], "x", x, box);
  else {
    const step = Math.ceil(xs.length / Math.floor((box.r - box.l) / 64));
    xs.forEach((c, i) => { if (!(i % step)) svgText(svg, sx(c), box.b + 16, c.length > 10 ? c.slice(0, 9) + "…" : c, "tick", "middle"); });
    svgText(svg, box.r, box.b + 32, x, "axis-label", "end");
  }
  drawReferences(svg, d.reference, numericX ? sx : null, sy, box);
  ser.list.forEach((k, si) => {
    const p = xs.filter((v) => pts.get(k).has(v)).map((v) => [sx(v), sy(pts.get(k).get(v))]);
    if (!p.length) return;
    if (area) {
      el("path", {
        d: `M${p[0][0]},${sy(Math.max(0, dom[0]))}` + p.map(([a, b]) => `L${a},${b}`).join("") + `L${p[p.length - 1][0]},${sy(Math.max(0, dom[0]))}Z`,
        class: "area", style: `fill:${slot(si)}`,
      }, svg);
    }
    el("polyline", { points: p.map((q) => q.join(",")).join(" "), class: "line", style: `stroke:${slot(si)}` }, svg);
    const last = p[p.length - 1];
    el("circle", { cx: last[0], cy: last[1], r: 4, class: "dot", style: `fill:${slot(si)}` }, svg);
  });
  // crosshair + tooltip over the nearest x
  const cross = el("line", { y1: box.t, y2: box.b, class: "cross", visibility: "hidden" }, svg);
  const hit = el("rect", { x: box.l, y: box.t, width: box.r - box.l, height: box.b - box.t, class: "hit" }, svg);
  hit.addEventListener("mousemove", (e) => {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    let best = xs[0], bd = Infinity;
    for (const v of xs) { const dd = Math.abs(sx(v) - loc.x); if (dd < bd) { bd = dd; best = v; } }
    cross.setAttribute("x1", sx(best)); cross.setAttribute("x2", sx(best)); cross.setAttribute("visibility", "visible");
    ctx.tip.show(e, [[x, fmt(best)], ...ser.list.filter((k) => pts.get(k).has(best))
      .map((k, i) => [series ? k : y, fmt(pts.get(k).get(best)), series ? slot(ser.list.indexOf(k)) : null])]);
  });
  hit.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); ctx.tip.hide(); });
  if (series) legend(root, ser.list.map((k, i) => [k, slot(i)]));
}

// ---------- scatter ----------
function marker(parent, shape, cx, cy, r, style) {
  const a = { class: "dot", style };
  if (shape === "square") return el("rect", { ...a, x: cx - r * 0.88, y: cy - r * 0.88, width: r * 1.76, height: r * 1.76, rx: 2 }, parent);
  if (shape === "diamond") return el("path", { ...a, d: `M${cx},${cy - r * 1.2}L${cx + r * 1.2},${cy}L${cx},${cy + r * 1.2}L${cx - r * 1.2},${cy}Z` }, parent);
  if (shape === "triangle") return el("path", { ...a, d: `M${cx},${cy - r * 1.2}L${cx + r * 1.15},${cy + r * 0.8}L${cx - r * 1.15},${cy + r * 0.8}Z` }, parent);
  return el("circle", { ...a, cx, cy, r }, parent);
}

function scatterChart(root, d, ctx) {
  const { rows, x, y, color, label } = d;
  const data = rows.filter((r) => isNum(r[x]) && isNum(r[y]));
  const col = color ? categories(data, color) : { list: ["_"], key: () => "_" };
  const useShapes = col.list.length > ALL_PAIRS_SAFE;
  const r = label ? 10 : 5;
  const pad = label ? 0.06 : 0.03;
  let xv = [...data.map((q) => num(q[x])), ...refExtent(d.reference, "x0", "x1")];
  let yv = [...data.map((q) => num(q[y])), ...refExtent(d.reference, "y0", "y1")];
  let xd = [Math.min(...xv), Math.max(...xv)], yd = [Math.min(...yv), Math.max(...yv)];
  const grow = (dd, f) => { const s = (dd[1] - dd[0]) || 1; return [dd[0] - s * f, dd[1] + s * f]; };
  let w = W, h = H;
  if (d.equal_aspect) {
    xd = grow(xd, pad); yd = grow(yd, pad);
    // same pixels per unit on both axes; fit inside 520 x 420 plot
    const ppu = Math.min(520 / (xd[1] - xd[0]), 420 / (yd[1] - yd[0]));
    w = M.l + M.r + ppu * (xd[1] - xd[0]);
    h = M.t + M.b + ppu * (yd[1] - yd[0]);
  } else {
    const tx = ticks(xd[0], xd[1]), ty = ticks(yd[0], yd[1]);
    xd = [tx[0], tx[tx.length - 1]]; yd = [ty[0], ty[ty.length - 1]];
  }
  const box = { l: M.l, r: w - M.r, t: M.t, b: h - M.b };
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, class: "chart" + (d.equal_aspect ? " fixed" : ""), style: d.equal_aspect ? `max-width:${Math.round(w)}px` : "" }, root);
  const sx = (v) => box.l + (box.r - box.l) * (v - xd[0]) / (xd[1] - xd[0]);
  const sy = (v) => box.t + (box.b - box.t) * (1 - (v - yd[0]) / (yd[1] - yd[0]));
  linearAxis(svg, sx, xd, "x", x, box);
  linearAxis(svg, sy, yd, "y", y, box);
  drawReferences(svg, d.reference, sx, sy, box);
  for (const q of data) {
    const ci = col.list.indexOf(col.key(q));
    const g = el("g", { class: "pt", tabindex: 0 }, svg);
    marker(g, useShapes ? SHAPES[ci % SHAPES.length] : "circle", sx(num(q[x])), sy(num(q[y])), r, `fill:${slot(ci)}`);
    if (label && q[label] != null) {
      const t = svgText(g, sx(num(q[x])), sy(num(q[y])) + 3.5, String(q[label]), "pt-label", "middle");
      if (ci % SLOTS === 3) t.style.fill = "var(--on-s4)";
    }
    g.addEventListener("mousemove", (e) => ctx.tip.show(e, rowLines(q)));
    g.addEventListener("mouseleave", ctx.tip.hide);
    g.addEventListener("click", () => ctx.onPick(q));
  }
  if (color) legend(root, col.list.map((k, i) => [k, slot(i), useShapes ? SHAPES[i % SHAPES.length] : "circle"]));
}

// ---------- histogram ----------
function histogram(root, d, ctx) {
  const vals = d.rows.map((r) => num(r[d.x])).filter(Number.isFinite);
  const n = Math.max(1, Math.min(100, d.bins || 20));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const width = (hi - lo) / n || 1;
  const counts = new Array(n).fill(0);
  for (const v of vals) counts[Math.min(n - 1, Math.floor((v - lo) / width))]++;
  const t = ticks(0, Math.max(...counts)); const dom = [0, t[t.length - 1]];
  const box = { l: M.l, r: W - M.r, t: M.t, b: H - M.b };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart" }, root);
  const sy = (v) => box.t + (box.b - box.t) * (1 - v / dom[1]);
  const sx = (v) => box.l + (box.r - box.l) * (v - lo) / (hi - lo || 1);
  linearAxis(svg, sy, dom, "y", "count", box);
  linearAxis(svg, sx, [lo, hi], "x", d.x, box);
  counts.forEach((c, i) => {
    const a = sx(lo + i * width) + 1, b = sx(lo + (i + 1) * width) - 1; // 2px gap
    const m = el("path", { d: roundedBar(a, sy(c), Math.max(1, b - a), box.b - sy(c), c ? 4 : 0, true), class: "mark", style: `fill:${slot(0)}` }, svg);
    const range = `${fmt(lo + i * width)} – ${fmt(lo + (i + 1) * width)}`;
    m.addEventListener("mousemove", (e) => ctx.tip.show(e, [[d.x, range], ["count", fmt(c)]]));
    m.addEventListener("mouseleave", ctx.tip.hide);
  });
  el("line", { x1: box.l, x2: box.r, y1: box.b, y2: box.b, class: "baseline" }, svg);
}

// ---------- heatmap ----------
function heatmap(root, d, ctx) {
  const { rows, x, y, value } = d;
  const xs = [...new Set(rows.map((r) => String(r[x])))];
  const ys = [...new Set(rows.map((r) => String(r[y])))];
  const cell = new Map(rows.map((r) => [`${r[x]}\u0000${r[y]}`, r]));
  const vs = rows.map((r) => num(r[value])).filter(Number.isFinite);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const step = (v) => 1 + Math.min(SEQ_STEPS - 1, Math.floor(((v - lo) / ((hi - lo) || 1)) * SEQ_STEPS));
  const left = 90, cw = Math.max(18, Math.min(64, (W - left - M.r) / xs.length)), ch = Math.max(18, Math.min(40, 360 / ys.length));
  const w = left + cw * xs.length + M.r, h = M.t + ch * ys.length + 40;
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, class: "chart", style: `max-width:${Math.round(w)}px` }, root);
  ys.forEach((yy, j) => svgText(svg, left - 8, M.t + j * ch + ch / 2 + 4, yy.length > 12 ? yy.slice(0, 11) + "…" : yy, "tick", "end"));
  xs.forEach((xx, i) => svgText(svg, left + i * cw + cw / 2, M.t + ys.length * ch + 16, xx.length > 8 ? xx.slice(0, 7) + "…" : xx, "tick", "middle"));
  svgText(svg, w - M.r, M.t + ys.length * ch + 32, x, "axis-label", "end");
  ys.forEach((yy, j) => xs.forEach((xx, i) => {
    const r = cell.get(`${xx}\u0000${yy}`);
    const v = r ? num(r[value]) : NaN;
    const rect = el("rect", {
      x: left + i * cw + 1, y: M.t + j * ch + 1, width: cw - 2, height: ch - 2, rx: 2,
      class: Number.isFinite(v) ? "cell" : "cell empty",
      style: Number.isFinite(v) ? `fill:var(--q${step(v)})` : "",
    }, svg);
    rect.addEventListener("mousemove", (e) => ctx.tip.show(e, [[x, xx], [y, yy], [value, fmt(v)]]));
    rect.addEventListener("mouseleave", ctx.tip.hide);
    if (r) rect.addEventListener("click", () => ctx.onPick(r));
  }));
  const lg = html("div", "ramp", root);
  html("span", "", lg, fmt(lo));
  for (let i = 1; i <= SEQ_STEPS; i++) html("i", "", lg).style.background = `var(--q${i})`;
  html("span", "", lg, `${fmt(hi)} ${value}`);
}

// ---------- table ----------
export function table(parent, rows, max = 200) {
  if (!rows.length) return html("div", "note", parent, "No rows.");
  const cols = Object.keys(rows[0]);
  const wrap = html("div", "table-wrap", parent);
  const t = html("table", "", wrap);
  const head = html("tr", "", html("thead", "", t));
  const body = html("tbody", "", t);
  let sortCol = null, asc = true;
  const fill = () => {
    body.replaceChildren();
    const sorted = sortCol == null ? rows : [...rows].sort((a, b) => {
      const p = a[sortCol], q = b[sortCol];
      const c = isNum(p) && isNum(q) ? num(p) - num(q) : String(p).localeCompare(String(q));
      return asc ? c : -c;
    });
    for (const r of sorted.slice(0, max)) {
      const tr = html("tr", "", body);
      for (const c of cols) html("td", isNum(r[c]) ? "n" : "", tr, typeof r[c] === "number" ? r[c].toLocaleString("en-US", { maximumFractionDigits: 3 }) : fmt(r[c]));
    }
  };
  for (const c of cols) {
    const th = html("th", rows.some((r) => typeof r[c] === "number") ? "n" : "", head, c);
    th.addEventListener("click", () => { asc = sortCol === c ? !asc : true; sortCol = c; fill(); });
  }
  fill();
  if (rows.length > max) html("div", "note", parent, `Showing ${max} of ${rows.length} rows.`);
}

// ---------- legend ----------
function legend(root, items) {
  const lg = html("div", "legend", root);
  for (const [label, color, shape] of items) {
    const s = html("span", "", lg);
    const k = html("i", `key ${shape || "square"}`, s);
    k.style.background = color;
    s.append(label);
  }
}

// ---------- entry ----------
export function render(root, d, { onPick = () => {} } = {}) {
  root.replaceChildren();
  if (!d || !Array.isArray(d.rows)) { root.textContent = "No data."; return; }
  const headEl = html("div", "head", root);
  html("div", "title", headEl, d.title || "Wren query");
  html("div", "meta", headEl, `${d.rows.length} rows · via Wren semantic layer`);
  const ctx = { tip: tooltip(root), onPick };
  if (!d.rows.length) { html("div", "note", root, "The query returned no rows."); }
  else if (d.chart === "table") table(root, d.rows);
  else {
    const draw = { bar: barChart, line: (r, dd, c) => lineChart(r, dd, c, false), area: (r, dd, c) => lineChart(r, dd, c, true), scatter: scatterChart, histogram, heatmap }[d.chart];
    if (!draw) root.append(`Unknown chart type: ${d.chart}`);
    else draw(root, d, ctx);
    const dt = html("details", "", root);
    html("summary", "", dt, "Data");
    table(dt, d.rows);
  }
  const sq = html("details", "", root);
  html("summary", "", sq, "SQL");
  html("pre", "", sq, d.sql || "");
}
