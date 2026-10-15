/**
 * cards・progress・funnel のレイアウト。
 *
 * - cards: 格子に並べたカード（見出し・大きな値・本文・✓ の項目）。行ごとに高さと段の位置を揃える。
 * - progress: 項目名と「実績 / 目標・割合」の下に細い棒。100% 以上は ✓ を付けて色を変え、棒は満たす。
 * - funnel: 段階ごとの棒を左に揃えて上から並べ、右に前の段階からの割合を出す。
 */

import type { CardsFigure, FunnelFigure, ProgressFigure } from "../ir.js";
import { share } from "../text.js";
import { type Ctx, formatValue, withUnit } from "./frame.js";
import { fit, wrap } from "./measure.js";
import { HEAD, HEAD_LH, ITEM_GAP, META, PAD, PARA_GAP, RADIUS, TEXT, TEXT_LH } from "./style.js";

const refsOf = (r: number[]) => (r.length ? ` ${r.map((n) => `[${n}]`).join("")}` : "");

// ---------------------------------------------------------------- cards

const CARD_MIN = 180;
const GAP = 12;
/** 値（料金・数値）の文字の大きさ。 */
const VALUE = 26;
const VALUE_LH = 34;
const ITEM_LH = 24;

/** チェックの印（項目の行頭）。 */
export function checkMark(ctx: Ctx, x: number, cy: number, group: string): void {
  ctx.items.push({ t: "path", d: `M${x},${cy}l3.5,3.5l7,-8`, stroke: "s3", strokeWidth: 1.75, group });
}

export function layoutCards(ctx: Ctx, f: CardsFigure, top: number): number {
  const n = f.cards.length;
  if (n === 0) return top;
  const inner = ctx.width - ctx.pad * 2;
  let cols = Math.max(1, Math.min(n, Math.floor((inner + GAP) / (CARD_MIN + GAP)), 3));
  // 4 枚は 2 × 2 にする（3 + 1 にしない）
  if (n === 4 && cols === 3) cols = 2;
  const cardW = (inner - GAP * (cols - 1)) / cols;
  const tw = cardW - PAD * 2;
  const blocks = f.cards.map((c) => {
    const title = wrap(c.title + refsOf(c.refs), tw, HEAD + 1, ctx.measure, 2, 600);
    const value = c.value ? [fit(c.value, tw, VALUE, ctx.measure, 600)] : [];
    const body = c.body ? c.body.split("\n").map((p) => wrap(p, tw, TEXT, ctx.measure, 6)) : [];
    const items = (c.items ?? []).map((it) => wrap(it, tw - 20, TEXT, ctx.measure, 2));
    return { title, value, body, items };
  });
  // 見出し・値・本文・項目の各段の高さ（行の中で段の位置を揃えるため、行ごとの最大を使う）
  const parts = (i: number) => {
    const b = blocks[i]!;
    const bodyH = b.body.length ? b.body.reduce((a, p) => a + p.length * TEXT_LH, 0) + (b.body.length - 1) * PARA_GAP : 0;
    const itemsH = b.items.reduce((a, l) => a + ITEM_LH + (l.length - 1) * TEXT_LH, 0);
    return { title: b.title.length * HEAD_LH, value: b.value.length ? VALUE_LH + 2 : 0, body: bodyH, items: itemsH };
  };
  let y = top + 2;
  for (let r = 0; r * cols < n; r++) {
    const idx = Array.from({ length: Math.min(cols, n - r * cols) }, (_, k) => r * cols + k);
    const ps = idx.map(parts);
    const titleH = Math.max(...ps.map((p) => p.title));
    const valueH = Math.max(...ps.map((p) => p.value));
    const bodyH = Math.max(...ps.map((p) => p.body));
    const itemsH = Math.max(...ps.map((p) => p.items));
    const sep = itemsH > 0 && (valueH > 0 || bodyH > 0);
    const h = PAD * 2 + titleH + (valueH ? 4 + valueH : 0) + (bodyH ? 6 + bodyH : 0) + (itemsH ? (sep ? 25 : 8) + itemsH : 0);
    idx.forEach((i, k) => {
      const x = ctx.pad + k * (cardW + GAP);
      const g = `c${i}`;
      const c = f.cards[i]!;
      const b = blocks[i]!;
      ctx.items.push({ t: "rect", x: x + 0.5, y: y + 0.5, w: cardW - 1, h: h - 1, r: RADIUS, fill: "surface", stroke: "border", strokeWidth: 1, group: g });
      let yy = y + PAD;
      b.title.forEach((l, j) => ctx.items.push({ t: "text", x: x + PAD, y: yy + 15 + j * HEAD_LH, text: l, size: HEAD + 1, weight: 600, fill: "ink", group: g }));
      yy += titleH;
      if (valueH) {
        yy += 4;
        if (b.value.length) ctx.items.push({ t: "text", x: x + PAD, y: yy + 27, text: b.value[0]!, size: VALUE, weight: 600, fill: "ink", tabular: true, group: g });
        yy += valueH;
      }
      if (bodyH) {
        yy += 6;
        let by = yy;
        b.body.forEach((p, j) => {
          if (j > 0) by += PARA_GAP;
          for (const l of p) {
            ctx.items.push({ t: "text", x: x + PAD, y: by + 14, text: l, size: TEXT, fill: "muted", group: g });
            by += TEXT_LH;
          }
        });
        yy += bodyH;
      }
      if (itemsH) {
        if (sep) {
          yy += 12;
          ctx.items.push({ t: "path", d: `M${x + PAD},${yy + 0.5}H${x + cardW - PAD}`, stroke: "grid", strokeWidth: 1, group: g });
          yy += 13;
        } else yy += 8;
        for (const l of b.items) {
          checkMark(ctx, x + PAD + 1, yy + 11, g);
          l.forEach((t, j) => ctx.items.push({ t: "text", x: x + PAD + 20, y: yy + 16 + j * TEXT_LH, text: t, size: TEXT, fill: "ink2", group: g }));
          yy += ITEM_LH + (l.length - 1) * TEXT_LH;
        }
      }
      const full = [c.value, c.body?.replace(/\n/g, " "), ...(c.items ?? [])].filter(Boolean).join("、");
      const cut = [...b.title, ...b.value, ...b.body.flat(), ...b.items.flat()].some((l) => l.endsWith("…"));
      ctx.targets.push({
        hit: { x, y, w: cardW, h },
        keep: [g],
        ...(cut ? { tip: { title: c.title, rows: [], ...(full ? { footer: full } : {}), x: x + cardW / 2, y } } : { say: full ? `${c.title}、${full}` : c.title }),
      });
    });
    y += h + GAP;
  }
  return y - GAP + 8;
}

