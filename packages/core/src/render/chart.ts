/**
 * bar / line のレイアウト。
 *
 * マークの仕様は dataviz の指針に従う: 棒は 24px 以下・データ側の端だけ 4px の角丸・基線から伸ばす、
 * 線は 2px、点は半径 4 に 2px の背景色の縁、目盛り線は 1px の実線で控えめに、値の数字は控えめに一部だけ。
 */

import type { ChartFigure } from "../ir.js";
import { BODY_SIZE, type Ctx, drawLegend, formatTick, formatValue, niceTicks, SMALL_SIZE } from "./frame.js";
import { fit } from "./measure.js";
import { barPath, type TipRow } from "./scene.js";
import { SERIES } from "./theme.js";

const PLOT_HEIGHT = 220;
const MAX_BAR = 24;
const GAP = 2;
/** 目盛り線は細かい破線にして、データより目立たせない（基線は実線）。 */
const GRID_DASH = "2 4";

function seriesNames(f: ChartFigure): string[] {
  return f.columns.slice(1);
}

function hint(f: ChartFigure, label: string, s: number, v: number, ctx: Ctx): string {
  const names = seriesNames(f);
  const name = names.length > 1 ? ` ${names[s]}` : "";
  return `${label}${name}: ${formatValue(v, ctx.locale)}${f.unit ?? ""}`;
}

/** 値の範囲（積み上げなら行ごとの合計）。 */
function extent(f: ChartFigure): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const r of f.rows) {
    if (f.stacked && f.kind === "bar") {
      let pos = 0;
      let neg = 0;
      for (const v of r.values) if (v !== null) (v >= 0 ? (pos += v) : (neg += v));
      lo = Math.min(lo, neg);
      hi = Math.max(hi, pos);
    } else {
      for (const v of r.values) if (v !== null) ((lo = Math.min(lo, v)), (hi = Math.max(hi, v)));
    }
  }
  return [lo, hi];
}

/** ホバーで出す、行のすべての系列の値。 */
function tipRows(ctx: Ctx, f: ChartFigure, values: (number | null)[]): TipRow[] {
  const names = seriesNames(f);
  const rows: TipRow[] = [];
  values.forEach((v, s) => {
    if (v !== null && v !== undefined) rows.push({ label: names[s] ?? "", value: formatValue(v, ctx.locale), token: SERIES[s % 8]! });
  });
  return rows;
}

/** 行の値が描く範囲の端（積み上げは正と負の合計、それ以外は値そのもの）。 */
function rowExtent(f: ChartFigure, values: (number | null)[]): [number, number] {
  const vs = values.filter((v): v is number => v !== null && v !== undefined);
  if (f.stacked && f.kind === "bar") {
    return [vs.filter((v) => v < 0).reduce((a, v) => a + v, 0), vs.filter((v) => v > 0).reduce((a, v) => a + v, 0)];
  }
  return [Math.min(0, ...vs), Math.max(0, ...vs)];
}

export function layoutChart(ctx: Ctx, f: ChartFigure, y0: number): number {
  const names = seriesNames(f);
  let y = drawLegend(ctx, names, y0, f.kind === "bar" ? "box" : "line");
  if (f.unit) {
    ctx.items.push({ t: "text", x: ctx.pad, y: y + 12, text: ctx.labels.unit(f.unit), size: SMALL_SIZE, fill: "muted" });
    y += 18;
  }
  if (f.rows.length === 0) return y;

  const maxLabel = Math.max(...f.rows.map((r) => ctx.measure(r.label, SMALL_SIZE)));
  const plotWidth = ctx.width - ctx.pad * 2 - 48;
  const horizontal = f.kind === "bar" && (f.horizontal === true || f.rows.length > 14 || (f.rows.length > 6 && maxLabel > (plotWidth / f.rows.length) * 1.6));
  return horizontal ? horizontalBars(ctx, f, y) : vertical(ctx, f, y);
}

// ---------------------------------------------------------------- 縦向き（棒・折れ線）

