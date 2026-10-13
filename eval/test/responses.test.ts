import { describe, expect, it } from "vitest";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { HttpError, type Endpoint } from "../src/client.js";
import { buildResponsesBody, chatResponses, toResponsesInput } from "../src/responses.js";

const baseEp: Endpoint = {
  api: "responses",
  baseUrl: "http://x/v1",
  model: "m",
  extraBody: { reasoning: { effort: "low" } },
  maxTokensParam: "max_completion_tokens",
  maxTokens: 10,
  timeoutMs: 5000,
};

describe("Responses の入力", () => {
  it("system を instructions に、ツールの往復を function_call / function_call_output に写す", () => {
    const r = toResponsesInput([
      { role: "system", content: "sys" },
      { role: "user", content: "q" },
      { role: "assistant", content: "調べます", tool_calls: [{ id: "c1", type: "function", function: { name: "emit_ui", arguments: '{"a":1}' } }] },
      { role: "tool", tool_call_id: "c1", content: "エラー" },
    ]);
    expect(r).toEqual({
      instructions: "sys",
      input: [
        { role: "user", content: "q" },
        { role: "assistant", content: "調べます" },
        { type: "function_call", call_id: "c1", name: "emit_ui", arguments: '{"a":1}' },
        { type: "function_call_output", call_id: "c1", output: "エラー" },
      ],
    });
  });

  it("本文: store なし・出力上限の下限・ツールは平らで strict なし・effort をそのまま渡す", () => {
    const body = buildResponsesBody(baseEp, {
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "emit_ui", description: "d", parameters: { type: "object" } } }],
      toolChoice: { type: "function", function: { name: "emit_ui" } },
    });
    expect(body).toMatchObject({
      store: false,
      stream: true,
      max_output_tokens: 16,
      reasoning: { effort: "low" },
      tools: [{ type: "function", name: "emit_ui", strict: false }],
      tool_choice: { type: "function", name: "emit_ui" },
    });
    expect(body).not.toHaveProperty("max_completion_tokens");
  });
});

describe("Responses のストリーム", () => {
  const serve = async (events: unknown[]) => {
    let seen: IncomingHttpHeaders = {};
    const server = createServer((req, res) => {
      seen = req.headers;
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const e of events) res.write(`event: x\ndata: ${JSON.stringify(e)}\n\n`);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const ep: Endpoint = {
      ...baseEp,
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      apiKey: "k",
      headers: { "user-agent": "yui-eval/1.0" },
      sessionHeader: "x-opencode-session",
    };
    return { ep, headers: () => seen, close: () => new Promise<void>((r) => server.close(() => r())) };
  };
  const done = (usage = { input_tokens: 3, output_tokens: 7, output_tokens_details: { reasoning_tokens: 5 } }) => ({
    type: "response.completed",
    response: { status: "completed", usage },
  });

  it("本文と終わり方・使用量を返し、名乗りと会話 ID のヘッダを送る", async () => {
    const { ep, headers, close } = await serve([
      { type: "response.reasoning_summary_text.delta", delta: "考え中" },
      { type: "response.output_text.delta", delta: "答" },
      { type: "response.output_text.delta", delta: "え" },
      done(),
    ]);
    const r = await chatResponses(ep, { messages: [{ role: "user", content: "q" }] });
    expect([r.text, r.finishReason, r.usage]).toEqual(["答え", "stop", { promptTokens: 3, completionTokens: 7, reasoningTokens: 5 }]);
    expect(headers()["user-agent"]).toBe("yui-eval/1.0");
    expect(headers()["x-opencode-session"]).toMatch(/^yui-eval-/);
    expect(headers().authorization).toBe("Bearer k");
    await close();
  });

  it("ツール呼び出しを返し、終わり方を tool_calls にする", async () => {
    const { ep, close } = await serve([
      { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "emit_ui", arguments: '{"spec":{}}' } },
      done(),
    ]);
    const r = await chatResponses(ep, { messages: [{ role: "user", content: "q" }] });
    expect([r.toolCalls, r.finishReason]).toEqual([[{ id: "c1", name: "emit_ui", arguments: '{"spec":{}}' }], "tool_calls"]);
    await close();
  });

  it("出力上限で打ち切られたら length", async () => {
    const { ep, close } = await serve([{ type: "response.output_text.delta", delta: "途中" }, { type: "response.incomplete", response: { status: "incomplete" } }]);
    expect((await chatResponses(ep, { messages: [{ role: "user", content: "q" }] })).finishReason).toBe("length");
    await close();
  });

  it("失敗イベントと、完了の無いまま切れたストリームは再送の対象にする", async () => {
    const failed = await serve([{ type: "response.failed", response: { status: "failed", error: { code: "server_error", message: "x" } } }]);
    await expect(chatResponses(failed.ep, { messages: [{ role: "user", content: "q" }] })).rejects.toBeInstanceOf(HttpError);
    await failed.close();
    const cut = await serve([{ type: "response.output_text.delta", delta: "途中" }]);
    await expect(chatResponses(cut.ep, { messages: [{ role: "user", content: "q" }] })).rejects.toMatchObject({ status: 502 });
    await cut.close();
  });
});
