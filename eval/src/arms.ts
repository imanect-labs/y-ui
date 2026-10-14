/** 1 課題 × 1 方式を実行し、抽出結果を返す。 */

import { isEmpty, parseMarkdown } from "@imanect/yui";
import { chat, type ChatMessage, type ChatRequest, type ChatResult, type Endpoint, type ToolDef } from "./client.js";
import { chatGemini } from "./gemini.js";
import { chatResponses } from "./responses.js";
import { extractJsonui } from "./extract/jsonui.js";
import { extractMermaid } from "./extract/mermaid.js";
import { extractYui } from "./extract/yui.js";
import { extractShiki } from "./extract/shiki.js";
import { buildMessages, type ArmId, type Padding, type ShikiTool } from "./prompts.js";
import type { Extraction } from "./score.js";
import type { EvalTask } from "./tasks/types.js";

/** Shiki と同じく、検証に失敗したら最大 2 回まで直させる。 */
const SHIKI_MAX_REPAIRS = 2;

export type ChatFn = (req: ChatRequest, figureReady?: (text: string) => boolean) => Promise<ChatResult>;

export function endpointChat(ep: Endpoint): ChatFn {
  if (ep.api === "gemini") return (req, figureReady) => chatGemini(ep, req, figureReady);
  if (ep.api === "responses") return (req, figureReady) => chatResponses(ep, req, figureReady);
  return (req, figureReady) => chat(ep, req, figureReady);
}

export interface ArmOutcome {
  extraction: Extraction;
  /** 1 回目の出力で構文が通ったか（A の修正ループの効果を分けて見る）。 */
  firstTrySyntaxOk: boolean;
  text: string;
  toolCalls: { name: string; arguments: string }[];
  turns: number;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number };
  ttftMs?: number;
  firstFigureMs?: number;
  totalMs: number;
  promptChars: number;
  /** 各ターンの生成の終わり方（stop / tool_calls / MAX_TOKENS / MALFORMED_FUNCTION_CALL など）。 */
  finishReasons: string[];
}

/** ストリーミング中に、Yui の図が 1 行以上描ける状態になったか。 */
function yuiReady(text: string): boolean {
  return parseMarkdown(text).some((s) => s.type === "ui" && s.result.figure !== null && !isEmpty(s.result.figure));
}

function fenceClosed(lang: string): (text: string) => boolean {
  const re = new RegExp(`^ {0,3}(\`{3,}|~{3,})\\s*${lang}\\s*\\n[\\s\\S]*?\\n {0,3}\\1\\s*$`, "m");
  return (text) => re.test(text);
}

function addUsage(acc: ArmOutcome["usage"], r: ChatResult): void {
  acc.promptTokens += r.usage?.promptTokens ?? 0;
  acc.completionTokens += r.usage?.completionTokens ?? 0;
  acc.reasoningTokens += r.usage?.reasoningTokens ?? 0;
}

export async function runArm(arm: ArmId, task: EvalTask, call: ChatFn, shiki: ShikiTool | null, pad?: Padding): Promise<ArmOutcome> {
  const messages = buildMessages(arm, task, pad, shiki);
  const promptChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0) + (arm === "A" || arm === "A2" ? JSON.stringify(shiki?.tool ?? {}).length : 0);
  const usage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };

  if (arm === "A" || arm === "A2") {
    if (!shiki) throw new Error("方式 A には Shiki のソース（--shiki-root）が必要です");
    let elapsed = 0;
    let firstTrySyntaxOk = true;
    let ttftMs: number | undefined;
    let text = "";
    const allCalls: { name: string; arguments: string }[] = [];
    let ex: ReturnType<typeof extractShiki> | null = null;
    let firstFigureMs: number | undefined;
    let turns = 0;
    const finishReasons: string[] = [];
    for (let attempt = 0; attempt <= SHIKI_MAX_REPAIRS; attempt++) {
      turns++;
      const req: ChatRequest = { messages, tools: [shiki.tool] };
      if (arm === "A2" && attempt === 0) req.toolChoice = { type: "function", function: { name: "emit_ui" } };
      const r = await call(req);
      if (ttftMs === undefined && r.ttftMs !== undefined) ttftMs = elapsed + r.ttftMs;
      elapsed += r.totalMs;
      addUsage(usage, r);
      finishReasons.push(r.finishReason ?? "");
      text += r.text;
      allCalls.push(...r.toolCalls);
      const cur = extractShiki(r.toolCalls);
      if (attempt === 0) firstTrySyntaxOk = cur.syntaxOk;
      if (!ex || cur.figures.length > 0 || cur.attempted) ex = cur;
      const emitted = r.toolCalls.filter((c) => c.name === "emit_ui");
      if (cur.figures.length > 0) {
        firstFigureMs = elapsed;
        break;
      }
      if (emitted.length === 0 || cur.syntaxOk) break;
      // 検証エラーを is_error の観測として返し、直させる（Shiki の emit_ui と同じ流れ）。
      messages.push({
        role: "assistant",
        content: r.text || null,
        tool_calls: r.toolCalls.map((c, i) => ({ id: c.id || `call_${attempt}_${i}`, type: "function" as const, function: { name: c.name, arguments: c.arguments } })),
      });
      r.toolCalls.forEach((c, i) => {
        const errs = cur.validationErrors[i] ?? [];
        messages.push({
          role: "tool",
          tool_call_id: c.id || `call_${attempt}_${i}`,
          content: errs.length === 0 ? "ok" : `UI スペックの検証に失敗しました:\n${errs.map((e) => `- ${e}`).join("\n")}\nエラーを直して再試行するか、通常のテキストで回答してください。`,
        } satisfies ChatMessage);
      });
    }
    const extraction: Extraction = { figures: ex!.figures, attempted: ex!.attempted, syntaxOk: ex!.syntaxOk, errors: ex!.errors, warnings: 0 };
    const out: ArmOutcome = { extraction, firstTrySyntaxOk, text, toolCalls: allCalls, turns, usage, totalMs: elapsed, promptChars, finishReasons };
    if (ttftMs !== undefined) out.ttftMs = ttftMs;
    if (firstFigureMs !== undefined) out.firstFigureMs = firstFigureMs;
    return out;
  }

  if (arm === "G" || arm === "H") return runOnDemand(messages, call, shiki, usage, promptChars);

  const yui = arm === "B" || arm === "C" || arm === "F";
  const ready = yui ? yuiReady : arm === "D" ? fenceClosed("uijson") : fenceClosed("mermaid");
  const r = await call({ messages }, ready);
  addUsage(usage, r);
  const extraction =
    yui ? extractYui(r.text) : arm === "D" ? extractJsonui(r.text) : extractMermaid(r.text, task.category === "stack");
  const out: ArmOutcome = {
    extraction,
    firstTrySyntaxOk: extraction.syntaxOk,
    text: r.text,
    toolCalls: r.toolCalls,
    turns: 1,
    usage,
    totalMs: r.totalMs,
    promptChars,
    finishReasons: [r.finishReason ?? ""],
  };
  if (r.ttftMs !== undefined) out.ttftMs = r.ttftMs;
  if (r.firstFigureMs !== undefined && extraction.figures.length > 0) out.firstFigureMs = r.firstFigureMs;
  return out;
}

