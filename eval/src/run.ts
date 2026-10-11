/** 評価の実行。結果は 1 生成 1 行の JSONL に追記し、途中から再開できる。 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { endpointChat, runArm, type ArmOutcome, type ChatFn } from "./arms.js";
import { HttpError, type Endpoint } from "./client.js";
import { mockChat } from "./mock.js";
import { armApplies, type ArmId, type Padding, type ShikiTool } from "./prompts.js";
import { scoreTask, type Score } from "./score.js";
import type { EvalTask } from "./tasks/types.js";

const MODELS_PATH = join(dirname(fileURLToPath(import.meta.url)), "../models.json");

interface ModelConfig {
  baseUrlEnv: string;
  baseUrlDefault?: string;
  apiKeyEnv: string;
  modelEnv?: string;
  model: string;
  maxTokensParam: "max_tokens" | "max_completion_tokens";
  maxTokens: number;
  effort: Record<string, Record<string, unknown>>;
}

export function loadModels(): Record<string, ModelConfig> {
  const raw = JSON.parse(readFileSync(MODELS_PATH, "utf8")) as Record<string, unknown>;
  delete raw.$comment;
  return raw as Record<string, ModelConfig>;
}

/** 環境変数から接続先を組み立てる。足りない変数があれば名前を挙げて失敗する。 */
export function resolveEndpoint(name: string, effort: string): Endpoint {
  const cfg = loadModels()[name];
  if (!cfg) throw new Error(`models.json に ${name} がありません`);
  const baseUrl = process.env[cfg.baseUrlEnv] ?? cfg.baseUrlDefault;
  const missing: string[] = [];
  if (!baseUrl) missing.push(cfg.baseUrlEnv);
  const apiKey = process.env[cfg.apiKeyEnv];
  if (!apiKey && name !== "gemma") missing.push(cfg.apiKeyEnv);
  if (missing.length > 0) throw new Error(`${name}: 環境変数 ${missing.join(", ")} が必要です`);
  const extraBody = cfg.effort[effort];
  if (!extraBody) throw new Error(`${name}: effort=${effort} の設定が models.json にありません`);
  const ep: Endpoint = {
    baseUrl: baseUrl!,
    model: (cfg.modelEnv && process.env[cfg.modelEnv]) || cfg.model,
    extraBody,
    maxTokensParam: cfg.maxTokensParam,
    maxTokens: cfg.maxTokens,
    timeoutMs: 300_000,
  };
  if (apiKey) ep.apiKey = apiKey;
  return ep;
}

export interface RunConfig {
  runId: string;
  outDir: string;
  models: string[];
  efforts: string[];
  arms: ArmId[];
  seeds: number;
  tasks: EvalTask[];
  concurrency: number;
  shiki: ShikiTool | null;
  pad?: Padding;
  mock: boolean;
}

export interface ResultRecord {
  key: string;
  runId: string;
  taskId: string;
  category: string;
  arm: ArmId;
  model: string;
  effort: string;
  seed: number;
  padChars: number;
  ok: boolean;
  error?: string;
  outcome?: Omit<ArmOutcome, "extraction"> & { extraction: Omit<ArmOutcome["extraction"], "figures"> & { figures: number } };
  score?: Score;
  at: string;
}

export function resultsPath(outDir: string): string {
  return join(outDir, "results.jsonl");
}

export function readResults(outDir: string): ResultRecord[] {
  const p = resultsPath(outDir);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as ResultRecord);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let delay = 2000;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const retriable = (e instanceof HttpError && (e.status === 429 || e.status >= 500)) || (e as Error).name === "AbortError" || (e as Error).name === "TypeError";
      if (!retriable || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

export async function run(cfg: RunConfig, log: (msg: string) => void = console.log): Promise<void> {
  mkdirSync(cfg.outDir, { recursive: true });
  const path = resultsPath(cfg.outDir);
  const done = new Set(readResults(cfg.outDir).filter((r) => r.ok).map((r) => r.key));
  writeFileSync(
    join(cfg.outDir, "config.json"),
    JSON.stringify({ ...cfg, tasks: cfg.tasks.map((t) => t.id), shiki: cfg.shiki ? { commit: cfg.shiki.commit } : null }, null, 2),
  );

  const jobs: (() => Promise<void>)[] = [];
  for (const model of cfg.models) {
    for (const effort of cfg.efforts) {
      const ep = cfg.mock ? null : resolveEndpoint(model, effort);
      for (const arm of cfg.arms) {
        for (const task of cfg.tasks) {
          if (!armApplies(arm, task)) continue;
          for (let seed = 0; seed < cfg.seeds; seed++) {
            const padChars = cfg.pad?.chars ?? 0;
            const key = [task.id, arm, model, effort, seed, padChars].join("|");
            if (done.has(key)) continue;
            jobs.push(async () => {
              const call: ChatFn = ep ? endpointChat(ep) : mockChat(arm, task);
              const rec: ResultRecord = { key, runId: cfg.runId, taskId: task.id, category: task.category, arm, model, effort, seed, padChars, ok: false, at: new Date().toISOString() };
              try {
                const outcome = await withRetry(() => runArm(arm, task, call, cfg.shiki, cfg.pad));
                rec.ok = true;
                rec.score = scoreTask(task, outcome.extraction);
                rec.outcome = { ...outcome, extraction: { ...outcome.extraction, figures: outcome.extraction.figures.length } };
              } catch (e) {
                rec.error = String((e as Error).message ?? e);
              }
              appendFileSync(path, `${JSON.stringify(rec)}\n`);
            });
          }
        }
      }
    }
  }

  log(`実行する生成: ${jobs.length} 件（完了済み ${done.size} 件は飛ばす）`);
  let next = 0;
  let finished = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      await job();
      finished++;
      if (finished % 25 === 0 || finished === jobs.length) log(`  ${finished} / ${jobs.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, cfg.concurrency) }, worker));
}

/** 保存した出力を、現在の抽出・採点で採点し直す（採点の不具合を直したとき用）。 */
export async function rescore(outDir: string, tasks: EvalTask[], shiki: ShikiTool | null): Promise<number> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const recs = readResults(outDir);
  let n = 0;
  const out: string[] = [];
  for (const rec of recs) {
    const task = byId.get(rec.taskId);
    if (rec.ok && rec.outcome && task) {
      const o = rec.outcome;
      const replay: ChatFn = async () => ({ text: o.text, toolCalls: o.toolCalls.map((c, i) => ({ id: `r${i}`, ...c })), totalMs: o.totalMs });
      // A は修正ループの途中経過を保存していないので、最終出力だけで採点し直す。
      const outcome = await runArm(rec.arm === "A2" ? "A" : rec.arm, task, replay, shiki);
      rec.score = scoreTask(task, outcome.extraction);
      n++;
    }
    out.push(JSON.stringify(rec));
  }
  writeFileSync(resultsPath(outDir), `${out.join("\n")}\n`);
  return n;
}
