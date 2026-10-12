/**
 * 配色。dataviz の検証済み参照パレット（カテゴリ 8 色・明暗それぞれ）を既定にする。
 * 画面では CSS 変数（`--yui-*`）でホストが上書きでき、書き出しでは色を焼き込む。
 */

export const TOKENS = [
  "surface", // 図の背景
  "surface2", // 層・カードの塗り
  "ink", // 主な文字
  "ink2", // 補助の文字
  "muted", // 軸・注記
  "grid", // 目盛り線
  "axis", // 基線・矢印
  "border", // 箱の枠
  "accentWash", // 強調する層の塗り
  "accentLine", // 強調する層の枠
  "s1",
  "s2",
  "s3",
  "s4",
  "s5",
  "s6",
  "s7",
  "s8",
] as const;
export type Token = (typeof TOKENS)[number];

export type Palette = Record<Token, string>;

export const LIGHT: Palette = {
  surface: "#fcfcfb",
  surface2: "#f3f2ef",
  ink: "#0b0b0b",
  ink2: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  border: "#dddcd5",
  accentWash: "#eef4fc",
  accentLine: "#b7d3f6",
  s1: "#2a78d6",
  s2: "#eb6834",
  s3: "#1baf7a",
  s4: "#eda100",
  s5: "#e87ba4",
  s6: "#008300",
  s7: "#6250d6",
  s8: "#e34948",
};

export const DARK: Palette = {
  surface: "#1a1a19",
  surface2: "#262624",
  ink: "#f0efec",
  ink2: "#c3c2b7",
  muted: "#898781",
  grid: "#2c2c2a",
  axis: "#383835",
  border: "#3a3a37",
  accentWash: "#1d2a3a",
  accentLine: "#2f4f78",
  s1: "#3987e5",
  s2: "#d95926",
  s3: "#199e70",
  s4: "#c98500",
  s5: "#d55181",
  s6: "#008300",
  s7: "#9085e9",
  s8: "#e66767",
};

export const SERIES: Token[] = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];

export const FONT = 'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif';

/**
 * 画面用の既定値を CSS で定義する（OS の設定と、ページの data-theme の両方に従う）。
 * 各色は `var(--yui-<token>, var(--yui-default-<token>))` で参照し、ホストの上書きを優先する。
 */
export function themeCss(scope: string): string {
  const decl = (p: Palette) => TOKENS.map((t) => `--yui-default-${t}:${p[t]}`).join(";");
  return [
    `${scope}{${decl(LIGHT)}}`,
    `@media (prefers-color-scheme: dark){:root:where(:not([data-theme="light"])) ${scope}{${decl(DARK)}}}`,
    `:root[data-theme="dark"] ${scope}{${decl(DARK)}}`,
  ].join("");
}

export type ThemeMode = "auto" | "light" | "dark";

/** トークンを塗りの値にする。auto は CSS 変数、light / dark は焼き込み。 */
export function paint(token: Token, mode: ThemeMode): string {
  if (mode === "light") return LIGHT[token];
  if (mode === "dark") return DARK[token];
  return `var(--yui-${token}, var(--yui-default-${token}))`;
}
