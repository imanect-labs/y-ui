/**
 * calc の静止画のレイアウト（SVG・書き出し・SSR 用）。画面では React の部品（react/calc.ts）が操作できる形で描く。
 *
 * 入力は名前と現在値と部品の見た目（スライダーの位置・選択中の選択肢）、結果は大きく、内訳は小さく。
 */

import { breakdownFormulas, formatCalc, runCalc, shownFormulas } from "../calc/run.js";
import type { CalcFigure, CalcInput } from "../ir.js";
import { BODY_SIZE, type Ctx, SMALL_SIZE, withUnit } from "./frame.js";
import { fit } from "./measure.js";

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
    ctx.items.push({ t: "text", x: ctx.pad, y: y + 13, text: fit(d.name, inner * 0.6, BODY_SIZE, ctx.measure), size: BODY_SIZE, fill: "ink2" });
    ctx.items.push({ t: "text", x: ctx.width - ctx.pad, y: y + 13, text: valueText, size: BODY_SIZE + 1, weight: 600, fill: "ink", anchor: "end", tabular: true });
    y += 22;
    if (d.control === "slider") {
      const ratio = d.max > d.min ? (v - d.min) / (d.max - d.min) : 0;
      ctx.items.push({ t: "rect", x: ctx.pad, y: y + 3, w: inner, h: 6, r: 3, fill: "grid" });
      ctx.items.push({ t: "rect", x: ctx.pad, y: y + 3, w: Math.max(6, ratio * inner), h: 6, r: 3, fill: "s1" });
      ctx.items.push({ t: "circle", cx: ctx.pad + ratio * inner, cy: y + 6, r: 8, fill: "surface", stroke: "border", strokeWidth: 1.5 });
      y += 22;
    } else if (d.control === "choice") {
      const opts = d.options!;
      const w = Math.min(160, (inner - 6 * (opts.length - 1)) / opts.length);
      opts.forEach((o, i) => {
        const x = ctx.pad + i * (w + 6);
        const on = o.value === v;
        ctx.items.push({ t: "rect", x: x + 0.5, y: y + 0.5, w: w - 1, h: 27, r: 14, fill: on ? "accentWash" : "surface", stroke: on ? "accentLine" : "border", strokeWidth: 1 });
        ctx.items.push({ t: "text", x: x + w / 2, y: y + 18, text: fit(o.label, w - 16, BODY_SIZE, ctx.measure, on ? 600 : 400), size: BODY_SIZE, weight: on ? 600 : 400, fill: on ? "ink" : "ink2", anchor: "middle" });
      });
      y += 36;
    } else {
      y += 4;
    }
  }

  // 結果
  ctx.items.push({ t: "path", d: `M${ctx.pad},${Math.round(y) + 0.5}H${ctx.width - ctx.pad}`, stroke: "grid", strokeWidth: 1 });
  y += 10;
  for (const r of shownFormulas(f)) {
    ctx.items.push({ t: "text", x: ctx.pad, y: y + 13, text: fit(r.name, inner, BODY_SIZE, ctx.measure), size: BODY_SIZE, fill: "muted" });
    const big = withUnit(formatCalc(values.get(r.name) ?? null, r.round, ctx.locale), r.unit);
    let size = 26;
    while (size > 16 && ctx.measure(big, size, 600) > inner) size -= 2;
    ctx.items.push({ t: "text", x: ctx.pad, y: y + 20 + size, text: fit(big, inner, size, ctx.measure, 600), size, weight: 600, fill: "ink", tabular: true });
    y += 30 + size;
  }
  // 内訳
  const rest = breakdownFormulas(f);
  rest.forEach((r) => {
    const val = withUnit(formatCalc(values.get(r.name) ?? null, r.round, ctx.locale), r.unit);
    ctx.items.push({ t: "text", x: ctx.pad, y: y + 12, text: fit(r.name, inner * 0.6, SMALL_SIZE + 1, ctx.measure), size: SMALL_SIZE + 1, fill: "muted" });
    ctx.items.push({ t: "text", x: ctx.width - ctx.pad, y: y + 12, text: val, size: SMALL_SIZE + 1, fill: "ink2", anchor: "end", tabular: true });
    y += 18;
  });
  return y + 6;
}
