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
  api?: "openai" | "gemini" | "responses";
  /** 1 分あたりのリクエスト数の上限。 */
  rpm?: number;
  /** 追加で送るヘッダ（秘密情報は書かない）。 */
  headers?: Record<string, string>;
  /** 呼び出しごとの会話 ID を載せるヘッダ名。 */
  sessionHeader?: string;
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
  if (cfg.api) ep.api = cfg.api;
  if (cfg.rpm) ep.rpm = cfg.rpm;
  if (cfg.headers) ep.headers = cfg.headers;
  if (cfg.sessionHeader) ep.sessionHeader = cfg.sessionHeader;
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
  /** この実行で送るリクエスト数の上限（修正ループの再送も数える）。無料枠を超えないための歯止め。 */
  maxRequests?: number;
}

/** 日次の割り当てを使い切った・リクエスト数の上限に達した。ここで実行を止める（再開できる）。 */
export class StopRun extends Error {}

/**
 * 429 の扱い。日次の割り当て切れ（Gemini の `…PerDay…`）なら実行を止める。
 * 分あたりの制限なら、サーバが示す待ち時間（`retryDelay`）だけ待って再送する。
 */
export function classify429(body: string): { daily: boolean; retryMs: number } {
  const daily = /PerDay|per day|daily/i.test(body);
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body) ?? /retry in (\d+(?:\.\d+)?)s/i.exec(body);
  return { daily, retryMs: m ? Math.ceil(Number(m[1]) * 1000) + 1000 : 30_000 };
}

/** リクエストの間隔を空け（rpm）、総数を数える（maxRequests）。全ワーカーで共有する。 */
export function limited(fn: ChatFn, state: { nextAt: number; sent: number }, rpm: number | undefined, maxRequests: number | undefined): ChatFn {
  const interval = rpm ? Math.ceil(60_000 / rpm) : 0;
  return async (req, figureReady) => {
    if (maxRequests !== undefined && state.sent >= maxRequests) throw new StopRun(`リクエスト数の上限（${maxRequests}）に達しました`);
    state.sent++;
    const now = Date.now();
    const at = Math.max(now, state.nextAt);
    state.nextAt = at + interval;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
    return fn(req, figureReady);
  };
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

/**
 * 結果を読む。同じ課題・方式・条件（key）の記録が複数あれば 1 つにまとめる
 * （再開で失敗をやり直した場合など。成功した記録を優先し、その中では後のものを採る）。
 */
export function readResults(outDir: string): ResultRecord[] {
  const p = resultsPath(outDir);
  if (!existsSync(p)) return [];
  const byKey = new Map<string, ResultRecord>();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const r = JSON.parse(line) as ResultRecord;
    const prev = byKey.get(r.key);
    if (!prev || r.ok || !prev.ok) byKey.set(r.key, r);
  }
  return [...byKey.values()];
}

async function withRetry<T>(fn: () => Promise<T>, log: (msg: string) => void): Promise<T> {
  let delay = 2000;
  let rateWaits = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof StopRun) throw e;
      if (e instanceof HttpError && e.status === 429) {
        const q = classify429(e.body);
        if (q.daily) throw new StopRun(`日次の割り当てを使い切りました: ${e.body.slice(0, 300)}`);
        if (++rateWaits > 8) throw new StopRun(`429 が続くため止めます: ${e.body.slice(0, 300)}`);
        log(`  429（分あたりの制限）: ${Math.round(q.retryMs / 1000)} 秒待って再送`);
        await new Promise((r) => setTimeout(r, q.retryMs));
        attempt--;
        continue;
      }
      const retriable = (e instanceof HttpError && e.status >= 500) || (e as Error).name === "AbortError" || (e as Error).name === "TypeError";
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
  const limiterState = { nextAt: 0, sent: 0 };
  let stopped: string | null = null;
  // 課題ごとに全方式を並べる（途中で割り当てが切れても、方式間で同じ課題が揃うように）。
  for (const model of cfg.models) {
    for (const effort of cfg.efforts) {
      const ep = cfg.mock ? null : resolveEndpoint(model, effort);
      for (let seed = 0; seed < cfg.seeds; seed++) {
        for (const task of cfg.tasks) {
          for (const arm of cfg.arms) {
            if (!armApplies(arm, task)) continue;
            const padChars = cfg.pad?.chars ?? 0;
            const key = [task.id, arm, model, effort, seed, padChars].join("|");
            if (done.has(key)) continue;
            jobs.push(async () => {
              const call: ChatFn = ep ? limited(endpointChat(ep), limiterState, ep.rpm, cfg.maxRequests) : mockChat(arm, task);
              const rec: ResultRecord = { key, runId: cfg.runId, taskId: task.id, category: task.category, arm, model, effort, seed, padChars, ok: false, at: new Date().toISOString() };
              try {
                const outcome = await withRetry(() => runArm(arm, task, call, cfg.shiki, cfg.pad), log);
                rec.ok = true;
                rec.score = scoreTask(task, outcome.extraction);
                rec.outcome = { ...outcome, extraction: { ...outcome.extraction, figures: outcome.extraction.figures.length } };
              } catch (e) {
                // 止める理由（割り当て切れ・上限）は結果に残さない（再開時にやり直す）。
                if (e instanceof StopRun) {
                  stopped ??= e.message;
                  return;
                }
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
    while (next < jobs.length && stopped === null) {
      const job = jobs[next++]!;
      await job();
      finished++;
      if (finished % 25 === 0 || finished === jobs.length) log(`  ${finished} / ${jobs.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, cfg.concurrency) }, worker));
  log(`送ったリクエスト: ${limiterState.sent} 件`);
  if (stopped) log(`途中で止めました（同じ --run-id で再開できます）: ${stopped}`);
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
      // A は修正ループの途中経過を、G・H は説明を読みに行く往復を保存していないので、最終出力だけで採点し直す
      // （G・H の最終出力は F と同じく本文中の ```ui ブロック）。
      const arm = rec.arm === "A2" ? "A" : rec.arm === "G" || rec.arm === "H" ? "F" : rec.arm;
      const outcome = await runArm(arm, task, replay, shiki);
      rec.score = scoreTask(task, outcome.extraction);
      n++;
    }
    out.push(JSON.stringify(rec));
  }
  writeFileSync(resultsPath(outDir), `${out.join("\n")}\n`);
  return n;
}
