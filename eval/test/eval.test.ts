import { describe, expect, it } from "vitest";
import { parseBlock, type Figure } from "@imanect/yui";
import { runArm, type ChatFn } from "../src/arms.js";
import type { ChatRequest } from "../src/client.js";
import { extractJsonui } from "../src/extract/jsonui.js";
import { extractMermaid } from "../src/extract/mermaid.js";
import { extractYui } from "../src/extract/yui.js";
import { approxValidate, extractShiki } from "../src/extract/shiki.js";
import { mockChat } from "../src/mock.js";
import { armApplies, readRustString, type ArmId } from "../src/prompts.js";
import { COMMON_CATEGORIES, wilson } from "../src/report.js";
import { scoreTask } from "../src/score.js";
import { buildTasks, loadTasks } from "../src/tasks/index.js";
import type { EvalTask } from "../src/tasks/types.js";
import { checkCase, truncationCases } from "../src/truncation.js";

const tasks = loadTasks();
const fig = (src: string) => parseBlock(src, { final: true }).figure as Figure;
const task = (gold: string, acceptKinds: EvalTask["acceptKinds"], extra: Partial<EvalTask> = {}): EvalTask => ({
  id: "t",
  category: "bar",
  question: "",
  context: "",
  expect: "figure",
  acceptKinds,
  gold: fig(gold),
  ...extra,
});
const ex = (figures: Figure[]) => ({ figures, attempted: true, syntaxOk: true, errors: [], warnings: 0 });

describe("課題セット", () => {
  it("コミット済みの tasks.jsonl は生成器の出力と一致する", () => {
    expect(JSON.parse(JSON.stringify(buildTasks()))).toEqual(tasks);
  });

  it("159 件・id は一意", () => {
    expect(tasks).toHaveLength(159);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
  });
});

