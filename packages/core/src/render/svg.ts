/**
 * シーンを SVG の文字列にする。
 *
 * - theme: "auto"（画面向け。CSS 変数で色を参照し、OS とページの明暗に追従。幅は親に合わせて伸縮）
 * - theme: "light" / "dark"（書き出し向け。色と寸法を焼き込む。CSS 変数を解釈しない描画系でも同じ見た目）
 *
 * 文字はすべてエスケープする。外部の画像・スクリプト・リンクは出力しない。
 */

import type { Figure } from "../ir.js";
import { layout, type LayoutOptions } from "./layout.js";
import type { Item, Scene } from "./scene.js";
import { FONT, paint, themeCss, type ThemeMode, type Token } from "./theme.js";

export interface SvgOptions extends LayoutOptions {
  theme?: ThemeMode;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => +v.toFixed(2);

/** 同じ内容なら同じ id になるようにする（出力を決定的にし、同じページに複数置いても衝突しにくく）。 */
function hashId(scene: Scene): string {
  let h = 5381;
  const src = `${scene.width}x${scene.height}|${scene.items.length}|${scene.desc}`;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  return `yui${h.toString(36)}`;
}

/** 色の指定。auto は style 属性（CSS 変数）、焼き込みは属性。 */
function colorAttrs(mode: ThemeMode, props: { fill?: Token | "none"; stroke?: Token }): string {
  if (mode === "auto") {
    const css: string[] = [];
    if (props.fill) css.push(`fill:${props.fill === "none" ? "none" : paint(props.fill, mode)}`);
    if (props.stroke) css.push(`stroke:${paint(props.stroke, mode)}`);
    return css.length ? ` style="${css.join(";")}"` : "";
  }
  let a = "";
  if (props.fill) a += ` fill="${props.fill === "none" ? "none" : paint(props.fill, mode)}"`;
  if (props.stroke) a += ` stroke="${paint(props.stroke, mode)}"`;
  return a;
}

function item(it: Item, mode: ThemeMode, arrowId: string): string {
  const title = it.hint ? `<title>${esc(it.hint)}</title>` : "";
  const op = it.opacity !== undefined ? ` opacity="${it.opacity}"` : "";
  const wrapTitle = (open: string, selfClose: string) => (title ? `${open}>${title}</${selfClose}>` : `${open}/>`);
  switch (it.t) {
    case "rect": {
      const sw = it.stroke ? ` stroke-width="${it.strokeWidth ?? 1}"` : "";
      return wrapTitle(`<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(Math.max(0, it.w))}" height="${n(Math.max(0, it.h))}"${it.r ? ` rx="${n(it.r)}"` : ""}${colorAttrs(mode, { fill: it.fill, ...(it.stroke ? { stroke: it.stroke } : {}) })}${sw}${op}`, "rect");
    }
    case "circle": {
      const sw = it.stroke ? ` stroke-width="${it.strokeWidth ?? 1}"` : "";
      return wrapTitle(`<circle cx="${n(it.cx)}" cy="${n(it.cy)}" r="${n(it.r)}"${colorAttrs(mode, { fill: it.fill, ...(it.stroke ? { stroke: it.stroke } : {}) })}${sw}${op}`, "circle");
    }
    case "path": {
      const stroke = it.stroke ? ` stroke-width="${it.strokeWidth ?? 1}" stroke-linecap="round" stroke-linejoin="round"` : "";
      const dash = it.dash ? ` stroke-dasharray="${it.dash}"` : "";
      const arrow = it.arrow ? ` marker-end="url(#${arrowId})"` : "";
      return wrapTitle(`<path d="${it.d}"${colorAttrs(mode, { fill: it.fill ?? "none", ...(it.stroke ? { stroke: it.stroke } : {}) })}${stroke}${dash}${arrow}${op}`, "path");
    }
    case "text": {
      const anchor = it.anchor && it.anchor !== "start" ? ` text-anchor="${it.anchor}"` : "";
      const weight = it.weight ? ` font-weight="${it.weight}"` : "";
      const tab = it.tabular ? ` font-variant-numeric="tabular-nums"` : "";
      return `<text x="${n(it.x)}" y="${n(it.y)}" font-size="${it.size}"${weight}${anchor}${tab}${colorAttrs(mode, { fill: it.fill })}${op}>${esc(it.text)}${title}</text>`;
    }
  }
}

export function sceneToSVG(scene: Scene, theme: ThemeMode = "auto"): string {
  const id = hashId(scene);
  const arrowId = `${id}-arrow`;
  const size = theme === "auto" ? `width="100%" style="max-width:${scene.width}px;height:auto;display:block"` : `width="${scene.width}" height="${scene.height}"`;
  const titleId = `${id}-t`;
  const descId = `${id}-d`;
  const bg = theme === "auto" ? "" : `<rect width="100%" height="100%"${colorAttrs(theme, { fill: "surface" })}/>`;
  const style = theme === "auto" ? `<style>${themeCss(`.${id}`)}</style>` : "";
  const marker = `<defs><marker id="${arrowId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1,1L9,5L1,9Z"${colorAttrs(theme, { fill: "muted" })}/></marker></defs>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="${id}" viewBox="0 0 ${scene.width} ${scene.height}" ${size} role="img" aria-labelledby="${titleId} ${descId}" font-family='${FONT}'>`,
    `<title id="${titleId}">${esc(scene.title)}</title><desc id="${descId}">${esc(scene.desc)}</desc>`,
    style,
    marker,
    bg,
    ...scene.items.map((it) => item(it, theme, arrowId)),
    "</svg>",
  ].join("");
}

/** 図を SVG にする。 */
export function renderSVG(figure: Figure, opts: SvgOptions = {}): string {
  return sceneToSVG(layout(figure, opts), opts.theme ?? "auto");
}
