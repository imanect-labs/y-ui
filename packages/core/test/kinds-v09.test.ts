import { describe, expect, it } from "vitest";
import { parseBlock, toSource, toText, type ChecklistFigure, type CompareFigure, type Figure, type ProsConsFigure, type SwotFigure } from "../src/index.js";
import { toHTML } from "../src/export.js";
import { layout } from "../src/svg.js";

const parse = (src: string) => parseBlock(src, { final: true });
const fig = <T extends Figure>(src: string) => parse(src).figure as T;
const roundTrip = (f: Figure) => expect(parse(toSource(f)).figure).toEqual(f);
/** 描画して、全文の中に words がすべて出ているか。 */
const drawn = (f: Figure, width = 640) =>
  layout(f, { width })
    .items.filter((i) => i.t === "text")
    .map((i) => (i.t === "text" ? i.text : ""))
    .join(" ");

describe("compare", () => {
  const src = "比較表 プラン\n推奨: Pro\n| 機能 | Starter | Pro |\n|---|---|---|\n| SSO | × | ✓ |\n| 監査ログ | なし | △ 90 日 |\n| API [1] | - | ○ 月 1 万回 |\n| サポート | メール | 一部 |\n";

  it("見出し行・印・推奨を読む", () => {
    const c = fig<CompareFigure>(src);
    expect(c.kind).toBe("compare");
    expect(c.columns).toEqual(["機能", "Starter", "Pro"]);
    expect(c.highlight).toBe(2);
    expect(c.rows).toEqual([
      { label: "SSO", cells: [{ mark: "no", text: "" }, { mark: "yes", text: "" }], refs: [] },
      { label: "監査ログ", cells: [{ mark: "no", text: "" }, { mark: "partial", text: "90 日" }], refs: [] },
      { label: "API", cells: [{ mark: "no", text: "" }, { mark: "yes", text: "月 1 万回" }], refs: [1] },
      { label: "サポート", cells: [{ text: "メール" }, { mark: "partial", text: "一部" }], refs: [] },
    ]);
  });

  it("往復でき、テキスト化・HTML は表になる", () => {
    const c = fig<CompareFigure>(src);
    roundTrip(c);
    expect(toText(c)).toContain("| 機能 | Starter | Pro（推奨） |");
    expect(toText(c)).toContain("| 監査ログ | ✗ | △ 90 日 |");
    expect(toHTML(c)).toContain("<th scope=\"col\">Pro（推奨）</th>");
  });

  it("「可能」のような語は印にしない・推奨が見出しに無ければ診断", () => {
    const r = parse("compare 案\n項目 | A | B\n導入 | 可能 | 可\n推奨: C\n");
    const c = r.figure as CompareFigure;
    expect(c.rows[0]!.cells).toEqual([{ text: "可能" }, { mark: "yes", text: "" }]);
    expect(c.highlight).toBeUndefined();
    expect(r.diagnostics.map((d) => d.code)).toEqual(["unrecognized_line"]);
  });

  it("描画: 推奨の札と ✓ の印、狭い幅でも英単語を途中で折らない", () => {
    const c = fig<CompareFigure>("compare Plans\nRecommended: Pro\nFeature | Starter | Pro | Business\nAudit log | ✗ | ✓ | ✓ Unlimited\n");
    const s = layout(c, { width: 360, locale: "en" });
    const texts = s.items.flatMap((i) => (i.t === "text" ? [i.text] : []));
    expect(texts).toContain("Recommended");
    expect(texts).toContain("Business");
    expect(texts.some((t) => t === "ed" || t === "s")).toBe(false);
    expect(s.items.filter((i) => i.t === "path" && i.stroke === "s3").length).toBe(2);
  });
});

