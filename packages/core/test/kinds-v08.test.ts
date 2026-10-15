import { describe, expect, it } from "vitest";
import { parseBlock, toSource, toText, type CardsFigure, type Figure, type FunnelFigure, type ProgressFigure, type StepsFigure } from "../src/index.js";
import { layout } from "../src/svg.js";

const parse = (src: string) => parseBlock(src, { final: true });
const fig = <T extends Figure>(src: string) => parse(src).figure as T;
const roundTrip = (f: Figure) => expect(parse(toSource(f)).figure).toEqual(f);

describe("cards", () => {
  it("箇条書き・表・字下げの本文を受ける", () => {
    const c = fig<CardsFigure>("カード 特徴\n- 共有: 権限を付けられる [1]\n- 検索\n  社内文書を横断する\n");
    expect(c.kind).toBe("cards");
    expect(c.cards).toEqual([
      { title: "共有", body: "権限を付けられる", refs: [1] },
      { title: "検索", body: "社内文書を横断する", refs: [] },
    ]);
    const t = fig<CardsFigure>("cards 特徴\n| 見出し | 本文 |\n|---|---|\n| 監査 | すべて記録する |\n");
    expect(t.cards).toEqual([{ title: "監査", body: "すべて記録する", refs: [] }]);
  });

  it("往復できる", () => {
    roundTrip(fig("cards 案\n- A 案: 改修する。費用は小さい\n- 時刻 10:00 の案\n- 見出し: 本文に | を含む\n- 現状維持\n"));
  });
});

describe("progress", () => {
  it("実績と目標、% だけなら目標は 100、`実績 / 目標` の 1 セル", () => {
    const r = parse("進捗 今期\n項目 | 実績 | 目標\n売上 | 8,200万円 | 1億円\n受講率: 64%\n新規 | 132 / 120\n設計 | 29画面 | 目標 40画面\n研修 | 660人（達成率 108%） | 610人\n件数 | 30\n");
    const p = r.figure as ProgressFigure;
    expect(p.items.map((i) => [i.label, i.value, i.target, i.valueText, i.targetText])).toEqual([
      ["売上", 82_000_000, 100_000_000, "8,200万円", "1億円"],
      ["受講率", 64, 100, "64%", "100%"],
      ["新規", 132, 120, "132", "120"],
      ["設計", 29, 40, "29画面", "40画面"],
      ["研修", 660, 610, "660人", "610人"],
    ]);
    // 目標の無い数値は表示しない
    expect(r.diagnostics.map((d) => d.code)).toEqual(["unrecognized_line"]);
  });

  it("往復できる", () => {
    roundTrip(fig("progress 今期\n売上 | 8,200万円 | 1億円 [2]\n受講率: 64%\n"));
  });
});

describe("funnel", () => {
  it("段階と数、単位は値から取る。負の数は除外", () => {
    const r = parse("ファネル 選考\n応募 | 1,200人\n書類通過: 420人\n面接 | -3\n");
    const f = r.figure as FunnelFigure;
    expect(f.unit).toBe("人");
    expect(f.stages.map((s) => [s.label, s.value])).toEqual([
      ["応募", 1200],
      ["書類通過", 420],
    ]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["bad_number"]);
  });

  it("往復でき、テキスト化は前段比と最初からの割合を持つ", () => {
    const f = fig<FunnelFigure>("funnel 選考\nunit: 人\n応募 | 1200\n書類通過 | 420\n内定 | 30\n");
    roundTrip(f);
    expect(toText(f)).toContain("| 書類通過 | 420 | 35% | 35% |");
    expect(toText(f)).toContain("| 内定 | 30 | 7.1% | 2.5% |");
  });
});

