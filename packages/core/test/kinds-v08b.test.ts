import { describe, expect, it } from "vitest";
import { parseBlock, toSource, toText, type Figure, type GanttFigure, type QuadrantFigure } from "../src/index.js";
import { parseDate } from "../src/kinds/v08b.js";
import { layout } from "../src/svg.js";

const parse = (src: string) => parseBlock(src, { final: true });
const fig = <T extends Figure>(src: string) => parse(src).figure as T;
const roundTrip = (f: Figure) => expect(parse(toSource(f)).figure).toEqual(f);
const day = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86_400_000);

describe("quadrant", () => {
  it("軸の名前・象限の名前・項目。見出し行は軸の名前にし、範囲外は丸める", () => {
    const r = parse("4象限 優先度\n右上: すぐやる\n施策 | 効果 | 実現しやすさ\nA | 70 | 85 [1]\nB | 120 | 40\n");
    const q = r.figure as QuadrantFigure;
    expect(q.kind).toBe("quadrant");
    expect([q.xLabel, q.yLabel, q.quadrants[0]]).toEqual(["効果", "実現しやすさ", "すぐやる"]);
    expect(q.items).toEqual([
      { label: "A", x: 70, y: 85, refs: [1] },
      { label: "B", x: 100, y: 40, refs: [] },
    ]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["bad_number"]);
    expect(toText(q)).toContain("- A: 横 70・縦 85（すぐやる） [1]");
  });

  it("往復できる", () => {
    roundTrip(fig("quadrant 優先度\nx: 効果\ny: 実現しやすさ\n左下: 見送り\nA | 70 | 85\n"));
  });
});

describe("gantt", () => {
  it("日付の書き方（年あり・月日・月だけ・範囲の 1 セル）と、年の引き継ぎ・年またぎ", () => {
    expect(parseDate("2025/4/1", null)).toEqual({ start: day(2025, 4, 1), end: day(2025, 4, 1), hasYear: true });
    expect(parseDate("2025年4月", null)).toEqual({ start: day(2025, 4, 1), end: day(2025, 4, 30), hasYear: true });
    expect(parseDate("4月1日", 2025)).toEqual({ start: day(2025, 4, 1), end: day(2025, 4, 1), hasYear: false });
    expect(parseDate("13/1", 2025)).toBeNull();
    const g = fig<GanttFigure>("工程表 導入\nタスク | 開始 | 終了\n要件 | 2025-11-01 | 2025-11-30\n設計: 12/1 〜 1/15\n稼働 | 2月\n");
    expect(g.noYear).toBe(false);
    expect(g.tasks.map((t) => [t.label, t.start, t.end, t.milestone ?? false])).toEqual([
      ["要件", day(2025, 11, 1), day(2025, 11, 30), false],
      ["設計", day(2025, 12, 1), day(2026, 1, 15), false],
      ["稼働", day(2025, 2, 1), day(2025, 2, 28), false],
    ]);
  });

  it("1 日だけはマイルストーン。終了が開始より前・読めない日付は除外", () => {
    const r = parse("gantt 準備\n当日 | 4/18\n逆 | 2025/5/1 | 2025/4/1\n謎 | そのうち\n");
    const g = r.figure as GanttFigure;
    expect(g.tasks.map((t) => [t.label, t.milestone])).toEqual([["当日", true]]);
    expect(g.noYear).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["bad_number", "bad_number"]);
  });

  it("往復でき、描画は項目ごとに期間を出す", () => {
    const g = fig<GanttFigure>("gantt 準備\n資料作成 | 4/1 | 4/12 [2]\n当日 | 4/18\n");
    roundTrip(g);
    for (const width of [640, 360]) {
      const s = layout(g, { width });
      expect(s.targets.map((t) => t.tip!.rows[0]!.value)).toEqual(["4/1 〜 4/12", "4/18"]);
      expect(s.targets[0]!.tip!.footer).toBe("12日間");
    }
  });
});
