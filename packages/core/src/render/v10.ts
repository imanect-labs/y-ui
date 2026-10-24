/**
 * radar（レーダーチャート）と treemap（ツリーマップ）のレイアウト。
 *
 * - radar: 観点を 12 時から時計回りに並べ、目盛りの多角形を薄く引く。系列は細い線と淡い塗り。
 *   系列が 2 つ以上なら凡例を上に。観点ごとにホバーで全系列の値を出す。
 * - treemap: 値の大きい順に、面積が値に比例する長方形に分ける（squarified）。2px の地の隙間。
 *   名前と値は入る大きさのときだけ載せ、入らなければホバーで出す。8 項目を超えた分は灰色。
 */

import type { ChartFigure } from "../ir.js";
import { share } from "../text.js";
import { allIntegers, type Ctx, drawLegend, formatTick, formatValue, niceTicks, tickStep, withUnit } from "./frame.js";
import { fit } from "./measure.js";
import { META, TEXT } from "./style.js";
import { SERIES, type Token } from "./theme.js";

const f2 = (n: number) => +n.toFixed(2);

// ---------------------------------------------------------------- radar

export function layoutRadar(ctx: Ctx, f: ChartFigure, top: number): number {
  const n = f.rows.length;
  if (n < 3) return top;
  const series = f.columns.slice(1);
  let y = drawLegend(ctx, series, top, "line");
  const inner = ctx.width - ctx.pad * 2;
  // 観点の名前の分だけ外側を空ける
  const labelW = Math.min(110, Math.max(...f.rows.map((r) => ctx.measure(r.label, TEXT))));
  // 狭い幅では、名前の分の余白を図の 2 割までにして円を大きく保つ
  const R = Math.max(70, Math.min(170, (inner - Math.min(labelW, inner * 0.2) * 2 - 24) / 2));
  const cx = ctx.pad + inner / 2;
  const cy = y + 28 + R;
  const max = Math.max(...f.rows.flatMap((r) => r.values.map((v) => v ?? 0)), 0);
  const ticks = niceTicks(0, max > 0 ? max : 1, 4, allIntegers(f.rows.flatMap((r) => r.values)));
  const top1 = ticks[ticks.length - 1]!;
  const angle = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const pt = (i: number, v: number) => [cx + Math.cos(angle(i)) * R * (v / top1), cy + Math.sin(angle(i)) * R * (v / top1)] as const;

  // 目盛りの多角形と軸
  ticks.slice(1).forEach((t) => {
    const d = f.rows.map((_, i) => pt(i, t)).map(([x, yy], i) => `${i ? "L" : "M"}${f2(x)},${f2(yy)}`).join("") + "Z";
    ctx.items.push({ t: "path", d, stroke: "grid", strokeWidth: 1 });
  });
  f.rows.forEach((_, i) => {
    const [x, yy] = pt(i, top1);
    ctx.items.push({ t: "path", d: `M${cx},${cy}L${f2(x)},${f2(yy)}`, stroke: "grid", strokeWidth: 1 });
  });
  // 目盛りの値（12 時の軸の上）
  ticks.slice(1).forEach((t) => ctx.items.push({ t: "text", x: cx + 6, y: cy - R * (t / top1) - 3, text: formatTick(t, ctx.locale, tickStep(ticks)), size: META - 1, fill: "muted", tabular: true }));

  // 系列
  series.forEach((_, s) => {
    const token = SERIES[s % SERIES.length]!;
    const pts = f.rows.map((r, i) => pt(i, r.values[s] ?? 0));
    const d = pts.map(([x, yy], i) => `${i ? "L" : "M"}${f2(x)},${f2(yy)}`).join("") + "Z";
    ctx.items.push({ t: "path", d, fill: token, opacity: 0.12, group: `s${s}` });
    ctx.items.push({ t: "path", d, stroke: token, strokeWidth: 2, group: `s${s}` });
    pts.forEach(([x, yy]) => ctx.items.push({ t: "circle", cx: x, cy: yy, r: 3.5, fill: token, stroke: "surface", strokeWidth: 1.5, group: `s${s}` }));
  });

  // 観点の名前とホバー
  const unit = f.unit ?? "";
  f.rows.forEach((r, i) => {
    const a = angle(i);
    const lx = cx + Math.cos(a) * (R + 12);
    const ly = cy + Math.sin(a) * (R + 12);
    const anchor = Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
    const dy = Math.sin(a) > 0.5 ? 12 : Math.sin(a) < -0.5 ? -4 : 4;
    ctx.items.push({ t: "text", x: lx, y: ly + dy, text: fit(r.label, labelW, TEXT, ctx.measure), size: TEXT, fill: "ink2", anchor });
    const [hx, hy] = pt(i, top1);
    ctx.targets.push({
      hit: { x: Math.min(hx, lx) - 30, y: Math.min(hy, ly) - 16, w: Math.abs(hx - lx) + 60, h: Math.abs(hy - ly) + 32 },
      keep: [],
      tip: { title: r.label, rows: series.map((name, s) => ({ label: name, value: r.values[s] === null ? "—" : withUnit(formatValue(r.values[s]!, ctx.locale), unit), token: SERIES[s % SERIES.length]! })), x: hx, y: hy },
    });
  });
  return cy + R + 28;
}

