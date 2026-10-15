import { describe, expect, it } from "vitest";
import { figureActions, parseBlock, toSource, toText, validateActionValues, type AppFigure, type AskFigure, type Figure, type PlanFigure } from "../src/index.js";
import { layout } from "../src/svg.js";

const parse = (src: string) => parseBlock(src, { final: true });
const roundTrip = (f: Figure) => expect(parse(toSource(f)).figure).toEqual(f);

describe("ask", () => {
  const src = `ask 調べる前の確認
> いくつか教えてください。
? 対象の期間は？
- 直近 1 年
- 直近 3 年: 傾向を見るならこちら
? 出力の形式は？ multi
- 表
- グラフ
- その他
? 補足があれば 任意 例 部署を絞るなど
button 回答する
`;
  it("質問・選択肢と説明・複数選択・その他・自由記述を読む", () => {
    const r = parse(src);
    expect(r.diagnostics).toEqual([]);
    const f = r.figure as AskFigure;
    expect(f.intro).toBe("いくつか教えてください。");
    expect(f.submitLabel).toBe("回答する");
    expect(f.questions).toEqual([
      { id: "q1", text: "対象の期間は？", options: [{ label: "直近 1 年" }, { label: "直近 3 年", desc: "傾向を見るならこちら" }], multi: false, other: false, required: true },
      { id: "q2", text: "出力の形式は？", options: [{ label: "表" }, { label: "グラフ" }], multi: true, other: true, required: true },
      { id: "q3", text: "補足があれば", options: [], multi: false, other: false, required: false, placeholder: "部署を絞るなど" },
    ]);
    roundTrip(f);
    expect(toText(f)).toContain("2. 出力の形式は？（複数選択可）");
    expect(figureActions(f)).toEqual([{ id: "a1", label: "回答する", target: { kind: "chat" }, confirm: false }]);
  });

  it("回答の検証: 選択肢・その他・自由記述・必須", () => {
    const f = parse(src).figure as AskFigure;
    expect(validateActionValues(f, "a1", { q1: "直近 1 年", q2: ["表", "PDF"], q3: "" })).toEqual({ ok: true, errors: {}, values: { q1: "直近 1 年", q2: ["表", "PDF"] } });
    const bad = validateActionValues(f, "a1", { q1: "直近 10 年", q2: ["A", "B"] });
    expect(bad.errors).toEqual({ q1: "選択肢から選んでください", q2: "その他は 1 つまでです" });
    expect(validateActionValues(f, "a1", {}).errors).toEqual({ q1: "回答してください", q2: "回答してください" });
    expect(validateActionValues(f, "zz", {}).ok).toBe(false);
  });

  it("描画: 質問と選択肢とボタン", () => {
    const texts = layout(parse(src).figure!, { width: 640 }).items.flatMap((i) => (i.t === "text" ? [i.text] : []));
    for (const w of ["1. 対象の期間は？", "傾向を見るならこちら", "その他（自由記述）", "回答する", "複数選択可"]) expect(texts).toContain(w);
  });
});

describe("plan", () => {
  const src = "plan 調査の進め方\n> 次の手順で進めます。\n1. 社内文書を検索する: 経費規程と過去の申請\n2. 比較表を作る\n3. 要点をまとめる\nbutton 進める\n";
  it("手順と前置き、承認と修正の依頼", () => {
    const f = parse(src).figure as PlanFigure;
    expect(f).toMatchObject({ intro: "次の手順で進めます。", approveLabel: "進める", revise: true });
    expect(f.steps.map((s) => s.title)).toEqual(["社内文書を検索する", "比較表を作る", "要点をまとめる"]);
    roundTrip(f);
    expect(figureActions(f).map((a) => a.id)).toEqual(["approve", "revise"]);
    expect(validateActionValues(f, "approve", {})).toEqual({ ok: true, errors: {}, values: {} });
    expect(validateActionValues(f, "revise", { comment: " " }).errors).toEqual({ comment: "修正してほしい点を書いてください" });
    expect(validateActionValues(f, "revise", { comment: "手順 2 を先に" }).values).toEqual({ comment: "手順 2 を先に" });
    const noRevise = parse(`${src}revise: off\n`).figure as PlanFigure;
    expect(figureActions(noRevise).map((a) => a.id)).toEqual(["approve"]);
    roundTrip(noRevise);
    const texts = layout(f, { width: 640 }).items.flatMap((i) => (i.t === "text" ? [i.text] : []));
    expect(texts).toContain("修正を依頼");
  });
});

describe("app の拡張: 評価・期間・その他", () => {
  const src = "app 研修の感想\n満足度 = rating 5 必須\n受講期間 = date range 必須\n参加の形 = choice 会場 | オンライン | その他\n関心 = choice AI | セキュリティ | 法務 multi other\nbutton 送る -> chat\n";
  it("読み、往復し、検証する", () => {
    const r = parse(src);
    expect(r.diagnostics).toEqual([]);
    const f = r.figure as AppFigure;
    const [rating, range, form, interest] = f.sections[0]!.fields;
    expect(rating).toEqual({ key: "満足度", label: "満足度", type: "rating", required: true, min: 1, max: 5 });
    expect(range).toEqual({ key: "受講期間", label: "受講期間", type: "daterange", required: true });
    expect(form).toMatchObject({ type: "choice", other: true, options: [{ value: "会場" }, { value: "オンライン" }] });
    expect(interest).toMatchObject({ multi: true, other: true });
    roundTrip(f);
    expect(validateActionValues(f, "a1", { 満足度: 4, 受講期間: "2025-04-01/2025-04-03", 参加の形: "社内の研修室", 関心: ["AI", "経理"] })).toEqual({
      ok: true,
      errors: {},
      values: { 満足度: 4, 受講期間: "2025-04-01/2025-04-03", 参加の形: "社内の研修室", 関心: ["AI", "経理"] },
    });
    expect(validateActionValues(f, "a1", { 満足度: 6, 受講期間: "2025-04-03/2025-04-01" }).errors).toEqual({ 満足度: "1〜5 で選んでください", 受講期間: "終わりの日を始まりの日以降にしてください" });
  });
});
