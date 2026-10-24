import { describe, expect, it } from "vitest";
import { parseBlock, toSource, type AppField, type AppFigure } from "../src/index.js";
import {
  FIELD_TYPES,
  changeType,
  checkApp,
  checkEditable,
  emptyApp,
  hasErrors,
  insertAction,
  insertField,
  insertSection,
  moveAction,
  moveField,
  moveSection,
  newAction,
  newField,
  problemsAt,
  removeField,
  removeSection,
  same,
  updateAction,
  updateField,
  updateSection,
  type EditResult,
} from "../src/editor/index.js";

const must = (r: EditResult): AppFigure => {
  if (!r.ok) throw new Error(r.problem);
  return r.figure;
};
const back = (f: AppFigure) => parseBlock(toSource(f), { final: true }).figure as AppFigure;
const labels = (f: AppFigure) => f.sections.map((s) => s.fields.map((x) => x.label));
/** テストの図のボタンの実行先（w）を選べる文脈。 */
const W = { workflows: [{ name: "w" }] };
const codes = (f: AppFigure, ctx = {}) => checkApp(f, ctx).map((p) => p.code);

/** 全種類の部品を 1 つずつ並べ、ボタンを付けた図。 */
function everyType(): AppFigure {
  let f = emptyApp("全部");
  for (const type of FIELD_TYPES) f = must(insertField(f, { section: 0, index: f.sections[0]!.fields.length }, newField(f, type)));
  return must(insertAction(f, { section: 0, index: 0 }, newAction(f, "経費申請")));
}

describe("editor: 作る", () => {
  it("どの種類の部品も、既定のままならエラーなしで往復する", () => {
    const f = everyType();
    expect(checkApp(f, { workflows: [{ name: "経費申請" }] }).filter((p) => p.severity === "error")).toEqual([]);
    expect(same(back(f), f)).toBe(true);
  });

  it("ラベルは図の中で重ならない名前にする", () => {
    let f = emptyApp();
    f = must(insertField(f, { section: 0, index: 0 }, newField(f, "text")));
    f = must(insertField(f, { section: 0, index: 1 }, newField(f, "text")));
    expect(labels(f)).toEqual([["件名", "件名 2"]]);
  });

  it("種類を変えるとラベル・key・必須は残り、意味の無い設定は落ちる", () => {
    const x: AppField = { key: "amount", label: "金額", type: "number", required: true, min: 1, max: 9, unit: "円" };
    const c = changeType(x, "choice");
    expect(c).toMatchObject({ key: "amount", label: "金額", required: true, type: "choice" });
    expect(c.min).toBeUndefined();
    expect(c.options!.length).toBe(2);
  });
});

describe("editor: 並べ替え", () => {
  const two = (): AppFigure => {
    let f = emptyApp();
    for (const l of ["A", "B", "C"]) f = must(insertField(f, { section: 0, index: 9 }, newField(f, "text", l)));
    f = must(insertSection(f, 1));
    return must(insertField(f, { section: 1, index: 0 }, newField(f, "text", "D")));
  };

  it("同じ機能の中で前後に動かす（to は動かす前の位置）", () => {
    expect(labels(must(moveField(two(), { section: 0, index: 0 }, { section: 0, index: 3 })))[0]).toEqual(["B", "C", "A"]);
    expect(labels(must(moveField(two(), { section: 0, index: 2 }, { section: 0, index: 0 })))[0]).toEqual(["C", "A", "B"]);
  });

  it("機能をまたいで動かす", () => {
    expect(labels(must(moveField(two(), { section: 0, index: 1 }, { section: 1, index: 1 })))).toEqual([["A", "C"], ["D", "B"]]);
  });

  it("機能を足すと見出しの無い機能に仮の見出しが付き、機能ごと動かせる", () => {
    const f = two();
    expect(f.sections.map((s) => s.title)).toEqual(["機能 1", "機能 2"]);
    expect(labels(must(moveSection(f, 1, 0)))).toEqual([["D"], ["A", "B", "C"]]);
  });

  it("ボタンの id は並べ替えのたびにソースの順で振り直す", () => {
    let f = two();
    f = must(insertAction(f, { section: 0, index: 0 }, newAction(f, "x")));
    f = must(insertAction(f, { section: 1, index: 0 }, newAction(f, "y")));
    expect(f.sections.flatMap((s) => s.actions.map((a) => a.id))).toEqual(["a1", "a2"]);
    const m = must(moveAction(f, { section: 1, index: 0 }, { section: 0, index: 0 }));
    expect(m.sections.flatMap((s) => s.actions.map((a) => `${a.id}:${a.target.kind === "workflow" ? a.target.name : ""}`))).toEqual(["a1:y", "a2:x"]);
  });

  it("上限を超える追加・移動は断る", () => {
    let f = emptyApp();
    for (let i = 0; i < 20; i++) f = must(insertField(f, { section: 0, index: i }, newField(f, "text", `項目${i}`)));
    expect(insertField(f, { section: 0, index: 0 }, newField(f, "text"))).toEqual({ ok: false, problem: "limit_section_fields" });
    f = must(insertSection(f, 1));
    f = must(insertField(f, { section: 1, index: 0 }, newField(f, "text", "X")));
    expect(moveField(f, { section: 1, index: 0 }, { section: 0, index: 0 })).toEqual({ ok: false, problem: "limit_section_fields" });
    let g = emptyApp();
    for (let i = 0; i < 3; i++) g = must(insertAction(g, { section: 0, index: i }, newAction(g, "w")));
    expect(insertAction(g, { section: 0, index: 0 }, newAction(g, "w"))).toEqual({ ok: false, problem: "limit_actions" });
    for (let i = 0; i < 5; i++) g = must(insertSection(g, 1));
    expect(insertSection(g, 0)).toEqual({ ok: false, problem: "limit_sections" });
  });

  it("最後の機能を消しても空の機能が 1 つ残る", () => {
    expect(must(removeSection(emptyApp(), 0)).sections.length).toBe(1);
    expect(labels(must(removeField(two(), { section: 0, index: 1 })))[0]).toEqual(["A", "C"]);
  });
});

