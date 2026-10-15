/**
 * ask（質問のカード）と plan（計画のカード）の静止画のレイアウト。画面では React の部品（react/ask.ts）が操作できる形で描く。
 *
 * - ask: 質問ごとに文と、選択肢の札（説明は札の下）。自由記述は入力欄。下に送るボタン。
 * - plan: 前置きと、steps と同じ縦の手順。下に「この計画で進める」「修正を依頼」。
 */

import type { AskFigure, PlanFigure } from "../ir.js";
import type { Ctx } from "./frame.js";
import { fit, wrap } from "./measure.js";
import { layoutSeq } from "./seq.js";
import { HEAD, HEAD_LH, META, TEXT, TEXT_LH } from "./style.js";

const BTN_H = 36;

function buttons(ctx: Ctx, labels: string[], y: number): number {
  let x = ctx.pad;
  labels.forEach((label, i) => {
    const w = ctx.measure(label, TEXT, 600) + 32;
    const primary = i === 0;
    ctx.items.push({ t: "rect", x: x + 0.5, y: y + 0.5, w: w - 1, h: BTN_H - 1, r: 10, fill: primary ? "ink" : "surface", stroke: primary ? "ink" : "border", strokeWidth: 1 });
    ctx.items.push({ t: "text", x: x + w / 2, y: y + 23, text: label, size: TEXT, weight: 600, fill: primary ? "surface" : "ink", anchor: "middle" });
    x += w + 8;
  });
  return y + BTN_H;
}

function intro(ctx: Ctx, text: string | undefined, y: number): number {
  if (!text) return y;
  const lines = text.split("\n").flatMap((p) => wrap(p, ctx.width - ctx.pad * 2, TEXT, ctx.measure, 4));
  lines.forEach((l, k) => ctx.items.push({ t: "text", x: ctx.pad, y: y + 14 + k * TEXT_LH, text: l, size: TEXT, fill: "ink2" }));
  return y + lines.length * TEXT_LH + 12;
}

export function layoutAsk(ctx: Ctx, f: AskFigure, top: number): number {
  const ja = ctx.locale.toLowerCase().startsWith("ja");
  const inner = ctx.width - ctx.pad * 2;
  let y = intro(ctx, f.intro, top + 2);
  f.questions.forEach((q, qi) => {
    const g = `q${qi}`;
    const head = wrap(`${qi + 1}. ${q.text}`, inner - 60, HEAD, ctx.measure, 3, 600);
    head.forEach((l, k) => ctx.items.push({ t: "text", x: ctx.pad, y: y + 15 + k * HEAD_LH, text: l, size: HEAD, weight: 600, fill: "ink", group: g }));
    const tag = [q.multi ? (ja ? "複数選択可" : "Multiple") : "", q.required ? "" : ja ? "任意" : "Optional"].filter(Boolean).join("・");
    if (tag) ctx.items.push({ t: "text", x: ctx.width - ctx.pad, y: y + 15, text: tag, size: META, fill: "muted", anchor: "end", group: g });
    y += head.length * HEAD_LH + 8;
    if (q.options.length === 0) {
      ctx.items.push({ t: "rect", x: ctx.pad + 0.5, y: y + 0.5, w: inner - 1, h: 35, r: 8, fill: "surface", stroke: "border", strokeWidth: 1, group: g });
      if (q.placeholder) ctx.items.push({ t: "text", x: ctx.pad + 12, y: y + 23, text: fit(q.placeholder, inner - 24, TEXT, ctx.measure), size: TEXT, fill: "muted", group: g });
      y += 36 + 18;
      return;
    }
    // 選択肢は縦に並べる（説明があれば下に）
    const opts = [...q.options, ...(q.other ? [{ label: ja ? "その他（自由記述）" : "Other", desc: undefined }] : [])];
    for (const o of opts) {
      const desc = o.desc ? wrap(o.desc, inner - 52, META, ctx.measure, 2) : [];
      const h = 22 + (desc.length ? desc.length * 17 + 2 : 0) + 14;
      ctx.items.push({ t: "rect", x: ctx.pad + 0.5, y: y + 0.5, w: inner - 1, h: h - 1, r: 10, fill: "surface", stroke: "border", strokeWidth: 1, group: g });
      // 単一選択は丸、複数選択は角丸の四角
      if (q.multi) ctx.items.push({ t: "rect", x: ctx.pad + 14, y: y + 12, w: 16, h: 16, r: 4, fill: "surface", stroke: "axis", strokeWidth: 1.5, group: g });
      else ctx.items.push({ t: "circle", cx: ctx.pad + 22, cy: y + 20, r: 8, fill: "surface", stroke: "axis", strokeWidth: 1.5, group: g });
      ctx.items.push({ t: "text", x: ctx.pad + 40, y: y + 25, text: fit(o.label, inner - 52, TEXT, ctx.measure, 500), size: TEXT, weight: 500, fill: "ink", group: g });
      desc.forEach((l, k) => ctx.items.push({ t: "text", x: ctx.pad + 40, y: y + 43 + k * 17, text: l, size: META, fill: "muted", group: g }));
      y += h + 6;
    }
    y += 12;
  });
  return buttons(ctx, [f.submitLabel ?? (ja ? "回答する" : "Submit")], y) + 8;
}

export function layoutPlan(ctx: Ctx, f: PlanFigure, top: number): number {
  const ja = ctx.locale.toLowerCase().startsWith("ja");
  let y = intro(ctx, f.intro, top + 2);
  y = layoutSeq(ctx, { kind: "steps", title: "", refs: [], steps: f.steps }, y + 2) + 10;
  return buttons(ctx, [f.approveLabel ?? (ja ? "この計画で進める" : "Proceed with this plan"), ...(f.revise ? [ja ? "修正を依頼" : "Request changes"] : [])], y) + 8;
}
