/**
 * Markdown の中から ` ```ui ` ブロックを切り出す。ストリーミング中の途中のテキストにも使える。
 *
 * CommonMark のフェンス規則（3 文字以上の ``` か ~~~、行頭の空白 3 つまで、
 * 閉じは同じ文字で開きと同じ長さ以上）に従う。他言語のコードブロックの中は見ない。
 */

import type { Kind, ParseResult } from "./ir.js";
import { parseBlock, resolveKind } from "./parse.js";

export type Segment =
  | { type: "markdown"; text: string }
  | {
      type: "ui";
      /** フェンスの情報文字列（`ui bar` など）。 */
      info: string;
      kind?: Kind;
      source: string;
      /** 閉じフェンスまで受け取ったか。 */
      closed: boolean;
      /** 元テキストでの開始行（0 始まり）。 */
      startLine: number;
      /** フェンスを含む元のテキスト。 */
      raw: string;
    };

const OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

export function isUiInfo(info: string): boolean {
  const lang = info.trim().split(/[\s:{]/)[0]?.toLowerCase() ?? "";
  return lang === "ui" || lang === "miniui";
}

function kindFromInfo(info: string): Kind | undefined {
  const m = /^(?:ui|miniui)(?:\s+|:)(\S+)/i.exec(info.trim());
  return m ? resolveKind(m[1]!) : undefined;
}

export function splitMarkdown(text: string): Segment[] {
  const lines = text.split("\n");
  const out: Segment[] = [];
  let md: string[] = [];
  let i = 0;

  const flushMd = () => {
    if (md.length > 0) {
      out.push({ type: "markdown", text: md.join("\n") });
      md = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const open = OPEN.exec(line);
    // バッククォートのフェンスの情報文字列にはバッククォートを含められない。
    if (!open || (open[2]![0] === "`" && open[3]!.includes("`"))) {
      md.push(line);
      i++;
      continue;
    }
    const fenceChar = open[2]![0]!;
    const fenceLen = open[2]!.length;
    const info = open[3]!.trim();
    const close = new RegExp(`^ {0,3}${fenceChar === "`" ? "`" : "~"}{${fenceLen},}\\s*$`);

    let j = i + 1;
    while (j < lines.length && !close.test(lines[j]!)) j++;
    const closed = j < lines.length;
    const bodyLines = lines.slice(i + 1, j);
    const rawLines = lines.slice(i, closed ? j + 1 : j);

    if (isUiInfo(info)) {
      flushMd();
      const seg: Segment = {
        type: "ui",
        info,
        // 閉じていないブロックでは、元テキストが改行で終わっていれば bodyLines の末尾が "" になり、
        // join の結果も改行で終わる（＝最終行は確定）。終わっていなければ最終行は未確定のまま渡す。
        source: closed && bodyLines.length > 0 ? `${bodyLines.join("\n")}\n` : bodyLines.join("\n"),
        closed,
        startLine: i,
        raw: rawLines.join("\n"),
      };
      const kind = kindFromInfo(info);
      if (kind) seg.kind = kind;
      out.push(seg);
    } else {
      md.push(...rawLines);
    }
    i = closed ? j + 1 : j;
  }
  flushMd();
  return out;
}

export interface ParsedSegmentUi extends Extract<Segment, { type: "ui" }> {
  result: ParseResult;
}

export type ParsedSegment = Extract<Segment, { type: "markdown" }> | ParsedSegmentUi;

/**
 * Markdown 全体を切り出して各 ui ブロックを解析する。
 * final=false ならストリーミング中とみなし、閉じていないブロックの未確定行を保留する。
 */
export function parseMarkdown(text: string, opts: { final?: boolean } = {}): ParsedSegment[] {
  return splitMarkdown(text).map((seg) => {
    if (seg.type === "markdown") return seg;
    const parseOpts = seg.kind ? { final: opts.final || seg.closed, kind: seg.kind } : { final: opts.final || seg.closed };
    return { ...seg, result: parseBlock(seg.source, parseOpts) };
  });
}
