/** calc の評価: 入力の値から、すべての名前の値を前から順に計算する。 */

import type { CalcFigure, CalcFormula } from "../ir.js";
import { evaluate } from "./expr.js";

export type CalcValues = Map<string, number | null>;

/** 入力の現在値（無ければ初期値）から、全定義の値を計算する。 */
export function runCalc(fig: CalcFigure, inputs: ReadonlyMap<string, number> = new Map()): CalcValues {
  const env: CalcValues = new Map();
  for (const d of fig.defs) {
    if (d.type === "input") {
      const v = inputs.get(d.name);
      env.set(d.name, v === undefined ? d.initial : Math.min(d.max, Math.max(d.min, v)));
    } else {
      env.set(d.name, evaluate(d.expr, env));
    }
  }
  return env;
}

/** 大きく出す結果（show が無ければ最後の式）。 */
export function shownFormulas(fig: CalcFigure): CalcFormula[] {
  const formulas = fig.defs.filter((d): d is CalcFormula => d.type === "formula");
  if (fig.show.length) return formulas.filter((f) => fig.show.includes(f.name));
  return formulas.length ? [formulas[formulas.length - 1]!] : [];
}

/** 内訳に出す式（大きく出すもの・hide を除く）。 */
export function breakdownFormulas(fig: CalcFigure): CalcFormula[] {
  const shown = new Set(shownFormulas(fig).map((f) => f.name));
  return fig.defs.filter((d): d is CalcFormula => d.type === "formula" && !shown.has(d.name) && !fig.hide.includes(d.name));
}

/** 値の表示（round が無ければ、1 以上は整数、1 未満は有効数字 2 桁）。null は「—」。 */
export function formatCalc(v: number | null, round: number | undefined, locale: string): string {
  if (v === null) return "—";
  const digits = round ?? (Math.abs(v) >= 1 || v === 0 ? 0 : Math.min(10, 1 - Math.floor(Math.log10(Math.abs(v)))));
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: round ?? 0 }).format(v);
}