describe("proscons", () => {
  it("見出しの下の箇条書き・補足・字下げの続きを読む", () => {
    const p = fig<ProsConsFigure>("proscons 週休 3 日\nメリット:\n- 定着率が上がる: 退職が減った\n  試行チームの結果\n- 集中できる\n## デメリット\n- 顧客対応が手薄 [2]\n");
    expect(p.labels).toEqual(["メリット", "デメリット"]);
    expect(p.pros).toEqual([
      { text: "定着率が上がる", desc: "退職が減った\n試行チームの結果", refs: [] },
      { text: "集中できる", refs: [] },
    ]);
    expect(p.cons).toEqual([{ text: "顧客対応が手薄", refs: [2] }]);
    roundTrip(p);
    expect(toText(p)).toContain("**デメリット**\n- 顧客対応が手薄 [2]");
  });

  it("見出しが無ければ + と -、2 列の表も受ける", () => {
    const a = fig<ProsConsFigure>("pros-cons 案\n+ 速い\n- 高い\n✓ 安全\n");
    expect([a.pros.map((i) => i.text), a.cons.map((i) => i.text), a.labels]).toEqual([["速い", "安全"], ["高い"], ["", ""]]);
    roundTrip(a);
    const t = fig<ProsConsFigure>("proscons 案\n良い点 | 悪い点\n--- | ---\n速い | 高い\n安全 |\n");
    expect([t.pros.map((i) => i.text), t.cons.map((i) => i.text), t.labels]).toEqual([["速い", "安全"], ["高い"], ["良い点", "悪い点"]]);
  });

  it("描画: 2 枚のパネル（狭い幅では縦に積む）", () => {
    const p = fig<ProsConsFigure>("proscons 案\n+ 速い\n- 高い\n");
    const wide = layout(p, { width: 640 });
    const narrow = layout(p, { width: 360 });
    expect(drawn(p)).toContain("メリット");
    expect(narrow.height).toBeGreaterThan(wide.height);
  });
});

describe("swot", () => {
  it("4 つの見出し（日本語・英語・1 文字）を読み、往復できる", () => {
    const s = fig<SwotFigure>("SWOT 自社\n強み:\n- 検索\n- オンプレ\nW（弱み）: 知名度\nOpportunities:\n- AI の普及\n脅威\n- 価格競争\n");
    expect(s.labels).toEqual(["強み", "W（弱み）", "Opportunities", "脅威"]);
    expect(s.sections.map((x) => x.map((i) => i.text))).toEqual([["検索", "オンプレ"], ["知名度"], ["AI の普及"], ["価格競争"]]);
    roundTrip(s);
    expect(toText(s)).toContain("**Opportunities**\n- AI の普及");
    expect(drawn(s)).toContain("価格競争");
  });

  it("見出しの前の項目は読めない行", () => {
    const r = parse("swot x\n- 前置き\n強み:\n- A\n");
    expect(r.diagnostics.map((d) => d.code)).toEqual(["unrecognized_line"]);
    expect((r.figure as SwotFigure).sections[0]).toHaveLength(1);
  });
});

describe("checklist", () => {
  it("[x] [ ] [~]・記号・表の状態を読む", () => {
    const c = fig<ChecklistFigure>("チェックリスト リリース前\n- [x] テスト\n- [ ] 設定: 本番の値\n  担当は佐藤\n- [~] ドキュメント\n✓ 変更履歴\n☐ 告知\n");
    expect(c.items).toEqual([
      { text: "テスト", state: "done", refs: [] },
      { text: "設定", desc: "本番の値\n担当は佐藤", state: "todo", refs: [] },
      { text: "ドキュメント", state: "doing", refs: [] },
      { text: "変更履歴", state: "done", refs: [] },
      { text: "告知", state: "todo", refs: [] },
    ]);
    roundTrip(c);
    expect(toText(c)).toContain("（5 項目中 2 項目が完了）");
    expect(toText(c)).toContain("- [ ] ドキュメント（進行中）");
    const t = fig<ChecklistFigure>("checklist x\n項目 | 状態\n--- | ---\nテスト | 完了\n設定 | 進行中\n告知 | 未着手\n");
    expect(t.items.map((i) => i.state)).toEqual(["done", "doing", "todo"]);
  });

  it("描画: 完了の数と割合", () => {
    const c = fig<ChecklistFigure>("checklist x\n- [x] A\n- [ ] B\n");
    expect(drawn(c)).toContain("2 項目中 1 項目が完了");
    expect(drawn(c)).toContain("50%");
    expect(drawn(c, 360)).toContain("A");
  });
});

describe("別名", () => {
  it.each([
    ["比較 x\nA | B | C\nx | ✓ | ✗\n", "compare"],
    ["メリット・デメリット x\n+ a\n", "proscons"],
    ["todo x\n- [x] a\n", "checklist"],
  ])("%s", (src, kind) => expect(parse(src).figure?.kind).toBe(kind));
});
