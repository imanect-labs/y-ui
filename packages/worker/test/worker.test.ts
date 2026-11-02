import { encodeSource } from "@imanect/yui-embed";
import { describe, expect, it } from "vitest";
import worker from "../src/index.js";

const ORIGIN = "https://yui.test";
const get = (path: string, init?: RequestInit) => worker.fetch(new Request(`${ORIGIN}${path}`, init));
const BAR = "bar 売上\n月 | 売上\n1月 | 120\n2月 | 150\n";

async function rpc(body: unknown, env = {}) {
  const res = await worker.fetch(new Request(`${ORIGIN}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env);
  return { status: res.status, body: res.status === 202 ? null : ((await res.json()) as any) };
}
const call = async (name: string, args: Record<string, unknown>) => (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).body;

describe("画像", () => {
  it("コードから SVG を描く（寸法を固定し、色を焼き込む）", async () => {
    const res = await get(`/svg/${await encodeSource(BAR)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const svg = await res.text();
    expect(svg).toMatch(/^<svg [^>]*width="640" height="\d+"/);
    expect(svg).not.toContain("var(");
    expect(svg).toContain("売上");
  });

  it("末尾の .svg を許す", async () => {
    expect((await get(`/svg/${await encodeSource(BAR)}.svg`)).status).toBe(200);
  });

  it("theme=auto は CSS 変数で描き、寸法は固定する", async () => {
    const svg = await (await get(`/svg/${await encodeSource(BAR)}?theme=auto`)).text();
    expect(svg).toContain("var(--yui-");
    expect(svg).toMatch(/^<svg [^>]*width="640" height="\d+"/);
  });

  it("kind でフェンスの種類を渡す", async () => {
    const src = "売上\n月 | 売上\n1月 | 120\n";
    expect(await (await get(`/svg/${await encodeSource(src)}?kind=bar`)).text()).toContain("<rect");
    expect((await get(`/svg/${await encodeSource(src)}?kind=nope`)).status).toBe(400);
  });

  it("壊れたコードは理由を書いた画像で 400", async () => {
    const res = await get("/svg/AAAA");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("画像の URL が壊れています");
  });

  it("図にできないソースは理由を書いた画像（短く置く）", async () => {
    const res = await get(`/svg/${await encodeSource("foo bar\n")}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await res.text()).toContain("図にできませんでした");
  });

  it("HEAD は本文を返さない", async () => {
    const res = await get(`/svg/${await encodeSource(BAR)}`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("見出しのタグはエスケープする", async () => {
    const svg = await (await get(`/svg/${await encodeSource('bar <script>alert(1)</script>\n月 | 売上\n1月 | 1\n')}`)).text();
    expect(svg).not.toContain("<script>");
  });
});

describe("AI 向けの説明", () => {
  it("llms.txt に MCP の URL・手順・早見・種類ごとのリンクを載せる（操作して使う種類は載せない）", async () => {
    const txt = await (await get("/llms.txt")).text();
    expect(txt).toContain(`${ORIGIN}/mcp`);
    expect(txt).toContain("render_ui");
    expect(txt).toContain("`bar` 棒グラフ");
    expect(txt).toContain(`${ORIGIN}/guide/flow.md`);
    expect(txt).not.toContain("`ask`");
  });

  it("PUBLIC_BASE があれば URL の基点に使う", async () => {
    const txt = await (await worker.fetch(new Request(`${ORIGIN}/llms.txt`), { PUBLIC_BASE: "https://yui.example.com/" })).text();
    expect(txt).toContain("https://yui.example.com/mcp");
  });

  it("llms-full.txt と種類ごとの書き方", async () => {
    expect(await (await get("/llms-full.txt")).text()).toContain("### flow 流れ図");
    const bar = await get("/guide/bar.md");
    expect(bar.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await bar.text()).toMatch(/^## bar 棒グラフ/);
    expect((await get("/guide/nope.md")).status).toBe(404);
  });
});

describe("MCP", () => {
  it("initialize は求められた版で答え、instructions に手順と早見を入れる", async () => {
    const { body } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.instructions).toContain("render_ui");
    expect(body.result.instructions).toContain("`flow` 流れ図");
  });

  it("知らない版には自分の最新の版で答える", async () => {
    const { body } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(body.result.protocolVersion).toBe("2025-11-25");
  });

  it("通知には 202 で本文を返さない", async () => {
    expect(await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).toEqual({ status: 202, body: null });
  });

  it("tools/list", async () => {
    const { body } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual(["list_kinds", "get_kind_guide", "render_ui", "embed_markdown"]);
  });

  it("render_ui はフェンスごとのソースも受け、貼り付け用の Markdown と URL を返す", async () => {
    const res = await call("render_ui", { source: `\`\`\`ui\n${BAR}\`\`\`` });
    expect(res.result.isError).toBeUndefined();
    const { url, markdown } = res.result.structuredContent;
    expect(url).toBe(`${ORIGIN}/svg/${await encodeSource(BAR)}`);
    expect(markdown).toContain(`![bar 売上](${url})`);
    expect(res.result.content[0].text).toContain(markdown);
    // 返した URL がそのまま描ける
    expect((await worker.fetch(new Request(url))).status).toBe(200);
  });

  it("render_ui は図にできないソースを isError で返す", async () => {
    const res = await call("render_ui", { source: "foo bar\n" });
    expect(res.result.isError).toBe(true);
  });

  it("render_ui は診断を返す", async () => {
    const res = await call("render_ui", { source: "bar 売上\n月 | 売上\n1月 | abc\n" });
    expect(res.result.structuredContent.diagnostics.length).toBeGreaterThan(0);
    expect(res.result.content[0].text).not.toContain("診断:\nなし");
  });

  it("get_kind_guide は別名も受ける・知らない種類は isError", async () => {
    expect((await call("get_kind_guide", { kind: "bar" })).result.content[0].text).toMatch(/^## bar 棒グラフ/);
    expect((await call("get_kind_guide", { kind: "zzz" })).result.isError).toBe(true);
  });

  it("embed_markdown は文書を書き換えて返す", async () => {
    const res = await call("embed_markdown", { markdown: `# x\n\n\`\`\`ui\n${BAR}\`\`\`\n`, fold: false });
    const text: string = res.result.content[0].text;
    expect(text).toContain("書き換えました");
    expect(text).toContain("<!-- yui-embed -->");
    expect(text).not.toContain("<details>");
  });

  it("引数の型が違えば -32602、知らないメソッドは -32601", async () => {
    expect((await call("render_ui", { source: 1 })).error.code).toBe(-32602);
    expect((await call("render_ui", { source: BAR, theme: "pink" })).error.code).toBe(-32602);
    expect((await rpc({ jsonrpc: "2.0", id: 9, method: "nope" })).body.error.code).toBe(-32601);
  });

  it("resources", async () => {
    const list = (await rpc({ jsonrpc: "2.0", id: 1, method: "resources/list" })).body.result.resources;
    expect(list[0].uri).toBe("yui://guide");
    const read = (await rpc({ jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "yui://guide/pie" } })).body.result.contents[0];
    expect(read.text).toMatch(/^## pie/);
  });

  it("壊れた JSON は -32700、GET は 405", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/mcp`, { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe(-32700);
    expect((await get("/mcp")).status).toBe(405);
  });
});
