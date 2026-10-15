/**
 * calc の静止画のレイアウト（SVG・書き出し・SSR 用）。画面では React の部品（react/calc.ts）が操作できる形で描く。
 *
 * 入力は名前と現在値と部品の見た目（スライダーの位置・選択中の選択肢）。結果は淡い面の中に大きく出し、内訳はその下に小さく。
 */

import { breakdownFormulas, formatCalc, runCalc, shownFormulas } from "../calc/run.js";
import type { CalcFigure, CalcInput } from "../ir.js";
import { type Ctx, withUnit } from "./frame.js";
import { fit } from "./measure.js";
import type { Item } from "./scene.js";
import { HEAD, META, PAD, RADIUS, TEXT } from "./style.js";

/** 入力の現在値の表示。 */
export function inputText(d: CalcInput, v: number, locale: string): string {
  if (d.control === "choice") return d.options!.find((o) => o.value === v)?.label ?? String(v);
  if (d.control === "toggle") return v ? (locale.startsWith("ja") ? "オン" : "On") : locale.startsWith("ja") ? "オフ" : "Off";
  return withUnit(new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(v), d.unit);
}

export function layoutCalc(ctx: Ctx, f: CalcFigure, top: number, inputs?: ReadonlyMap<string, number>): number {
  const values = runCalc(f, inputs);
  const inner = ctx.width - ctx.pad * 2;
  let y = top + 4;
  for (const d of f.defs) {
    if (d.type !== "input") continue;
    const v = values.get(d.name) ?? d.initial;
    const valueText = inputText(d, v, ctx.locale);
    ctx.items.push({ t: "text", x: ctx.pad, y: y + 15, text: fit(d.name, inner * 0.6, TEXT, ctx.measure), size: TEXT, fill: "ink2" });
    ctx.items.push({ t: "text", x: ctx.width - ctx.pad, y: y + 15, text: valueText, size: HEAD + 1, weight: 600, fill: "ink", anchor: "end", tabular: true });
    y += 28;
    if (d.control === "slider") {
      const ratio = d.max > d.min ? (v - d.min) / (d.max - d.min) : 0;
      const tx = ctx.pad + 9 + ratio * (inner - 18);
      ctx.items.push({ t: "rect", x: ctx.pad, y: y + 6, w: inner, h: 6, r: 3, fill: "grid" });
      ctx.items.push({ t: "rect", x: ctx.pad, y: y + 6, w: Math.max(6, tx - ctx.pad), h: 6, r: 3, fill: "s1" });
      ctx.items.push({ t: "circle", cx: tx, cy: y + 9, r: 9, fill: "surface", stroke: "s1", strokeWidth: 2 });
      y += 30;
    } else if (d.control === "choice") {
      // 区切りの付いた切り替え（淡い地の中で、選択中だけ白い札を浮かせる）
      const opts = d.options!;
      const w = Math.min(inner, opts.length * 140);
      const segW = (w - 6) / opts.length;
      ctx.items.push({ t: "rect", x: ctx.pad, y, w, h: 36, r: 10, fill: "surface2", stroke: "border", strokeWidth: 1 });
      opts.forEach((o, i) => {
        const x = ctx.pad + 3 + i * segW;
        const on = o.value === v;
        if (on) ctx.items.push({ t: "rect", x: x + 0.5, y: y + 3.5, w: segW - 1, h: 29, r: 8, fill: "surface", stroke: "border", strokeWidth: 1 });
        ctx.items.push({ t: "text", x: x + segW / 2, y: y + 22.5, text: fit(o.label, segW - 16, TEXT, ctx.measure, on ? 600 : 400), size: TEXT, weight: on ? 600 : 400, fill: on ? "ink" : "muted", anchor: "middle" });
      });
      y += 48;
    } else {
      y += 6;
    }
  }

  // 結果（淡い面の中に、大きな数字と内訳）
  const shown = shownFormulas(f);
  const rest = breakdownFormulas(f);
  const bigs = shown.map((r) => {
    const big = withUnit(formatCalc(values.get(r.name) ?? null, r.round, ctx.locale), r.unit);
    let size = 30;
    while (size > 18 && ctx.measure(big, size, 600) > inner - PAD * 2) size -= 2;
    return { r, big, size };
  });
  const panelTop = y + 4;
  let py = panelTop + PAD;
  const panel: Item[] = [];
  bigs.forEach(({ r, big, size }, i) => {
    if (i > 0) py += 10;
    panel.push({ t: "text", x: ctx.pad + PAD, y: py + 13, text: fit(r.name, inner - PAD * 2, META, ctx.measure), size: META, fill: "muted" });
    panel.push({ t: "text", x: ctx.pad + PAD, y: py + 18 + size, text: fit(big, inner - PAD * 2, size, ctx.measure, 600), size, weight: 600, fill: "ink", tabular: true });
    py += 26 + size;
  });
  if (rest.length) {
    py += 8;
    panel.push({ t: "path", d: `M${ctx.pad + PAD},${Math.round(py) + 0.5}H${ctx.width - ctx.pad - PAD}`, stroke: "border", strokeWidth: 1 });
    py += 8;
    for (const r of rest) {
      const val = withUnit(formatCalc(values.get(r.name) ?? null, r.round, ctx.locale), r.unit);
      panel.push({ t: "text", x: ctx.pad + PAD, y: py + 15, text: fit(r.name, inner * 0.55, TEXT, ctx.measure), size: TEXT, fill: "muted" });
      panel.push({ t: "text", x: ctx.width - ctx.pad - PAD, y: py + 15, text: val, size: TEXT, fill: "ink2", anchor: "end", tabular: true });
      py += 24;
    }
  }
  py += PAD - 4;
  ctx.items.push({ t: "rect", x: ctx.pad, y: panelTop, w: inner, h: py - panelTop, r: RADIUS, fill: "surface2" });
  ctx.items.push(...panel);
  return py + 8;
}
