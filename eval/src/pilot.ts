/**
 * API を使わない予備評価（パイロット）。
 *
 * 実モデルの API が用意できるまで、エージェント（例: Claude のサブエージェント）に「評価対象のモデル役」を
 * させる。プロンプトをファイルに書き出し（export）、エージェントが書いた回答ファイルを取り込んで採点する（ingest）。
 *
 * 本番の評価との違い（レポートにも明記する）:
 * - 方式 A のツール呼び出しは、本文中の `<tool_call name="emit_ui">{…}</tool_call>` で代用する（ネイティブではない）。
 *   検証エラー時の修正は 1 回だけ（exportRepairs で書き出し、エージェントに答え直させる）。
 * - トークン数の代わりに文字数を使う。時間は測らない。
 * - エージェントは自分の system プロンプトの上でモデル役を演じるため、素の API 呼び出しとは条件が違う。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runArm, type ChatFn } from "./arms.js";
import { armApplies, buildMessages, type ArmId, type ShikiTool } from "./prompts.js";
import { resultsPath, type ResultRecord } from "./run.js";
import { scoreTask } from "./score.js";
import type { EvalTask } from "./tasks/types.js";

const SEP = (id: string) => `=== TASK ${id} ===`;
const SEP_RE = /^=== TASK (\S+) ===\s*$/m;

/** 種類ごとに等間隔で n 件ずつ選ぶ（固定）。 */
export function sampleTasks(tasks: EvalTask[], perCategory: number): EvalTask[] {
  const byCat = new Map<string, EvalTask[]>();
  for (const t of tasks) byCat.set(t.category, [...(byCat.get(t.category) ?? []), t]);
  return [...byCat.values()].flatMap((ts) => {
    const k = Math.min(perCategory, ts.length);
    return Array.from({ length: k }, (_, i) => ts[Math.floor((i * ts.length) / k)]!);
  });
}

function toolInstruction(shiki: ShikiTool): string {
  const f = shiki.tool.function;
  return [
    "## 使えるツール",
    "",
    `ツール名: ${f.name}`,
    `説明: ${f.description}`,
    `引数の JSON Schema: ${JSON.stringify(f.parameters)}`,
    "",
    "ツールを呼ぶときは、回答本文の中に次の形で 1 行に書く（引数は JSON）:",
    '<tool_call name="emit_ui">{"spec": { … }}</tool_call>',
    "ツールを呼ばずに文章だけで答えてもよい。",
  ].join("\n");
}

export function exportPrompts(tasks: EvalTask[], arms: ArmId[], dir: string, shiki: ShikiTool | null): string[] {
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const arm of arms) {
    const ts = tasks.filter((t) => armApplies(arm, t) && arm !== "A2");
    if (ts.length === 0) continue;
    // system は方式ごとに全課題で同じなので、先頭に 1 回だけ書く。
    const sys = buildMessages(arm, ts[0]!)[0]!.content!;
    const system = arm === "A" ? `${sys}\n\n${toolInstruction(shiki!)}` : sys;
    const blocks = ts.map((t) => [SEP(t.id), "", "[user]", buildMessages(arm, t)[1]!.content!, ""].join("\n"));
    const path = join(dir, `prompts-${arm}.md`);
    writeFileSync(path, `[system]（全課題で共通）\n${system}\n\n${blocks.join("\n")}\n`);
    files.push(path);
  }
  return files;
}

/** 回答ファイルを課題ごとに分ける。 */
export function splitAnswers(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = text.split(SEP_RE);
  // parts = [前置き, id1, 本文1, id2, 本文2, …]
  for (let i = 1; i + 1 < parts.length; i += 2) out.set(parts[i]!, parts[i + 1]!.trim());
  return out;
}

/** 本文中の `<tool_call name="…">{…}</tool_call>` をツール呼び出しとして取り出す。 */
export function parseToolCalls(text: string): { text: string; toolCalls: { id: string; name: string; arguments: string }[] } {
  const toolCalls: { id: string; name: string; arguments: string }[] = [];
  const rest = text.replace(/<tool_call name="([^"]+)">([\s\S]*?)<\/tool_call>/g, (_, name: string, args: string) => {
    toolCalls.push({ id: `p${toolCalls.length}`, name, arguments: args.trim() });
    return "";
  });
  return { text: rest.trim(), toolCalls };
}

/**
 * 方式 A で検証に失敗した回答について、Shiki と同じ「検証エラーを返して直させる」ターンのプロンプトを書き出す。
 * エージェントの回答は answers-<model>-A-repair.md に書かせ、ingest で 2 回目の応答として使う。
 */
