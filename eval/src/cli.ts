/**
 * 評価の CLI。
 *
 *   pnpm eval build-tasks                 課題を生成して eval/tasks/tasks.jsonl に書く
 *   pnpm eval prompts [--shiki-root DIR]  方式ごとのプロンプトの大きさを表示する
 *   pnpm eval truncation                  生成途中で切れたときの検証（モデル不要）
 *   pnpm eval run --models gemma,luna --arms A,B,C,D,E [--efforts low] [--seeds 3] [--mock] ...
 *   pnpm eval report <dir> [--effort low] レポートを <dir>/report.md に書く
 *   pnpm eval rescore <dir>               保存した出力を採点し直す
 *   pnpm eval pilot-export --dir D [--per-category 3] [--arms A,B,C,D,E]
 *                                         予備評価: プロンプトを D/prompts-<方式>.md に書き出す
 *   pnpm eval pilot-repair-export --dir D --model M
 *                                         予備評価: 方式 A の検証エラーを返す修正ターンを D/repair-<M>-A.md に書き出す
 *   pnpm eval pilot-ingest --dir D --model M [--arms …] [--primary M1 --secondary M2]
 *                                         予備評価: D/answers-<M>-<方式>.md を取り込んで採点する
 */

import { UI_REFERENCE_TOOL } from "./arms.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARMS, armApplies, buildMessages, loadShikiTool, type ArmId, type ShikiTool } from "./prompts.js";
import { renderReport } from "./report.js";
import { exportPrompts, exportRepairs, ingestAnswers, PILOT_NOTES, sampleTasks } from "./pilot.js";
import { readResults, rescore, run } from "./run.js";
import { buildTasks, loadTasks, TASKS_PATH } from "./tasks/index.js";
import { checkCase, summarize, truncationCases } from "./truncation.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function flags(argv: string[]): { positional: string[]; opts: Record<string, string | true> } {
  const positional: string[] = [];
  const opts: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts[a.slice(2)] = next;
        i++;
      } else opts[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { positional, opts };
}

const str = (v: string | true | undefined, d: string) => (typeof v === "string" ? v : d);
const list = (v: string | true | undefined, d: string) => str(v, d).split(",").map((s) => s.trim()).filter(Boolean);

