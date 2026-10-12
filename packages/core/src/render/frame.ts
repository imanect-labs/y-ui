/** 図の共通部分（見出し・凡例・注記）と、数値の書式・目盛り。 */

import type { Figure } from "../ir.js";
import { estimate, wrap, type Measure } from "./measure.js";
import type { Item } from "./scene.js";
import { SERIES } from "./theme.js";

export interface LayoutOptions {
  /** 描画幅（px）。既定 640。 */
  width?: number;
  /** 数値の書式のロケール。既定 ja-JP。 */
  locale?: string;
  /** 文字幅の計測（ブラウザなら canvas の measureText などに差し替えられる）。 */
  measure?: Measure;
  /** 定型の文言。既定はロケールが ja なら日本語、それ以外は英語。 */
  labels?: Labels;
}

/** 図の中に出る定型の文言（ロケールで切り替える）。 */
export interface Labels {
  unit: (unit: string) => string;
  note: (note: string) => string;
}

export const LABELS_JA: Labels = { unit: (u) => `単位: ${u}`, note: (n) => `※ ${n}` };
export const LABELS_EN: Labels = { unit: (u) => `Unit: ${u}`, note: (n) => `Note: ${n}` };

export interface Ctx {
  width: number;
  pad: number;
  locale: string;
  labels: Labels;
  measure: Measure;
  items: Item[];
}

export function makeCtx(opts: LayoutOptions): Ctx {
  const width = Math.max(240, Math.round(opts.width ?? 640));
  const locale = opts.locale ?? "ja-JP";
  const labels = opts.labels ?? (locale.toLowerCase().startsWith("ja") ? LABELS_JA : LABELS_EN);
  return { width, pad: width < 400 ? 12 : 16, locale, labels, measure: opts.measure ?? estimate, items: [] };
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

export function formatTick(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

/** 区切りのよい目盛り（0 を含む）。 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  let lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : +v.toPrecision(12));
  return ticks;
}
