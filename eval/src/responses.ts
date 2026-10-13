/**
 * OpenAI の Responses API（`/responses`）をストリーミングで呼ぶ。
 * Chat Completions を受け付けず Responses だけで呼べるモデル（OpenCode Go の gpt-6-luna など）向け。
 *
 * 会話はサーバーに持たせない（`store: false`）。思考（reasoning）は本文に含めず、トークン数だけ数える。
 * 終わり方は Chat Completions と同じ名前に揃える（`stop` / `tool_calls` / `length`）。
 */

import { randomUUID } from "node:crypto";
import { HttpError, type ChatMessage, type ChatRequest, type ChatResult, type Endpoint } from "./client.js";

/** Responses は小さな上限を 400 で拒否する（実測の下限）。 */
const MIN_OUTPUT_TOKENS = 16;

/** OpenAI 形式のメッセージを Responses の instructions と入力アイテムに写す。 */
export function toResponsesInput(messages: ChatMessage[]): { instructions?: string; input: unknown[] } {
  const instructions = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content ?? "")
    .join("\n\n");
  const input: unknown[] = [];
  for (const m of messages) {
    if (m.role === "user") input.push({ role: "user", content: m.content ?? "" });
    else if (m.role === "assistant") {
      if (m.content) input.push({ role: "assistant", content: m.content });
      for (const c of m.tool_calls ?? []) {
        input.push({ type: "function_call", call_id: c.id, name: c.function.name, arguments: c.function.arguments || "{}" });
      }
    } else if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: m.tool_call_id ?? "", output: m.content ?? "" });
    }
  }
  return instructions ? { instructions, input } : { input };
}

/** リクエスト本文を組み立てる（I/O から切り離して単体で確かめる）。 */
export function buildResponsesBody(ep: Endpoint, req: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: ep.model,
    ...toResponsesInput(req.messages),
    stream: true,
    store: false,
    max_output_tokens: Math.max(ep.maxTokens, MIN_OUTPUT_TOKENS),
    ...ep.extraBody,
  };
  if (req.tools) {
    // Responses のツール定義は function の中身が平ら。既定の strict は任意の引数まで必須に書き換えるので切る。
    body.tools = req.tools.map((t) => ({ type: "function", name: t.function.name, description: t.function.description, parameters: t.function.parameters, strict: false }));
  }
  if (req.toolChoice) body.tool_choice = req.toolChoice === "auto" ? "auto" : { type: "function", name: req.toolChoice.function.name };
  return body;
}

interface ResponsesEvent {
  type?: string;
  delta?: string;
  item?: { type?: string; call_id?: string; name?: string; arguments?: string };
  response?: {
    status?: string;
    error?: { code?: string; message?: string } | null;
    incomplete_details?: { reason?: string } | null;
    usage?: { input_tokens?: number; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
  };
  error?: { code?: string; message?: string };
  message?: string;
}

export async function chatResponses(ep: Endpoint, req: ChatRequest, figureReady?: (text: string) => boolean): Promise<ChatResult> {
  const started = performance.now();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {}),
    ...(ep.headers ?? {}),
  };
  // 会話 ID を求めるプロバイダ向け。評価の 1 生成（修正の往復を含む）ごとではなく、呼び出しごとに振る。
  if (ep.sessionHeader) headers[ep.sessionHeader] = `yui-eval-${randomUUID()}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ep.timeoutMs);
  try {
    const res = await fetch(`${ep.baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildResponsesBody(ep, req)),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new HttpError(res.status, await res.text());

    const out: ChatResult = { text: "", toolCalls: [], totalMs: 0 };
    const decoder = new TextDecoder();
    let buf = "";
    // SSE は空行でイベントが確定する。同じイベント内の data 行は改行でつなぐ。
    let data: string[] = [];
    const dispatch = () => {
      if (data.length === 0) return;
      const ev = JSON.parse(data.join("\n")) as ResponsesEvent;
      data = [];
      onEvent(ev);
    };
    const onEvent = (ev: ResponsesEvent) => {
      switch (ev.type) {
        case "response.output_text.delta":
        case "response.refusal.delta": {
          const d = ev.delta ?? "";
          if (!d) return;
          if (out.ttftMs === undefined) out.ttftMs = performance.now() - started;
          out.text += d;
          if (figureReady && out.firstFigureMs === undefined && d.includes("\n") && figureReady(out.text)) {
            out.firstFigureMs = performance.now() - started;
          }
          return;
        }
        case "response.output_item.done":
          if (ev.item?.type === "function_call") {
            out.toolCalls.push({ id: ev.item.call_id ?? `r${out.toolCalls.length}`, name: ev.item.name ?? "", arguments: ev.item.arguments ?? "" });
          }
          return;
        case "response.completed":
        case "response.incomplete": {
          const u = ev.response?.usage;
          if (u) {
            out.usage = { promptTokens: u.input_tokens ?? 0, completionTokens: u.output_tokens ?? 0 };
            const r = u.output_tokens_details?.reasoning_tokens;
            if (r !== undefined) out.usage.reasoningTokens = r;
          }
          out.finishReason = ev.type === "response.incomplete" ? "length" : out.toolCalls.length > 0 ? "tool_calls" : "stop";
          return;
        }
        case "response.failed":
          throw new HttpError(500, JSON.stringify(ev.response?.error ?? ev));
        case "error":
          throw new HttpError(500, JSON.stringify(ev.error ?? ev));
        default:
          return;
      }
    };
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line === "") dispatch();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (buf.startsWith("data:")) data.push(buf.slice(5).replace(/^ /, ""));
    dispatch();
    // 完了イベントの無いまま切れたストリームは、途中で打ち切られた応答として再送させる。
    if (out.finishReason === undefined) throw new HttpError(502, "stream ended without response.completed");
    out.totalMs = performance.now() - started;
    if (figureReady && out.firstFigureMs === undefined && figureReady(out.text)) out.firstFigureMs = out.totalMs;
    return out;
  } finally {
    clearTimeout(timer);
  }
}
