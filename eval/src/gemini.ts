/**
 * Gemini API（ネイティブの generateContent）をストリーミングで呼ぶ。
 * Gemini API 上の Gemma 4 は OpenAI 互換エンドポイントで 500 を返すため、ネイティブで呼ぶ。
 *
 * 思考（thought: true の部分）は本文に含めず、トークン数だけ数える。
 */

import { HttpError, type ChatMessage, type ChatRequest, type ChatResult, type Endpoint } from "./client.js";

type Part =
  | { text: string; thought?: boolean }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: { name: string; response: unknown } };

interface Content {
  role: "user" | "model";
  parts: Part[];
}

/** OpenAI 形式のメッセージを Gemini の contents / systemInstruction に変換する。 */
export function toGeminiContents(messages: ChatMessage[]): { systemInstruction?: { parts: Part[] }; contents: Content[] } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content ?? "").join("\n\n");
  const toolNames = new Map<string, string>();
  const contents: Content[] = [];
  const push = (role: Content["role"], parts: Part[]) => {
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };
  for (const m of messages) {
    if (m.role === "user") push("user", [{ text: m.content ?? "" }]);
    else if (m.role === "assistant") {
      const parts: Part[] = m.content ? [{ text: m.content }] : [];
      for (const c of m.tool_calls ?? []) {
        toolNames.set(c.id, c.function.name);
        let args: unknown;
        try {
          args = JSON.parse(c.function.arguments || "{}");
        } catch {
          args = { _raw: c.function.arguments };
        }
        parts.push({ functionCall: { name: c.function.name, args } });
      }
      push("model", parts);
    } else if (m.role === "tool") {
      push("user", [{ functionResponse: { name: toolNames.get(m.tool_call_id ?? "") ?? "tool", response: { content: m.content ?? "" } } }]);
    }
  }
  return system ? { systemInstruction: { parts: [{ text: system }] }, contents } : { contents };
}

interface StreamChunk {
  error?: { code?: number; message?: string; status?: string };
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

export async function chatGemini(ep: Endpoint, req: ChatRequest, figureReady?: (text: string) => boolean): Promise<ChatResult> {
  const started = performance.now();
  const { generationConfig: extraGen, ...extraRest } = ep.extraBody as { generationConfig?: Record<string, unknown> };
  const body: Record<string, unknown> = {
    ...toGeminiContents(req.messages),
    generationConfig: { maxOutputTokens: ep.maxTokens, ...(extraGen ?? {}) },
    ...extraRest,
  };
  if (req.tools) {
    body.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.function.name, description: t.function.description, parametersJsonSchema: t.function.parameters })) }];
  }
  if (req.toolChoice && req.toolChoice !== "auto") {
    body.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [req.toolChoice.function.name] } };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ep.timeoutMs);
  try {
    const url = `${ep.baseUrl.replace(/\/$/, "")}/models/${ep.model}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": ep.apiKey ?? "" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new HttpError(res.status, await res.text());

    const out: ChatResult = { text: "", toolCalls: [], totalMs: 0 };
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const ev = JSON.parse(line.slice(5).trim()) as StreamChunk;
        // ストリームの途中で送られてくるエラー（HTTP は 200 のまま）。読み飛ばすと空の応答に見えてしまう。
        if (ev.error) throw new HttpError(ev.error.code ?? 500, JSON.stringify(ev));
        if (ev.usageMetadata) {
          const u = ev.usageMetadata;
          out.usage = {
            promptTokens: u.promptTokenCount ?? 0,
            completionTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
            reasoningTokens: u.thoughtsTokenCount ?? 0,
          };
        }
        for (const cand of ev.candidates ?? []) {
          if (cand.finishReason) out.finishReason = cand.finishReason;
          for (const p of cand.content?.parts ?? []) {
            if ("functionCall" in p) {
              out.toolCalls.push({ id: `g${out.toolCalls.length}`, name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) });
            } else if ("text" in p && !p.thought && p.text) {
              if (out.ttftMs === undefined) out.ttftMs = performance.now() - started;
              out.text += p.text;
              if (figureReady && out.firstFigureMs === undefined && p.text.includes("\n") && figureReady(out.text)) {
                out.firstFigureMs = performance.now() - started;
              }
            }
          }
        }
      }
    }
    // 終わり方（finishReason）が無いまま切れたストリームは、途中で打ち切られた応答として再送させる。
    if (out.finishReason === undefined) throw new HttpError(502, "stream ended without finishReason");
    out.totalMs = performance.now() - started;
    if (figureReady && out.firstFigureMs === undefined && figureReady(out.text)) out.firstFigureMs = out.totalMs;
    return out;
  } finally {
    clearTimeout(timer);
  }
}
