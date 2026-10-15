/**
 * cards・progress・funnel のレイアウト。
 *
 * - cards: 格子に並べたカード（見出しと本文）。行ごとに高さを揃える。
 * - progress: 項目ごとの横棒（目標までの割合）。100% 以上は色を変え、棒は満たす。
 * - funnel: 段階ごとの棒を中央に揃えて上から並べ、右に前の段階からの割合を出す。
 */

import type { CardsFigure, FunnelFigure, ProgressFigure } from "../ir.js";
import { share } from "../text.js";
import { BODY_SIZE, type Ctx, formatValue, SMALL_SIZE, withUnit } from "./frame.js";
import { fit, wrap } from "./measure.js";

const refsOf = (r: number[]) => (r.length ? ` ${r.map((n) => `[${n}]`).join("")}` : "");

// ---------------------------------------------------------------- cards

const CARD_MIN = 180;
const GAP = 10;

export function layoutCards(ctx: Ctx, f: CardsFigure, top: number): number {
  const n = f.cards.length;
  if (n === 0) return top;
  const inner = ctx.width - ctx.pad * 2;
  let cols = Math.max(1, Math.min(n, Math.floor((inner + GAP) / (CARD_MIN + GAP)), 3));
  // 4 枚は 2 × 2 にする（3 + 1 にしない）
  if (n === 4 && cols === 3) cols = 2;
  const cardW = (inner - GAP * (cols - 1)) / cols;
  const pad = 12;
  const tw = cardW - pad * 2;
  const blocks = f.cards.map((c) => ({ title: wrap(c.title + refsOf(c.refs), tw, BODY_SIZE + 1, ctx.measure, 2, 600), body: c.body ? wrap(c.body, tw, BODY_SIZE, ctx.measure, 6) : [] }));
  const heightOf = (i: number) => pad * 2 + 3 + blocks[i]!.title.length * 18 + (blocks[i]!.body.length ? 4 + blocks[i]!.body.length * 17 : 0);
  let y = top + 2;
  for (let r = 0; r * cols < n; r++) {
    const idx = Array.from({ length: Math.min(cols, n - r * cols) }, (_, k) => r * cols + k);
    const h = Math.max(...idx.map(heightOf));
    idx.forEach((i, k) => {
      const x = ctx.pad + k * (cardW + GAP);
      const g = `c${i}`;
      const c = f.cards[i]!;
      const b = blocks[i]!;
      ctx.items.push({ t: "rect", x: x + 0.5, y: y + 0.5, w: cardW - 1, h: h - 1, r: 12, fill: "surface2", stroke: "border", strokeWidth: 1, group: g });
      // 上端の色の印（カードを見分ける手がかり。色だけに意味は持たせない）
      ctx.items.push({ t: "rect", x: x + pad, y: y + pad - 2, w: 20, h: 3, r: 1.5, fill: "s1", group: g });
      b.title.forEach((l, j) => ctx.items.push({ t: "text", x: x + pad, y: y + pad + 17 + j * 18, text: l, size: BODY_SIZE + 1, weight: 600, fill: "ink", group: g }));
      const by = y + pad + 3 + b.title.length * 18 + 4;
      b.body.forEach((l, j) => ctx.items.push({ t: "text", x: x + pad, y: by + 13 + j * 17, text: l, size: BODY_SIZE, fill: "ink2", group: g }));
      const cut = [...b.title, ...b.body].some((l) => l.endsWith("…"));
      ctx.targets.push({
        hit: { x, y, w: cardW, h },
        keep: [g],
        ...(cut ? { tip: { title: c.title, rows: [], ...(c.body ? { footer: c.body } : {}), x: x + cardW / 2, y } } : { say: c.body ? `${c.title}、${c.body}` : c.title }),
      });
    });
    y += h + GAP;
  }
  return y - GAP + 8;
}

// ---------------------------------------------------------------- progress

const BAR_H = 10;

