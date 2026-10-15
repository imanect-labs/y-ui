import { describe, expect, it } from "vitest";
import { parseBlock, toSource, toText, type Figure, type ScatterFigure, type StepsFigure, type TimelineFigure, type TreeFigure } from "../src/index.js";
import { toHTML } from "../src/export.js";
import { layout } from "../src/svg.js";

const final = { final: true } as const;
const parse = (src: string) => parseBlock(src, final);
const fig = <T extends Figure>(src: string) => parse(src).figure as T;
const roundTrip = (f: Figure) => expect(parse(toSource(f)).figure).toEqual(f);

describe("timeline", () => {
  it("箇条書き・表・空白区切り・時刻の書き方を受け、書いた順に並べる", () => {
    const a = fig<TimelineFigure>("年表 沿革\n- 2024年4月: 創業 [1]\n- 2023年1月: 準備室: 3 名で発足\n");
    expect(a.kind).toBe("timeline");
    expect(a.events).toEqual([
      { when: "2024年4月", title: "創業", refs: [1] },
      { when: "2023年1月", title: "準備室", desc: "3 名で発足", refs: [] },
    ]);
    const b = fig<TimelineFigure>("timeline 予定\n| 時期 | 出来事 | 補足 |\n|---|---|---|\n| 4月 | 試験導入 | 2 部署 |\n");
    expect(b.events).toEqual([{ when: "4月", title: "試験導入", desc: "2 部署", refs: [] }]);
    const c = fig<TimelineFigure>("timeline 当日\n10:00 開会\n10:30-12:00: 基調講演\n2025年 新製品\n");
    expect(c.events.map((e) => [e.when, e.title])).toEqual([
      ["10:00", "開会"],
      ["10:30-12:00", "基調講演"],
      ["2025年", "新製品"],
    ]);
  });

  it("字下げした行は直前の出来事の説明に足す。解釈できない行は警告", () => {
    const r = parse("timeline 沿革\n- 2021年: 100 社を突破\n  クラウド版を開始\n思い出\n");
    expect((r.figure as TimelineFigure).events[0]!.desc).toBe("クラウド版を開始");
    expect(r.diagnostics.map((d) => d.code)).toEqual(["unrecognized_line"]);
  });

  it("往復できる（出来事に : や | が入っても）", () => {
    roundTrip(fig("timeline 沿革\n- 2024年4月: 創業 [1]\n- 2025年: 上場: 東証 | グロース\n10:00 開会\n"));
  });
});

describe("steps", () => {
  it("番号付き・STEP 表記・表を受け、番号の列は落とす", () => {
    const a = fig<StepsFigure>("手順 経費精算\n1. 申請: 領収書を添える\n2) 承認\nSTEP3: 支払\n");
    expect(a.kind).toBe("steps");
    expect(a.steps).toEqual([
      { title: "申請", desc: "領収書を添える", refs: [] },
      { title: "承認", refs: [] },
      { title: "支払", refs: [] },
    ]);
    const b = fig<StepsFigure>("steps 手順\n| No | 手順 | 内容 |\n|---|---|---|\n| 1 | 申請 | 入力する |\n| 2 | 承認 | |\n");
    expect(b.steps).toEqual([
      { title: "申請", desc: "入力する", refs: [] },
      { title: "承認", refs: [] },
    ]);
  });

  it("15 を超える手順は省く", () => {
    const src = `steps 多い\n${Array.from({ length: 17 }, (_, i) => `${i + 1}. 手順${i + 1}`).join("\n")}\n`;
    const r = parse(src);
    expect((r.figure as StepsFigure).steps).toHaveLength(15);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["limit_exceeded"]);
  });

  it("往復できる", () => {
    roundTrip(fig("steps 設定\n1. 接続する: SSID は「corp」\n2. 時刻 10:00 に確認\n3. 見出し: 説明に | を含む\n4. Step 4 という名前\n"));
  });
});

