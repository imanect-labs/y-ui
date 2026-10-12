/**
 * シーン: レイアウトの結果（箱・線・文字の並び）。SVG にも React にも、この 1 つから描く。
 * 色はトークンで持ち、出力のときに CSS 変数か焼き込みの色にする。
 */

import type { Token } from "./theme.js";

interface Common {
  /** マウスを載せたときの説明（SVG の <title>）。 */
  hint?: string;
  opacity?: number;
}

export type Item =
  | (Common & { t: "rect"; x: number; y: number; w: number; h: number; r?: number; fill: Token; stroke?: Token; strokeWidth?: number })
  | (Common & { t: "path"; d: string; fill?: Token; stroke?: Token; strokeWidth?: number; dash?: string; arrow?: boolean })
  | (Common & { t: "circle"; cx: number; cy: number; r: number; fill: Token; stroke?: Token; strokeWidth?: number })
  | (Common & {
      t: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      fill: Token;
      weight?: number;
      anchor?: "start" | "middle" | "end";
      /** tabular-nums にするか（目盛りなど縦に揃える数字）。 */
      tabular?: boolean;
    });

export interface Scene {
  width: number;
  height: number;
  items: Item[];
  /** 読み上げ用の見出しと説明（テキスト化した図）。 */
  title: string;
  desc: string;
}

/** 上の角だけ丸い棒（下向きなら下の角）。 */
export function barPath(x: number, y: number, w: number, h: number, r: number, end: "top" | "bottom" | "right" | "left"): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const f = (n: number) => +n.toFixed(2);
  if (end === "top") {
    return `M${f(x)},${f(y + h)}V${f(y + rr)}Q${f(x)},${f(y)} ${f(x + rr)},${f(y)}H${f(x + w - rr)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + rr)}V${f(y + h)}Z`;
  }
  if (end === "bottom") {
    return `M${f(x)},${f(y)}V${f(y + h - rr)}Q${f(x)},${f(y + h)} ${f(x + rr)},${f(y + h)}H${f(x + w - rr)}Q${f(x + w)},${f(y + h)} ${f(x + w)},${f(y + h - rr)}V${f(y)}Z`;
  }
  if (end === "right") {
    return `M${f(x)},${f(y)}H${f(x + w - rr)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + rr)}V${f(y + h - rr)}Q${f(x + w)},${f(y + h)} ${f(x + w - rr)},${f(y + h)}H${f(x)}Z`;
  }
  return `M${f(x + w)},${f(y)}H${f(x + rr)}Q${f(x)},${f(y)} ${f(x)},${f(y + rr)}V${f(y + h - rr)}Q${f(x)},${f(y + h)} ${f(x + rr)},${f(y + h)}H${f(x + w)}Z`;
}