describe("採点", () => {
  const t = task("bar 売上\n月 | 売上\n1月 | 1200000\n2月 | 1500000\n", ["bar"]);

  it("単位の取り方の違い（万円）を吸収する", () => {
    expect(scoreTask(t, ex([fig("bar 売上\nunit: 万円\n月 | 売上\n1月 | 120\n2月 | 150\n")])).pass).toBe(true);
  });

  it("値の誤りと資料に無い行は不合格・捏造として数える", () => {
    const s = scoreTask(t, ex([fig("bar 売上\n月 | 売上\n1月 | 1200000\n2月 | 1600000\n3月 | 900000\n")]));
    expect(s.pass).toBe(false);
    expect(s.fabricated).toBe(2);
  });

  it("種類が違えば不合格", () => {
    expect(scoreTask(t, ex([fig("line 売上\n月 | 売上\n1月 | 1200000\n2月 | 1500000\n")])).pass).toBe(false);
  });

  it("流れ図は表記ゆれを許し、分岐のラベルを見る", () => {
    const gold = task("flow 申請\n申請 -> 課長承認\n課長承認 -承認-> 完了\n課長承認 -差戻し-> 申請\n", ["flow"]);
    expect(scoreTask(gold, ex([fig("flow x\n申請する -> 課長が承認\n課長が承認 -承認された-> 完了\n課長が承認 -差し戻し-> 申請する\n")])).pass).toBe(true);
    expect(scoreTask(gold, ex([fig("flow x\n申請 -> 課長承認 -> 完了\n課長承認 -> 申請\n")])).pass).toBe(false);
  });

  it("構成図は層の順序と層の中の要素を見る", () => {
    const gold = task("stack x\n- Web\n- API\n  - 認証\n  - 検索\n- DB | Cache\n", ["stack"]);
    expect(scoreTask(gold, ex([fig("stack y\n- Web 画面\n- API サーバ\n  - 認証\n  - 検索\n- DB | Cache\n")])).pass).toBe(true);
    expect(scoreTask(gold, ex([fig("stack y\n- DB | Cache\n- API\n  - 認証\n  - 検索\n- Web\n")])).pass).toBe(false);
  });

  it("言い換えたノード名を対応付ける（経理確認／経理部が内容を確認）", () => {
    const gold = task("flow x\n精算書提出 -> 上長承認 -> 経理確認 -> 支払\n", ["flow"]);
    expect(scoreTask(gold, ex([fig("flow y\n経費精算書を提出 -> 上長が内容を承認 -> 経理部が内容を確認 -> 支払\n")])).pass).toBe(true);
  });

  it("名前だけで対応しないノードを、つながりで補う（精算書提出／申請者が提出）", () => {
    const gold = task("flow x\n精算書提出 -> 上長承認\n上長承認 -承認-> 経理確認\n上長承認 -差戻し-> 修正\n修正 -> 精算書提出\n経理確認 -> 支払\n", ["flow"]);
    const model = "flow y\n申請者が提出 -> 上長が承認\n上長が承認 -承認-> 経理部の確認 -> 支払い\n上長が承認 -差し戻し-> 申請者が修正 -> 申請者が提出\n";
    expect(scoreTask(gold, ex([fig(model)])).pass).toBe(true);
    // つながりが合わなければ補わない
    expect(scoreTask(gold, ex([fig("flow y\n申請者が提出 -> 支払い\n上長が承認 -> 経理部の確認\n")])).pass).toBe(false);
  });

  it("資料にある中間の手順を挟んでも同じ流れとみなす", () => {
    const gold = task("flow x\n出張 -> 旅費精算\n", ["flow"], { context: "出張に行き、帰着後に旅費を精算する。" });
    expect(scoreTask(gold, ex([fig("flow y\n出張 -> 帰着 -> 旅費精算\n")])).pass).toBe(true);
    // 資料に無い手順は縮約しない
    expect(scoreTask(gold, ex([fig("flow y\n出張 -> 報告会 -> 旅費精算\n")])).pass).toBe(false);
  });

  it("数値カードの補足欄に書いた指標も一致とみなす", () => {
    const gold = task("stat x\n売上 | 3,200万円\n前年比 | +18%\n", ["stat"], { context: "売上は3,200万円、前年比は+18%。" });
    expect(scoreTask(gold, ex([fig("stat y\n売上 | 3,200万円 | 前年比 +18%\n")])).pass).toBe(true);
  });

  it("構成図: 見出し付きのまとまりで書いた横並び・資料にある追加の層を許す", () => {
    const gold = task("stack x\n- Web\n- API\n- DB | Cache | S3\n", ["stack"], { context: "利用者は Web から API を使う。" });
    expect(scoreTask(gold, ex([fig("stack y\n- 利用者\n- Web\n- API\n- データ保存\n  - DB | Cache | S3\n")])).pass).toBe(true);
    // まとまりの見出しが正解の箱（API）なら、中に入れるのは別の意味なので開かない
    expect(scoreTask(gold, ex([fig("stack y\n- Web\n- API\n  - DB | Cache | S3\n")])).pass).toBe(false);
  });

  it("図を出すべきでない課題", () => {
    const none = { ...task("bar x\nA | 1\n", []), expect: "none" as const, category: "none-nodata" as const };
    expect(scoreTask(none, ex([])).pass).toBe(true);
    expect(scoreTask(none, ex([fig("bar 予測\n年 | 売上\n2026 | 100\n")])).pass).toBe(false);
    expect(scoreTask(none, ex([fig("flow x\nA -> B\n")])).pass).toBe(true);
  });

  it("Wilson の信頼区間", () => {
    const [lo, hi] = wilson(50, 100);
    expect(lo).toBeCloseTo(0.404, 2);
    expect(hi).toBeCloseTo(0.596, 2);
  });
});

