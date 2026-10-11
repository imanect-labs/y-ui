import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chat, HttpError, type Endpoint } from "../src/client.js";

/** OpenAI 互換のストリーミング応答を返す偽サーバ。 */
let server: Server;
let base = "";
let lastBody: Record<string, unknown> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastBody = JSON.parse(body);
      if ((lastBody.model as string) === "broken") {
        res.writeHead(429, { "content-type": "application/json" });
        res.end('{"error":"rate limited"}');
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (lastBody.tools) {
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "emit_", arguments: '{"spec":' } }] } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "ui", arguments: '{"version":1}}' } }] }, finish_reason: "tool_calls" }] });
      } else {
        for (const piece of ["説明です。\n```ui\nbar 売", "上\n月 | 金額\n1月 | 1", "00\n```\n"]) send({ choices: [{ delta: { content: piece } }] });
        send({ choices: [{ delta: {}, finish_reason: "stop" }] });
      }
      send({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 34, completion_tokens_details: { reasoning_tokens: 5 } } });
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const ep = (model = "m"): Endpoint => ({ baseUrl: base, apiKey: "k", model, extraBody: { reasoning_effort: "low" }, maxTokensParam: "max_completion_tokens", maxTokens: 100, timeoutMs: 5000 });

describe("chat（SSE）", () => {
  it("本文を連結し、使用量と最初の図の時刻を取る", async () => {
    const seen: string[] = [];
    const r = await chat(ep(), { messages: [{ role: "user", content: "q" }] }, (t) => {
      seen.push(t);
      return t.includes("1月 | 100\n");
    });
    expect(r.text).toBe("説明です。\n```ui\nbar 売上\n月 | 金額\n1月 | 100\n```\n");
    expect(r.usage).toEqual({ promptTokens: 12, completionTokens: 34, reasoningTokens: 5 });
    expect(r.finishReason).toBe("stop");
    expect(r.firstFigureMs).toBeDefined();
    expect(lastBody).toMatchObject({ stream: true, max_completion_tokens: 100, reasoning_effort: "low" });
  });

  it("ツール呼び出しの断片を組み立てる", async () => {
    const r = await chat(ep(), { messages: [{ role: "user", content: "q" }], tools: [{ type: "function", function: { name: "emit_ui", description: "", parameters: {} } }] });
    expect(r.toolCalls).toEqual([{ id: "c1", name: "emit_ui", arguments: '{"spec":{"version":1}}' }]);
  });

  it("HTTP エラーは状態コード付きで投げる", async () => {
    await expect(chat(ep("broken"), { messages: [] })).rejects.toBeInstanceOf(HttpError);
  });
});
