/**
 * Markdown の ```ui ブロックに、Worker が描く画像のリンクを付ける。
 *
 * GitHub などコードを実行しない Markdown ビューアでも、画像として図が見えるようにする。
 * 付けた部分は `<!-- yui-embed -->` 〜 `<!-- /yui-embed -->` で囲むので、何度かけても同じ結果になる
 * （ソースを直したら、もう一度かければ画像の URL だけが変わる）。
 *
 * ```md
 * <!-- yui-embed -->
 * ![bar 売上](https://…/svg/…)
 *
 * <details><summary>図のソース</summary>
 *
 * ```ui
 * bar 売上
 * …
 * ```
 *
 * </details>
 * <!-- /yui-embed -->
 * ```
 */

import { type Diagnostic, type Kind, parseBlock, type ParseResult, splitMarkdown } from "@imanect/yui";
import { encodeSource } from "./code.js";

export type EmbedTheme = "light" | "dark" | "auto";

export interface ImageUrlOptions {
  /** 画像を描く Worker の URL（`https://yui.example.workers.dev` など）。 */
  base: string;
  /** フェンスの情報文字列で指定した種類（` ```ui bar `）。 */
  kind?: Kind;
  /** 画像の配色。既定 light。auto は閲覧者の OS の明暗に従う（背景は透明）。 */
  theme?: EmbedTheme;
}

export interface EmbedOptions extends Omit<ImageUrlOptions, "kind"> {
  /** ソースを `<details>` に畳む（既定 true）。false ならソースのコードブロックを画像の下にそのまま見せる。 */
  fold?: boolean;
  /** `<details>` の見出し（既定「図のソース」）。 */
  summary?: string;
}

export interface BlockReport {
  /** 文書での行番号（1 始まり、開きフェンスの行）。 */
  line: number;
  kind?: Kind;
  title: string;
  /** 付けた画像の URL。描けないブロックには無い。 */
  url?: string;
  diagnostics: Diagnostic[];
  /** 画像を付けなかった理由。 */
  skipped?: "unclosed" | "unparsable";
  /** URL が長すぎて表示できない場所がありそう。 */
  longUrl?: boolean;
}

export interface EmbedResult {
  text: string;
  changed: boolean;
  blocks: BlockReport[];
}

export const START = "<!-- yui-embed -->";
export const END = "<!-- /yui-embed -->";
/** これより長い URL は GitHub などで表示されないことがある。 */
export const LONG_URL = 8000;