function vertical(ctx: Ctx, f: ChartFigure, top: number): number {
  const S = Math.max(1, f.columns.length - 1);
  const R = f.rows.length;
  const [lo, hi] = extent(f);
  const ticks = niceTicks(lo, hi);
  const tMin = ticks[0]!;
  const tMax = ticks[ticks.length - 1]!;
  const tickLabels = ticks.map((t) => formatTick(t, ctx.locale));
  const left = ctx.pad + Math.max(...tickLabels.map((l) => ctx.measure(l, SMALL_SIZE))) + 8;
  const right = ctx.width - ctx.pad;
  const plotTop = top + 6;
  const plotBottom = plotTop + PLOT_HEIGHT;
  const yOf = (v: number) => plotBottom - ((v - tMin) / (tMax - tMin)) * PLOT_HEIGHT;
  const band = (right - left) / R;

  // 目盛り線と基線
  ticks.forEach((t, i) => {
    const yy = Math.round(yOf(t)) + 0.5;
    ctx.items.push({ t: "path", d: `M${left},${yy}H${right}`, stroke: t === 0 ? "axis" : "grid", strokeWidth: 1, ...(t === 0 ? {} : { dash: GRID_DASH }) });
    ctx.items.push({ t: "text", x: left - 8, y: yy + 4, text: tickLabels[i]!, size: SMALL_SIZE, fill: "muted", anchor: "end", tabular: true });
  });

  // 横軸のラベル（重なるなら間引く）
  const maxLabel = Math.max(...f.rows.map((r) => ctx.measure(r.label, SMALL_SIZE)));
  const every = Math.max(1, Math.ceil((maxLabel + 6) / band));
  f.rows.forEach((r, i) => {
    if (i % every !== 0) return;
    ctx.items.push({ t: "text", x: left + band * (i + 0.5), y: plotBottom + 16, text: fit(r.label, band * every - 4, SMALL_SIZE, ctx.measure), size: SMALL_SIZE, fill: "muted", anchor: "middle" });
  });

  if (f.kind === "bar") verticalBars(ctx, f, { left, band, yOf, S });
  else lines(ctx, f, { left, band, yOf, S });

  // ホバー: 行（横軸の 1 区画）ごとに、全系列の値を出す。棒はその行以外を薄くし、折れ線は縦線と点で示す
  const footer = f.unit ? ctx.labels.unit(f.unit) : undefined;
  f.rows.forEach((r, i) => {
    const rows = tipRows(ctx, f, r.values);
    if (rows.length === 0) return;
    const x = left + band * (i + 0.5);
    const [lo2, hi2] = rowExtent(f, r.values);
    const line = f.kind === "line";
    const vs = r.values.map((v, s) => [v, s] as const).filter((p): p is readonly [number, number] => p[0] !== null && p[0] !== undefined);
    ctx.targets.push({
      hit: { x: left + band * i, y: plotTop, w: band, h: plotBottom - plotTop },
      keep: line ? [] : [`r${i}`],
      tip: { title: r.label, rows, footer, x, y: line ? Math.min(...vs.map(([v]) => yOf(v))) - 6 : yOf(hi2 > 0 ? hi2 : lo2 < 0 ? 0 : hi2) },
      ...(line ? { guide: { x, y1: plotTop, y2: plotBottom }, points: vs.map(([v, s]) => ({ x, y: yOf(v), token: SERIES[s % 8]! })) } : {}),
    });
  });
  return plotBottom + 24;
}

interface Geo {
  left: number;
  band: number;
  yOf: (v: number) => number;
  S: number;
}

