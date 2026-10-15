import { describe, expect, it } from "vitest";
import { parseBlock, toSource, toText, type CalloutFigure, type ChartFigure, type Figure, type MapFigure, type StatFigure } from "../src/index.js";
import { toHTML } from "../src/export.js";
import { layout } from "../src/svg.js";

const parse = (src: string) => parseBlock(src, { final: true });
const roundTrip = (f: Figure) => expect(parse(toSource(f)).figure).toEqual(f);
const texts = (f: Figure, width = 640) => layout(f, { width }).items.flatMap((i) => (i.t === "text" ? [i.text] : []));

describe("radar", () => {
  const src = "レーダーチャート 評価\n観点 | A社 | B社\n価格 | 4 | 3\n機能 | 3 | 5\nサポート | 5 | -1\n";
  it("読み、負の値は 0、往復・描画", () => {
    const r = parse(src);
    const f = r.figure as ChartFigure;
    expect(f.kind).toBe("radar");
    expect(f.rows[2]!.values).toEqual([5, 0]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["bad_number"]);
    roundTrip(f);
    expect(texts(f)).toEqual(expect.arrayContaining(["A社", "B社", "価格", "サポート"]));
    expect(parse("radar x\n観点 | A\n価格 | 1\n機能 | 2\n").diagnostics.map((d) => d.code)).toContain("unrecognized_line");
  });
});

describe("treemap", () => {
  it("1 系列・0 以下は除く・描画", () => {
    const r = parse("treemap 予算\nunit: 万円\n項目 | 予算 | 前年\nクラウド | 4200 | 1\n端末 | 1800 | 2\n研修 | 0 | 3\n");
    const f = r.figure as ChartFigure;
    expect(f.columns).toEqual(["項目", "予算"]);
    expect(f.rows.map((x) => x.label)).toEqual(["クラウド", "端末"]);
    roundTrip(f);
    expect(texts(f)).toContain("クラウド");
    expect(toText(f)).toContain("クラウド");
  });
});

describe("callout", () => {
  it("見出しの先頭の種類・本文・箇条書き", () => {
    const f = parse("callout 注意 申請の締め切り\n4 月 5 日までに申請してください。\n- 遅れた申請は翌月\n").figure as CalloutFigure;
    expect(f).toMatchObject({ tone: "warning", title: "申請の締め切り", body: "4 月 5 日までに申請してください。", items: ["遅れた申請は翌月"] });
    roundTrip(f);
    expect(toSource(f).split("\n")[0]).toBe("callout warning 申請の締め切り");
    expect(texts(f)).toEqual(expect.arrayContaining(["申請の締め切り", "!"]));
    expect((parse("callout 締め切り\n本文\n").figure as CalloutFigure).tone).toBe("info");
  });
});

describe("map", () => {
  const src = "地図 訪問\n名前 | 緯度 | 経度 | 説明\n大阪駅 | 34.7025 | 135.4959 | 集合\n本社: 34.6937, 135.5023\n不正 | 95 | 10\nroute: 大阪駅 -> 本社 -> 京都 (walk)\nzoom: 14\n";
  it("地点・道順・範囲外の診断・往復", () => {
    const r = parse(src);
    const f = r.figure as MapFigure;
    expect(f.markers).toEqual([
      { label: "大阪駅", lat: 34.7025, lng: 135.4959, desc: "集合", refs: [] },
      { label: "本社", lat: 34.6937, lng: 135.5023, refs: [] },
    ]);
    expect(f.route).toEqual({ stops: ["大阪駅", "本社"], mode: "walk" });
    expect(f.zoom).toBe(14);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["bad_number", "unrecognized_line", "unrecognized_line"]);
    roundTrip(f);
    expect(texts(f)).toEqual(expect.arrayContaining(["大阪駅", "1. 大阪駅　集合"]));
    expect(toHTML(f)).toContain("大阪駅");
  });
});

describe("stat の推移", () => {
  it("trend のセルを折れ線に、補足はそのまま", () => {
    const f = parse("stat 指標\n売上 | 1.2億円 | 前月比 +12% | trend 92, 98, 120\n解約率 | 1.8%\n").figure as StatFigure;
    expect(f.items[0]).toMatchObject({ sub: "前月比 +12%", trend: [92, 98, 120] });
    expect(f.items[1]!.trend).toBeUndefined();
    roundTrip(f);
    expect(layout(f, { width: 640 }).items.some((i) => i.t === "path" && i.stroke === "s1")).toBe(true);
  });
});
