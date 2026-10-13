/**
 * シーン: レイアウトの結果（箱・線・文字の並び）。SVG にも React にも、この 1 つから描く。
 * 色はトークンで持ち、出力のときに CSS 変数か焼き込みの色にする。
 */

import type { Token } from "./theme.js";

interface Common {
  /** マウスを載せたときの説明（SVG の <title>）。 */
  hint?: string;
  opacity?: number;
  /** 強調のまとまり。ホバー中は、対象の keep に無いまとまりの要素を薄くする（まとまりの無い要素はそのまま）。 */
  group?: string;
}

/** ツールチップの 1 行（系列名と値）。 */
export interface TipRow {
  label: string;
  value: string;
  /** 系列の色（行頭の印）。 */
  token?: Token;
}

/**
 * ホバー・フォーカスの対象（画面用。書き出しの SVG には出さない）。
 * 当たり判定・強調するまとまり・ツールチップの中身を、レイアウトと同じ座標で持つ。
 */
export interface Target {
  /** 当たり判定。 */
  hit: { x: number; y: number; w: number; h: number };
  /** 強調するまとまり（これ以外のまとまりを薄くする）。空なら何も薄くしない。 */
  keep: string[];
  /** ツールチップ。x, y は指す位置（マークの上端の中央）。無ければ強調だけ。 */
  tip?: { title: string; rows: TipRow[]; footer?: string; x: number; y: number };
  /** 縦の補助線（折れ線）。 */
  guide?: { x: number; y1: number; y2: number };
  /** 大きくして強調する点（折れ線）。 */
  points?: { x: number; y: number; token: Token }[];
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
  /** ホバー・フォーカスの対象（画面用）。 */
  targets: Target[];
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