function shikiFrom(opts: Record<string, string | true>, arms: readonly ArmId[]): ShikiTool | null {
  if (!arms.some((a) => a === "A" || a === "A2" || a === "F" || a === "G" || a === "H" || a === "I")) return null;
  const root = str(opts["shiki-root"], process.env.SHIKI_ROOT ?? resolve(ROOT, "../shiki-platform"));
  return loadShikiTool(root);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, opts } = flags(rest);
  switch (cmd) {
    case "build-tasks": {
      const tasks = buildTasks();
      writeFileSync(TASKS_PATH, `${tasks.map((t) => JSON.stringify(t)).join("\n")}\n`);
      console.log(`${tasks.length} 件を ${TASKS_PATH} に書きました`);
      return;
    }
    case "prompts": {
      const tasks = loadTasks();
      const shiki = shikiFrom(opts, ARMS);
      const sample = tasks.find((t) => t.category === "bar")!;
      console.log(`Shiki commit: ${shiki?.commit}`);
      console.log("| 方式 | system の文字数 | ツール定義の文字数 |\n|---|---:|---:|");
      for (const arm of ARMS) {
        const sys = buildMessages(arm, sample, undefined, shiki)[0]!.content!.length;
        if ((arm === "A" || arm === "A2") && !shiki?.tool) continue; // emit_ui の無い版の Shiki
        const tool = arm === "A" || arm === "A2" ? JSON.stringify(shiki!.tool).length : arm === "I" ? JSON.stringify(UI_REFERENCE_TOOL).length : 0;
        console.log(`| ${arm} | ${sys} | ${tool} |`);
      }
      return;
    }
    case "truncation": {
      const tasks = loadTasks();
      const results = truncationCases(tasks).map(checkCase);
      const md = summarize(results);
      const out = str(opts.out, join(ROOT, "eval/results/truncation.md"));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${md}\n`);
      console.log(md);
      if (results.some((r) => r.exceptions || r.inconsistent || r.shrinks)) process.exitCode = 1;
      return;
    }
    case "run": {
      const arms = list(opts.arms, "A,B,C,D,E") as ArmId[];
      for (const a of arms) if (!ARMS.includes(a)) throw new Error(`不明な方式: ${a}`);
      const categories = opts.categories === undefined ? null : list(opts.categories, "");
      const ids = opts.tasks === undefined ? null : new Set(list(opts.tasks, ""));
      const limit = opts.limit === undefined ? Infinity : Number(opts.limit);
      const tasks = loadTasks()
        .filter((t) => (categories ? categories.includes(t.category) : true))
        .filter((t) => (ids ? ids.has(t.id) : true))
        .slice(0, limit);
      const runId = str(opts["run-id"], new Date().toISOString().replace(/[:.]/g, "-"));
      const outDir = str(opts.out, join(ROOT, "eval/results", runId));
      const padChars = Number(str(opts["pad-chars"], "0"));
      const cfg = {
        runId,
        outDir,
        models: list(opts.models, "gemma,luna"),
        efforts: list(opts.efforts, "low"),
        arms,
        seeds: Number(str(opts.seeds, "3")),
        tasks,
        concurrency: Number(str(opts.concurrency, "4")),
        shiki: shikiFrom(opts, arms),
        mock: opts.mock === true,
        ...(opts["max-requests"] !== undefined ? { maxRequests: Number(opts["max-requests"]) } : {}),
        ...(padChars > 0 ? { pad: { dir: str(opts["pad-dir"], resolve(ROOT, "../shiki-platform/docs")), chars: padChars } } : {}),
      };
      const planned = cfg.models.length * cfg.efforts.length * cfg.seeds * arms.reduce((n, a) => n + tasks.filter((t) => armApplies(a, t)).length, 0);
      console.log(`課題 ${tasks.length} 件、方式 ${arms.join(",")}、モデル ${cfg.models.join(",")}、effort ${cfg.efforts.join(",")}、各 ${cfg.seeds} 回 → 最大 ${planned} 生成`);
      console.log(`出力先: ${outDir}`);
      await run(cfg);
      const report = renderReport(readResults(outDir), { effort: str(opts.effort, cfg.efforts[0]!) });
      writeFileSync(join(outDir, "report.md"), `${report}\n`);
      console.log(`レポート: ${join(outDir, "report.md")}`);
      return;
    }
    case "report": {
      const dir = positional[0];
      if (!dir) throw new Error("結果のディレクトリを指定してください");
      const report = renderReport(readResults(dir), { effort: str(opts.effort, "low"), primary: str(opts.primary, "gemma"), secondary: str(opts.secondary, "luna") });
      writeFileSync(join(dir, "report.md"), `${report}\n`);
      console.log(report);
      return;
    }
    case "rescore": {
      const dir = positional[0];
      if (!dir) throw new Error("結果のディレクトリを指定してください");
      const n = await rescore(dir, loadTasks(), shikiFrom(opts, ARMS));
      console.log(`${n} 件を採点し直しました`);
      return;
    }
    case "pilot-export": {
      const dir = str(opts.dir, "");
      if (!dir) throw new Error("--dir を指定してください");
      const arms = list(opts.arms, "A,B,C,D,E") as ArmId[];
      const tasks = sampleTasks(loadTasks(), Number(str(opts["per-category"], "3")));
      const files = exportPrompts(tasks, arms, dir, shikiFrom(opts, arms));
      writeFileSync(join(dir, "tasks.json"), JSON.stringify(tasks.map((t) => t.id)));
      console.log(`課題 ${tasks.length} 件: ${tasks.map((t) => t.id).join(", ")}`);
      for (const f of files) console.log(f);
      return;
    }
    case "pilot-repair-export": {
      const dir = str(opts.dir, "");
      const model = str(opts.model, "");
      if (!dir || !model) throw new Error("--dir と --model を指定してください");
      const tasks = sampleTasks(loadTasks(), Number(str(opts["per-category"], "3")));
      const ids = exportRepairs(dir, model, tasks, shikiFrom(opts, ["A"])!);
      console.log(ids.length ? `${model}: 修正ターン ${ids.length} 件（${ids.join(", ")}）→ ${join(dir, `repair-${model}-A.md`)}` : `${model}: 修正が必要な回答はありません`);
      return;
    }
    case "pilot-ingest": {
      const dir = str(opts.dir, "");
      const model = str(opts.model, "");
      if (!dir || !model) throw new Error("--dir と --model を指定してください");
      const arms = list(opts.arms, "A,B,C,D,E") as ArmId[];
      const tasks = sampleTasks(loadTasks(), Number(str(opts["per-category"], "3")));
      const r = await ingestAnswers({ dir, model, arms, tasks, shiki: shikiFrom(opts, arms), runId: `pilot-${model}` });
      console.log(`${model}: ${r.ingested} 件を取り込みました${r.missing.length ? `（欠け: ${r.missing.join(", ")}）` : ""}`);
      const report = renderReport(readResults(dir), {
        effort: "pilot",
        primary: str(opts.primary, "haiku"),
        secondary: str(opts.secondary, "sonnet"),
        notes: PILOT_NOTES,
      });
      writeFileSync(join(dir, "report.md"), `${report}\n`);
      console.log(`レポート: ${join(dir, "report.md")}`);
      return;
    }
    default:
      console.log("使い方: pnpm eval <build-tasks|prompts|truncation|run|report|rescore> …（eval/src/cli.ts の冒頭を参照）");
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