export function layoutProgress(ctx: Ctx, f: ProgressFigure, top: number): number {
  if (f.items.length === 0) return top;
  const inner = ctx.width - ctx.pad * 2;
  const right = f.items.map((it) => ({ amount: `${it.valueText} / ${it.targetText}`, pct: share(it.value, it.target) }));
  const pctW = Math.max(...right.map((r) => ctx.measure(r.pct, BODY_SIZE + 1, 600)));
  const amountW = Math.max(...right.map((r) => ctx.measure(r.amount, SMALL_SIZE)));
  const labelW = Math.min(Math.max(...f.items.map((it) => ctx.measure(it.label + refsOf(it.refs), BODY_SIZE))), inner * 0.3);
  // 狭い幅では、項目名を棒の上に置く
  const stacked = inner - labelW - pctW - amountW - 40 < 120;
  const rowH = stacked ? 44 : 32;
  let y = top + 4;
  f.items.forEach((it, i) => {
    const g = `p${i}`;
    const ratio = it.target > 0 ? it.value / it.target : 0;
    const done = ratio >= 1;
    const label = it.label + refsOf(it.refs);
    let barX: number;
    let barW: number;
    let barY: number;
    if (stacked) {
      ctx.items.push({ t: "text", x: ctx.pad, y: y + 13, text: fit(label, inner - pctW - amountW - 20, BODY_SIZE, ctx.measure), size: BODY_SIZE, fill: "ink", group: g });
      ctx.items.push({ t: "text", x: ctx.width - ctx.pad - pctW - 8, y: y + 13, text: right[i]!.amount, size: SMALL_SIZE, fill: "muted", anchor: "end", tabular: true, group: g });
      ctx.items.push({ t: "text", x: ctx.width - ctx.pad, y: y + 13, text: right[i]!.pct, size: BODY_SIZE + 1, weight: 600, fill: "ink", anchor: "end", tabular: true, group: g });
      barX = ctx.pad;
      barW = inner;
      barY = y + 22;
    } else {
      const cy = y + rowH / 2;
      ctx.items.push({ t: "text", x: ctx.pad, y: cy + 4, text: fit(label, labelW, BODY_SIZE, ctx.measure), size: BODY_SIZE, fill: "ink", group: g });
      barX = ctx.pad + labelW + 12;
      barW = inner - labelW - 12 - amountW - pctW - 28;
      barY = cy - BAR_H / 2;
      ctx.items.push({ t: "text", x: barX + barW + 12 + amountW, y: cy + 4, text: right[i]!.amount, size: SMALL_SIZE, fill: "muted", anchor: "end", tabular: true, group: g });
      ctx.items.push({ t: "text", x: ctx.width - ctx.pad, y: cy + 4.5, text: right[i]!.pct, size: BODY_SIZE + 1, weight: 600, fill: "ink", anchor: "end", tabular: true, group: g });
    }
    ctx.items.push({ t: "rect", x: barX, y: barY, w: barW, h: BAR_H, r: BAR_H / 2, fill: "grid", group: g });
    const fillW = Math.max(ratio > 0 ? BAR_H : 0, Math.min(1, Math.max(0, ratio)) * barW);
    if (fillW > 0) ctx.items.push({ t: "rect", x: barX, y: barY, w: fillW, h: BAR_H, r: BAR_H / 2, fill: done ? "s3" : "s1", group: g, hint: `${it.label}: ${right[i]!.amount}（${right[i]!.pct}）` });
    ctx.targets.push({ hit: { x: ctx.pad, y, w: inner, h: rowH }, keep: [g], say: `${it.label}、${right[i]!.amount}、${right[i]!.pct}${done ? "、達成" : ""}` });
    y += rowH;
  });
  return y + 6;
}

// ---------------------------------------------------------------- funnel

export function layoutFunnel(ctx: Ctx, f: FunnelFigure, top: number): number {
  const n = f.stages.length;
  if (n === 0) return top;
  const inner = ctx.width - ctx.pad * 2;
  const unit = f.unit ?? "";
  const max = Math.max(...f.stages.map((s) => s.value), 0);
  const first = f.stages[0]!.value;
  const rates = f.stages.map((s, i) => (i === 0 ? "" : share(s.value, f.stages[i - 1]!.value)));
  const labelW = Math.min(Math.max(...f.stages.map((s) => ctx.measure(s.label + refsOf(s.refs), BODY_SIZE))), inner * 0.28);
  const rateW = Math.max(ctx.measure("100%", BODY_SIZE, 600), ...rates.map((r) => ctx.measure(r, BODY_SIZE, 600))) + 6;
  const areaX = ctx.pad + labelW + 12;
  const areaW = inner - labelW - 12 - rateW - 12;
  const rowH = 30;
  const barH = 24;
  let y = top + 4;
  f.stages.forEach((s, i) => {
    const g = `f${i}`;
    const w = max > 0 ? Math.max(4, (s.value / max) * areaW) : 4;
    const bx = areaX + (areaW - w) / 2;
    const by = y + (rowH - barH) / 2;
    const cy = y + rowH / 2;
    ctx.items.push({ t: "text", x: ctx.pad, y: cy + 4, text: fit(s.label + refsOf(s.refs), labelW, BODY_SIZE, ctx.measure), size: BODY_SIZE, fill: "ink", group: g });
    ctx.items.push({ t: "rect", x: bx, y: by, w, h: barH, r: 6, fill: "s1", opacity: 1 - (i / Math.max(1, n)) * 0.45, group: g, hint: `${s.label}: ${withUnit(formatValue(s.value, ctx.locale), unit)}` });
    // 値は棒の中（入らなければ棒の右）
    const valueText = withUnit(formatValue(s.value, ctx.locale), unit);
    const vw = ctx.measure(valueText, BODY_SIZE, 600);
    const inside = vw + 12 <= w;
    ctx.items.push({ t: "text", x: inside ? bx + w / 2 : bx + w + 6, y: cy + 4.5, text: valueText, size: BODY_SIZE, weight: 600, fill: inside ? "surface" : "ink", anchor: inside ? "middle" : "start", tabular: true, group: g });
    if (i > 0) ctx.items.push({ t: "text", x: ctx.width - ctx.pad, y: cy + 4.5, text: rates[i]!, size: BODY_SIZE, weight: 600, fill: "muted", anchor: "end", tabular: true, group: g });
    ctx.targets.push({
      hit: { x: ctx.pad, y, w: inner, h: rowH },
      keep: [g],
      tip: {
        title: s.label,
        rows: [
          { label: ctx.labels.count, value: valueText, token: "s1" },
          ...(i > 0 ? [{ label: ctx.labels.fromPrev, value: rates[i]! }, { label: ctx.labels.fromFirst, value: share(s.value, first) }] : []),
        ],
        x: areaX + areaW / 2,
        y: by,
      },
    });
    y += rowH;
  });
  // 右の列の見出し
  if (n > 1) ctx.items.push({ t: "text", x: ctx.width - ctx.pad, y: top - 2, text: ctx.labels.stepRate, size: SMALL_SIZE, fill: "muted", anchor: "end" });
  return y + 6;
}
