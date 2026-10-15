/**
 * app の静止画のレイアウト（SVG・書き出し・SSR 用）。画面では React の部品（react/app.ts）が操作できる形で描く。
 *
 * 機能ごとに角丸の枠を置き、見出し・説明・入力欄（ラベルと枠）・ボタンを並べる。
 * 幅があれば入力欄を 2 列にする（複数行の文字は 1 行を使う）。値は初期値か、例を薄く出す。
 */

import { displayValue } from "../app/values.js";
import type { AppField, AppFigure } from "../ir.js";
import type { Ctx } from "./frame.js";
import { fit, wrap } from "./measure.js";
import { HEAD, HEAD_LH, META, PAD, RADIUS, TEXT } from "./style.js";

const BOX_H = 36;
const AREA_H = 76;
const BTN_H = 36;
const COL_GAP = 12;
const ROW_GAP = 14;

const boxH = (x: AppField) => (x.type === "textarea" ? AREA_H : x.type === "slider" ? 22 : BOX_H);

export function layoutApp(ctx: Ctx, f: AppFigure, top: number): number {
  const inner = ctx.width - ctx.pad * 2;
  const ja = ctx.locale.toLowerCase().startsWith("ja");
  const cols = inner - PAD * 2 >= 480 ? 2 : 1;
  const colW = (inner - PAD * 2 - COL_GAP * (cols - 1)) / cols;
  let y = top + 2;
  f.sections.forEach((s, si) => {
    const g = `s${si}`;
    const items: (() => void)[] = [];
    let yy = y + PAD;
    const x0 = ctx.pad + PAD;
    if (s.title) {
      const t = fit(s.title, inner - PAD * 2, HEAD + 1, ctx.measure, 600);
      const ty = yy;
      items.push(() => ctx.items.push({ t: "text", x: x0, y: ty + 15, text: t, size: HEAD + 1, weight: 600, fill: "ink", group: g }));
      yy += HEAD_LH + 2;
    }
    if (s.desc) {
      const lines = s.desc.split("\n").flatMap((p) => wrap(p, inner - PAD * 2, META + 1, ctx.measure, 3));
      const dy = yy;
      items.push(() => lines.forEach((l, k) => ctx.items.push({ t: "text", x: x0, y: dy + 13 + k * 19, text: l, size: META + 1, fill: "muted", group: g })));
      yy += lines.length * 19 + 2;
    }
    if (s.title || s.desc) yy += 10;

    // 入力欄を格子に並べる（複数行の文字は 1 行を使う）
    let col = 0;
    let rowH = 0;
    for (const x of s.fields) {
      const span = x.type === "textarea" || cols === 1 ? cols : 1;
      if (col + span > cols) {
        yy += rowH + ROW_GAP;
        col = 0;
        rowH = 0;
      }
      const fx = x0 + col * (colW + COL_GAP);
      const fw = span * colW + (span - 1) * COL_GAP;
      const fy = yy;
      const h = x.type === "toggle" ? BOX_H : 22 + boxH(x);
      items.push(() => drawField(ctx, x, fx, fy, fw, g, ja));
      rowH = Math.max(rowH, h);
      col += span;
      if (col >= cols) {
        yy += rowH + ROW_GAP;
        col = 0;
        rowH = 0;
      }
    }
    if (col > 0) yy += rowH + ROW_GAP;

    // ボタン（最初のボタンを主に）
    if (s.actions.length) {
      yy += 2;
      let bx = x0;
      const by = yy;
      s.actions.forEach((a, i) => {
        const w = Math.min(inner - PAD * 2, ctx.measure(a.label, TEXT, 600) + 32);
        const primary = i === 0;
        const ax = bx;
        items.push(() => {
          ctx.items.push({ t: "rect", x: ax + 0.5, y: by + 0.5, w: w - 1, h: BTN_H - 1, r: 10, fill: primary ? "ink" : "surface", stroke: primary ? "ink" : "border", strokeWidth: 1, group: g, hint: a.target.kind === "workflow" ? `${a.label} → ${a.target.name}` : a.label });
          ctx.items.push({ t: "text", x: ax + w / 2, y: by + 23, text: fit(a.label, w - 20, TEXT, ctx.measure, 600), size: TEXT, weight: 600, fill: primary ? "surface" : "ink", anchor: "middle", group: g });
        });
        bx += w + 8;
      });
      yy += BTN_H;
    } else yy -= ROW_GAP - 4;
    const h = yy + PAD - y;
    ctx.items.push({ t: "rect", x: ctx.pad + 0.5, y: y + 0.5, w: inner - 1, h: h - 1, r: RADIUS, fill: "surface", stroke: "border", strokeWidth: 1, group: g });
    for (const draw of items) draw();
    y += h + 12;
  });
  return y - 12 + 8;
}