function verticalBars(ctx: Ctx, f: ChartFigure, g: Geo): void {
  const { left, band, yOf, S } = g;
  const zero = yOf(0);
  const stacked = f.stacked === true && S > 1;
  const bw = stacked ? Math.min(MAX_BAR, band * 0.6) : Math.min(MAX_BAR, (band * 0.72 - GAP * (S - 1)) / S);
  const groupW = stacked ? bw : bw * S + GAP * (S - 1);
  const showValues = S === 1 && f.rows.length <= 12;

  f.rows.forEach((r, i) => {
    const gx = left + band * i + (band - groupW) / 2;
    if (stacked) {
      let pos = 0;
      let neg = 0;
      const lastPos = r.values.reduce<number>((k, v, s) => (v !== null && v > 0 ? s : k), -1);
      const lastNeg = r.values.reduce<number>((k, v, s) => (v !== null && v < 0 ? s : k), -1);
      r.values.forEach((v, s) => {
        if (v === null || v === 0) return;
        const from = v > 0 ? pos : neg;
        const to = from + v;
        if (v > 0) pos = to;
        else neg = to;
        const y1 = Math.min(yOf(from), yOf(to));
        const y2 = Math.max(yOf(from), yOf(to));
        const isEnd = v > 0 ? s === lastPos : s === lastNeg;
        // 積み重ねの切れ目に 2px の背景色の隙間
        const h = Math.max(0.5, y2 - y1 - (isEnd ? 0 : GAP));
        const yy = v > 0 ? y2 - h : y1;
        ctx.items.push({ t: "path", d: isEnd ? barPath(gx, yy, bw, h, 4, v > 0 ? "top" : "bottom") : `M${gx},${yy}h${bw}v${h}h${-bw}Z`, fill: SERIES[s % 8]!, hint: hint(f, r.label, s, v, ctx), group: `r${i}` });
      });
      return;
    }
    r.values.forEach((v, s) => {
      if (v === null) return;
      const x = gx + s * (bw + GAP);
      const yv = yOf(v);
      const h = Math.max(1, Math.abs(zero - yv));
      ctx.items.push({ t: "path", d: barPath(x, Math.min(zero, yv), bw, h, 4, v >= 0 ? "top" : "bottom"), fill: SERIES[s % 8]!, hint: hint(f, r.label, s, v, ctx), group: `r${i}` });
      if (showValues) {
        const text = formatValue(v, ctx.locale);
        if (ctx.measure(text, SMALL_SIZE) <= band - 2) {
          ctx.items.push({ t: "text", x: x + bw / 2, y: v >= 0 ? yv - 5 : yv + 13, text, size: SMALL_SIZE, fill: "ink2", anchor: "middle", tabular: true, group: `r${i}` });
        }
      }
    });
  });
}

function lines(ctx: Ctx, f: ChartFigure, g: Geo): void {
  const { left, band, yOf, S } = g;
  const dots = f.rows.length <= 16;
  for (let s = 0; s < S; s++) {
    const token = SERIES[s % 8]!;
    let d = "";
    let pen = false;
    const pts: [number, number, number, string][] = [];
    f.rows.forEach((r, i) => {
      const v = r.values[s];
      if (v === null || v === undefined) {
        pen = false;
        return;
      }
      const x = +(left + band * (i + 0.5)).toFixed(2);
      const yy = +yOf(v).toFixed(2);
      d += `${pen ? "L" : "M"}${x},${yy}`;
      pen = true;
      pts.push([x, yy, v, r.label]);
    });
    if (d) ctx.items.push({ t: "path", d, stroke: token, strokeWidth: 2 });
    const marked = dots ? pts : pts.slice(-1);
    for (const [x, yy, v, label] of marked) {
      ctx.items.push({ t: "circle", cx: x, cy: yy, r: 4, fill: token, stroke: "surface", strokeWidth: 2, hint: hint(f, label, s, v, ctx) });
    }
  }
  // 1 系列なら終点の値だけ添える
  if (S === 1) {
    const lastRow = [...f.rows].reverse().find((r) => r.values[0] !== null && r.values[0] !== undefined);
    if (lastRow) {
      const i = f.rows.indexOf(lastRow);
      const v = lastRow.values[0]!;
      ctx.items.push({ t: "text", x: left + band * (i + 0.5), y: yOf(v) - 10, text: formatValue(v, ctx.locale), size: SMALL_SIZE, fill: "ink2", anchor: "middle", tabular: true });
    }
  }
}

// ---------------------------------------------------------------- 横向きの棒（行が多い・ラベルが長い）

