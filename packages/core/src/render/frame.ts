/** 図の共通部分（見出し・凡例・注記）と、数値の書式・目盛り。 */

import type { Figure } from "../ir.js";
import { estimate, wrap, type Measure } from "./measure.js";
import type { Item, Target } from "./scene.js";
import { SERIES } from "./theme.js";

export interface LayoutOptions {
  /** 描画幅（px）。既定 640。 */
  width?: number;
  /** 数値の書式のロケール。既定 ja-JP。 */
  locale?: string;
  /** 文字幅の計測（ブラウザなら canvas の measureText などに差し替えられる）。 */
  measure?: Measure;
  /** calc の入力の現在値（書き出しで、操作した後の状態を描くため）。無ければ初期値。 */
  calcInputs?: ReadonlyMap<string, number>;
  /** 定型の文言。既定はロケールが ja なら日本語、それ以外は英語。渡した項目だけを上書きする。 */
  labels?: Partial<Labels>;
}

/** 図の中に出る定型の文言（ロケールで切り替える）。 */
export interface Labels {
  unit: (unit: string) => string;
  note: (note: string) => string;
  /** 円グラフの中央・割合。 */
  total: string;
  share: string;
  /** ファネルの右の列（前の段階からの割合）と、ツールチップの行。 */
  stepRate: string;
  count: string;
  fromPrev: string;
  fromFirst: string;
  /** 進捗が目標に届いた項目（読み上げ）。 */
  done: string;
  /** 比較表で強調する選択肢の札。 */
  recommended: string;
  /** proscons・swot の見出しの既定（見出しが書かれていないとき）。 */
  pros: string;
  cons: string;
  swot: [string, string, string, string];
  /** チェックリストの進行中の札と、完了の数。 */
  doing: string;
  completed: (done: number, total: number) => string;
  /** 比較表の印の読み上げ。 */
  yes: string;
  no: string;
  partial: string;
}

export const LABELS_JA: Labels = { unit: (u) => `単位: ${u}`, note: (n) => `※ ${n}`, total: "合計", share: "割合", stepRate: "前段比", count: "数", fromPrev: "前の段階から", fromFirst: "最初から", done: "達成", recommended: "おすすめ", pros: "メリット", cons: "デメリット", swot: ["強み", "弱み", "機会", "脅威"], doing: "進行中", completed: (d, t) => `${t} 項目中 ${d} 項目が完了`, yes: "あり", no: "なし", partial: "一部" };
export const LABELS_EN: Labels = { unit: (u) => `Unit: ${u}`, note: (n) => `Note: ${n}`, total: "Total", share: "Share", stepRate: "Step rate", count: "Count", fromPrev: "From previous", fromFirst: "From first", done: "done", recommended: "Recommended", pros: "Pros", cons: "Cons", swot: ["Strengths", "Weaknesses", "Opportunities", "Threats"], doing: "In progress", completed: (d, t) => `${d} of ${t} done`, yes: "Yes", no: "No", partial: "Partial" };

/** 数値に単位を付ける（英字で始まる単位は空白を挟む: `1,200 people`、`1,200人`）。 */
export function withUnit(value: string, unit: string | undefined): string {
  if (!unit) return value;
  // 通貨記号で始まる単位は前に置く（`$M` → `$350M`）
  const cur = /^([$€£¥₹₩])(.*)$/.exec(unit);
  if (cur) return `${cur[1]}${value}${cur[2]}`;
  return /^[A-Za-z]/.test(unit) ? `${value} ${unit}` : `${value}${unit}`;
}

export interface Ctx {
  width: number;
  pad: number;
  locale: string;
  labels: Labels;
  measure: Measure;
  items: Item[];
  targets: Target[];
}

export function makeCtx(opts: LayoutOptions): Ctx {
  const width = Math.max(240, Math.round(opts.width ?? 640));
  const locale = opts.locale ?? "ja-JP";
  const labels = { ...(locale.toLowerCase().startsWith("ja") ? LABELS_JA : LABELS_EN), ...opts.labels };
  return { width, pad: width < 400 ? 12 : 16, locale, labels, measure: opts.measure ?? estimate, items: [], targets: [] };
}

export const TITLE_SIZE = 14;
export const BODY_SIZE = 12;
export const SMALL_SIZE = 11;

