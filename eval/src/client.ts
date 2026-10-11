/**
 * OpenAI 互換の Chat Completions をストリーミングで呼ぶ（GPT-6 Luna・vLLM 上の Gemma 4 の両方）。
 * 依存を増やさないため fetch で SSE を読む。
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDef[];
  toolChoice?: "auto" | { type: "function"; function: { name: string } };
}

export interface Endpoint {
  /** API の形式。既定は OpenAI 互換。 */
  api?: "openai" | "gemini";
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** モデル・思考の深さごとの追加パラメータ（reasoning_effort など）。 */
  extraBody: Record<string, unknown>;
  maxTokensParam: "max_tokens" | "max_completion_tokens";
  maxTokens: number;
  timeoutMs: number;
  /** 1 分あたりのリクエスト数の上限（無料枠のレート制限に合わせる）。 */
  rpm?: number;
}

export interface ChatResult {
  text: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  usage?: { promptTokens: number; completionTokens: number; reasoningTokens?: number };
  finishReason?: string;
  /** 最初の本文トークンまでの時間。 */
  ttftMs?: number;
  /** 本文の途中で図が描けるようになった時刻（onText で判定）。 */
  firstFigureMs?: number;
  totalMs: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 500)}`);
  }
}

/**
 * @param figureReady 本文が伸びるたびに呼ぶ。true を返した最初の時刻を firstFigureMs とする。
 */
export async function chat(ep: Endpoint, req: ChatRequest, figureReady?: (text: string) => boolean): Promise<ChatResult> {
  const started = performance.now();
  const body: Record<string, unknown> = {
    model: ep.model,
    messages: req.messages,
    stream: true,
    stream_options: { include_usage: true },
    [ep.maxTokensParam]: ep.maxTokens,
    ...ep.extraBody,
  };
  if (req.tools) body.tools = req.tools;
  if (req.toolChoice) body.tool_choice = req.toolChoice;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ep.timeoutMs);
  try {
    const res = await fetch(`${ep.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new HttpError(res.status, await res.text());

    const out: ChatResult = { text: "", toolCalls: [], totalMs: 0 };
    const calls: { id: string; name: string; arguments: string }[] = [];
    const decoder = new TextDecoder();
    let buf = "";
    let lastChecked = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        const ev = JSON.parse(data) as StreamEvent;
        if (ev.usage) {
          out.usage = { promptTokens: ev.usage.prompt_tokens, completionTokens: ev.usage.completion_tokens };
          const r = ev.usage.completion_tokens_details?.reasoning_tokens;
          if (r !== undefined) out.usage.reasoningTokens = r;
        }
        for (const choice of ev.choices ?? []) {
          if (choice.finish_reason) out.finishReason = choice.finish_reason;
          const d = choice.delta ?? {};
          if (d.content) {
            if (out.ttftMs === undefined) out.ttftMs = performance.now() - started;
            out.text += d.content;
            // 行が確定したときだけ判定する（毎トークンの再解析を避ける）。
            if (figureReady && out.firstFigureMs === undefined && d.content.includes("\n") && out.text.length !== lastChecked) {
              lastChecked = out.text.length;
              if (figureReady(out.text)) out.firstFigureMs = performance.now() - started;
            }
          }
          for (const tc of d.tool_calls ?? []) {
            const i = tc.index ?? 0;
            calls[i] ??= { id: "", name: "", arguments: "" };
            if (tc.id) calls[i]!.id = tc.id;
            if (tc.function?.name) calls[i]!.name += tc.function.name;
            if (tc.function?.arguments) calls[i]!.arguments += tc.function.arguments;
          }
        }
      }
    }
    out.toolCalls = calls.filter(Boolean);
    out.totalMs = performance.now() - started;
    if (figureReady && out.firstFigureMs === undefined && figureReady(out.text)) out.firstFigureMs = out.totalMs;
    return out;
  } finally {
    clearTimeout(timer);
  }
}

interface StreamEvent {
  choices?: {
    delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; completion_tokens_details?: { reasoning_tokens?: number } };
}