/** 方式 G・H で、書き方の全文を返すツール（Shiki の yui_guide.md をそのまま返す）。 */
export const YUI_GUIDE_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "yui_guide",
    description: "回答の中に図（```ui ブロック）を書くための書き方を返す。図を書く前に 1 回呼ぶ。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

/** 書き方を読みに行くための往復の上限（読む → 書く、に 1 回の余裕）。 */
const ON_DEMAND_MAX_TURNS = 3;

/**
 * 方式 G・H: system には短い案内だけを置き、書き方の全文はモデルが yui_guide を呼んだときに返す。
 * 「必要なときだけ読み込む」方式の品質（読みに行くか・読まずに書いて崩れないか）と往復の増分を測る。
 */
async function runOnDemand(
  messages: ChatMessage[],
  call: ChatFn,
  shiki: ShikiTool | null,
  usage: ArmOutcome["usage"],
  promptChars: number,
): Promise<ArmOutcome> {
  if (!shiki?.yuiGuide) throw new Error("方式 G・H には Shiki のソース（--shiki-root）の yui_guide.md が必要です");
  const guide = shiki.yuiGuide;
  let elapsed = 0;
  let text = "";
  let ttftMs: number | undefined;
  let firstFigureMs: number | undefined;
  const allCalls: { id: string; name: string; arguments: string }[] = [];
  const finishReasons: string[] = [];
  let turns = 0;
  for (let i = 0; i < ON_DEMAND_MAX_TURNS; i++) {
    turns++;
    const r = await call({ messages, tools: [YUI_GUIDE_TOOL] }, yuiReady);
    if (ttftMs === undefined && r.ttftMs !== undefined) ttftMs = elapsed + r.ttftMs;
    if (firstFigureMs === undefined && r.firstFigureMs !== undefined) firstFigureMs = elapsed + r.firstFigureMs;
    elapsed += r.totalMs;
    addUsage(usage, r);
    finishReasons.push(r.finishReason ?? "");
    text += r.text;
    allCalls.push(...r.toolCalls);
    if (r.toolCalls.length === 0) break;
    messages.push({
      role: "assistant",
      content: r.text || null,
      tool_calls: r.toolCalls.map((c, j) => ({ id: c.id || `call_${i}_${j}`, type: "function" as const, function: { name: c.name, arguments: c.arguments || "{}" } })),
    });
    r.toolCalls.forEach((c, j) => {
      messages.push({ role: "tool", tool_call_id: c.id || `call_${i}_${j}`, content: c.name === "yui_guide" ? guide : `不明なツール: ${c.name}` });
    });
  }
  const extraction = extractYui(text);
  const out: ArmOutcome = {
    extraction,
    firstTrySyntaxOk: extraction.syntaxOk,
    text,
    toolCalls: allCalls,
    turns,
    usage,
    totalMs: elapsed,
    promptChars: promptChars + JSON.stringify(YUI_GUIDE_TOOL).length,
    finishReasons,
  };
  if (ttftMs !== undefined) out.ttftMs = ttftMs;
  if (firstFigureMs !== undefined && extraction.figures.length > 0) out.firstFigureMs = firstFigureMs;
  return out;
}