describe("tree", () => {
  it("字下げの深さが階層になる。| は兄弟、名前: 説明", () => {
    const t = fig<TreeFigure>("組織図 体制\n- 社長\n  - 営業: 120名\n    - 東 | 西\n  - 開発\n- 監査役\n");
    expect(t.kind).toBe("tree");
    expect(t.roots.map((r) => r.title)).toEqual(["社長", "監査役"]);
    const sales = t.roots[0]!.children[0]!;
    expect(sales).toMatchObject({ title: "営業", desc: "120名" });
    expect(sales.children.map((c) => c.title)).toEqual(["東", "西"]);
    expect(t.roots[0]!.children[1]!.title).toBe("開発");
  });

  it("5 段目以降は 4 段目に置く", () => {
    const r = parse("tree 深い\n- 1\n  - 2\n    - 3\n      - 4\n        - 5\n");
    const four = (r.figure as TreeFigure).roots[0]!.children[0]!.children[0]!;
    expect(four.children.map((c) => c.title)).toEqual(["4", "5"]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["nested_too_deep"]);
  });

  it("往復できる", () => {
    roundTrip(fig("tree 構成\n- 導入ガイド [2]\n  - インストール\n    - Linux: Ubuntu 22.04 以降\n- API\n"));
  });
});

describe("scatter", () => {
  it("列名の行と点、4 列目のまとまり。読めない値は除外", () => {
    const r = parse("散布図 広告費と売上\n店舗 | 広告費 | 売上 | 地域\n新宿 | 120 | 48 | 東京\n梅田 | 1.1万 | 39 | 大阪\n天神 | - | 19 | 福岡\n");
    const s = r.figure as ScatterFigure;
    expect(s.columns).toEqual(["店舗", "広告費", "売上", "地域"]);
    expect(s.points).toEqual([
      { label: "新宿", x: 120, y: 48, group: "東京", refs: [] },
      { label: "梅田", x: 11000, y: 39, group: "大阪", refs: [] },
    ]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["bad_number"]);
  });

  it("列名が無ければ補う", () => {
    const r = parse("scatter 関係\nA | 1 | 2\nB | 3 | 4\n");
    expect((r.figure as ScatterFigure).columns).toEqual(["項目", "X", "Y"]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["missing_header"]);
  });

  it("往復できる", () => {
    roundTrip(fig("scatter 関係\n社名 | 従業員 | 売上 | 業種\nA社 | 12 | 30 | 製造 [1]\nB社 | 40 | -5 | 小売\n"));
  });
});

describe("テキスト化と描画", () => {
  const all = [
    fig("timeline 沿革\n- 2015年: 創業\n- 2021年: 100 社を突破\n  クラウド版を開始\n"),
    fig("steps 手順\n1. 申請: 入力する\n2. 承認\n"),
    fig("tree 組織\n- 社長\n  - 営業\n    - 東\n    - 西\n  - 開発\n"),
    fig("scatter 関係\n社名 | 従業員 | 売上\nA社 | 12 | 30\nB社 | 40 | 55\n"),
  ];

  it("toText・toHTML は読める形にする", () => {
    expect(toText(all[0]!)).toContain("- 2021年: 100 社を突破（クラウド版を開始）");
    expect(toText(all[1]!)).toContain("1. 申請: 入力する\n2. 承認");
    expect(toText(all[2]!)).toContain("- 社長\n  - 営業\n    - 東");
    expect(toText(all[3]!)).toContain("| A社 | 12 | 30 |");
    expect(toHTML(all[1]!)).toBe("<ol><li>申請（入力する）</li><li>承認</li></ol>");
    expect(toHTML(all[2]!)).toContain("<li>社長<ul><li>営業<ul><li>東</li>");
  });

  it.each([640, 360])("幅 %ipx: 項目ごとにホバーの対象があり、全文を出す", (width) => {
    const [tl, st, tr, sc] = all.map((f) => layout(f, { width }));
    expect(tl!.targets.map((t) => t.tip?.footer)).toEqual([undefined, "クラウド版を開始"]);
    expect(st!.targets.map((t) => t.tip?.title)).toEqual(["1. 申請", "2. 承認"]);
    // 木は祖先ごと残す（東 → 営業 → 社長）
    const east = tr!.targets.find((t) => t.tip?.title === "東")!;
    expect(east.keep).toHaveLength(3);
    expect(sc!.targets[1]!.tip!.rows).toEqual([
      { label: "従業員", value: "40", token: "s1" },
      { label: "売上", value: "55" },
    ]);
    for (const s of [tl, st, tr, sc]) expect(Number.isFinite(s!.height) && s!.height > 60).toBe(true);
  });
});