/** 見出し（引用番号付き）を置き、次に使える y を返す。 */
export function drawTitle(ctx: Ctx, f: Figure, y: number): number {
  const title = f.title + (f.refs.length ? ` ${f.refs.map((r) => `[${r}]`).join("")}` : "");
  if (!title.trim()) return y;
  const lines = wrap(title, ctx.width - ctx.pad * 2, TITLE_SIZE, ctx.measure, 2, 600);
  lines.forEach((l, i) => ctx.items.push({ t: "text", x: ctx.pad, y: y + TITLE_SIZE + i * 20, text: l, size: TITLE_SIZE, weight: 600, fill: "ink" }));
  return y + lines.length * 20 + 6;
}

/** 系列の凡例（2 系列以上のときだけ）。次に使える y を返す。 */
export function drawLegend(ctx: Ctx, names: string[], y: number, mark: "box" | "line"): number {
  if (names.length < 2) return y;
  let x = ctx.pad;
  let row = 0;
  for (let i = 0; i < names.length; i++) {
    const label = names[i]!;
    const w = 14 + ctx.measure(label, BODY_SIZE) + 16;
    if (x + w > ctx.width - ctx.pad && x > ctx.pad) {
      x = ctx.pad;
      row++;
    }
    const cy = y + 8 + row * 20;
    const token = SERIES[i % SERIES.length]!;
    if (mark === "box") ctx.items.push({ t: "circle", cx: x + 5, cy, r: 4, fill: token });
    else ctx.items.push({ t: "path", d: `M${x},${cy}H${x + 12}`, stroke: token, strokeWidth: 2 });
    ctx.items.push({ t: "text", x: x + 16, y: cy + 4, text: label, size: BODY_SIZE, fill: "ink2" });
    x += w;
  }
  return y + (row + 1) * 20 + 4;
}

/** 注記を置き、次に使える y を返す。 */
export function drawNote(ctx: Ctx, f: Figure, y: number): number {
  if (!f.note) return y;
  const lines = wrap(ctx.labels.note(f.note), ctx.width - ctx.pad * 2, BODY_SIZE, ctx.measure, 4);
  lines.forEach((l, i) => ctx.items.push({ t: "text", x: ctx.pad, y: y + 14 + i * 17, text: l, size: BODY_SIZE, fill: "muted" }));
  return y + lines.length * 17 + 6;
}

// ---------------------------------------------------------------- 数値

export function formatValue(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1 }).format(v);
}

/**
 * 目盛りの数値。`step`（目盛りの間隔）を渡すと、隣どうしが同じ表記にならない桁数まで出す
 * （0.5 セント刻みが「0」「0」と重なるのを防ぐ）。渡さなければ小数 1 桁まで。
 */
export function formatTick(v: number, locale: string, step?: number): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: tickDigits(step) }).format(v);
}

/** 間隔 `step` の目盛りを書き分けるのに要る小数の桁数（1〜6）。 */
export function tickDigits(step: number | undefined): number {
  if (step === undefined || !(step > 0) || step >= 1) return 1;
  for (let d = 1; d < 6; d++) {
    if (Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) < 1e-9) return d;
  }
  return 6;
}

/** 目盛りの間隔（目盛りが 2 つ以上あるときの隣との差）。 */
export function tickStep(ticks: number[]): number | undefined {
  return ticks.length > 1 ? Math.abs(ticks[1]! - ticks[0]!) : undefined;
}

/** 値がすべて整数か（人数・回数のような量。目盛りも整数だけにする）。 */
export function allIntegers(values: Iterable<number | null | undefined>): boolean {
  let any = false;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (!Number.isInteger(v)) return false;
    any = true;
  }
  return any;
}

/**
 * 区切りのよい間隔。`integer` なら 1 未満にせず、2.5 刻みも使わない
 * （値が整数だけの図で 0, 2.5, 5… や 0.5 刻みの目盛りを出さない）。
 */
export function niceStep(raw: number, integer = false): number {
  const mag = 10 ** Math.floor(Math.log10(raw));
  const multiples = integer && mag <= 1 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = multiples.map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return integer ? Math.max(1, Math.round(step)) : step;
}

/** 区切りのよい目盛り（0 を含む）。`integer` は {@link niceStep} を参照。 */
export function niceTicks(min: number, max: number, count = 5, integer = false): number[] {
  let lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (lo === hi) hi = lo + 1;
  const step = niceStep((hi - lo) / count, integer);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : +v.toPrecision(12));
  return ticks;
}
