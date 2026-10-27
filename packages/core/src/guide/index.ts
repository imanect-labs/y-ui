/**
 * LLM 向けの書き方（`@imanect/yui/guide`）。
 *
 * ホスト（Shiki など）は、システムプロンプトに種類の早見（[`guideIndex`]）と共通の決まり
 * （[`GUIDE_RULES`]）だけを置き、種類ごとの書き方（[`kindGuide`]）はモデルが図を書く前に
 * ツールで読み込む。27 種類の書き方を全部載せるより短く、評価では品質も落ちなかった
 * （docs/eval-results-2026-10-13-luna.md の方式 H）。早見を置かないと、どの種類を使うかの
 * 判断が落ちる（同じ評価の方式 G）ので、早見はプロンプトに常に載せる。
 *
 * 文はすべて日本語。説明は [`KIND_GUIDE`]、作例は [`SAMPLES`] が単一の定義で、
 * docs/kinds.md も同じものから作る。
 */

import type { Kind } from "../ir.js";
import { COMMON_OPTIONS, KIND_GROUPS, KIND_GUIDE } from "./kinds.js";
import { SAMPLES } from "./samples.js";

export { COMMON_OPTIONS, KIND_GROUPS, KIND_GUIDE, type KindGuide } from "./kinds.js";
export { SAMPLES } from "./samples.js";

/** どの種類にも当てはまる書き方の決まり（Markdown の箇条書き）。 */
export const GUIDE_RULES = [
  "- ```ui ブロックの 1 行目は「種類 タイトル」、2 行目以降にデータを書く。種類は早見にあるものだけ。",
  "- 書くのはデータだけ。色・配置・大きさは書かない（描き方は表示側が決める）。HTML・JSON・コードも書かない。",
  "- 図の下に注記を付けるなら `note: 注記`。",
].join("\n");

export interface GuideIndexOptions {
  /** 早見に載せる種類（既定はすべて）。ホストが扱わない種類を外すときに使う。並びは用途のまとまりの順のまま。 */
  kinds?: readonly Kind[];
}

/** 用途の最初の 1 文（句点まで）。 */
function firstSentence(text: string): string {
  return text.split("。")[0] ?? text;
}

/**
 * 種類の早見（用途のまとまりごとに 1 種類 1 行）。モデルが「どの種類を使うか」を決める材料。
 *
 * ```text
 * グラフ:
 * - `bar` 棒グラフ: 項目や時期ごとの数値の比較
 * …
 * ```
 */
export function guideIndex(options: GuideIndexOptions = {}): string {
  const only = options.kinds ? new Set<Kind>(options.kinds) : null;
  const out: string[] = [];
  for (const group of KIND_GROUPS) {
    const kinds = group.kinds.filter((k) => !only || only.has(k));
    if (kinds.length === 0) continue;
    out.push(`${group.title}:`);
    for (const k of kinds) {
      const g = KIND_GUIDE[k];
      out.push(`- \`${k}\` ${g.name}: ${firstSentence(g.use)}`);
    }
  }
  return out.join("\n");
}

/**
 * 種類ごとの書き方（用途・書き方・オプション行・上限・使い分け・作例）。図を書く前に読み込ませる。
 *
 * オプション行には共通の `note:` を含め、ホストが解決する `src:` は含めない（モデルに書かせない）。
 */
export function kindGuide(kind: Kind): string {
  const g = KIND_GUIDE[kind];
  const options = [...g.options, COMMON_OPTIONS[0]];
  const out: string[] = [`## ${kind} ${g.name}`, g.use, "", "書き方:", ...g.syntax.map((s) => `- ${s}`)];
  out.push(`- オプション行: ${options.join("、")}`);
  out.push(`- 上限: ${g.limits.join("、")}`);
  if (g.instead) out.push(`- 使い分け: ${g.instead}`);
  out.push("", "例:", "```ui", SAMPLES.ja[kind].trimEnd(), "```");
  return out.join("\n");
}
