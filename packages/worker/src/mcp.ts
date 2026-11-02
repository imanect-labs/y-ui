/**
 * MCP サーバー（Streamable HTTP・状態を持たない）。`POST /mcp` に JSON-RPC を受けて JSON で返す。
 *
 * セッションも SSE も使わない（どのツールも 1 回の呼び出しで完結する）ので、SDK を入れずに
 * 必要なメソッドだけを書いている: initialize・ping・tools/list・tools/call・resources/list・resources/read。
 */

import { embedMarkdown, embedSource, type EmbedTheme } from "@imanect/yui-embed";
import { type Diagnostic, type Kind, KINDS, resolveKind, splitMarkdown } from "@imanect/yui";
import { guideIndex, GUIDE_RULES, KIND_GUIDE } from "@imanect/yui/guide";
import { IMAGE_KINDS, kindGuide, llmsTxt, mcpInstructions, SERVER_NAME, SERVER_VERSION } from "./docs.js";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type Id = string | number | null;
interface Message {
  jsonrpc?: unknown;
  id?: Id;
  method?: unknown;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

const THEME_SCHEMA = { type: "string", enum: ["light", "dark", "auto"], description: "画像の配色。既定 light。auto は閲覧者の OS の明暗に従う（背景は透明）" };
const FOLD_SCHEMA = { type: "boolean", description: "ソースを <details> に畳む（既定 true）。false ならソースを画像の下にそのまま見せる" };

const TOOLS = [
  {
    name: "list_kinds",
    title: "図の種類の早見",
    description: "Yui の図の種類の早見（用途のまとまりごとに 1 行）と、どの種類にも共通する書き方の決まりを返す。図を書く前に、どの種類を使うかを決めるために読む。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_kind_guide",
    title: "種類ごとの書き方",
    description: "1 つの種類の書き方（用途・書き方の要点・オプション行・上限・近い種類との使い分け・作例）を返す。ソースを書く前に必ず読む。",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: [...IMAGE_KINDS], description: "図の種類（list_kinds の早見にある名前）" } },
      required: ["kind"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "render_ui",
    title: "図を画像にする",
    description:
      "```ui ブロックのソースを解析して、図の画像の URL と、そのまま貼れる Markdown（画像＋畳んだソース）を返す。解析の診断（直すべき点）も返すので、error や warning があれば直してもう一度呼ぶ。画像の URL は自分で作らず、この結果を使う。",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "ui ブロックの中身（1 行目が「種類 タイトル」）。```ui のフェンスごと渡してもよい" },
        theme: THEME_SCHEMA,
        fold: FOLD_SCHEMA,
      },
      required: ["source"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "embed_markdown",
    title: "Markdown の図に画像を付ける",
    description:
      "Markdown 文書の中の ```ui ブロックすべてに図の画像を付けた文書を返す（前回付けたものは作り直す。何度かけても同じ結果）。README などの .md を書き換えるときに使う。他の言語のコードブロックの中は触らない。",
    inputSchema: {
      type: "object",
      properties: { markdown: { type: "string", description: "Markdown 文書の全文" }, theme: THEME_SCHEMA, fold: FOLD_SCHEMA },
      required: ["markdown"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const RESOURCES = [
  { uri: "yui://guide", name: "guide", title: "Yui の書き方（早見と決まり）", mimeType: "text/markdown", description: "種類の早見と共通の決まり、画像で埋め込む手順" },
  ...IMAGE_KINDS.map((k) => ({ uri: `yui://guide/${k}`, name: `guide-${k}`, title: `${k} ${KIND_GUIDE[k].name}`, mimeType: "text/markdown", description: KIND_GUIDE[k].use })),
];

function str(args: Record<string, unknown>, key: string, required: true): string;
function str(args: Record<string, unknown>, key: string, required?: false): string | undefined;
function str(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) {
    if (required) throw new RpcError(-32602, `引数 ${key} がありません`);
    return undefined;
  }
  if (typeof v !== "string") throw new RpcError(-32602, `引数 ${key} は文字列です`);
  return v;
}

function themeArg(args: Record<string, unknown>): EmbedTheme {
  const t = str(args, "theme") ?? "light";
  if (t !== "light" && t !== "dark" && t !== "auto") throw new RpcError(-32602, "theme は light・dark・auto のどれかです");
  return t;
}

function foldArg(args: Record<string, unknown>): boolean {
  const v = args.fold;
  if (v === undefined || v === null) return true;
  if (typeof v !== "boolean") throw new RpcError(-32602, "fold は真偽値です");
  return v;
}

function formatDiagnostics(diags: Diagnostic[]): string {
  if (diags.length === 0) return "なし";
  return diags.map((d) => `- ${d.severity}${d.line > 0 ? `（${d.line} 行目）` : ""}: ${d.message}`).join("\n");
}

/** フェンスごと渡されたら中身と情報文字列の種類を取り出す。 */
function unfence(source: string): { source: string; kind?: Kind } {
  if (!/^\s*(`{3,}|~{3,})/.test(source)) return { source };
  const seg = splitMarkdown(source.trim()).find((s) => s.type === "ui");
  if (!seg || seg.type !== "ui") return { source };
  return seg.kind ? { source: seg.source, kind: seg.kind } : { source: seg.source };
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

async function callTool(name: string, args: Record<string, unknown>, base: string): Promise<ToolResult> {
  switch (name) {
    case "list_kinds":
      return text(["種類の早見:", guideIndex({ kinds: IMAGE_KINDS }), "", "書き方の決まり:", GUIDE_RULES, "", "次に get_kind_guide で使う種類の書き方を読んでください。"].join("\n"));
    case "get_kind_guide": {
      const raw = str(args, "kind", true);
      const kind = resolveKind(raw);
      if (!kind) return text(`知らない種類です: ${raw}\n使える種類: ${IMAGE_KINDS.join(", ")}`, true);
      return text(kindGuide(kind));
    }
    case "render_ui": {
      const { source, kind } = unfence(str(args, "source", true));
      const res = await embedSource(source, { base, theme: themeArg(args), fold: foldArg(args), ...(kind ? { kind } : {}) });
      const diags = formatDiagnostics(res.result.diagnostics);
      if (!res.url) return text(`図にできませんでした。1 行目は「種類 タイトル」です（種類は list_kinds の早見から）。\n\n診断:\n${diags}`, true);
      const out = text(
        [`画像の URL: ${res.url}`, "", `診断:\n${diags}`, "", "貼り付け用の Markdown（そのまま使う）:", "", res.markdown].join("\n"),
      );
      out.structuredContent = { url: res.url, markdown: res.markdown, kind: res.result.figure!.kind, title: res.result.figure!.title, diagnostics: res.result.diagnostics };
      return out;
    }
    case "embed_markdown": {
      const res = await embedMarkdown(str(args, "markdown", true), { base, theme: themeArg(args), fold: foldArg(args) });
      const report = res.blocks.map((b) => {
        const head = `- ${b.line} 行目${b.kind ? ` ${b.kind}` : ""}${b.title ? ` ${b.title}` : ""}`;
        if (b.skipped === "unclosed") return `${head}: 閉じていないので飛ばしました`;
        if (b.skipped === "unparsable") return `${head}: 図にできないので飛ばしました（${b.diagnostics.map((d) => d.message).join(" / ") || "種類が分かりません"}）`;
        const issues = b.diagnostics.filter((d) => d.severity !== "info");
        return `${head}: 画像を付けました${issues.length ? `（${issues.map((d) => d.message).join(" / ")}）` : ""}${b.longUrl ? "（URL が長すぎて表示できない場所があります）" : ""}`;
      });
      const summary = res.blocks.length === 0 ? "```ui ブロックがありません。" : `${res.changed ? "書き換えました" : "変更はありません"}。\n${report.join("\n")}`;
      return text(`${summary}\n\n---\n\n${res.text}`, res.blocks.some((b) => b.skipped));
    }
    default:
      throw new RpcError(-32602, `知らないツールです: ${name}`);
  }
}

function readResource(uri: string, base: string): { uri: string; mimeType: string; text: string } {
  if (uri === "yui://guide") return { uri, mimeType: "text/markdown", text: llmsTxt(base) };
  const m = /^yui:\/\/guide\/([a-z]+)$/.exec(uri);
  const kind = m ? resolveKind(m[1]!) : undefined;
  if (!kind || !(KINDS as readonly string[]).includes(kind)) throw new RpcError(-32002, `リソースがありません: ${uri}`);
  return { uri, mimeType: "text/markdown", text: kindGuide(kind) };
}

async function dispatch(msg: Message, base: string): Promise<unknown> {
  const params = (msg.params ?? {}) as Record<string, unknown>;
  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: "Yui（結）の図", version: SERVER_VERSION },
        instructions: mcpInstructions(),
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string") throw new RpcError(-32602, "name がありません");
      const args = params.arguments ?? {};
      if (typeof args !== "object" || Array.isArray(args)) throw new RpcError(-32602, "arguments はオブジェクトです");
      return callTool(name, args as Record<string, unknown>, base);
    }
    case "resources/list":
      return { resources: RESOURCES };
    case "resources/read": {
      const uri = params.uri;
      if (typeof uri !== "string") throw new RpcError(-32602, "uri がありません");
      return { contents: [readResource(uri, base)] };
    }
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      throw new RpcError(-32601, `知らないメソッドです: ${String(msg.method)}`);
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });

async function answer(msg: unknown, base: string): Promise<unknown | undefined> {
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "JSON-RPC のメッセージではありません" } };
  const m = msg as Message;
  // 通知（id が無い）とクライアントからの応答には返さない
  if (m.method === undefined || !("id" in m) || m.id === undefined) return undefined;
  if (typeof m.method !== "string") return { jsonrpc: "2.0", id: m.id, error: { code: -32600, message: "method がありません" } };
  try {
    return { jsonrpc: "2.0", id: m.id, result: await dispatch(m, base) };
  } catch (e) {
    if (e instanceof RpcError) return { jsonrpc: "2.0", id: m.id, error: { code: e.code, message: e.message } };
    return { jsonrpc: "2.0", id: m.id, error: { code: -32603, message: e instanceof Error ? e.message : "内部のエラー" } };
  }
}

export async function handleMcp(req: Request, base: string): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // 状態を持たないので、サーバーから送る SSE の流れは無い
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST, OPTIONS", ...CORS } });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON として読めません" } }, 400);
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => answer(m, base)))).filter((r) => r !== undefined);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await answer(body, base);
  return out === undefined ? new Response(null, { status: 202, headers: CORS }) : json(out);
}
