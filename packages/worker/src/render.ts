/**
 * `/svg/<コード>` の画像を描く。
 */

import { decodeSource, CodeError } from "@imanect/yui-embed";
import { type Kind, parseBlock, resolveKind } from "@imanect/yui";
import { renderSVG, wrap, LIGHT, DARK } from "@imanect/yui/svg";

export type ImageTheme = "light" | "dark" | "auto";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SVG_HEADERS = {
  "content-type": "image/svg+xml; charset=utf-8",
  // 画像として開いても、直接開いても何も実行させない（SVG は文字と図形だけ）
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  "x-content-type-options": "nosniff",
  "access-control-allow-origin": "*",
};

/** 同じコードは同じ画像なので長く置ける（描き方が変わったときに追従できるよう、永久にはしない）。 */
export const CACHE_OK = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800";
const CACHE_ERROR = "public, max-age=300";

/** 図にできなかったことを伝える小さな画像（GitHub などで壊れた画像のマークにせず、理由を見せる）。 */
export function errorSVG(message: string, details: string[] = [], theme: ImageTheme = "light"): string {
  const p = theme === "dark" ? DARK : LIGHT;
  const width = 640;
  const lines = [
    ...wrap(message, width - 48, 15, undefined, 2, 600).map((t) => ({ t, size: 15, weight: 600 })),
    ...details.flatMap((d) => wrap(d, width - 48, 13, undefined, 2)).slice(0, 6).map((t) => ({ t, size: 13, weight: 400 })),
  ];
  const height = 32 + lines.length * 22;
  const text = lines.map((l, i) => `<text x="24" y="${36 + i * 22}" font-size="${l.size}" font-weight="${l.weight}" fill="${i === 0 ? p.ink : p.ink2}">${esc(l.t)}</text>`);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" font-family="ui-sans-serif, system-ui, sans-serif">`,
    `<title>${esc(message)}</title>`,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="8" fill="${p.surface}" stroke="${p.border}" stroke-dasharray="4 3"/>`,
    ...text,
    "</svg>",
  ].join("");
}

function svgResponse(svg: string, cache: string, status = 200, head = false): Response {
  return new Response(head ? null : svg, { status, headers: { ...SVG_HEADERS, "cache-control": cache } });
}

export function parseTheme(v: string | null): ImageTheme | null {
  if (v === null || v === "" || v === "light") return "light";
  if (v === "dark" || v === "auto") return v;
  return null;
}

/** ソースを SVG にする。図にできなければ null と理由。 */
export function renderSource(source: string, opts: { kind?: Kind; theme?: ImageTheme } = {}): { svg: string } | { error: string; details: string[] } {
  const result = parseBlock(source, opts.kind ? { final: true, kind: opts.kind } : { final: true });
  if (!result.figure) return { error: "図にできませんでした", details: result.diagnostics.map((d) => d.message) };
  const theme = opts.theme ?? "light";
  return { svg: renderSVG(result.figure, { theme, fixedSize: true }) };
}

export async function handleImage(code: string, url: URL, head: boolean): Promise<Response> {
  const theme = parseTheme(url.searchParams.get("theme"));
  const kindParam = url.searchParams.get("kind");
  const kind = kindParam ? resolveKind(kindParam) : undefined;
  if (!theme || (kindParam && !kind)) return svgResponse(errorSVG("URL のパラメータが正しくありません", ["theme は light・dark・auto、kind は図の種類です"]), CACHE_ERROR, 400, head);

  let source: string;
  try {
    source = await decodeSource(code);
  } catch (e) {
    const message = e instanceof CodeError ? e.message : "コードを読めませんでした";
    return svgResponse(errorSVG("画像の URL が壊れています", [message], theme), CACHE_ERROR, 400, head);
  }
  const out = renderSource(source, { theme, ...(kind ? { kind } : {}) });
  if ("error" in out) return svgResponse(errorSVG(out.error, out.details, theme), CACHE_ERROR, 200, head);
  return svgResponse(out.svg, CACHE_OK, 200, head);
}
