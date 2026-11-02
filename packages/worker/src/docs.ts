/**
 * AI 向けの説明（`/llms.txt`・`/llms-full.txt`・`/guide/<種類>.md`）と、MCP の instructions。
 *
 * 書き方の本文は `@imanect/yui/guide` が単一の定義（docs/kinds.md と同じもの）。ここでは
 * 「画像として埋め込む」ための手順を足すだけ。
 */

import { type Kind, KINDS } from "@imanect/yui";
import { GUIDE_RULES, guideIndex, kindGuide, KIND_GUIDE } from "@imanect/yui/guide";

/** 画像にしても意味が無い（操作して使う）種類。描けはするが、AI には勧めない。 */
const INTERACTIVE: readonly Kind[] = ["calc", "app", "ask", "plan"];
export const IMAGE_KINDS: readonly Kind[] = KINDS.filter((k) => !INTERACTIVE.includes(k));

export const SERVER_NAME = "yui";
export const SERVER_VERSION = "0.1.0";

const WORKFLOW = [
  "1. 早見から図の種類を 1 つ選ぶ（図にする必要が無ければ文章だけで答える）。",
  "2. `get_kind_guide` でその種類の書き方を読む（作例と上限が載っている）。",
  "3. ```ui ブロックのソースを書いて `render_ui` に渡す。診断が出たら直して、もう一度渡す。",
  "4. `render_ui` が返した Markdown を、そのまま回答や .md ファイルに貼る。画像の URL は自分で作らない（ソースを圧縮して符号化したもので、手では作れない）。",
  "既にある Markdown の ```ui ブロックにまとめて画像を付けるときは `embed_markdown` を使う。",
].join("\n");

/** MCP の instructions（クライアントがシステムプロンプトに入れる）。 */
export function mcpInstructions(): string {
  return [
    "Yui（結）は Markdown の ```ui ブロックに図を書く小さな記法です。このサーバーはソースを図の画像（SVG）にし、GitHub の README など、コードを実行しない Markdown にも図を貼れるようにします。",
    "",
    "手順:",
    WORKFLOW,
    "",
    "書き方の決まり:",
    GUIDE_RULES,
    "",
    "種類の早見:",
    guideIndex({ kinds: IMAGE_KINDS }),
  ].join("\n");
}

/** `/llms.txt`（https://llmstxt.org の形）。 */
export function llmsTxt(base: string): string {
  return [
    "# Yui（結）の図を画像で埋め込む",
    "",
    "> Markdown の ```ui ブロックに書いた図のソースを SVG 画像にするサービス。GitHub の README・Issue・Wiki など、コードを実行しない Markdown でも図を見せられる。図の配置・配色は描く側が決めるので、書くのはデータだけ。",
    "",
    "## 使い方",
    "",
    `- MCP（Streamable HTTP）: \`${base}/mcp\` — ツール \`list_kinds\` \`get_kind_guide\` \`render_ui\` \`embed_markdown\``,
    "- 画像の URL は `" + base + "/svg/<コード>` で、コードはソースを deflate-raw で圧縮して base64url（詰め物なし）にしたもの。手では作れないので、MCP の `render_ui` か CLI（`npx @imanect/yui-embed --base " + base + " README.md`）で作る。",
    "- 配色は `?theme=light`（既定）・`dark`・`auto`（閲覧者の OS の明暗に従う・背景は透明）。` ```ui bar ` のように種類をフェンスに書いたときは `?kind=bar`。",
    "",
    "手順:",
    WORKFLOW,
    "",
    "## 書き方の決まり",
    "",
    GUIDE_RULES,
    "",
    "## 種類の早見",
    "",
    guideIndex({ kinds: IMAGE_KINDS }),
    "",
    "## 種類ごとの書き方",
    "",
    ...IMAGE_KINDS.map((k) => `- [${k} ${KIND_GUIDE[k].name}](${base}/guide/${k}.md)`),
    "",
    "## Optional",
    "",
    `- [すべての種類の書き方を 1 つにしたもの](${base}/llms-full.txt)`,
    "- [記法の仕様とソース](https://github.com/imanect-labs/y-ui)",
    "",
  ].join("\n");
}

/** `/llms-full.txt`: llms.txt に全種類の書き方を足したもの。 */
export function llmsFullTxt(base: string): string {
  return [llmsTxt(base).replace(/\n## 種類ごとの書き方[\s\S]*$/, ""), "", "## 種類ごとの書き方", "", ...IMAGE_KINDS.map((k) => `${kindGuide(k).replace(/^## /, "### ")}\n`)].join("\n");
}

export { kindGuide };
