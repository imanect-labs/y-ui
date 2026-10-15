/**
 * calc: 画面内で完結する計算（docs/calc.md）。
 *
 * 1 行が 1 つの名前の定義 `名前 = 中身 [単位]`。中身は入力（slider / count / choice / toggle）か式。
 * `show A | B`・`hide: A, B`・`note:`。式は前に定義した名前だけを参照できる。
 */

import { ExprError, exprSource, namesIn, parseExpr } from "../calc/expr.js";
import type { CalcFigure, CalcFormula, CalcInput } from "../ir.js";
import { clip, Diagnostics, LIMITS, type Line, parseOption, stripListMarker } from "../lines.js";

const NAME = /^([^\s=+\-*/^(),<>!|:：]+)\s*[=＝]\s*(.+)$/;
const NUM = "(-?\\d+(?:\\.\\d+)?)";
const RANGE = `${NUM}\\s*(?:\\.\\.|〜|~|～)\\s*${NUM}`;
const SLIDER = new RegExp(`^(slider|スライダー)\\s+${RANGE}(?:\\s+(?:step|刻み)\\s+${NUM})?(?:\\s+(?:初期値?|initial|default)\\s+${NUM})?\\s*(.*)$`, "i");
const COUNT = new RegExp(`^(count|stepper|増減)\\s+${RANGE}(?:\\s+(?:初期値?|initial|default)\\s+${NUM})?\\s*(.*)$`, "i");
const CHOICE = /^(choice|select|選択)\s+(.+)$/i;
const TOGGLE = /^(toggle|switch|オンオフ)(?:\s+(?:初期値?|initial|default)\s+(オン|オフ|on|off|1|0))?\s*$/i;
const ROUND = /\s+round\s+(\d+)\s*$/i;

export function parseCalc(fig: CalcFigure, body: Line[], diags: Diagnostics): void {
  const defined = new Set<string>();
  for (const line of body) {
    const raw = stripListMarker(line.text.trim()).text;
    if (raw === "") continue;
    const opt = parseOption(raw, ["note", "src"]);
    if (opt) {
      if (opt.key === "note") fig.note = opt.value;
      else fig.src = opt.value;
      continue;
    }
    const show = /^(show|表示)\s*[:：]?\s+(.+)$/i.exec(raw);
    if (show) {
      fig.show = show[2]!.split(/\s*[|,、]\s*/).filter(Boolean);
      continue;
    }
    const hide = /^(hide|非表示)\s*[:：]\s*(.+)$/i.exec(raw);
    if (hide) {
      fig.hide = hide[2]!.split(/\s*[|,、]\s*/).filter(Boolean);
      continue;
    }
    // 名前は正規化して照合する（式の中の名前も正規化して読むため）。中身（選択肢の表示名など）は書かれたまま
    const eq = raw.search(/[=＝]/);
    const m = eq > 0 ? NAME.exec(`${raw.slice(0, eq).normalize("NFKC").trim()} = ${raw.slice(eq + 1).trim()}`) : null;
    if (!m) {
      diags.add(line.no, "warning", "unrecognized_line", `解釈できない行を無視しました（「名前 = 中身」で書いてください）: ${raw}`);
      continue;
    }
    const name = clip(m[1]!, line.no, diags);
    if (defined.has(name)) {
      diags.add(line.no, "warning", "unrecognized_line", `「${name}」は既に定義されています`);
      continue;
    }
    if (fig.defs.length >= LIMITS.calcDefs) {
      diags.addOnce(line.no, "warning", "limit_exceeded", `定義は ${LIMITS.calcDefs} 個までです`);
      continue;
    }
    const def = readDef(name, m[2]!.trim(), line.no, diags, defined);
    if (!def) continue;
    fig.defs.push(def);
    defined.add(name);
  }
  const names = new Set(fig.defs.map((d) => d.name));
  const unknown = [...fig.show, ...fig.hide].filter((n) => !names.has(n));
  if (unknown.length) diags.add(0, "warning", "unrecognized_line", `定義の無い名前を無視しました: ${unknown.join("、")}`);
  fig.show = fig.show.filter((n) => names.has(n));
  fig.hide = fig.hide.filter((n) => names.has(n));
}