// ---------------------------------------------------------------- treemap

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** squarified treemap（Bruls ほか）。values は降順・合計は面積に正規化済み。 */
function squarify(values: number[], box: Rect): Rect[] {
  const out: Rect[] = [];
  let rest = { ...box };
  let i = 0;
  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, v) => a + v, 0);
    const mx = Math.max(...row);
    const mn = Math.min(...row);
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  while (i < values.length) {
    const side = Math.min(rest.w, rest.h);
    const row = [values[i]!];
    i++;
    while (i < values.length && worst([...row, values[i]!], side) <= worst(row, side)) {
      row.push(values[i]!);
      i++;
    }
    const sum = row.reduce((a, v) => a + v, 0);
    if (rest.w >= rest.h) {
      // 左に縦の列を置く
      const w = sum / rest.h;
      let yy = rest.y;
      for (const v of row) {
        out.push({ x: rest.x, y: yy, w, h: v / w });
        yy += v / w;
      }
      rest = { x: rest.x + w, y: rest.y, w: rest.w - w, h: rest.h };
    } else {
      const h = sum / rest.w;
      let xx = rest.x;
      for (const v of row) {
        out.push({ x: xx, y: rest.y, w: v / h, h });
        xx += v / h;
      }
      rest = { x: rest.x, y: rest.y + h, w: rest.w, h: rest.h - h };
    }
  }
  return out;
}

export function layoutTreemap(ctx: Ctx, f: ChartFigure, top: number): number {
  const rows = f.rows.map((r, i) => ({ r, i, v: r.values[0] ?? 0 })).filter((x) => x.v > 0);
  if (rows.length === 0) return top;
  const inner = ctx.width - ctx.pad * 2;
  const H = Math.round(Math.min(360, Math.max(200, inner * 0.55)));
  const total = rows.reduce((a, x) => a + x.v, 0);
  const sorted = [...rows].sort((a, b) => b.v - a.v);
  const area = inner * H;
  const rects = squarify(
    sorted.map((x) => (x.v / total) * area),
    { x: ctx.pad, y: top + 4, w: inner, h: H },
  );
  const unit = f.unit ?? "";
  const valueName = f.columns[1] || "値";
  sorted.forEach((x, k) => {
    const b = rects[k]!;
    // 色は書かれた順（項目に付く。大きさの順位では変えない）
    const token: Token = x.i < SERIES.length ? SERIES[x.i]! : "muted";
    const g = `t${x.i}`;
    const valueText = withUnit(formatValue(x.v, ctx.locale), unit);
    ctx.items.push({ t: "rect", x: b.x + 1, y: b.y + 1, w: Math.max(0, b.w - 2), h: Math.max(0, b.h - 2), r: 6, fill: token, group: g, hint: `${x.r.label}: ${valueText}（${share(x.v, total)}）` });
    // 名前と値は入る大きさのときだけ（色の上なので地の色の文字。明るい山吹・灰色の上は濃い文字）
    const ink: Token = token === "s6" || token === "muted" ? "ink" : "surface";
    if (b.w > 56 && b.h > 40) {
      ctx.items.push({ t: "text", x: b.x + 10, y: b.y + 21, text: fit(x.r.label, b.w - 20, TEXT, ctx.measure, 600), size: TEXT, weight: 600, fill: ink, group: g });
      if (b.h > 58) ctx.items.push({ t: "text", x: b.x + 10, y: b.y + 39, text: fit(`${valueText}・${share(x.v, total)}`, b.w - 20, META, ctx.measure), size: META, fill: ink, opacity: 0.9, group: g });
    }
    ctx.targets.push({ hit: b, keep: [g], tip: { title: x.r.label, rows: [{ label: valueName, value: valueText, token }, { label: ctx.labels.share, value: share(x.v, total) }], x: b.x + b.w / 2, y: b.y } });
  });
  return top + 4 + H + 10;
}
