/**
 * Yui の図を画像として配信する Cloudflare Worker。
 *
 * - `GET /svg/<コード>[.svg]?theme=&kind=`: ソースを描いた SVG（コードは @imanect/yui-embed の encodeSource）
 * - `POST /mcp`: AI 向けの MCP サーバー（書き方の案内と、ソース → 貼り付け用 Markdown）
 * - `GET /llms.txt`・`/llms-full.txt`・`/guide/<種類>.md`: AI 向けの説明
 *
 * 状態は持たない。同じ URL は同じ画像なので、Cloudflare のキャッシュに置く。
 */

import { resolveKind } from "@imanect/yui";
import { kindGuide, llmsFullTxt, llmsTxt } from "./docs.js";
import { handleMcp } from "./mcp.js";
import { CACHE_OK, handleImage } from "./render.js";

export interface Env {
  /** 画像の URL の基点（独自ドメインで配信するとき）。無ければリクエストの origin。 */
  PUBLIC_BASE?: string;
}

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

/** Workers の既定のキャッシュ（Node のテストには無い）。 */
function edgeCache(): Cache | undefined {
  const c = (globalThis as { caches?: { default?: Cache } }).caches;
  return c?.default;
}

const textResponse = (body: string, type: string, head: boolean) =>
  new Response(head ? null : body, {
    headers: { "content-type": `${type}; charset=utf-8`, "cache-control": "public, max-age=3600", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" },
  });

const SVG_PATH = /^\/svg\/([A-Za-z0-9_-]+)(?:\.svg)?$/;

export default {
  async fetch(req: Request, env: Env = {}, ctx?: Ctx): Promise<Response> {
    const url = new URL(req.url);
    const base = (env.PUBLIC_BASE || url.origin).replace(/\/+$/, "");
    const head = req.method === "HEAD";

    if (url.pathname === "/mcp") return handleMcp(req, base);
    if (req.method !== "GET" && !head) return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });

    const svg = SVG_PATH.exec(url.pathname);
    if (svg) {
      const cache = edgeCache();
      const key = new Request(url.toString(), { method: "GET" });
      const hit = await cache?.match(key);
      if (hit) return head ? new Response(null, hit) : hit;
      const res = await handleImage(svg[1]!, url, false);
      if (cache && res.status === 200 && res.headers.get("cache-control") === CACHE_OK) {
        const put = cache.put(key, res.clone());
        if (ctx) ctx.waitUntil(put);
        else await put;
      }
      return head ? new Response(null, res) : res;
    }

    if (url.pathname === "/" || url.pathname === "/llms.txt") return textResponse(llmsTxt(base), url.pathname === "/" ? "text/plain" : "text/markdown", head);
    if (url.pathname === "/llms-full.txt") return textResponse(llmsFullTxt(base), "text/markdown", head);
    const guide = /^\/guide\/([a-z]+)(?:\.md)?$/.exec(url.pathname);
    const kind = guide ? resolveKind(guide[1]!) : undefined;
    if (kind) return textResponse(kindGuide(kind), "text/markdown", head);

    return new Response("Not Found", { status: 404 });
  },
};
