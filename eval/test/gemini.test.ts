import { describe, expect, it } from "vitest";
import { toGeminiContents } from "../src/gemini.js";
import { classify429, limited, StopRun } from "../src/run.js";

describe("Gemini への変換", () => {
  it("system・ツール呼び出し・ツール結果を変換する", () => {
    const r = toGeminiContents([
      { role: "system", content: "S" },
      { role: "user", content: "U" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "emit_ui", arguments: '{"spec":{}}' } }] },
      { role: "tool", tool_call_id: "c1", content: "検証エラー" },
    ]);
    expect(r).toEqual({
      systemInstruction: { parts: [{ text: "S" }] },
      contents: [
        { role: "user", parts: [{ text: "U" }] },
        { role: "model", parts: [{ functionCall: { name: "emit_ui", args: { spec: {} } } }] },
        { role: "user", parts: [{ functionResponse: { name: "emit_ui", response: { content: "検証エラー" } } }] },
      ],
    });
  });
});

describe("無料枠の歯止め", () => {
  it("429 を日次と分あたりに分ける", () => {
    expect(classify429('{"error":{"details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"},{"retryDelay":"12s"}]}}')).toEqual({ daily: true, retryMs: 13000 });
    expect(classify429('{"error":{"details":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"},{"retryDelay":"7s"}]}}')).toEqual({ daily: false, retryMs: 8000 });
  });

  it("上限を超えるリクエストは送らずに止める", async () => {
    let sent = 0;
    const call = limited(async () => ({ text: String(++sent), toolCalls: [], totalMs: 0 }), { nextAt: 0, sent: 0 }, undefined, 2);
    await call({ messages: [] });
    await call({ messages: [] });
    await expect(call({ messages: [] })).rejects.toBeInstanceOf(StopRun);
    expect(sent).toBe(2);
  });
});

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chatGemini } from "../src/gemini.js";
import { HttpError } from "../src/client.js";

describe("Gemini のストリーム", () => {
  const serve = async (events: unknown[]) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const e of events) res.write(`data: ${JSON.stringify(e)}\r\n\r\n`);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const ep = { api: "gemini" as const, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiKey: "k", model: "m", extraBody: {}, maxTokensParam: "max_tokens" as const, maxTokens: 10, timeoutMs: 5000 };
    return { ep, close: () => new Promise<void>((r) => server.close(() => r())) };
  };
  const thought = { candidates: [{ content: { parts: [{ text: "考え中", thought: true }] } }] };

  it("途中で送られてくるエラーは HTTP エラーとして投げる（空の応答にしない）", async () => {
    const { ep, close } = await serve([thought, { error: { code: 500, message: "Internal error encountered.", status: "INTERNAL" } }]);
    await expect(chatGemini(ep, { messages: [{ role: "user", content: "q" }] })).rejects.toMatchObject({ status: 500 });
    await close();
  });

  it("終わり方の無いまま切れたストリームは再送の対象にする", async () => {
    const { ep, close } = await serve([thought]);
    await expect(chatGemini(ep, { messages: [{ role: "user", content: "q" }] })).rejects.toBeInstanceOf(HttpError);
    await close();
  });

  it("思考を除いた本文と終わり方を返す", async () => {
    const { ep, close } = await serve([thought, { candidates: [{ content: { parts: [{ text: "答え" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, thoughtsTokenCount: 5 } }]);
    const r = await chatGemini(ep, { messages: [{ role: "user", content: "q" }] });
    expect([r.text, r.finishReason, r.usage]).toEqual(["答え", "STOP", { promptTokens: 3, completionTokens: 7, reasoningTokens: 5 }]);
    await close();
  });
});
