import { describe, expect, it } from "vitest";
import { evaluate, MAX_OPS, parseExpr } from "../src/calc/expr.js";
import { formatCalc, runCalc, shownFormulas } from "../src/calc/run.js";
import { parseBlock, toSource, toText, type CalcFigure } from "../src/index.js";
import { layout } from "../src/svg.js";

const calc = (src: string) => parseBlock(src, { final: true });
const env = (o: Record<string, number>) => new Map(Object.entries(o));
const ev = (s: string, o: Record<string, number> = {}) => evaluate(parseExpr(s).expr, env(o));

const LOAN = `calc 住宅ローンの試算
借入額 = slider 500..10000 step 100 初期 3000 万円
金利 = slider 0.1..5 step 0.05 初期 1.5 %
期間 = slider 5..35 初期 35 年
月利 = 金利 / 100 / 12
回数 = 期間 * 12
毎月の返済額 = 借入額 * 10000 * 月利 / (1 - (1 + 月利) ^ -回数) 円
総返済額 = 毎月の返済額 * 回数 / 10000 万円 round 0
show 毎月の返済額 | 総返済額
hide: 月利, 回数
`;

describe("式", () => {
  it("優先順位・右結合のべき乗・単項のマイナス・比較と論理・関数", () => {
    expect([ev("1 + 2 * 3"), ev("(1 + 2) * 3"), ev("2 ^ 3 ^ 2"), ev("-2 ^ 2"), ev("2 × 3 ÷ 4")]).toEqual([7, 9, 512, -4, 1.5]);
    expect([ev("1 < 2 and not 0"), ev("1 > 2 or 0"), ev("if(a >= 10, 1, 2)", { a: 10 }), ev("round(2.345, 2)"), ev("max(1, 5, 3)")]).toEqual([1, 0, 1, 2.35, 5]);
  });

  it("0 除算・定義域外・未定義は null（「—」）", () => {
    expect([ev("1 / 0"), ev("sqrt(-1)"), ev("x + 1"), ev("10 ^ 400")]).toEqual([null, null, null, null]);
    expect(formatCalc(null, 0, "ja-JP")).toBe("—");
  });

  it("関数は決まった一覧だけ、記号は受けない、後ろの語は単位として残す", () => {
    expect(() => parseExpr("alert(1)")).toThrow(/使えません/);
    expect(() => parseExpr("a.b")).not.toThrow(); // 「a.b」は 1 つの名前（プロパティアクセスではない）
    expect(() => parseExpr("x[0]")).not.toThrow();
    expect(ev("x[0]", { "x[0]": 3 })).toBe(3);
    expect(() => parseExpr("1 + ")).toThrow();
    const p = parseExpr("a * 2 万円");
    expect("a * 2 万円".slice(p.end).trim()).toBe("万円");
  });

  it("語の数と演算の回数に上限がある（深い式で落ちない）", () => {
    expect(() => parseExpr(Array.from({ length: 5000 }, () => "1").join(" + "))).toThrow(/長すぎ/);
    expect(() => parseExpr(`${"(".repeat(2000)}1${")".repeat(2000)}`)).toThrow(/長すぎ/);
    expect(evaluate(parseExpr("1 + 1").expr, new Map(), { ops: MAX_OPS })).toBeNull();
  });
});

describe("calc の記法", () => {
  it("入力・式・単位・show / hide を読み、初期値で計算する", () => {
    const r = calc(LOAN);
    expect(r.diagnostics).toEqual([]);
    const f = r.figure as CalcFigure;
    expect(f.defs.map((d) => [d.type, d.name, d.unit ?? ""])).toEqual([
      ["input", "借入額", "万円"],
      ["input", "金利", "%"],
      ["input", "期間", "年"],
      ["formula", "月利", ""],
      ["formula", "回数", ""],
      ["formula", "毎月の返済額", "円"],
      ["formula", "総返済額", "万円"],
    ]);
    const v = runCalc(f);
    expect(Math.round(v.get("毎月の返済額")!)).toBe(91855);
    expect(shownFormulas(f).map((x) => x.name)).toEqual(["毎月の返済額", "総返済額"]);
    // 入力を動かすと計算し直す。範囲外の値は丸める
    expect(Math.round(runCalc(f, env({ 金利: 9 })).get("毎月の返済額")!)).toBe(Math.round(runCalc(f, env({ 金利: 5 })).get("毎月の返済額")!));
  });

  it("choice・count・toggle と、選択肢の表示名は書かれたまま", () => {
    const f = calc("calc 料金\n支払い = choice 月額=1 | 年額（20%割引）=0.8\n人数 = count 1..100 初期 5 人\n割引 = toggle 初期 オン\n料金 = 980 * 人数 * 支払い * if(割引, 0.9, 1) 円\n").figure as CalcFigure;
    expect(f.defs[0]).toMatchObject({ control: "choice", options: [{ label: "月額", value: 1 }, { label: "年額（20%割引）", value: 0.8 }], initial: 1 });
    expect(f.defs[1]).toMatchObject({ control: "count", min: 1, max: 100, initial: 5, unit: "人" });
    expect(f.defs[2]).toMatchObject({ control: "toggle", initial: 1 });
    expect(runCalc(f).get("料金")).toBeCloseTo(4410);
  });

  it("前に定義していない名前・読めない式・選択肢の不足は、その行だけ除外する", () => {
    const r = calc("calc x\na = slider 0..10\nb = c + 1\nd = a +\ne = choice だけ=1\nf = a * 2\n");
    expect((r.figure as CalcFigure).defs.map((d) => d.name)).toEqual(["a", "f"]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["unrecognized_line", "unrecognized_line", "unrecognized_line"]);
  });

  it("往復できる", () => {
    const f = calc(LOAN).figure as CalcFigure;
    const again = calc(toSource(f)).figure as CalcFigure;
    expect(again).toEqual(f);
  });

  it("テキスト化は初期値での結果と式。静止画は入力の現在値で描ける", () => {
    const f = calc(LOAN).figure as CalcFigure;
    expect(toText(f)).toContain("- **毎月の返済額**: 91,855円（= 借入額 * 10000 * 月利 / (1 - (1 + 月利) ^ (-回数))）");
    expect(toText(f)).not.toContain("月利:");
    const texts = (m?: Map<string, number>) => layout(f, { width: 480, ...(m ? { calcInputs: m } : {}) }).items.flatMap((i) => (i.t === "text" ? [i.text] : []));
    expect(texts()).toContain("91,855円");
    expect(texts(env({ 借入額: 4000 }))).toContain("4,000万円");
  });
});