function drawField(ctx: Ctx, x: AppField, fx: number, fy: number, fw: number, g: string, ja: boolean): void {
  const req = x.required ? (ja ? "必須" : "Required") : "";
  if (x.type === "toggle") {
    const on = x.initial === true;
    ctx.items.push({ t: "text", x: fx, y: fy + 23, text: fit(x.label, fw - 60, TEXT, ctx.measure, 500), size: TEXT, weight: 500, fill: "ink2", group: g });
    const sx = fx + fw - 40;
    ctx.items.push({ t: "rect", x: sx, y: fy + 8, w: 40, h: 22, r: 11, fill: on ? "s1" : "grid", group: g });
    ctx.items.push({ t: "circle", cx: on ? sx + 29 : sx + 11, cy: fy + 19, r: 8, fill: "surface", group: g });
    return;
  }
  const lw = ctx.measure(x.label, TEXT, 500);
  ctx.items.push({ t: "text", x: fx, y: fy + 14, text: fit(x.label, fw - (req ? 40 : 0), TEXT, ctx.measure, 500), size: TEXT, weight: 500, fill: "ink2", group: g });
  if (req) ctx.items.push({ t: "text", x: fx + Math.min(lw, fw - 40) + 8, y: fy + 14, text: req, size: META - 1, fill: "muted", group: g });
  const by = fy + 22;
  if (x.type === "slider") {
    const min = x.min ?? 0;
    const max = x.max ?? 100;
    const v = typeof x.initial === "number" ? x.initial : min;
    const ratio = max > min ? (v - min) / (max - min) : 0;
    const tx = fx + 9 + ratio * (fw - 18);
    ctx.items.push({ t: "rect", x: fx, y: by + 8, w: fw, h: 6, r: 3, fill: "grid", group: g });
    ctx.items.push({ t: "rect", x: fx, y: by + 8, w: Math.max(6, tx - fx), h: 6, r: 3, fill: "s1", group: g });
    ctx.items.push({ t: "circle", cx: tx, cy: by + 11, r: 8, fill: "surface", stroke: "s1", strokeWidth: 2, group: g });
    return;
  }
  const h = boxH(x);
  ctx.items.push({ t: "rect", x: fx + 0.5, y: by + 0.5, w: fw - 1, h: h - 1, r: 8, fill: "surface", stroke: "border", strokeWidth: 1, group: g });
  const has = x.initial !== undefined && x.initial !== "" && !(Array.isArray(x.initial) && x.initial.length === 0);
  const text = has ? displayValue(x, x.initial, ja) : (x.placeholder ?? (x.type === "choice" ? (ja ? "選択してください" : "Select") : x.type === "date" ? "yyyy-mm-dd" : x.type === "month" ? "yyyy-mm" : ""));
  const chevron = x.type === "choice" || x.type === "date" || x.type === "month";
  const unitW = x.unit && (x.type === "number" || x.type === "count") ? ctx.measure(x.unit, TEXT) + 12 : 0;
  if (text) ctx.items.push({ t: "text", x: fx + 12, y: by + 23, text: fit(text, fw - 24 - (chevron ? 16 : 0) - unitW, TEXT, ctx.measure), size: TEXT, fill: has ? "ink" : "muted", group: g });
  if (unitW) ctx.items.push({ t: "text", x: fx + fw - 12, y: by + 23, text: x.unit!, size: TEXT, fill: "muted", anchor: "end", group: g });
  if (chevron) ctx.items.push({ t: "path", d: `M${fx + fw - 22},${by + 15}l4.5,4.5l4.5,-4.5`, stroke: "muted", strokeWidth: 1.5, group: g });
}
