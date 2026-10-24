import { describe, expect, it } from "vitest";
import { parseBlock, toSource, toText, validateAppValues, initialValues, type AppFigure } from "../src/index.js";
import { toHTML } from "../src/export.js";
import { layout } from "../src/svg.js";

const parse = (src: string) => parseBlock(src, { final: true });
const fig = (src: string) => parse(src).figure as AppFigure;

const SRC = `app 経費の処理
## 経費の申請
> 領収書の内容を入力してください。
件名 = text 必須 例 4月 大阪出張の交通費
金額 = number 1..1000000 円 必須 as amount
区分 = choice 交通費 | 出張費 | 備品
日付 = date 必須
内容 = textarea
立替 = toggle 初期 オン
button 申請する -> workflow 経費申請

## 月次の集計
対象月 = month 必須
部署 = choice 営業=sales | 開発=dev | 管理=admin multi 初期 sales
人数 = count 1..10 初期 2
button 集計する -> workflow 月次集計
button 会話で相談する -> chat
note: 申請は上長の承認後に経理へ回ります。
`;

describe("app: 記法", () => {
  it("機能・入力部品・ボタンを読む", () => {
    const r = parse(SRC);
    expect(r.diagnostics).toEqual([]);
    const f = r.figure as AppFigure;
    expect(f.title).toBe("経費の処理");
    expect(f.note).toBe("申請は上長の承認後に経理へ回ります。");
    expect(f.sections.map((s) => s.title)).toEqual(["経費の申請", "月次の集計"]);
    const [a, b] = f.sections;
    expect(a!.desc).toBe("領収書の内容を入力してください。");
    expect(a!.fields).toEqual([
      { key: "件名", label: "件名", type: "text", required: true, placeholder: "4月 大阪出張の交通費" },
      { key: "amount", label: "金額", type: "number", required: true, min: 1, max: 1000000, unit: "円" },
      { key: "区分", label: "区分", type: "choice", required: false, options: ["交通費", "出張費", "備品"].map((v) => ({ label: v, value: v })) },
      { key: "日付", label: "日付", type: "date", required: true },
      { key: "内容", label: "内容", type: "textarea", required: false },
      { key: "立替", label: "立替", type: "toggle", required: false, initial: true },
    ]);
    expect(a!.actions).toEqual([{ id: "a1", label: "申請する", target: { kind: "workflow", name: "経費申請" }, confirm: true }]);
    expect(b!.fields[1]).toEqual({ key: "部署", label: "部署", type: "choice", required: false, multi: true, initial: ["sales"], options: [{ label: "営業", value: "sales" }, { label: "開発", value: "dev" }, { label: "管理", value: "admin" }] });
    expect(b!.fields[2]).toMatchObject({ type: "count", min: 1, max: 10, step: 1, initial: 2 });
    expect(b!.actions.map((x) => [x.id, x.target.kind, x.confirm])).toEqual([
      ["a2", "workflow", true],
      ["a3", "chat", false],
    ]);
  });

  it("往復できる", () => {
    const f = fig(SRC);
    expect(parse(toSource(f)).figure).toEqual(f);
  });

  it("見出しの無い app は 1 つの機能、読めない行・種類は診断", () => {
    const r = parse("app 休暇\n開始日 = date\n種類 = color\nbutton 送る -> https://example.com/x\nbutton 申請 -> workflow 休暇申請\nこれは説明ではない\n");
    const f = r.figure as AppFigure;
    expect(f.sections).toHaveLength(1);
    expect(f.sections[0]!.fields.map((x) => x.key)).toEqual(["開始日"]);
    // 実行先は名前だけ（URL のような文字は受けない）
    expect(f.sections[0]!.actions.map((a) => a.target)).toEqual([{ kind: "workflow", name: "休暇申請" }]);
    expect(f.sections[0]!.actions[0]!.id).toBe("a1");
    expect(r.diagnostics.map((d) => d.code)).toEqual(["unrecognized_line", "unrecognized_line", "unrecognized_line"]);
  });

  it("上限: 機能は 6 つまで（超えた機能の行は読み飛ばす）", () => {
    const src = `app x\n${Array.from({ length: 8 }, (_, i) => `## 機能${i}\n値${i} = text\nbutton 実行${i} -> workflow w${i}`).join("\n")}\n`;
    const r = parse(src);
    expect((r.figure as AppFigure).sections).toHaveLength(6);
    expect(r.diagnostics.filter((d) => d.code === "limit_exceeded")).toHaveLength(1);
  });
  it("選択肢の中の | は \\| と書く（初期値も）・往復できる", () => {
    const f = fig("app x\n区分 = choice A\\|B | C 初期 A\\|B\n");
    expect(f.sections[0]!.fields[0]!.options!.map((o) => o.value)).toEqual(["A|B", "C"]);
    expect(f.sections[0]!.fields[0]!.initial).toBe("A|B");
    expect(toSource(f)).toContain("choice A\\|B | C 初期 A\\|B");
    expect(fig(toSource(f))).toEqual(f);
  });

  it("片側だけの範囲は読まずに警告する（単位に紛れ込ませない）", () => {
    const r = parse("app x\n金額 = number 1.. 円\n");
    const x = (r.figure as AppFigure).sections[0]!.fields[0]!;
    expect([x.min, x.max, x.unit]).toEqual([undefined, undefined, "円"]);
    expect(r.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining("両方を書いてください")]);
    // 単位が続けて書かれていても同じ
    const g = parse("app x\n金額 = number 1..円\n");
    expect((g.figure as AppFigure).sections[0]!.fields[0]!.unit).toBe("円");
    expect(g.diagnostics).toHaveLength(1);
  });
});

