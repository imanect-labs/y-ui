import { describe, expect, it } from "vitest";
import { CodeError, decodeSource, embedMarkdown, embedSource, encodeSource, END, imageUrl, MAX_SOURCE_BYTES, START } from "../src/index.js";

const BASE = "https://yui.example.dev/";
const BAR = "bar 四半期ごとの売上\nunit: 百万円\n四半期 | 売上\nQ1 | 120\nQ2 | 150\n";
const DOC = `# 報告\n\n本文。\n\n\`\`\`ui\n${BAR}\`\`\`\n\nおわり。\n`;

describe("コード", () => {
  it("ソースを往復できる（日本語・記号を含む）", async () => {
    const code = await encodeSource(BAR);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeSource(code)).toBe(BAR);
  });

  it("同じソースは同じコードになる", async () => {
    expect(await encodeSource(BAR)).toBe(await encodeSource(BAR));
  });

  it("壊れたコードは CodeError", async () => {
    await expect(decodeSource("")).rejects.toBeInstanceOf(CodeError);
    await expect(decodeSource("a+b")).rejects.toBeInstanceOf(CodeError);
    await expect(decodeSource("AAAAAAAA")).rejects.toBeInstanceOf(CodeError);
  });

  it("展開すると大きすぎるコード（圧縮爆弾）は止める", async () => {
    const big = "a".repeat(MAX_SOURCE_BYTES * 4);
    const stream = new Blob([big]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const code = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await expect(decodeSource(code)).rejects.toThrow(/大きすぎ/);
  });
});

describe("画像の URL", () => {
  it("基点の末尾の / を落とし、既定の配色は付けない", async () => {
    const url = await imageUrl(BAR, { base: BASE });
    expect(url).toMatch(/^https:\/\/yui\.example\.dev\/svg\/[A-Za-z0-9_-]+$/);
  });

  it("種類と配色はクエリで渡す", async () => {
    const url = await imageUrl(BAR, { base: BASE, kind: "bar", theme: "auto" });
    expect(url).toMatch(/\?kind=bar&theme=auto$/);
  });

  it("http(s) 以外の基点は受け付けない", async () => {
    await expect(imageUrl(BAR, { base: "javascript:alert(1)" })).rejects.toThrow();
  });
});

describe("embedMarkdown", () => {
  it("ブロックを画像と畳んだソースで囲む", async () => {
    const res = await embedMarkdown(DOC, { base: BASE });
    expect(res.changed).toBe(true);
    const url = await imageUrl(BAR, { base: BASE });
    expect(res.text).toBe(
      `# 報告\n\n本文。\n\n${START}\n![bar 四半期ごとの売上](${url})\n\n<details><summary>図のソース</summary>\n\n\`\`\`ui\n${BAR}\`\`\`\n\n</details>\n${END}\n\nおわり。\n`,
    );
    expect(res.blocks).toEqual([{ line: 5, kind: "bar", title: "四半期ごとの売上", url, diagnostics: [] }]);
  });

  it("何度かけても同じ（2 回目は変更なし）", async () => {
    const once = await embedMarkdown(DOC, { base: BASE });
    const twice = await embedMarkdown(once.text, { base: BASE });
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once.text);
  });

  it("ソースを直すと画像の URL だけが変わる", async () => {
    const once = (await embedMarkdown(DOC, { base: BASE })).text;
    const edited = once.replace("Q2 | 150", "Q2 | 180");
    const res = await embedMarkdown(edited, { base: BASE });
    expect(res.changed).toBe(true);
    expect(res.text.split(START)).toHaveLength(2);
    expect(res.text).toContain(await imageUrl(BAR.replace("150", "180"), { base: BASE }));
    expect(res.text).not.toContain(await imageUrl(BAR, { base: BASE }));
  });

  it("畳む・畳まないを切り替えても囲みは 1 つのまま", async () => {
    const folded = (await embedMarkdown(DOC, { base: BASE })).text;
    const open = await embedMarkdown(folded, { base: BASE, fold: false });
    expect(open.text).not.toContain("<details>");
    expect(open.text.split(START)).toHaveLength(2);
    const back = await embedMarkdown(open.text, { base: BASE });
    expect(back.text).toBe(folded);
  });

  it("他の言語のコードブロックの中の ```ui は触らない", async () => {
    const doc = `\`\`\`\`md\n\`\`\`ui\n${BAR}\`\`\`\n\`\`\`\`\n`;
    const res = await embedMarkdown(doc, { base: BASE });
    expect(res.changed).toBe(false);
    expect(res.blocks).toHaveLength(0);
  });

  it("情報文字列の種類（```ui bar）を URL に渡す", async () => {
    const doc = "```ui bar\n売上\n月 | 売上\n1月 | 120\n```\n";
    const res = await embedMarkdown(doc, { base: BASE });
    expect(res.blocks[0]!.url).toMatch(/\?kind=bar$/);
  });

  it("字下げしたブロック（リストの中）は付ける行も下げる", async () => {
    const doc = `- 項目\n\n   \`\`\`ui\n   stat 実績\n   売上 | 100万円\n   \`\`\`\n`;
    const res = await embedMarkdown(doc, { base: BASE });
    const lines = res.text.split("\n");
    expect(lines[2]).toBe(`   ${START}`);
    expect(lines.filter((l) => l.includes("</details>"))).toEqual(["   </details>"]);
    expect((await embedMarkdown(res.text, { base: BASE })).changed).toBe(false);
  });

  it("CRLF の文書は CRLF のまま", async () => {
    const res = await embedMarkdown(DOC.replace(/\n/g, "\r\n"), { base: BASE });
    expect(res.text).not.toMatch(/[^\r]\n/);
    expect((await embedMarkdown(res.text, { base: BASE })).changed).toBe(false);
  });

  it("閉じていない・図にできないブロックは飛ばして理由を返す", async () => {
    const doc = "```ui\nfoo bar\n```\n\n```ui\nbar x\n";
    const res = await embedMarkdown(doc, { base: BASE });
    expect(res.changed).toBe(false);
    expect(res.blocks.map((b) => b.skipped)).toEqual(["unparsable", "unclosed"]);
  });

  it("見出しの角括弧は代替テキストでエスケープする", async () => {
    const doc = "```ui\nstat [速報] 実績\n売上 | 100万円\n```\n";
    const res = await embedMarkdown(doc, { base: BASE });
    expect(res.text).toContain("![stat \\[速報\\] 実績](");
  });
});

describe("embedSource", () => {
  it("1 つのソースから貼り付け用の Markdown を作る", async () => {
    const res = await embedSource(BAR, { base: BASE });
    expect(res.url).toBe(await imageUrl(BAR, { base: BASE }));
    expect(res.markdown!.startsWith(`${START}\n![bar 四半期ごとの売上](`)).toBe(true);
    expect(res.markdown).toContain(`\`\`\`ui\n${BAR}\`\`\``);
    // 作った Markdown にもう一度かけても変わらない
    expect((await embedMarkdown(res.markdown!, { base: BASE })).changed).toBe(false);
  });

  it("図にできないソースは URL を返さない", async () => {
    const res = await embedSource("foo bar\n", { base: BASE });
    expect(res.url).toBeUndefined();
    expect(res.result.figure).toBeNull();
  });
});
