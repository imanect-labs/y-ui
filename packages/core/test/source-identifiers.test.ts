import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * 引用符の無いキー・名前に、新しい Unicode でだけ識別子に使える文字を入れない。
 * `・`（U+30FB）と `･`（U+FF65）は Unicode 15.1 で識別子の文字になったため、Node では読めても、
 * 古い表を持つツール（Next.js の SWC など）は構文エラーにする（0.8.0 の `メリット・デメリット:`）。
 * 出力の JS はキーを書いたとおりに残すので、ソースの段階で止める。
 */
const NEW_ID_CHARS = /[・･]/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("ソースの識別子", () => {
  it("引用符の無いキー・名前に ・ と ･ を使わない（使うなら引用符で囲む）", () => {
    const bad: string[] = [];
    for (const file of sources(join(__dirname, "../src"))) {
      const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node) && NEW_ID_CHARS.test(node.text)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          bad.push(`${file}:${line + 1} ${node.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(bad).toEqual([]);
  });
});