function readDef(name: string, body: string, line: number, diags: Diagnostics, defined: Set<string>): CalcInput | CalcFormula | null {
  let m = SLIDER.exec(body);
  if (m) {
    const [min, max] = order(+m[2]!, +m[3]!);
    const step = m[4] ? Math.abs(+m[4]) || 1 : niceStep(max - min);
    return input(name, "slider", min, max, step, m[5] !== undefined ? +m[5] : min, m[6], line, diags);
  }
  m = COUNT.exec(body);
  if (m) {
    const [min, max] = order(Math.round(+m[2]!), Math.round(+m[3]!));
    return input(name, "count", min, max, 1, m[4] !== undefined ? Math.round(+m[4]) : min, m[5], line, diags);
  }
  m = CHOICE.exec(body);
  if (m) {
    const options = m[2]!
      .split(/\s*\|\s*/)
      .map((o) => /^(.+?)\s*[=＝]\s*(-?\d+(?:\.\d+)?)$/.exec(o.trim()))
      .filter((x): x is RegExpExecArray => x !== null)
      .map((x) => ({ label: clip(x[1]!.trim(), line, diags), value: +x[2]! }));
    if (options.length < 2) {
      diags.add(line, "warning", "unrecognized_line", `「${name}」の選択肢は「表示名=値 | 表示名=値」で 2 つ以上書いてください`);
      return null;
    }
    const values = options.map((o) => o.value);
    return { type: "input", name, control: "choice", min: Math.min(...values), max: Math.max(...values), step: 0, initial: options[0]!.value, options };
  }
  m = TOGGLE.exec(body);
  if (m) {
    const on = m[2] !== undefined && /^(オン|on|1)$/i.test(m[2]);
    return { type: "input", name, control: "toggle", min: 0, max: 1, step: 1, initial: on ? 1 : 0 };
  }
  // 式
  let text = body;
  let round: number | undefined;
  const r = ROUND.exec(text);
  if (r) {
    round = Math.min(10, +r[1]!);
    text = text.slice(0, r.index);
  }
  if (text.length > LIMITS.calcExprLength) {
    diags.add(line, "warning", "text_too_long", `「${name}」の式が長すぎます（${LIMITS.calcExprLength} 文字まで）`);
    return null;
  }
  try {
    const p = parseExpr(text);
    const normalized = text.normalize("NFKC");
    const unit = normalized.slice(p.end).trim();
    const missing = [...namesIn(p.expr)].filter((n) => !defined.has(n));
    if (missing.length) {
      diags.add(line, "warning", "unrecognized_line", `「${name}」の式に、前に定義されていない名前があります: ${missing.join("、")}`);
      return null;
    }
    const f: CalcFormula = { type: "formula", name, source: exprSource(p.expr), expr: p.expr };
    if (unit) f.unit = clip(unit, line, diags);
    if (round !== undefined) f.round = round;
    return f;
  } catch (e) {
    if (e instanceof ExprError) {
      diags.add(line, "warning", "unrecognized_line", `「${name}」の式を読めません: ${e.message}`);
      return null;
    }
    throw e;
  }
}

function order(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/** 範囲の 1/100 前後の、区切りのよい刻み。 */
function niceStep(span: number): number {
  if (span <= 0) return 1;
  const raw = span / 100;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? mag * 10;
}

function input(name: string, control: "slider" | "count", min: number, max: number, step: number, initial: number, unitText: string | undefined, line: number, diags: Diagnostics): CalcInput {
  const init = Math.min(max, Math.max(min, initial));
  if (init !== initial) diags.add(line, "warning", "bad_number", `「${name}」の初期値を範囲（${min}〜${max}）に丸めました`);
  const def: CalcInput = { type: "input", name, control, min, max, step, initial: init };
  const unit = unitText?.trim();
  if (unit) def.unit = clip(unit, line, diags);
  return def;
}