/** Worker の URL を正規化する（http(s) だけ、末尾の / は落とす）。 */
export function normalizeBase(base: string): string {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new Error(`画像の URL の基点が正しくありません: ${base}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`画像の URL の基点は http(s) にしてください: ${base}`);
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

/** ソースから画像の URL を作る。 */
export async function imageUrl(source: string, opts: ImageUrlOptions): Promise<string> {
  const q = new URLSearchParams();
  if (opts.kind) q.set("kind", opts.kind);
  if (opts.theme && opts.theme !== "light") q.set("theme", opts.theme);
  const qs = q.toString();
  return `${normalizeBase(opts.base)}/svg/${await encodeSource(source)}${qs ? `?${qs}` : ""}`;
}

const escAlt = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/([\\[\]])/g, "\\$1");

function altText(result: ParseResult): string {
  const f = result.figure!;
  return escAlt(f.title ? `${f.kind} ${f.title}` : f.kind);
}

/** 画像と（畳んだ）ソースの Markdown。ソースのフェンスは渡したものをそのまま使う。 */
export function wrapBlock(fence: string, alt: string, url: string, opts: Pick<EmbedOptions, "fold" | "summary"> = {}, indent = ""): string[] {
  const fold = opts.fold ?? true;
  const summary = (opts.summary ?? "図のソース").replace(/[<>&]/g, "");
  // ブロックが字下げされていれば（リストの中など）、付ける行も同じだけ下げる。ソースは元の字下げのまま
  const g = (l: string) => (l === "" ? l : indent + l);
  const head = [START, `![${alt}](${url})`, "", ...(fold ? [`<details><summary>${summary}</summary>`, ""] : [])].map(g);
  const tail = [...(fold ? ["", "</details>"] : []), END].map(g);
  return [...head, ...fence.split("\n"), ...tail];
}

/** 1 つのブロックを描いて、埋め込み用の Markdown を作る（MCP などで使う）。 */
export async function embedSource(
  source: string,
  opts: EmbedOptions & { kind?: Kind },
): Promise<{ markdown?: string; url?: string; result: ParseResult }> {
  const result = parseBlock(source, opts.kind ? { final: true, kind: opts.kind } : { final: true });
  if (!result.figure) return { result };
  const url = await imageUrl(source, opts);
  const body = source.endsWith("\n") ? source : `${source}\n`;
  const info = opts.kind ? `ui ${opts.kind}` : "ui";
  const fence = /^\s*`{3,}/m.test(body) ? "~~~" : "```";
  return { markdown: wrapBlock(`${fence}${info}\n${body}${fence}`, altText(result), url, opts).join("\n"), url, result };
}

const IMAGE = /^!\[.*\]\(.*\)$/;
const DETAILS_OPEN = /^<details>\s*<summary>.*<\/summary>$/;

/** 前回付けた部分（開きフェンスの前・閉じフェンスの後）の範囲。無ければ null。 */
function findWrapper(lines: string[], start: number, end: number): { from: number; to: number } | null {
  let i = start - 1;
  while (i >= 0 && (lines[i]!.trim() === "" || IMAGE.test(lines[i]!.trim()) || DETAILS_OPEN.test(lines[i]!.trim()))) i--;
  if (i < 0 || lines[i]!.trim() !== START) return null;
  let j = end;
  while (j < lines.length && (lines[j]!.trim() === "" || lines[j]!.trim() === "</details>")) j++;
  if (j >= lines.length || lines[j]!.trim() !== END) return null;
  return { from: i, to: j + 1 };
}

/** 文書の ui ブロックすべてに画像を付ける（前回付けたものは作り直す）。 */
export async function embedMarkdown(input: string, opts: EmbedOptions): Promise<EmbedResult> {
  normalizeBase(opts.base);
  const crlf = input.includes("\r\n");
  const text = crlf ? input.replace(/\r\n/g, "\n") : input;
  const lines = text.split("\n");
  const blocks: BlockReport[] = [];
  const edits: { from: number; to: number; lines: string[] }[] = [];

  for (const seg of splitMarkdown(text)) {
    if (seg.type !== "ui") continue;
    const start = seg.startLine;
    const end = start + seg.raw.split("\n").length;
    const report: BlockReport = { line: start + 1, title: "", diagnostics: [] };
    if (seg.kind) report.kind = seg.kind;
    blocks.push(report);
    if (!seg.closed) {
      report.skipped = "unclosed";
      continue;
    }
    const result = parseBlock(seg.source, seg.kind ? { final: true, kind: seg.kind } : { final: true });
    report.diagnostics = result.diagnostics;
    if (!result.figure) {
      report.skipped = "unparsable";
      continue;
    }
    report.kind = result.figure.kind;
    report.title = result.figure.title;
    const url = await imageUrl(seg.source, { ...opts, ...(seg.kind ? { kind: seg.kind } : {}) });
    report.url = url;
    if (url.length > LONG_URL) report.longUrl = true;
    const indent = /^ */.exec(lines[start]!)![0];
    const range = findWrapper(lines, start, end) ?? { from: start, to: end };
    edits.push({ ...range, lines: wrapBlock(seg.raw, altText(result), url, opts, indent) });
  }

  for (const e of edits.reverse()) lines.splice(e.from, e.to - e.from, ...e.lines);
  let out = lines.join("\n");
  if (crlf) out = out.replace(/\n/g, "\r\n");
  return { text: out, changed: out !== input, blocks };
}

