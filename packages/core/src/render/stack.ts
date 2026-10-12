/**
 * stack: 層構成図のレイアウト。
 *
 * 層を上から積み、層の間に下向きの矢印を引く。横並びは等幅で並べ、狭ければ折り返す。
 * 層の中の要素は格子（4 個なら 2×2）。配色はレンダラーが決める:
 * 先頭の層は塗り、要素を持つ層は強調色の塗り、それ以外は枠だけ。
 */

import type { StackBox, StackFigure } from "../ir.js";
import { BODY_SIZE, type Ctx, SMALL_SIZE } from "./frame.js";
import { wrap } from "./measure.js";
import type { Token } from "./theme.js";

const TITLE = 14;
const ARROW_GAP = 28;
const ROW_GAP = 10;
const CHILD_GAP = 8;

interface Measured {
  box: StackBox;
  titleLines: string[];
  descLines: string[];
  childCols: number;
  childLines: string[][];
  childH: number;
  h: number;
}

function measureBox(ctx: Ctx, box: StackBox, w: number): Measured {
  const inner = w - 24;
  const titleLines = wrap(box.title + (box.refs.length ? ` ${box.refs.map((r) => `[${r}]`).join("")}` : ""), inner, TITLE, ctx.measure, 2, 600);
  const descLines = box.desc ? wrap(box.desc, inner, BODY_SIZE, ctx.measure, 3) : [];
  const n = box.children.length;
  let childCols = 0;
  let childLines: string[][] = [];
  let childH = 0;
  if (n > 0) {
    const maxCols = inner < 300 ? 2 : inner < 520 ? 3 : 4;
    childCols = n === 4 ? 2 : Math.min(n, maxCols);
    const cw = (inner - CHILD_GAP * (childCols - 1)) / childCols;
    childLines = box.children.map((c) => wrap(c.desc ? `${c.title}` : c.title, cw - 16, 13, ctx.measure, 2));
    const rows = Math.ceil(n / childCols);
    let total = 0;
    for (let r = 0; r < rows; r++) {
      const inRow = childLines.slice(r * childCols, (r + 1) * childCols);
      const hasDesc = box.children.slice(r * childCols, (r + 1) * childCols).some((c) => c.desc);
      total += Math.max(...inRow.map((l) => l.length)) * 17 + (hasDesc ? 16 : 0) + 18;
    }
    childH = total + CHILD_GAP * (rows - 1);
  }
  const h = 14 + titleLines.length * 19 + (descLines.length ? 2 + descLines.length * 16 : 0) + (childH ? 12 + childH : 0) + 14;
  return { box, titleLines, descLines, childCols, childLines, childH, h };
}

export function layoutStack(ctx: Ctx, f: StackFigure, top: number): number {
  const inner = ctx.width - ctx.pad * 2;
  let y = top;
  f.tiers.forEach((tier, ti) => {
    if (ti > 0) {
      // 層の間の矢印（とラベル）
      const cx = ctx.width / 2;
      ctx.items.push({ t: "path", d: `M${cx},${y + 4}V${y + ARROW_GAP - 5}`, stroke: "muted", strokeWidth: 1.5, arrow: true });
      if (tier.arrowLabel) ctx.items.push({ t: "text", x: cx + 10, y: y + ARROW_GAP / 2 + 4, text: tier.arrowLabel, size: SMALL_SIZE, fill: "ink2" });
      y += ARROW_GAP;
    }
    // 横並びは 1 つ 140px 以上を保ち、収まらなければ折り返す
    const n = tier.boxes.length;
    const perRow = Math.max(1, Math.min(n, Math.floor((inner + ROW_GAP) / (140 + ROW_GAP))));
    for (let start = 0; start < n; start += perRow) {
      const row = tier.boxes.slice(start, start + perRow);
      const w = (inner - ROW_GAP * (row.length - 1)) / row.length;
      const ms = row.map((b) => measureBox(ctx, b, w));
      const h = Math.max(...ms.map((m) => m.h));
      ms.forEach((m, k) => drawBox(ctx, m, ctx.pad + k * (w + ROW_GAP), y, w, h, ti));
      y += h + (start + perRow < n ? ROW_GAP : 0);
    }
  });
  return y + 12;
}

function drawBox(ctx: Ctx, m: Measured, x: number, y: number, w: number, h: number, tierIndex: number): void {
  const hasChildren = m.box.children.length > 0;
  const fill: Token = hasChildren ? "accentWash" : tierIndex === 0 ? "surface2" : "surface";
  const stroke: Token = hasChildren ? "accentLine" : "border";
  const hint = [m.box.title, m.box.desc, ...m.box.children.map((c) => c.title)].filter(Boolean).join(" / ");
  ctx.items.push({ t: "rect", x, y, w, h, r: 10, fill, ...(tierIndex === 0 && !hasChildren ? {} : { stroke, strokeWidth: 1 }), hint });
  const cx = x + w / 2;
  let yy = y + 14;
  m.titleLines.forEach((l) => {
    ctx.items.push({ t: "text", x: cx, y: yy + TITLE, text: l, size: TITLE, weight: 600, fill: "ink", anchor: "middle" });
    yy += 19;
  });
  if (m.descLines.length) {
    yy += 2;
    m.descLines.forEach((l) => {
      ctx.items.push({ t: "text", x: cx, y: yy + 12, text: l, size: BODY_SIZE, fill: "ink2", anchor: "middle" });
      yy += 16;
    });
  }
  if (!hasChildren) return;
  yy += 12;
  const innerW = w - 24;
  const cols = m.childCols;
  const cw = (innerW - CHILD_GAP * (cols - 1)) / cols;
  const rows = Math.ceil(m.box.children.length / cols);
  for (let r = 0; r < rows; r++) {
    const kids = m.box.children.slice(r * cols, (r + 1) * cols);
    const lines = m.childLines.slice(r * cols, (r + 1) * cols);
    const hasDesc = kids.some((c) => c.desc);
    const ch = Math.max(...lines.map((l) => l.length)) * 17 + (hasDesc ? 16 : 0) + 18;
    // 最後の行が埋まらないときは中央に寄せる
    const offset = ((cols - kids.length) * (cw + CHILD_GAP)) / 2;
    kids.forEach((c, k) => {
      const kx = x + 12 + offset + k * (cw + CHILD_GAP);
      ctx.items.push({ t: "rect", x: kx, y: yy, w: cw, h: ch, r: 8, fill: "surface", hint: c.desc ? `${c.title}: ${c.desc}` : c.title });
      let ty = yy + 9 + 13;
      lines[k]!.forEach((l) => {
        ctx.items.push({ t: "text", x: kx + cw / 2, y: ty, text: l, size: 13, fill: "ink", anchor: "middle" });
        ty += 17;
      });
      if (c.desc) ctx.items.push({ t: "text", x: kx + cw / 2, y: ty - 2, text: wrap(c.desc, cw - 12, SMALL_SIZE, ctx.measure, 1)[0]!, size: SMALL_SIZE, fill: "muted", anchor: "middle" });
    });
    yy += ch + CHILD_GAP;
  }
}