describe("描画", () => {
  it.each([640, 360])("幅 %ipx: 項目ごとのホバー・読み上げ", (width) => {
    const c = layout(fig("cards 特徴\n- 共有: 権限を付けられる\n- 検索\n"), { width });
    expect(c.targets.map((t) => t.say)).toEqual(["共有、権限を付けられる", "検索"]);
    const p = layout(fig("progress 今期\n売上 | 120 | 100\n受講率: 64%\n"), { width });
    expect(p.targets.map((t) => t.say)).toEqual(["売上、120 / 100、120%、達成", "受講率、64% / 100%、64%"]);
    const f = layout(fig("funnel 選考\n応募 | 1200\n内定 | 30\n"), { width });
    expect(f.targets[1]!.tip!.rows.map((r) => r.value)).toEqual(["30", "2.5%", "2.5%"]);
  });
});

describe("単位の付け方", () => {
  it("英字の単位は空白を挟み、通貨記号は前に置く。英語の文言に切り替わる", async () => {
    const { withUnit } = await import("../src/render/frame.js");
    expect([withUnit("1,200", "人"), withUnit("1,200", "people"), withUnit("350", "$M"), withUnit("5", undefined)]).toEqual(["1,200人", "1,200 people", "$350M", "5"]);
    const s = layout(fig("funnel Hiring\nunit: people\nApplied | 1200\nAccepted | 30\n"), { locale: "en-US" });
    const texts = s.items.flatMap((i) => (i.t === "text" ? [i.text] : []));
    expect(texts).toContain("1,200 people");
    expect(texts).toContain("Step rate");
    expect(layout(fig("funnel Hiring\nApplied | 1200\nAccepted | 30\n"), { locale: "en-US", labels: { stepRate: "Rate" } }).items.some((i) => i.t === "text" && i.text === "Rate")).toBe(true);
  });
});

describe("段落・項目・値（ChatGPT のような説明の多い図）", () => {
  it("cards: `見出し | 値 | 本文` の値と、字下げの `- 項目` を受けて往復できる", () => {
    const c = fig<CardsFigure>("cards 料金\n- Starter | ¥4,800 | 月額相当\n  - 基本分析\n  - メールサポート\n- Pro: 上位プラン\n  チーム向け\n  - API\n");
    expect(c.cards).toEqual([
      { title: "Starter", value: "¥4,800", body: "月額相当", items: ["基本分析", "メールサポート"], refs: [] },
      { title: "Pro", body: "上位プラン\nチーム向け", items: ["API"], refs: [] },
    ]);
    roundTrip(c);
    expect(toText(c)).toContain("基本分析");
    // 描画: 値は大きな文字、項目の行頭にチェックの印
    const s = layout(c, { width: 640 });
    expect(s.items.some((i) => i.t === "text" && i.text === "¥4,800" && i.size > 20)).toBe(true);
    expect(s.items.filter((i) => i.t === "path" && i.stroke === "s3")).toHaveLength(3);
  });

  it("steps: 字下げの続きは段落、`Step 1〜3:` の範囲は見出しに残す", () => {
    const st = fig<StepsFigure>("steps 進め方\n1. 準備: 基礎\n  Rust の所有権\n  - ネットワークの階層\n2. Step 1〜3: 土台\n3. Step 2 実装する\n");
    expect(st.steps.map((s) => [s.title, s.desc])).toEqual([
      ["準備", "基礎\nRust の所有権\nネットワークの階層"],
      ["Step 1〜3", "土台"],
      ["実装する", undefined],
    ]);
    roundTrip(st);
    expect(toText(st)).toContain("1. 準備: 基礎 Rust の所有権 ネットワークの階層");
  });
});

describe("cards の項目の上限", () => {
  it("1 枚に 8 項目まで", () => {
    const r = parse(`cards 案\n- A\n${Array.from({ length: 10 }, (_, i) => `  - 項目${i}`).join("\n")}\n`);
    expect((r.figure as CardsFigure).cards[0]!.items).toHaveLength(8);
    expect(r.diagnostics.map((d) => d.code)).toContain("limit_exceeded");
  });
});