describe("editor: チェッカー（記法で書けないもの）", () => {
  const one = (patch: Partial<AppField>, type: AppField["type"] = "text"): AppFigure => {
    let f = emptyApp();
    f = must(insertField(f, { section: 0, index: 0 }, newField(f, type)));
    f = must(insertAction(f, { section: 0, index: 0 }, newAction(f, "w")));
    return must(updateField(f, { section: 0, index: 0 }, patch));
  };

  it.each<[string, Partial<AppField>, AppField["type"], string, string]>([
    ["ラベルの =", { label: "A = B", key: "A = B" }, "text", "label_char", "label"],
    ["ラベルの先頭の #", { label: "# 見出し", key: "# 見出し" }, "text", "label_start", "label"],
    ["ラベルの全角英数", { label: "ＡＢＣ", key: "ＡＢＣ" }, "text", "label_width", "label"],
    ["key の形", { key: "送る 名前" }, "text", "key_format", "key"],
    ["例の中の予約語", { placeholder: "multi line" }, "text", "reserved_word", "placeholder"],
    ["例の中の as", { placeholder: "Alice as owner" }, "text", "reserved_word", "placeholder"],
    ["最小だけ", { min: 1 }, "number", "half_range", "max"],
    ["最小 > 最大", { min: 9, max: 1 }, "number", "range_order", "min"],
    ["単位が数字で始まる", { unit: "1.. 円" }, "number", "unit_number", "unit"],
    ["選択肢の =", { options: [{ label: "a=b", value: "a=b" }, { label: "c", value: "c" }] }, "choice", "option_char", "options"],
    ["選択肢のその他", { options: [{ label: "a", value: "a" }, { label: "その他", value: "その他" }] }, "choice", "option_other", "options"],
    ["選択肢が 1 つ", { options: [{ label: "a", value: "a" }] }, "choice", "options_few", "options"],
    ["評価の段階", { max: 20 }, "rating", "rating_max", "max"],
    ["ラベルの先頭の note:", { label: "note: 備考", key: "note: 備考" }, "text", "label_start", "label"],
    ["例の前後の空白", { placeholder: " 例えば " }, "text", "spaces", "placeholder"],
    ["例を持てない種類の例", { placeholder: "x" }, "date", "no_placeholder", "placeholder"],
    ["単位が .. で始まる", { unit: "..円" }, "number", "unit_number", "unit"],
    ["選択肢の中の as", { options: [{ label: "as x", value: "as x" }, { label: "c", value: "c" }] }, "choice", "reserved_word", "options"],
  ])("%s は場所つきのエラーになり、往復で変わることを未然に防ぐ", (_, patch, type, code, prop) => {
    const f = one(patch, type);
    const p = checkApp(f).find((x) => x.code === code);
    expect(p).toMatchObject({ severity: "error", path: { section: 0, field: 0, prop } });
    expect(p!.message.length).toBeGreaterThan(5);
  });

  it("選択肢の中の | は書ける（\\| で保存される）", () => {
    const f = one({ options: [{ label: "A|B", value: "A|B" }, { label: "全角｜も", value: "全角｜も" }] }, "choice");
    expect(hasErrors(checkApp(f, W))).toBe(false);
    expect(toSource(f)).toContain("A\\|B | 全角\\｜も");
    expect(same(back(f), f)).toBe(true);
  });

  it("機能が 2 つ以上なら見出しが要る・空の機能は保存できない", () => {
    let f = one({});
    f = must(insertSection(f, 1));
    f = must(updateSection(f, 0, { title: "" }));
    expect(codes(f)).toEqual(expect.arrayContaining(["section_title", "empty_section"]));
    expect(problemsAt(checkApp(f), { section: 1 }).map((p) => p.code)).toContain("empty_section");
  });

  it("どの規則にも当たらない組み合わせも、往復の検査で場所つきで捕まえる", () => {
    // 初期値に選択肢に無い値（パーサは読まずに落とす）
    const f = one({ options: [{ label: "a", value: "a" }, { label: "b", value: "b" }], initial: "z" }, "choice");
    const p = checkApp(f, W).find((x) => x.code === "round_trip");
    expect(p).toMatchObject({ path: { section: 0, field: 0, prop: "initial" } });
    expect(p!.message).toContain("初期値");
  });

  it("改行になる文字（\\r など）はどこにも入れられない（Markdown の描画と読み方がずれるため）", () => {
    for (const label of ["a\rb", "a\u2028b"]) expect(codes(one({ label, key: label }))).toContain("newline");
    expect(codes(one({ options: [{ label: "a\rb", value: "a\rb" }, { label: "c", value: "c" }] }, "choice"))).toContain("newline");
  });

  it("英語のメッセージ", () => {
    const f = one({ label: "A = B", key: "A = B" });
    expect(checkApp(f, { locale: "en" }).find((p) => p.code === "label_char")!.message).toMatch(/can't contain "="/);
  });
});

describe("editor: 既定は閉じた側", () => {
  it("実行先を渡さなければ、どのワークフローも会話も選べない", () => {
    let f = emptyApp();
    f = must(insertAction(f, { section: 0, index: 0 }, newAction(f, "どれか")));
    f = must(insertAction(f, { section: 0, index: 1 }, newAction(f, null)));
    expect(codes(f)).toEqual(expect.arrayContaining(["unknown_workflow", "chat_not_allowed"]));
    expect(codes(f, { workflows: [{ name: "どれか" }], allowChat: true })).not.toContain("unknown_workflow");
  });

  it("ラベルと同じ key はラベルに付いてくる・英字の key は残る", () => {
    let f = emptyApp();
    f = must(insertField(f, { section: 0, index: 0 }, newField(f, "text", "件名")));
    f = must(insertField(f, { section: 0, index: 1 }, { ...newField(f, "number", "金額"), key: "amount" }));
    f = must(updateField(f, { section: 0, index: 0 }, { label: "題名" }));
    f = must(updateField(f, { section: 0, index: 1 }, { label: "合計" }));
    expect(f.sections[0]!.fields.map((x) => `${x.label}:${x.key}`)).toEqual(["題名:題名", "合計:amount"]);
  });

  it("workflow のボタンは足すときも確認を挟む", () => {
    const f = must(insertAction(emptyApp(), { section: 0, index: 0 }, { id: "", label: "x", target: { kind: "workflow", name: "w" }, confirm: false }));
    expect(f.sections[0]!.actions[0]!.confirm).toBe(true);
  });
});

describe("editor: チェッカー（実行先）", () => {
  const app = (): AppFigure => {
    let f = emptyApp();
    f = must(insertField(f, { section: 0, index: 0 }, { ...newField(f, "number", "金額"), key: "amount" }));
    f = must(insertField(f, { section: 0, index: 1 }, newField(f, "text", "メモ")));
    return must(insertAction(f, { section: 0, index: 0 }, newAction(f, "経費申請")));
  };
  const workflows = [{ name: "経費申請", inputs: [{ key: "amount", type: "number" as const, required: true }, { key: "category", label: "区分", type: "choice" as const, required: true }] }];

  it("選べないワークフロー・会話に送れない場所", () => {
    expect(codes(app(), { workflows: [{ name: "別" }] })).toContain("unknown_workflow");
    const chat = must(updateAction(app(), { section: 0, index: 0 }, { target: { kind: "chat" } }));
    expect(codes(chat, { allowChat: false })).toContain("chat_not_allowed");
  });

  it("入力の突き合わせ: 足りない必須・必須の付け忘れ・知らない名前（警告）", () => {
    const ps = checkApp(app(), { workflows });
    expect(ps.filter((p) => p.severity === "error")).toEqual([]);
    expect(ps.map((p) => p.code).sort()).toEqual(["input_required", "missing_input", "unknown_input"]);
    expect(ps.find((p) => p.code === "missing_input")!.message).toContain("区分");
  });

  it("workflow のボタンは必ず確認を挟む", () => {
    const f = must(updateAction(app(), { section: 0, index: 0 }, { confirm: false }));
    expect(f.sections[0]!.actions[0]!.confirm).toBe(true);
  });
});

describe("editor: ソースから開く", () => {
  it("診断の無いブロックだけ開ける（読めない行を黙って落とさない）", () => {
    expect(checkEditable("app x\n金額 = number 必須\nbutton 送る -> workflow w\n").ok).toBe(true);
    const bad = checkEditable("app x\n金額 = number 必須\nこれは読めない\n");
    expect(bad).toMatchObject({ ok: false, reason: "diagnostics" });
    expect(!bad.ok && bad.diagnostics[0]!.line).toBe(3);
    expect(checkEditable("bar x\na | 1\n")).toMatchObject({ ok: false, reason: "not_app" });
  });

  it("書き方の違うソースも開け、正規形で書き直される", () => {
    const r = checkEditable("app x\n- 金額 = 数値 required 円 as amount\nボタン 送る -> ワークフロー 経費申請 確認\n");
    expect(r.ok).toBe(true);
    expect(r.ok && toSource(r.figure)).toBe("app x\n金額 = number 円 必須 as amount\nbutton 送る -> workflow 経費申請\n");
  });
});

describe("editor: 不変条件（乱数）", () => {
  // 記法の区切り・予約語・全角・空白を混ぜた文字片
  const PIECES = ["A", "金額", " ", "=", "＝", "|", "\\", "->", "#", "> ", "- ", "1. ", "必須", "multi", "as x", "例", "初期", "1..", "..2", "ＡＢ", "（", "、", ",", "その他", "button ", "note: ", "[1]", "\n"];
  let seed = 7;
  // 32 ビットの線形合同法。下位ビットは周期が短いので、上位ビットから取る（偏らずに全部の文字片を選ぶため）
  const rand = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return (seed >>> 8) % n;
  };
  const text = () => Array.from({ length: 1 + rand(4) }, () => PIECES[rand(PIECES.length)]).join("");

  it("エラーが無ければ、保存しても内容が変わらない（5000 通り）", () => {
    let checked = 0;
    for (let i = 0; i < 5000; i++) {
      let f = emptyApp(rand(3) ? "画面" : text());
      const type = FIELD_TYPES[rand(FIELD_TYPES.length)]!;
      f = must(insertField(f, { section: 0, index: 0 }, newField(f, type)));
      const patch: Partial<AppField> = { label: text() };
      patch.key = rand(2) ? patch.label : text();
      if (rand(2)) patch.placeholder = text();
      if (type === "number" && rand(2)) patch.unit = text();
      if (type === "choice") patch.options = [text(), text(), text()].map((v) => ({ label: v, value: v }));
      if (rand(3) === 0) patch.initial = text();
      f = must(updateField(f, { section: 0, index: 0 }, patch));
      f = must(insertAction(f, { section: 0, index: 0 }, { ...newAction(f, "w"), label: text() }));
      if (rand(2)) f = must(insertSection(f, 1, rand(2) ? text() : undefined));
      const ps = checkApp(f, W);
      if (!hasErrors(ps)) {
        checked++;
        expect(same(back(f), f), toSource(f)).toBe(true);
      }
    }
    // 意味のある数の図がエラーなしで通っていること（全部エラーでは検査にならない）
    expect(checked).toBeGreaterThan(60);
    // 文字片がすべて選ばれていること（乱数が偏ると検査の範囲が狭くなる）
    seed = 7;
    expect(new Set(Array.from({ length: 2000 }, () => rand(PIECES.length))).size).toBe(PIECES.length);
  });
});
