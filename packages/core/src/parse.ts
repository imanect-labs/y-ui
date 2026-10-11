/** ` ```ui ` ブロック 1 つ分のソースを IR にする。 */

import type { Figure, Kind, ParseResult } from "./ir.js";
import { Diagnostics, type Line, takeRefs } from "./lines.js";
import { parseChart } from "./kinds/chart.js";
import { parseFlow } from "./kinds/flow.js";
import { parseStack } from "./kinds/stack.js";
import { parseStat } from "./kinds/stat.js";

/** 種類の名前と別名。モデルが書きがちな表記を受ける。 */
const KIND_ALIASES: Record<string, Kind> = {
  bar: "bar",
  bars: "bar",
  column: "bar",
  棒: "bar",
  棒グラフ: "bar",
  line: "line",
  折れ線: "line",
  折れ線グラフ: "line",
  stat: "stat",
  stats: "stat",
  kpi: "stat",
  flow: "flow",
  flowchart: "flow",
  フロー: "flow",
  stack: "stack",
  layers: "stack",
  arch: "stack",
  構成: "stack",
  構成図: "stack",
};

export function resolveKind(token: string): Kind | undefined {
  return KIND_ALIASES[token.normalize("NFKC").toLowerCase()];
}

export interface ParseOptions {
  /**
   * ブロックが確定しているか（閉じフェンスを受け取った、またはストリームが終わった）。
   * false の場合、改行で終わっていない最終行は未確定として読まない。
   */
  final?: boolean;
  /** フェンスの情報文字列で種類が指定されている場合（` ```ui bar `）。 */
  kind?: Kind;
}

const HEADER = /^\s*([^\s|:：]+)\s*(?:[|:：]\s*)?(.*)$/;

export function parseBlock(source: string, opts: ParseOptions = {}): ParseResult {
  const diags = new Diagnostics();
  let text = source;
  let pending = false;
  if (!opts.final && !text.endsWith("\n")) {
    const cut = text.lastIndexOf("\n");
    pending = text.length > 0;
    text = cut >= 0 ? text.slice(0, cut + 1) : "";
  }

  const lines: Line[] = text
    .split(/\r?\n/)
    .map((t, i) => ({ no: i + 1, text: t }))
    .filter((l) => l.text.trim() !== "");

  let kind = opts.kind;
  let title = "";
  let body = lines;

  const first = lines[0];
  if (first) {
    const m = HEADER.exec(first.text);
    const headerKind = m ? resolveKind(m[1]!) : undefined;
    if (headerKind && (!kind || kind === headerKind)) {
      kind = headerKind;
      title = m![2]!.trim();
      body = lines.slice(1);
    } else if (kind && isTitleLine(first.text)) {
      title = first.text.trim();
      body = lines.slice(1);
    } else if (!kind) {
      diags.add(first.no, "error", "unknown_kind", `図の種類が分かりません: ${m?.[1] ?? first.text.trim()}（bar / line / stat / flow / stack）`);
      return { figure: null, diagnostics: diags.list, pending };
    }
  }

  if (!kind) {
    if (opts.final) diags.add(0, "error", "empty", "ブロックが空です");
    return { figure: null, diagnostics: diags.list, pending };
  }

  const t = takeRefs(title.replace(/^#+\s*/, ""));
  const figure = emptyFigure(kind, t.text, t.refs);
  switch (figure.kind) {
    case "bar":
    case "line":
      parseChart(figure, body, diags);
      break;
    case "stat":
      parseStat(figure, body, diags);
      break;
    case "flow":
      parseFlow(figure, body, diags);
      break;
    case "stack":
      parseStack(figure, body, diags);
      break;
  }

  if (opts.final && isEmpty(figure)) {
    diags.add(0, "error", "empty", "表示できるデータがありません");
  }
  return { figure, diagnostics: diags.list, pending };
}

/** 種類が別に分かっているとき、先頭行が見出しだけの行か。 */
function isTitleLine(text: string): boolean {
  return !/[|\t]|->|→|^\s*[-*+]\s/.test(text);
}

function emptyFigure(kind: Kind, title: string, refs: number[]): Figure {
  switch (kind) {
    case "bar":
    case "line":
      return { kind, title, refs, columns: [], rows: [] };
    case "stat":
      return { kind, title, refs, items: [] };
    case "flow":
      return { kind, title, refs, direction: "TB", nodes: [], edges: [] };
    case "stack":
      return { kind, title, refs, tiers: [] };
  }
}

export function isEmpty(f: Figure): boolean {
  switch (f.kind) {
    case "bar":
    case "line":
      return f.rows.length === 0;
    case "stat":
      return f.items.length === 0;
    case "flow":
      return f.nodes.length === 0;
    case "stack":
      return f.tiers.length === 0;
  }
}
