/**
 * quadrant（2×2）と gantt（工程表）のレイアウト。
 *
 * - quadrant: 正方形を 4 つの角丸の面に分け、右上を淡く塗る。象限の名前は角に、項目は点と名前。軸の名前は左上と右下。
 * - gantt: 左にタスク名、右に時間の軸。期間が 2 か月を超えれば月ごと、それ以下は週ごとの目盛り。
 *   マイルストーン（1 日だけ）はひし形。
 */

import type { GanttFigure, QuadrantFigure } from "../ir.js";
import type { Ctx } from "./frame.js";
import { fit } from "./measure.js";
import { META, TEXT } from "./style.js";

const refsOf = (r: number[]) => (r.length ? ` ${r.map((n) => `[${n}]`).join("")}` : "");

// ---------------------------------------------------------------- quadrant

export function layoutQuadrant(ctx: Ctx, f: QuadrantFigure, top: number): number {
  const inner = ctx.width - ctx.pad * 2;
  const size = Math.min(inner - 8, 440);
  const x0 = ctx.pad + (inner - size) / 2;
  let y0 = top + 4;
  if (f.yLabel) {
    ctx.items.push({ t: "text", x: x0, y: y0 + 12, text: fit(`↑ ${f.yLabel}`, size, META, ctx.measure), size: META, fill: "muted" });
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
  // 象限は 4px 空けた角丸の面にする（区切りの線は引かない）
  cells.forEach(([x, y], i) => ctx.items.push({ t: "rect", x: x + 2, y: y + 2, w: half - 4, h: half - 4, r: 12, fill: i === 0 ? "accentWash" : "surface2", ...(i === 0 ? { stroke: "accentLine", strokeWidth: 1 } : {}) }));
  // 象限の名前（外側の角）
  f.quadrants.forEach((name, i) => {
    if (!name) return;
    const [cx, cy] = cells[i]!;
    const right = i === 0 || i === 3;
    const bottom = i === 2 || i === 3;
    ctx.items.push({ t: "text", x: right ? cx + half - 14 : cx + 14, y: bottom ? cy + half - 14 : cy + 24, text: fit(name, half - 28, TEXT, ctx.measure, 600), size: TEXT, weight: 600, fill: i === 0 ? "ink" : "ink2", anchor: right ? "end" : "start" });
  });
  // 項目（重なる名前は省き、ホバーで出す）
  const X = (v: number) => x0 + 14 + (v / 100) * (size - 28);
  const Y = (v: number) => y0 + size - 14 - (v / 100) * (size - 28);
  const taken = f.items.map((it) => ({ x: X(it.x) - 6, y: Y(it.y) - 6, w: 12, h: 12 }));
  const overlaps = (a: { x: number; y: number; w: number; h: number }) => taken.some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
  f.items.forEach((it, i) => {
    const g = `q${i}`;
    const cx = X(it.x);
    const cy = Y(it.y);
    ctx.items.push({ t: "circle", cx, cy, r: 6, fill: "s1", stroke: "surface", strokeWidth: 2, group: g });
    const text = fit(it.label + refsOf(it.refs), Math.min(132, half - 20), TEXT, ctx.measure);
    const w = ctx.measure(text, TEXT);
    const toLeft = cx + 11 + w > x0 + size - 4;
    const box = { x: toLeft ? cx - 11 - w : cx + 11, y: cy - 9, w, h: 17 };
    if (!overlaps(box)) {
      taken.push(box);
      ctx.items.push({ t: "text", x: toLeft ? cx - 11 : cx + 11, y: cy + 4.5, text, size: TEXT, fill: "ink", anchor: toLeft ? "end" : "start", group: g });
    }
    ctx.targets.push({
      hit: { x: cx - 9, y: cy - 9, w: 18, h: 18 },
      keep: [g],
      tip: { title: it.label, rows: [{ label: f.xLabel || "横", value: String(it.x), token: "s1" }, { label: f.yLabel || "縦", value: String(it.y) }], x: cx, y: cy - 6 },
    });
  });
  let bottom = y0 + size;
  if (f.xLabel) {
    ctx.items.push({ t: "text", x: x0 + size, y: bottom + 18, text: fit(`${f.xLabel} →`, size, META, ctx.measure), size: META, fill: "muted", anchor: "end" });
    bottom += 22;
  }
  return bottom + 8;
}

// ---------------------------------------------------------------- gantt

const DAY = 86_400_000;
const ROW = 36;
const BAR = 16;

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
  const labelW = Math.min(Math.max(...f.tasks.map((t) => ctx.measure(t.label + refsOf(t.refs), TEXT))), inner * 0.3);
  const left = ctx.pad + labelW + 16;
  const right = ctx.width - ctx.pad - 6;
  const X = (d: number) => left + ((d - min) / span) * (right - left);
  const axisY = top + 16;
  const rowsTop = axisY + 10;
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
  const maxLabel = Math.max(...ticks.map((t) => ctx.measure(t.label, META)));
  const every = Math.max(1, Math.ceil((maxLabel + 10) / (((right - left) / span) * (span > 62 ? 30 : 7))));
  ticks.forEach((t, i) => {
    const x = Math.round(X(t.d)) + 0.5;
    ctx.items.push({ t: "path", d: `M${x},${axisY + 6}V${bottom}`, stroke: "grid", strokeWidth: 1, dash: "2 3" });
    // 右端からはみ出す目盛りの文字は出さない
    if (i % every === 0 && x + 4 + ctx.measure(t.label, META) <= ctx.width - ctx.pad) ctx.items.push({ t: "text", x: x + 4, y: axisY, text: t.label, size: META, fill: "muted" });
  });

  f.tasks.forEach((t, i) => {
    const g = `t${i}`;
    const cy = rowsTop + i * ROW + ROW / 2;
    ctx.items.push({ t: "text", x: ctx.pad, y: cy + 4, text: fit(t.label + refsOf(t.refs), labelW, TEXT, ctx.measure), size: TEXT, fill: "ink", group: g });
    const period = t.endText ? `${t.startText} 〜 ${t.endText}` : t.startText;
    if (t.milestone) {
      const x = X(t.start + 0.5);
      const r = 8;
      ctx.items.push({ t: "path", d: `M${x},${cy - r}L${x + r},${cy}L${x},${cy + r}L${x - r},${cy}Z`, fill: "s2", stroke: "surface", strokeWidth: 2, group: g, hint: `${t.label}: ${period}` });
    } else {
      const x1 = X(t.start);
      const x2 = X(t.end + 1);
      ctx.items.push({ t: "rect", x: x1, y: cy - BAR / 2, w: Math.max(4, x2 - x1), h: BAR, r: BAR / 2, fill: "s1", group: g, hint: `${t.label}: ${period}` });
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