describe("app: 値の検証", () => {
  const f = fig(SRC);

  it("初期値と、必須・範囲・選択肢・日付", () => {
    expect(initialValues(f.sections[0]!)).toEqual({ 件名: "", amount: "", 区分: "", 日付: "", 内容: "", 立替: true });
    const bad = validateAppValues(f, "a1", { 件名: "", amount: "0", 区分: "家賃", 日付: "2025-02-30", 立替: "yes" });
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.errors).sort()).toEqual(["amount", "件名", "区分", "日付", "立替"].sort());
    const good = validateAppValues(f, "a1", { 件名: "出張", amount: "12,300", 区分: "交通費", 日付: "2025-04-01", 内容: "", 立替: false, 余計: "x" });
    expect(good).toEqual({ ok: true, errors: {}, values: { 件名: "出張", amount: 12300, 区分: "交通費", 日付: "2025-04-01", 立替: false } });
  });

  it("ボタンはその機能の値だけを見る・知らないボタンは誤り", () => {
    expect(validateAppValues(f, "a2", { 対象月: "2025-04", 部署: ["sales", "dev", "dev"], 人数: 3, 件名: "x" })).toEqual({ ok: true, errors: {}, values: { 対象月: "2025-04", 部署: ["sales", "dev"], 人数: 3 } });
    expect(validateAppValues(f, "a2", { 対象月: "2025-13", 部署: ["hr"], 人数: 2.5 }).errors).toEqual({ 対象月: "日付が正しくありません", 部署: "選択肢から選んでください", 人数: "整数で入力してください" });
    expect(validateAppValues(f, "a9", {}).ok).toBe(false);
  });
});

describe("app: 描画とテキスト化", () => {
  const f = fig(SRC);

  it("静止画: 機能の見出し・ラベル・ボタン", () => {
    const texts = layout(f, { width: 640 })
      .items.flatMap((i) => (i.t === "text" ? [i.text] : []))
      .join(" ");
    for (const w of ["経費の申請", "件名", "必須", "4月 大阪出張の交通費", "申請する", "月次の集計", "会話で相談する", "オン"]) if (w !== "オン") expect(texts).toContain(w);
    expect(layout(f, { width: 360 }).height).toBeGreaterThan(layout(f, { width: 640 }).height);
  });

  it("テキスト化・HTML は入力の一覧と実行先", () => {
    expect(toText(f)).toContain("- 金額（数値・必須・円）");
    expect(toText(f)).toContain("- ボタン「申請する」→ ワークフロー「経費申請」を起動");
    expect(toText(f)).toContain("- ボタン「会話で相談する」→ 会話に送る");
    expect(toHTML(f)).toContain("［申請する］ → 経費申請");
  });
});
