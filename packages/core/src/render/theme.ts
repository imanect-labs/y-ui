/**
 * 配色。地と文字は青みのあるニュートラル、系列は四季の色相（冬・秋・夏・紺・春…）を
 * 彩度を抑えて並べたもの。系列の 8 色は明暗それぞれ、色覚多様性のシミュレーションで
 * 隣り合う色が区別できること（ΔE ≥ 8）と、通常の見え方での差（ΔE ≥ 15）を検証している。
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
  surface: "#fcfcfc",
  surface2: "#f6f6f8",
  ink: "#18181b",
  ink2: "#4c4c54",
  muted: "#71717a",
  grid: "#e4e4e7",
  axis: "#cdcdd2",
  border: "#dddde1",
  accentWash: "#eff4fc",
  accentLine: "#b2bed5",
  s1: "#398cb8", // 冬（雪空）
  s2: "#cc7d49", // 秋（紅葉）
  s3: "#1e7751", // 夏（新緑）
  s4: "#395490", // 紺
  s5: "#c1707e", // 春（桜）
  s6: "#cca754", // 山吹
  s7: "#2ca59f", // 青磁
  s8: "#944b39", // 鳶
};

export const DARK: Palette = {
  surface: "#0d0d0f",
  surface2: "#161619",
  ink: "#f2f2f2",
  ink2: "#bdbdc3",
  muted: "#a1a1a8",
  grid: "#212124",
  axis: "#37373b",
  border: "#2b2b2e",
  accentWash: "#171d27",
  accentLine: "#3d4d6b",
  s1: "#4d9ac8",
  s2: "#c5804c",
  s3: "#1a7854",
  s4: "#3e62a8",
  s5: "#a75864",
  s6: "#b48c2c",
  s7: "#179a94",
  s8: "#a15744",
};

export const SERIES: Token[] = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];

export const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';

/**
 * 画面用の既定値を CSS で定義する。明暗は次の順に決める。
 * - ページが明示していれば従う: `<html class="dark">`（Tailwind・next-themes など）か `<html data-theme="dark">`
 * - 明示が無ければ OS の設定（prefers-color-scheme）
 * 各色は `var(--yui-<token>, var(--yui-default-<token>))` で参照し、ホストの上書きを優先する。
 * 文字は `--yui-font` があればそれを使う（埋め込み先と揃えたいとき）。
 */
export function themeCss(scope: string): string {
  const decl = (p: Palette) => TOKENS.map((t) => `--yui-default-${t}:${p[t]}`).join(";");
  const explicitLight = `:root:where(:not([data-theme="light"]):not(.light))`;
  return [
    `${scope}{${decl(LIGHT)};font-family:var(--yui-font,${FONT.replace(/"/g, "'")})}`,
    `@media (prefers-color-scheme: dark){${explicitLight} ${scope}{${decl(DARK)}}}`,
    `:root:where([data-theme="dark"],.dark) ${scope}{${decl(DARK)}}`,
  ].join("");
}

export type ThemeMode = "auto" | "light" | "dark";

/** トークンを塗りの値にする。auto は CSS 変数、light / dark は焼き込み。 */
export function paint(token: Token, mode: ThemeMode): string {
  if (mode === "light") return LIGHT[token];
  if (mode === "dark") return DARK[token];
  return `var(--yui-${token}, var(--yui-default-${token}))`;
}
