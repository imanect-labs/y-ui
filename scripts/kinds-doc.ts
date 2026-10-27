/**
 * 図の種類の一覧（docs/kinds.md）を作る。
 *   pnpm docs:kinds
 * 種類・別名はコード（KINDS・KIND_ALIASES）、用途・書き方・上限・使い分け・例は
 * `@imanect/yui/guide`（KIND_GUIDE・SAMPLES。LLM 向けの書き方と同じ定義）から取る。
 * docs/kinds.md は直接編集しない
 * （テスト packages/core/test/kinds-doc.test.ts が、生成し直した内容と一致するかを確かめる）。
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KIND_ALIASES, KINDS, type Kind } from "@imanect/yui";
import { COMMON_OPTIONS, KIND_GROUPS, KIND_GUIDE, SAMPLES } from "@imanect/yui/guide";

/** GitHub の見出しのアンカー（小文字・記号を除く・空白を - に）。 */
function anchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function aliasesOf(kind: Kind): string[] {
  return Object.entries(KIND_ALIASES)
    .filter(([alias, k]) => k === kind && alias !== kind)
    .map(([alias]) => alias);
}

export function renderKindsDoc(): string {
  const listed = KIND_GROUPS.flatMap((g) => g.kinds);
  const missing = KINDS.filter((k) => !listed.includes(k));
  if (missing.length) throw new Error(`一覧に無い種類があります: ${missing.join(", ")}`);

  const out: string[] = [
    "# 図の種類の一覧",
    "",
    "<!-- scripts/kinds-doc.ts が生成する。直接編集しない（pnpm docs:kinds で作り直す）。 -->",
    "",
    `Yui が描ける図は ${KINDS.length} 種類。どれも Markdown の ` + "` ```ui `" + " ブロックに、1 行目「種類 タイトル」、2 行目以降にデータを書く。",
    "配置・色・目盛りはレンダラーが決めるので、記法に見た目の指定は無い。共通の書き方（ブロック・1 行目・引用番号・数値の読み方）は [spec.md](spec.md) の §2〜§4・§6 を参照。",
    "",
    "## 早見表",
    "",
    "| 種類 | 名前 | 用途 | 別名 |",
    "|---|---|---|---|",
  ];
  for (const g of KIND_GROUPS) {
    for (const k of g.kinds) {
      const i = KIND_GUIDE[k];
      out.push(`| [\`${k}\`](#${anchor(`${k} ${i.name}`)}) | ${i.name} | ${i.use.split("。")[0]} | ${aliasesOf(k).map((a) => `\`${a}\``).join(" ")} |`);
    }
  }
  out.push("", "1 行目の種類は、表の種類名か別名のどれで書いてもよい（`棒グラフ 売上`、`ui bar` のように情報文字列に書いてもよい）。", "");

  for (const g of KIND_GROUPS) {
    out.push(`## ${g.title}`, "");
    for (const k of g.kinds) {
      const i = KIND_GUIDE[k];
      out.push(`### ${k} ${i.name}`, "", i.use, "", `<img src="images/ja-${k}.png" width="640" alt="${k}">`, "");
      out.push("````md", "```ui", SAMPLES.ja[k].trimEnd(), "```", "````", "");
      out.push("**書き方**", "", ...i.syntax.map((s) => `- ${s}`), "");
      out.push(`**オプション行**: ${[...i.options, ...COMMON_OPTIONS].join("、")}`, "");
      out.push(`**上限**: ${i.limits.join("、")}`, "");
      const al = aliasesOf(k);
      if (al.length) out.push(`**別名**: ${al.map((a) => `\`${a}\``).join(" ")}`, "");
      if (i.instead) out.push(`**使い分け**: ${i.instead}`, "");
      const link = k === "calc" ? `[spec.md §${i.spec}](spec.md#${anchor(i.spec)})、[calc.md](calc.md)` : `[spec.md §${i.spec}](spec.md#${anchor(i.spec)})`;
      out.push(`**仕様**: ${link}`, "");
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}

export const KINDS_DOC_PATH = fileURLToPath(new URL("../docs/kinds.md", import.meta.url));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(KINDS_DOC_PATH, renderKindsDoc());
  console.log(`written ${KINDS_DOC_PATH}`);
}
