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