// ---------------------------------------------------------------- progress

const BAR_H = 8;

export function layoutProgress(ctx: Ctx, f: ProgressFigure, top: number): number {
  if (f.items.length === 0) return top;
  const inner = ctx.width - ctx.pad * 2;
  // 1 行目: 項目名（左）と「実績 / 目標・割合」（右）。2 行目: 棒（図の幅いっぱい）
  const rowH = HEAD_LH + 8 + BAR_H + ITEM_GAP;
  let y = top + 2;
  f.items.forEach((it, i) => {
    const g = `p${i}`;
    const ratio = it.target > 0 ? it.value / it.target : 0;
    const done = ratio >= 1;
    const pct = share(it.value, it.target);
    const amount = `${it.valueText} / ${it.targetText}`;
    const pctW = ctx.measure(pct, HEAD, 600);
    const amountW = ctx.measure(amount, META);
    const labelX = ctx.pad + (done ? 20 : 0);
    const label = fit(it.label + refsOf(it.refs), ctx.width - ctx.pad - pctW - amountW - 20 - labelX, HEAD, ctx.measure, 500);
    if (done) checkMark(ctx, ctx.pad + 1, y + 10, g);
    ctx.items.push({ t: "text", x: labelX, y: y + 15, text: label, size: HEAD, weight: 500, fill: "ink", group: g });
    ctx.items.push({ t: "text", x: ctx.width - ctx.pad - pctW - 10, y: y + 15, text: amount, size: META, fill: "muted", anchor: "end", tabular: true, group: g });
    ctx.items.push({ t: "text", x: ctx.width - ctx.pad, y: y + 15, text: pct, size: HEAD, weight: 600, fill: "ink", anchor: "end", tabular: true, group: g });
    const barY = y + HEAD_LH + 8;
    ctx.items.push({ t: "rect", x: ctx.pad, y: barY, w: inner, h: BAR_H, r: BAR_H / 2, fill: "grid", group: g });
    const fillW = Math.max(ratio > 0 ? BAR_H : 0, Math.min(1, Math.max(0, ratio)) * inner);
    if (fillW > 0) ctx.items.push({ t: "rect", x: ctx.pad, y: barY, w: fillW, h: BAR_H, r: BAR_H / 2, fill: done ? "s3" : "s1", group: g, hint: `${it.label}: ${amount}（${pct}）` });
    ctx.targets.push({ hit: { x: ctx.pad, y: y - ITEM_GAP / 2, w: inner, h: rowH }, keep: [g], say: `${it.label}、${amount}、${pct}${done ? `、${ctx.labels.done}` : ""}` });
    y += rowH;
  });
  return y - ITEM_GAP + 10;
}

