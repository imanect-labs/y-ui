/**
 * 流れ図の後方互換の課題集（packages/core/test/fixtures/flow-compat.json）を作る。
 *   pnpm spec:flow
 * 評価で実際にモデルが書いた flow ブロック・課題集の正解・ドキュメントの例と、枠・強調の例を集め、
 * 解析結果・テキスト化と、描画（SVG・HTML・正規形のソース）のハッシュを記録する。
 * テスト（packages/core/test/flow-compat.test.ts）が、今のコードで同じ結果になるかを確かめる。
 * 描画を意図して変えたときだけ作り直し、差分で変わった図を確かめる。
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBlock, toSource, toText, type Figure } from "@imanect/yui";
import { toHTML } from "../packages/core/src/export.js";
import { renderSVG } from "@imanect/yui/svg";

const root = fileURLToPath(new URL("..", import.meta.url));

/** 枠・強調の例（新しい書き方の見た目も固定する）。 */
const EXTRA = [
  [
    "flow ToC 検索のパイプライン",
    "dir: LR",
    "subgraph Stage 1 — Input Preparation",
    "  Book (PDF/Text) -> ToC Extraction -> Synthetic QA Generation",
    "end",
    "subgraph Stage 2 — Training",
    "  C1[Concatenate ToC + Query] -> LLM Fine-tuning -> Target: ToC Leaf Node",
    "end",
    "subgraph Stage 3 — Inference",
    "  Query Input -> C2[Concatenate ToC + Query]",
    "  ToC -> C2",
    "  C2 -> Fine-tuned LLM -> **Constrained Generation** -> Predicted Leaf Node",
    "end",
    "ToC Extraction -> C1",
    "Synthetic QA Generation -> C1",
    "LLM Fine-tuning -> Fine-tuned LLM",
  ].join("\n"),
  "flow 入り組んだ例\ndir: LR\nsubgraph 受付\n  申込 -> 審査\nend\nsubgraph S2[処理]\n  手配 -> 発送\nend\nsubgraph 完了\n  請求\nend\n開始 -> 申込\n審査 -> 手配\n審査 -急ぎ-> 請求\n発送 -不備-> 申込\n請求 -> S2\n",
  "flow 見出しの枠\n## 前半\nStart -> A:::hot\n## 後半\nA -> B\nEnd\nstyle B fill:#f00\n",
];

/** ```ui ブロックの中身を取り出す（閉じていないものも末尾まで）。 */
function blocks(text: string): string[] {
  return [...text.matchAll(/```(?:ui|yui)[^\n]*\n([\s\S]*?)(?:```|$)/g)].map((m) => m[1]!);
}

function walk(dir: string, out: string[]): void {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsonl|md)$/.test(n)) out.push(p);
  }
}

const sources = new Set<string>();
const files: string[] = [];
walk(join(root, "eval"), files);
walk(join(root, "docs"), files);
files.push(join(root, "README.md"), join(root, "README.ja.md"));
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  if (!f.endsWith(".jsonl")) {
    for (const b of blocks(raw)) sources.add(b);
    continue;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (j.gold?.kind === "flow") sources.add(toSource(j.gold as Figure));
    const text = j.outcome?.text;
    if (typeof text === "string") for (const b of blocks(text)) sources.add(b);
  }
}
for (const s of EXTRA) sources.add(s);

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const cases = [...sources]
  .sort()
  .map((source) => ({ source, r: parseBlock(source, { final: true }) }))
  .filter(({ r }) => r.figure?.kind === "flow")
  .map(({ source, r }) => {
    const f = r.figure!;
    return {
      source,
      figure: f,
      diagnostics: r.diagnostics.map((d) => ({ line: d.line, code: d.code })),
      text: toText(f),
      hashes: {
        source: hash(toSource(f)),
        html: hash(toHTML(f)),
        svg640: hash(renderSVG(f, { width: 640, theme: "light" })),
        svg360: hash(renderSVG(f, { width: 360, theme: "light" })),
      },
    };
  });

const out = join(root, "packages/core/test/fixtures/flow-compat.json");
writeFileSync(out, `${JSON.stringify({ note: "scripts/flow-fixtures.ts で生成。既存の流れ図の解析・テキスト化・描画が変わっていないかを確かめる。", cases }, null, 1)}\n`);
console.log(`written ${out} (${cases.length} cases)`);
