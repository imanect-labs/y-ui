/**
 * scatter のレイアウト。横軸・縦軸に目盛りを置き、点を描く。
 *
 * 点が少なければ（15 個まで）点の右に名前を添える（重なるものは省き、ホバーで出す）。
 * 4 列目のまとまりは色で分け、凡例を出す。軸は 0 を含めると点が片寄る場合は 0 から始めない。
 */

import type { ScatterFigure } from "../ir.js";
import { allIntegers, type Ctx, drawLegend, formatTick, formatValue, niceStep, SMALL_SIZE, tickStep } from "./frame.js";
import { fit } from "./measure.js";
import { SERIES, type Token } from "./theme.js";

const PLOT_HEIGHT = 240;
const LABEL_MAX = 15;
const GRID_DASH = "2 3";

/** 区切りのよい目盛り。0 は、値の範囲の半分より近い場合だけ含める。 */
export function scatterTicks(min: number, max: number, count = 5, integer = false): number[] {
  let lo = min;
  let hi = max;
  if (lo >= 0 && lo < hi * 0.5) lo = 0;
  if (hi <= 0 && hi > lo * 0.5) hi = 0;
  if (lo === hi) {
    lo -= Math.abs(lo) * 0.1 || 1;
    hi += Math.abs(hi) * 0.1 || 1;
  }
  const step = niceStep((hi - lo) / count, integer);
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : +v.toPrecision(12));
  return ticks;
}

export function layoutScatter(ctx: Ctx, f: ScatterFigure, top: number): number {
  const groups = [...new Set(f.points.map((p) => p.group).filter((g): g is string => g !== undefined))];
  const color = (g: string | undefined): Token => (g === undefined ? "s1" : (SERIES[groups.indexOf(g)] ?? "muted"));
  let y = drawLegend(ctx, groups, top, "box");
  if (f.points.length === 0) return y;

  const [labelName, xName, yName] = [f.columns[0] || "項目", f.columns[1] || "X", f.columns[2] || "Y"];
  const xs = f.points.map((p) => p.x);
  const ys = f.points.map((p) => p.y);
  const xt = scatterTicks(Math.min(...xs), Math.max(...xs), 5, allIntegers(xs));
  const yt = scatterTicks(Math.min(...ys), Math.max(...ys), 5, allIntegers(ys));
  const yLabels = yt.map((t) => formatTick(t, ctx.locale, tickStep(yt)));
  // 縦軸の名前（左上）
  ctx.items.push({ t: "text", x: ctx.pad, y: y + 12, text: fit(yName, ctx.width - ctx.pad * 2, SMALL_SIZE, ctx.measure), size: SMALL_SIZE, fill: "muted" });
  y += 20;
  const left = ctx.pad + Math.max(...yLabels.map((l) => ctx.measure(l, SMALL_SIZE))) + 8;
  const right = ctx.width - ctx.pad - 6;
  const plotTop = y + 4;
  const plotBottom = plotTop + PLOT_HEIGHT;
  const [x0, x1, y0, y1] = [xt[0]!, xt[xt.length - 1]!, yt[0]!, yt[yt.length - 1]!];
  const X = (v: number) => left + ((v - x0) / (x1 - x0)) * (right - left);
  const Y = (v: number) => plotBottom - ((v - y0) / (y1 - y0)) * PLOT_HEIGHT;

  yt.forEach((t, i) => {
    const yy = Math.round(Y(t)) + 0.5;
    ctx.items.push({ t: "path", d: `M${left},${yy}H${right}`, stroke: i === 0 ? "axis" : "grid", strokeWidth: 1, ...(i === 0 ? {} : { dash: GRID_DASH }) });
    ctx.items.push({ t: "text", x: left - 8, y: yy + 4, text: yLabels[i]!, size: SMALL_SIZE, fill: "muted", anchor: "end", tabular: true });
  });
  xt.forEach((t, i) => {
    const xx = Math.round(X(t)) + 0.5;
    ctx.items.push({ t: "path", d: `M${xx},${plotTop}V${plotBottom}`, stroke: i === 0 ? "axis" : "grid", strokeWidth: 1, ...(i === 0 ? {} : { dash: GRID_DASH }) });
    ctx.items.push({ t: "text", x: xx, y: plotBottom + 15, text: formatTick(t, ctx.locale, tickStep(xt)), size: SMALL_SIZE, fill: "muted", anchor: "middle", tabular: true });
  });
  // 横軸の名前（右下）
  ctx.items.push({ t: "text", x: right, y: plotBottom + 32, text: fit(xName, right - left, SMALL_SIZE, ctx.measure), size: SMALL_SIZE, fill: "muted", anchor: "end" });

  // 点の名前は、重ならないものだけ置く
  const taken: { x: number; y: number; w: number; h: number }[] = f.points.map((p) => ({ x: X(p.x) - 6, y: Y(p.y) - 6, w: 12, h: 12 }));
  const overlaps = (a: { x: number; y: number; w: number; h: number }) => taken.some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
  f.points.forEach((p, i) => {
    const g = `p${i}`;
    const cx = X(p.x);
    const cy = Y(p.y);
    ctx.items.push({ t: "circle", cx, cy, r: 6, fill: color(p.group), stroke: "surface", strokeWidth: 2, group: g, hint: `${p.label}: ${xName} ${formatValue(p.x, ctx.locale)}、${yName} ${formatValue(p.y, ctx.locale)}` });
    if (f.points.length <= LABEL_MAX) {
      const text = fit(p.label + (p.refs.length ? ` ${p.refs.map((n) => `[${n}]`).join("")}` : ""), 104, SMALL_SIZE + 1, ctx.measure);
      const w = ctx.measure(text, SMALL_SIZE + 1);
      const toLeft = cx + 11 + w > right;
      const box = { x: toLeft ? cx - 11 - w : cx + 11, y: cy - 8, w, h: 14 };
      if (!overlaps(box)) {
        taken.push(box);
        ctx.items.push({ t: "text", x: toLeft ? cx - 11 : cx + 11, y: cy + 4, text, size: SMALL_SIZE + 1, fill: "ink2", anchor: toLeft ? "end" : "start", group: g });
      }
    }
    ctx.targets.push({
      hit: { x: cx - 9, y: cy - 9, w: 18, h: 18 },
      keep: [g],
      tip: {
        title: p.label,
        rows: [
          { label: xName, value: formatValue(p.x, ctx.locale), token: color(p.group) },
          { label: yName, value: formatValue(p.y, ctx.locale) },
        ],
        ...(p.group !== undefined ? { footer: `${f.columns[3] ?? labelName}: ${p.group}` } : {}),
        x: cx,
        y: cy - 6,
      },
    });
  });
  return plotBottom + 40;
}