// ---------------------------------------------------------------- funnel

/**
 * 段階ごとの棒を左に揃えて上から並べる（長さを比べやすいように）。
 * 値は棒の右、前の段階からの割合は右端の列に出す。
 */
export function layoutFunnel(ctx: Ctx, f: FunnelFigure, top: number): number {
  const n = f.stages.length;
  if (n === 0) return top;
  const inner = ctx.width - ctx.pad * 2;
  const unit = f.unit ?? "";
  const max = Math.max(...f.stages.map((s) => s.value), 0);
  const first = f.stages[0]!.value;
  const rates = f.stages.map((s, i) => (i === 0 ? "" : share(s.value, f.stages[i - 1]!.value)));
  const values = f.stages.map((s) => withUnit(formatValue(s.value, ctx.locale), unit));
  const labelW = Math.min(Math.max(...f.stages.map((s) => ctx.measure(s.label + refsOf(s.refs), HEAD, 500))), inner * 0.3);
  const rateW = n > 1 ? Math.max(ctx.measure(ctx.labels.stepRate, META), ...rates.map((r) => ctx.measure(r, HEAD, 600))) + 8 : 0;
  const valueW = Math.max(...values.map((v) => ctx.measure(v, HEAD, 600)));
  const areaX = ctx.pad + labelW + 16;
  const areaW = inner - labelW - 16 - rateW - (rateW ? 16 : 0);
  const rowH = 38;
  const barH = 24;
  const headH = n > 1 ? 20 : 0;
  // 右の列の見出し
  if (n > 1) ctx.items.push({ t: "text", x: ctx.width - ctx.pad, y: top + 12, text: ctx.labels.stepRate, size: META, fill: "muted", anchor: "end" });
  let y = top + headH;
  f.stages.forEach((s, i) => {
    const g = `f${i}`;
    const by = y + (rowH - barH) / 2;
    const cy = y + rowH / 2;
    // 値の文字が棒の外に出る分だけ、棒の最大の長さを縮める
    const span = Math.max(8, areaW - valueW - 10);
    const w = max > 0 ? Math.max(6, (s.value / max) * span) : 6;
    ctx.items.push({ t: "text", x: ctx.pad, y: cy + 5, text: fit(s.label + refsOf(s.refs), labelW, HEAD, ctx.measure, 500), size: HEAD, weight: 500, fill: "ink", group: g });
    ctx.items.push({ t: "rect", x: areaX, y: by, w, h: barH, r: 8, fill: "s1", group: g, hint: `${s.label}: ${values[i]}` });
    ctx.items.push({ t: "text", x: areaX + w + 10, y: cy + 5, text: values[i]!, size: HEAD, weight: 600, fill: "ink", tabular: true, group: g });
    if (i > 0) ctx.items.push({ t: "text", x: ctx.width - ctx.pad, y: cy + 5, text: rates[i]!, size: HEAD, weight: 600, fill: "ink2", anchor: "end", tabular: true, group: g });
    ctx.targets.push({
      hit: { x: ctx.pad, y, w: inner, h: rowH },
      keep: [g],
      tip: {
        title: s.label,
        rows: [
          { label: ctx.labels.count, value: values[i]!, token: "s1" },
          ...(i > 0 ? [{ label: ctx.labels.fromPrev, value: rates[i]! }, { label: ctx.labels.fromFirst, value: share(s.value, first) }] : []),
        ],
        x: areaX + w / 2,
        y: by,
      },
    });
    y += rowH;
  });
  return y + 6;
}
