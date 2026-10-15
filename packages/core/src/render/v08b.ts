/**
 * quadrant（2×2）と gantt（工程表）のレイアウト。
 *
 * - quadrant: 正方形を 4 つに分け、右上を淡く塗る。象限の名前は角に、項目は点と名前。軸の名前は左上と右下。
 * - gantt: 左にタスク名、右に時間の軸。期間が 2 か月を超えれば月ごと、それ以下は週ごとの目盛り。
 *   マイルストーン（1 日だけ）はひし形。
 */

import type { GanttFigure, QuadrantFigure } from "../ir.js";
import { BODY_SIZE, type Ctx, SMALL_SIZE } from "./frame.js";
import { fit } from "./measure.js";

const refsOf = (r: number[]) => (r.length ? ` ${r.map((n) => `[${n}]`).join("")}` : "");

// ---------------------------------------------------------------- quadrant

export function layoutQuadrant(ctx: Ctx, f: QuadrantFigure, top: number): number {
  const inner = ctx.width - ctx.pad * 2;
  const size = Math.min(inner - 8, 420);
  const x0 = ctx.pad + (inner - size) / 2;
  let y0 = top + 4;
  if (f.yLabel) {
    ctx.items.push({ t: "text", x: x0, y: y0 + 12, text: fit(`↑ ${f.yLabel}`, size, SMALL_SIZE, ctx.measure), size: SMALL_SIZE, fill: "muted" });
    y0 += 20;
  }
  const half = size / 2;
  // 象限（右上・左上・左下・右下）
  const cells: [number, number][] = [
    [x0 + half, y0],
    [x0, y0],
    [x0, y0 + half],
    [x0 + half, y0 + half],
  ];
  cells.forEach(([x, y], i) => ctx.items.push({ t: "rect", x: x + 1, y: y + 1, w: half - 2, h: half - 2, r: 8, fill: i === 0 ? "accentWash" : "surface2" }));
  ctx.items.push({ t: "path", d: `M${x0 + half},${y0}V${y0 + size}M${x0},${y0 + half}H${x0 + size}`, stroke: "axis", strokeWidth: 1 });
  // 象限の名前（外側の角）
  f.quadrants.forEach((name, i) => {
    if (!name) return;
    const [cx, cy] = cells[i]!;
    const right = i === 0 || i === 3;
    const bottom = i === 2 || i === 3;
    ctx.items.push({ t: "text", x: right ? cx + half - 10 : cx + 10, y: bottom ? cy + half - 10 : cy + 20, text: fit(name, half - 20, BODY_SIZE, ctx.measure, 600), size: BODY_SIZE, weight: 600, fill: "muted", anchor: right ? "end" : "start" });
  });
  // 項目（重なる名前は省き、ホバーで出す）
  const X = (v: number) => x0 + 10 + (v / 100) * (size - 20);
  const Y = (v: number) => y0 + size - 10 - (v / 100) * (size - 20);
  const taken = f.items.map((it) => ({ x: X(it.x) - 6, y: Y(it.y) - 6, w: 12, h: 12 }));
  const overlaps = (a: { x: number; y: number; w: number; h: number }) => taken.some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
  f.items.forEach((it, i) => {
    const g = `q${i}`;
    const cx = X(it.x);
    const cy = Y(it.y);
    ctx.items.push({ t: "circle", cx, cy, r: 5.5, fill: "s1", stroke: "surface", strokeWidth: 1.5, group: g });
    const text = fit(it.label + refsOf(it.refs), Math.min(120, half - 16), SMALL_SIZE + 1, ctx.measure);
    const w = ctx.measure(text, SMALL_SIZE + 1);
    const toLeft = cx + 9 + w > x0 + size;
    const box = { x: toLeft ? cx - 9 - w : cx + 9, y: cy - 8, w, h: 15 };
    if (!overlaps(box)) {
      taken.push(box);
      ctx.items.push({ t: "text", x: toLeft ? cx - 9 : cx + 9, y: cy + 4, text, size: SMALL_SIZE + 1, fill: "ink", anchor: toLeft ? "end" : "start", group: g });
    }
    ctx.targets.push({
      hit: { x: cx - 9, y: cy - 9, w: 18, h: 18 },
      keep: [g],
      tip: { title: it.label, rows: [{ label: f.xLabel || "横", value: String(it.x), token: "s1" }, { label: f.yLabel || "縦", value: String(it.y) }], x: cx, y: cy - 6 },
    });
  });
  let bottom = y0 + size;
  if (f.xLabel) {
    ctx.items.push({ t: "text", x: x0 + size, y: bottom + 16, text: fit(`${f.xLabel} →`, size, SMALL_SIZE, ctx.measure), size: SMALL_SIZE, fill: "muted", anchor: "end" });
    bottom += 22;
  }
  return bottom + 8;
}