function horizontalBars(ctx: Ctx, f: ChartFigure, top: number): number {
  const S = Math.max(1, f.columns.length - 1);
  const stacked = f.stacked === true && S > 1;
  const thick = stacked || S === 1 ? 14 : Math.max(6, Math.min(12, 30 / S));
  const rowH = stacked || S === 1 ? 24 : S * (thick + GAP) + 10;
  const [lo, hi] = extent(f);
  const ticks = niceTicks(lo, hi, 4);
  const tMin = ticks[0]!;
  const tMax = ticks[ticks.length - 1]!;
  const labelW = Math.min(Math.max(...f.rows.map((r) => ctx.measure(r.label, BODY_SIZE))), ctx.width * 0.32);
  const left = ctx.pad + labelW + 8;
  const right = ctx.width - ctx.pad - (S === 1 ? 52 : 8);
  const xOf = (v: number) => left + ((v - tMin) / (tMax - tMin)) * (right - left);
  const zero = xOf(0);
  const plotTop = top + 4;
  const plotBottom = plotTop + rowH * f.rows.length;

  ticks.forEach((t) => {
    const xx = Math.round(xOf(t)) + 0.5;
    ctx.items.push({ t: "path", d: `M${xx},${plotTop}V${plotBottom}`, stroke: t === 0 ? "axis" : "grid", strokeWidth: 1, ...(t === 0 ? {} : { dash: GRID_DASH }) });
    ctx.items.push({ t: "text", x: xx, y: plotBottom + 14, text: formatTick(t, ctx.locale), size: SMALL_SIZE, fill: "muted", anchor: "middle", tabular: true });
  });

  f.rows.forEach((r, i) => {
    const cy = plotTop + rowH * i + rowH / 2;
    ctx.items.push({ t: "text", x: left - 8, y: cy + 4, text: fit(r.label, labelW, BODY_SIZE, ctx.measure), size: BODY_SIZE, fill: "ink2", anchor: "end" });
    if (stacked) {
      let pos = 0;
      let neg = 0;
      r.values.forEach((v, s) => {
        if (v === null || v === 0) return;
        const from = v > 0 ? pos : neg;
        const to = from + v;
        if (v > 0) pos = to;
        else neg = to;
        const x1 = Math.min(xOf(from), xOf(to));
        const w = Math.max(0.5, Math.abs(xOf(to) - xOf(from)) - GAP);
        ctx.items.push({ t: "rect", x: v > 0 ? x1 : x1 + GAP, y: cy - thick / 2, w, h: thick, fill: SERIES[s % 8]!, hint: hint(f, r.label, s, v, ctx), group: `r${i}` });
      });
      return;
    }
    const groupH = S * thick + (S - 1) * GAP;
    r.values.forEach((v, s) => {
      if (v === null) return;
      const yy = cy - groupH / 2 + s * (thick + GAP);
      const xv = xOf(v);
      const w = Math.max(1, Math.abs(xv - zero));
      ctx.items.push({ t: "path", d: barPath(Math.min(zero, xv), yy, w, thick, 4, v >= 0 ? "right" : "left"), fill: SERIES[s % 8]!, hint: hint(f, r.label, s, v, ctx), group: `r${i}` });
      if (S === 1) {
        ctx.items.push({ t: "text", x: v >= 0 ? xv + 6 : xv - 6, y: cy + 4, text: formatValue(v, ctx.locale), size: SMALL_SIZE, fill: "ink2", anchor: v >= 0 ? "start" : "end", tabular: true, group: `r${i}` });
      }
    });
  });
  // ホバー: 行ごとに全系列の値を出し、その行以外を薄くする
  const footer = f.unit ? ctx.labels.unit(f.unit) : undefined;
  f.rows.forEach((r, i) => {
    const rows = tipRows(ctx, f, r.values);
    if (rows.length === 0) return;
    const [lo2, hi2] = rowExtent(f, r.values);
    const end = hi2 > 0 ? xOf(hi2) : xOf(lo2);
    ctx.targets.push({
      hit: { x: ctx.pad, y: plotTop + rowH * i, w: ctx.width - ctx.pad * 2, h: rowH },
      keep: [`r${i}`],
      tip: { title: r.label, rows, footer, x: (Math.min(zero, end) + Math.max(zero, end)) / 2, y: plotTop + rowH * i + 2 },
    });
  });
  return plotBottom + 24;
}