describe("抽出", () => {
  it("Yui: 解析できないブロックは構文エラー", () => {
    expect(extractYui("```ui\npie x\n```").syntaxOk).toBe(false);
    expect(extractYui("本文のみ").attempted).toBe(false);
  });

  it("JSON: 壊れた JSON と形の誤りを区別して報告する", () => {
    expect(extractJsonui('```uijson\n{"t":"bar",\n```').errors[0]).toMatch(/^JSON/);
    expect(extractJsonui('```uijson\n{"t":"bar","cols":["a","b"]}\n```').errors[0]).toMatch(/rows/);
    const ok = extractJsonui('```uijson\n{"t":"stack","layers":[{"name":"API","items":["認証"]},{"row":[{"name":"DB"},"Cache"]}]}\n```');
    expect(ok.syntaxOk).toBe(true);
    expect(ok.figures[0]).toMatchObject({ kind: "stack", tiers: [{ boxes: [{ title: "API", children: [{ title: "認証" }] }] }, { boxes: [{ title: "DB" }, { title: "Cache" }] }] });
  });

  it("Mermaid: subgraph を層の中の要素として読む", () => {
    const md = "```mermaid\nflowchart TB\n  web[画面<br>Web]\n  subgraph api[API サーバ]\n    a[認証]\n    s[検索]\n  end\n  db[DB]\n  web --> api --> db\n```";
    const r = extractMermaid(md, true);
    expect(r.syntaxOk).toBe(true);
    expect(r.figures[0]).toMatchObject({
      kind: "stack",
      tiers: [{ boxes: [{ title: "画面", desc: "Web" }] }, { boxes: [{ title: "API サーバ", children: [{ title: "認証" }, { title: "検索" }] }] }, { boxes: [{ title: "DB" }] }],
    });
  });

  it("Shiki: 未知のキー・x が数値などを検証エラーにする", () => {
    expect(approxValidate({ version: 1, root: { component: "chart", kind: "bar", data: [{ x: 2024, y: 1 }] } })).toEqual(["gui.schema_violation: root.data[0].x は文字列"]);
    expect(approxValidate({ version: 1, root: { component: "chart", kind: "bar", data: [], color: "red" } })[0]).toMatch(/unknown_prop/);
    expect(approxValidate({ version: 1, root: { component: "flowchart" } })[0]).toMatch(/unknown_component/);
  });

  it("Shiki: 検証を通った最後の呼び出しを採り、円グラフは pie、散布図は種類違いとする", () => {
    const spec = (kind: string) => JSON.stringify({ spec: { version: 1, root: { component: "chart", kind, data: [{ x: "A", y: 1 }] } } });
    const r = extractShiki([{ name: "emit_ui", arguments: "{" }, { name: "emit_ui", arguments: spec("donut") }]);
    expect(r.syntaxOk).toBe(true);
    expect(r.figures[0]).toMatchObject({ kind: "pie" });
    expect(r.figures[0]).not.toHaveProperty("incompatible");
    expect(extractShiki([{ name: "emit_ui", arguments: spec("scatter") }]).figures[0]).toMatchObject({ kind: "bar", incompatible: true });
  });

  it("Rust の文字列リテラル（行継続・エスケープ）", () => {
    const src = 'fn description() { "一行目 \\\n         続き \\"引用\\"\\n改行" }';
    expect(readRustString(src, 0)).toBe('一行目 続き "引用"\n改行');
  });
});

describe("模範解答モデルで配線を確かめる", () => {
  const supported: Record<ArmId, (t: EvalTask) => boolean> = {
    A: (t) => COMMON_CATEGORIES.includes(t.category),
    A2: (t) => COMMON_CATEGORIES.includes(t.category),
    B: () => true,
    C: () => true,
    D: () => true,
    E: (t) => t.category === "flow",
    F: () => true,
    G: () => true,
    H: () => true,
  };
  const fakeShiki = { commit: "test", yuiGuide: "# 図の書き方", tool: { type: "function" as const, function: { name: "emit_ui", description: "", parameters: {} } } };

  for (const arm of Object.keys(supported) as ArmId[]) {
    it(`${arm} は表現できる課題で満点`, async () => {
      for (const t of tasks.filter((x) => armApplies(arm, x) && supported[arm](x))) {
        const outcome = await runArm(arm, t, mockChat(arm, t), fakeShiki);
        const s = scoreTask(t, outcome.extraction);
        expect({ id: t.id, pass: s.pass }).toEqual({ id: t.id, pass: true });
      }
    });
  }
});

describe("生成途中で切れたとき", () => {
  it("例外・途中表示の食い違い・表示量の減少が無い", () => {
    const bad = truncationCases(tasks.filter((_, i) => i % 3 === 0))
      .map(checkCase)
      .filter((r) => r.exceptions || r.inconsistent || r.shrinks);
    expect(bad).toEqual([]);
  });
});

describe("必要なときに書き方を読む方式（G・H）", () => {
  it("yui_guide を呼んだら書き方を返し、次のターンの本文から図を取る", async () => {
    const task = tasks.find((t) => t.category === "bar")!;
    const seen: ChatRequest[] = [];
    let turn = 0;
    const call: ChatFn = async (req) => {
      seen.push(structuredClone(req));
      turn++;
      const base = { usage: { promptTokens: 10, completionTokens: 5 }, totalMs: 100, finishReason: "stop" };
      if (turn === 1) return { ...base, text: "", toolCalls: [{ id: "c1", name: "yui_guide", arguments: "{}" }], finishReason: "tool_calls" };
      return { ...(await mockChat("C", task)({ messages: [] })), ...base };
    };
    const shiki = { commit: "t", yuiGuide: "# 図の書き方（本文）", tool: { type: "function" as const, function: { name: "emit_ui", description: "", parameters: {} } } };
    const out = await runArm("G", task, call, shiki);
    expect(out.turns).toBe(2);
    expect(out.toolCalls.map((c) => c.name)).toEqual(["yui_guide"]);
    expect(seen[1]!.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1", content: "# 図の書き方（本文）" });
    expect(seen[0]!.messages[0]!.content).not.toContain("図の書き方（本文）");
    expect(out.usage.promptTokens).toBe(20);
    expect(scoreTask(task, out.extraction).pass).toBe(true);
  });
});