// ---------------------------------------------------------------- gantt

const DAY = 86_400_000;
const ROW = 28;
const BAR = 14;

function ymd(d: number): { y: number; m: number; day: number } {
  const t = new Date(d * DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function layoutGantt(ctx: Ctx, f: GanttFigure, top: number): number {
  if (f.tasks.length === 0) return top;
  const ja = ctx.locale.toLowerCase().startsWith("ja");
  const inner = ctx.width - ctx.pad * 2;
  const min = Math.min(...f.tasks.map((t) => t.start));
  const max = Math.max(...f.tasks.map((t) => t.end)) + 1;
  const span = Math.max(1, max - min);
  const labelW = Math.min(Math.max(...f.tasks.map((t) => ctx.measure(t.label + refsOf(t.refs), BODY_SIZE))), inner * 0.3);
  const left = ctx.pad + labelW + 12;
  const right = ctx.width - ctx.pad - 6;
  const X = (d: number) => left + ((d - min) / span) * (right - left);
  const axisY = top + 16;
  const rowsTop = axisY + 8;
  const bottom = rowsTop + f.tasks.length * ROW;

  // 目盛り: 2 か月を超えれば月の 1 日ごと、それ以下は 7 日ごと（間隔が狭ければ間引く）
  const ticks: { d: number; label: string }[] = [];
  const monthName = (m: number) => (ja ? `${m}月` : new Date(Date.UTC(2001, m - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" }));
  if (span > 62) {
    let { y, m } = ymd(min);
    let prevYear: number | null = null;
    for (;;) {
      const d = Math.round(Date.UTC(y, m - 1, 1) / DAY);
      if (d > max) break;
      if (d >= min) {
        const withYear = !f.noYear && y !== prevYear;
        ticks.push({ d, label: withYear ? (ja ? `${y}年${m}月` : `${monthName(m)} ${y}`) : monthName(m) });
        prevYear = y;
      }
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  } else {
    for (let d = min; d <= max; d += 7) {
      const t = ymd(d);
      ticks.push({ d, label: `${t.m}/${t.day}` });
    }
  }
  const maxLabel = Math.max(...ticks.map((t) => ctx.measure(t.label, SMALL_SIZE)));
  const every = Math.max(1, Math.ceil((maxLabel + 10) / (((right - left) / span) * (span > 62 ? 30 : 7))));
  ticks.forEach((t, i) => {
    const x = Math.round(X(t.d)) + 0.5;
    ctx.items.push({ t: "path", d: `M${x},${axisY + 4}V${bottom}`, stroke: "grid", strokeWidth: 1 });
    // 右端からはみ出す目盛りの文字は出さない
    if (i % every === 0 && x + 3 + ctx.measure(t.label, SMALL_SIZE) <= ctx.width - ctx.pad) ctx.items.push({ t: "text", x: x + 3, y: axisY, text: t.label, size: SMALL_SIZE, fill: "muted" });
  });
  ctx.items.push({ t: "path", d: `M${left},${axisY + 4.5}H${right}`, stroke: "axis", strokeWidth: 1 });

  f.tasks.forEach((t, i) => {
    const g = `t${i}`;
    const cy = rowsTop + i * ROW + ROW / 2;
    ctx.items.push({ t: "text", x: ctx.pad, y: cy + 4, text: fit(t.label + refsOf(t.refs), labelW, BODY_SIZE, ctx.measure), size: BODY_SIZE, fill: "ink", group: g });
    const period = t.endText ? `${t.startText} 〜 ${t.endText}` : t.startText;
    if (t.milestone) {
      const x = X(t.start + 0.5);
      const r = 7;
      ctx.items.push({ t: "path", d: `M${x},${cy - r}L${x + r},${cy}L${x},${cy + r}L${x - r},${cy}Z`, fill: "s2", stroke: "surface", strokeWidth: 1.5, group: g, hint: `${t.label}: ${period}` });
    } else {
      const x1 = X(t.start);
      const x2 = X(t.end + 1);
      ctx.items.push({ t: "rect", x: x1, y: cy - BAR / 2, w: Math.max(4, x2 - x1), h: BAR, r: 4, fill: "s1", group: g, hint: `${t.label}: ${period}` });
    }
    const days = t.end - t.start + 1;
    ctx.targets.push({
      hit: { x: ctx.pad, y: cy - ROW / 2, w: inner, h: ROW },
      keep: [g],
      tip: { title: t.label, rows: [{ label: ja ? "期間" : "Period", value: period, token: t.milestone ? "s2" : "s1" }], ...(t.milestone ? {} : { footer: ja ? `${days}日間` : `${days} days` }), x: X(t.start + (t.end - t.start + 1) / 2), y: cy - BAR / 2 },
    });
  });
  return bottom + 8;
}