export function exportRepairs(dir: string, model: string, tasks: EvalTask[], shiki: ShikiTool): string[] {
  const recs = readFileSync(resultsPath(dir), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as ResultRecord)
    .filter((r) => r.model === model && r.arm === "A" && r.ok && r.outcome?.extraction.attempted && !r.outcome.firstTrySyntaxOk);
  if (recs.length === 0) return [];
  const answers = splitAnswers(readFileSync(join(dir, `answers-${model}-A.md`), "utf8"));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const sys = `${buildMessages("A", tasks[0]!)[0]!.content}\n\n${toolInstruction(shiki)}`;
  const blocks = recs.map((r) => {
    const t = byId.get(r.taskId)!;
    const errs = r.outcome!.extraction.errors;
    return [
      SEP(t.id),
      "",
      "[user]",
      buildMessages("A", t)[1]!.content!,
      "",
      "[assistant（前回の回答）]",
      answers.get(t.id) ?? "",
      "",
      "[tool（emit_ui の結果）]",
      `UI スペックの検証に失敗しました:\n${errs.map((e) => `- ${e}`).join("\n")}\nエラーを直して再試行するか、通常のテキストで回答してください。`,
      "",
    ].join("\n");
  });
  const path = join(dir, `repair-${model}-A.md`);
  writeFileSync(path, `[system]（全課題で共通）\n${sys}\n\n${blocks.join("\n")}\n`);
  return recs.map((r) => r.taskId);
}

export async function ingestAnswers(opts: {
  dir: string;
  model: string;
  arms: ArmId[];
  tasks: EvalTask[];
  shiki: ShikiTool | null;
  runId: string;
}): Promise<{ ingested: number; missing: string[] }> {
  const byId = new Map(opts.tasks.map((t) => [t.id, t]));
  const missing: string[] = [];
  const records: ResultRecord[] = [];
  for (const arm of opts.arms) {
    const path = join(opts.dir, `answers-${opts.model}-${arm}.md`);
    if (!existsSync(path)) {
      missing.push(path);
      continue;
    }
    const answers = splitAnswers(readFileSync(path, "utf8"));
    const repairPath = join(opts.dir, `answers-${opts.model}-${arm}-repair.md`);
    const repairs = arm === "A" && existsSync(repairPath) ? splitAnswers(readFileSync(repairPath, "utf8")) : new Map<string, string>();
    for (const task of opts.tasks.filter((t) => armApplies(arm, t) && arm !== "A2")) {
      const answer = answers.get(task.id);
      const rec: ResultRecord = {
        key: [task.id, arm, opts.model, "pilot", 0, 0].join("|"),
        runId: opts.runId,
        taskId: task.id,
        category: task.category,
        arm,
        model: opts.model,
        effort: "pilot",
        seed: 0,
        padChars: 0,
        ok: false,
        at: new Date().toISOString(),
      };
      if (answer === undefined) {
        rec.error = "回答がありません";
        missing.push(`${arm}/${task.id}`);
        records.push(rec);
        continue;
      }
      const parsed = arm === "A" ? parseToolCalls(answer) : { text: answer, toolCalls: [] };
      const promptChars = buildMessages(arm, task).reduce((n, m) => n + (m.content?.length ?? 0), 0) + (arm === "A" ? toolInstruction(opts.shiki!).length : 0);
      // 2 回目の呼び出し（A の修正ループ）には、修正ターンの回答があればそれを、無ければ空の応答を返す。
      const repair = repairs.get(task.id);
      let calls = 0;
      const replay: ChatFn = async () => {
        const n = calls++;
        if (n === 0) return { text: parsed.text, toolCalls: parsed.toolCalls, usage: { promptTokens: promptChars, completionTokens: answer.length }, totalMs: 0 };
        if (n === 1 && repair !== undefined) {
          const p2 = parseToolCalls(repair);
          return { text: p2.text, toolCalls: p2.toolCalls, usage: { promptTokens: promptChars + answer.length, completionTokens: repair.length }, totalMs: 0 };
        }
        return { text: "", toolCalls: [], totalMs: 0 };
      };
      const outcome = await runArm(arm, task, replay, opts.shiki);
      // 修正ループは行わない（予備評価では 2 回目の回答が無い）。
      rec.ok = true;
      rec.score = scoreTask(byId.get(task.id)!, outcome.extraction);
      rec.outcome = { ...outcome, turns: repair !== undefined ? 2 : 1, extraction: { ...outcome.extraction, figures: outcome.extraction.figures.length } };
      records.push(rec);
    }
  }
  mkdirSync(opts.dir, { recursive: true });
  const path = resultsPath(opts.dir);
  const kept = existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as ResultRecord)
        .filter((r) => !(r.model === opts.model && opts.arms.includes(r.arm)))
    : [];
  writeFileSync(path, `${[...kept, ...records].map((r) => JSON.stringify(r)).join("\n")}\n`);
  return { ingested: records.filter((r) => r.ok).length, missing };
}

export const PILOT_NOTES = [
  "> **予備評価（パイロット）**: 実モデルの API の代わりに、エージェントが「評価対象のモデル役」として回答した結果。",
  "> 方式 A のツール呼び出しは本文中の `<tool_call>` で代用し、修正ループは 1 回（検証エラーを渡して答え直させる）。トークン列は文字数、時間は未計測。本番の評価の代わりにはならない。",
];
