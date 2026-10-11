import { describe, expect, it } from "vitest";
import { parseBlock, parseMarkdown, splitMarkdown, toSource, toText, transformMarkdown, type Figure } from "../src/index.js";

const doc = [
  "売上は次の通りです。",
  "",
  "```ui",
  "bar 売上 [1]",
  "月 | 金額",
  "1月 | 100",
  "```",
  "",
  "```ts",
  "const x = '```ui';",
  "```",
  "",
  "以上です。",
].join("\n");

describe("splitMarkdown", () => {
  it("ui ブロックだけを切り出し、他言語のコードブロックはそのまま", () => {
    const segs = splitMarkdown(doc);
    expect(segs.map((s) => s.type)).toEqual(["markdown", "ui", "markdown"]);
    const ui = segs[1]!;
    if (ui.type !== "ui") throw new Error();
    expect(ui.closed).toBe(true);
    expect(ui.source).toBe("bar 売上 [1]\n月 | 金額\n1月 | 100\n");
    expect(segs[2]!.type === "markdown" && segs[2]!.text.includes("const x")).toBe(true);
  });

  it("情報文字列の種類指定と長いフェンス", () => {
    const segs = splitMarkdown("~~~~ui:flow\nA -> B\n~~~~\n");
    expect(segs[0]).toMatchObject({ type: "ui", kind: "flow", closed: true });
  });

  it("ストリーミング中の閉じていないブロック", () => {
    const partial = "説明\n```ui\nbar 売上\n月 | 金額\n1月 | 100\n2月 | 1";
    const segs = parseMarkdown(partial);
    const ui = segs[1];
    if (!ui || ui.type !== "ui") throw new Error();
    expect(ui.closed).toBe(false);
    expect(ui.result.pending).toBe(true);
    expect(ui.result.figure && "rows" in ui.result.figure && ui.result.figure.rows.length).toBe(1);
    // ストリーム終了で確定させれば最終行も読む
    const done = parseMarkdown(partial, { final: true })[1];
    expect(done?.type === "ui" && done.result.figure && "rows" in done.result.figure && done.result.figure.rows.length).toBe(2);
  });
});

describe("toSource は parseBlock の逆", () => {
  const sources = [
    "bar 売上 [1]\nunit: 万円\nstacked: true\n月 | 売上 | 利益\n1月 | 120 | 30 [2]\n2月 | 150 | -\nnote: 速報\n",
    "line 推移\n項目 | 値\nA | 1.5\n",
    "stat 実績\n売上 | 320万円 | 前年比 +18%\n顧客数 | 1,240人 [3]\n",
    "flow 承認\ndir: LR\n申請 -> 課長承認\n課長承認 -却下-> 申請\n孤立\n",
    "stack 構成\n- Web: フロント\n↓ HTTPS\n- API\n  - 認証\n  - 検索: 全文\n- DB | Cache: Redis\nnote: 論理構成\n",
  ];
  it.each(sources)("%s", (src) => {
    const f1 = parseBlock(src, { final: true }).figure as Figure;
    const f2 = parseBlock(toSource(f1), { final: true }).figure;
    expect(f2).toEqual(f1);
  });
});

describe("toText", () => {
  it("グラフは表、構成図は入れ子リスト", () => {
    const bar = parseBlock("bar 売上 [1]\nunit: 万円\n月 | 金額\n1月 | 1200\n", { final: true }).figure!;
    expect(toText(bar)).toBe("**売上 [1]**\n\n| 月 | 金額 |\n| --- | ---: |\n| 1月 | 1,200 |\n\n（単位: 万円）");
    const stack = parseBlock("stack 構成\n- Web\n↓ HTTPS\n- API: 本体\n  - 認証\n- DB | Cache\n", { final: true }).figure!;
    expect(toText(stack)).toBe("**構成**\n\n- Web\n  ↓ HTTPS\n- API（本体）\n  - 認証\n  ↓\n- DB ／ Cache");
  });

  it("transformMarkdown は解析できないブロックを残す", () => {
    const md = "前\n```ui\npie x\n```\n後\n```ui\nflow\nA -> B\n```";
    expect(transformMarkdown(md, "text")).toBe("前\n```ui\npie x\n```\n後\n- A → B");
  });
});
