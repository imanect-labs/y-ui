/**
 * IR からテキストへの変換。
 *
 * - toSource: 正規形の Yui ソース（` ```ui ` の中身）。parseBlock(toSource(f)) は f に戻る。
 * - toText: Yui 非対応の場所に貼るためのテキスト化 Markdown（表・リスト）。
 */

import type { ChartFigure, Figure, FlowFigure, StackBox, StackFigure, StatFigure } from "./ir.js";
import { parseMarkdown } from "./markdown.js";

function refsText(refs: number[]): string {
  return refs.map((r) => `[${r}]`).join("");
}

function withRefs(text: string, refs: number[]): string {
  const r = refsText(refs);
  return r ? `${text} ${r}` : text;
}

function esc(cell: string): string {
  return cell.replace(/\|/g, "\\|");
}

function num(v: number | null): string {
  return v === null ? "-" : String(v);
}

// ---------------------------------------------------------------- source

export function toSource(f: Figure): string {
  const lines: string[] = [withRefs(`${f.kind} ${f.title}`.trimEnd(), f.refs)];
  switch (f.kind) {
    case "bar":
    case "line":
      chartSource(f, lines);
      break;
    case "stat":
      for (const it of f.items) {
        const cells = [esc(it.label), esc(it.value)];
        if (it.sub !== undefined) cells.push(esc(it.sub));
        lines.push(withRefs(cells.join(" | "), it.refs));
      }
      break;
    case "flow":
      flowSource(f, lines);
      break;
    case "stack":
      stackSource(f, lines);
      break;
  }
  if (f.src !== undefined) lines.push(`src: ${f.src}`);
  if (f.note !== undefined) lines.push(`note: ${f.note}`);
  return `${lines.join("\n")}\n`;
}

function chartSource(f: ChartFigure, lines: string[]): void {
  if (f.unit !== undefined) lines.push(`unit: ${f.unit}`);
  if (f.stacked) lines.push("stacked: true");
  if (f.horizontal) lines.push("horizontal: true");
  lines.push(f.columns.map(esc).join(" | "));
  for (const r of f.rows) {
    lines.push(withRefs([esc(r.label), ...r.values.map(num)].join(" | "), r.refs));
  }
}

function flowSource(f: FlowFigure, lines: string[]): void {
  if (f.direction === "LR") lines.push("dir: LR");
  const label = new Map(f.nodes.map((n) => [n.id, n.label]));
  const used = new Set<string>();
  for (const e of f.edges) {
    used.add(e.from);
    used.add(e.to);
    const arrow = e.label === undefined ? "->" : `-${e.label}->`;
    lines.push(`${label.get(e.from)} ${arrow} ${label.get(e.to)}`);
  }
  for (const n of f.nodes) if (!used.has(n.id)) lines.push(n.label);
}

function boxText(b: StackBox): string {
  return withRefs(b.desc === undefined ? esc(b.title) : `${esc(b.title)}: ${esc(b.desc)}`, b.refs);
}

function stackSource(f: StackFigure, lines: string[]): void {
  for (const t of f.tiers) {
    if (t.arrowLabel !== undefined) lines.push(`↓ ${t.arrowLabel}`);
    lines.push(`- ${t.boxes.map(boxText).join(" | ")}`);
    for (const b of t.boxes) for (const c of b.children) lines.push(`  - ${boxText(c)}`);
  }
}

// ---------------------------------------------------------------- text

const fmt = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 6 });

export function toText(f: Figure): string {
  const out: string[] = [];
  if (f.title) out.push(`**${withRefs(f.title, f.refs)}**`, "");
  switch (f.kind) {
    case "bar":
    case "line":
      chartText(f, out);
      break;
    case "stat":
      statText(f, out);
      break;
    case "flow":
      flowText(f, out);
      break;
    case "stack":
      stackText(f, out);
      break;
  }
  if (f.note !== undefined) out.push("", `※ ${f.note}`);
  return out.join("\n");
}

function chartText(f: ChartFigure, out: string[]): void {
  const head = [f.columns[0] || "項目", ...f.columns.slice(1)];
  out.push(`| ${head.map(esc).join(" | ")} |`);
  out.push(`|${head.map((_, i) => (i === 0 ? " --- " : " ---: ")).join("|")}|`);
  for (const r of f.rows) {
    const cells = [withRefs(esc(r.label), r.refs), ...r.values.map((v) => (v === null ? "-" : fmt.format(v)))];
    out.push(`| ${cells.join(" | ")} |`);
  }
  if (f.unit !== undefined) out.push("", `（単位: ${f.unit}）`);
}

function statText(f: StatFigure, out: string[]): void {
  for (const it of f.items) {
    const sub = it.sub === undefined ? "" : `（${it.sub}）`;
    out.push(`- ${it.label}: ${withRefs(`${it.value}${sub}`, it.refs)}`);
  }
}

function flowText(f: FlowFigure, out: string[]): void {
  const label = new Map(f.nodes.map((n) => [n.id, n.label]));
  const used = new Set<string>();
  for (const e of f.edges) {
    used.add(e.from);
    used.add(e.to);
    const arrow = e.label === undefined ? "→" : `→（${e.label}）`;
    out.push(`- ${label.get(e.from)} ${arrow} ${label.get(e.to)}`);
  }
  for (const n of f.nodes) if (!used.has(n.id)) out.push(`- ${n.label}`);
}

function stackText(f: StackFigure, out: string[]): void {
  f.tiers.forEach((t, i) => {
    if (i > 0) out.push(t.arrowLabel === undefined ? "  ↓" : `  ↓ ${t.arrowLabel}`);
    out.push(`- ${t.boxes.map((b) => withRefs(b.desc === undefined ? b.title : `${b.title}（${b.desc}）`, b.refs)).join(" ／ ")}`);
    for (const b of t.boxes) {
      for (const c of b.children) out.push(`  - ${withRefs(c.desc === undefined ? c.title : `${c.title}（${c.desc}）`, c.refs)}`);
    }
  });
}

// ---------------------------------------------------------------- markdown

export type UiExportMode = "source" | "text";

/**
 * Markdown 中の ui ブロックを書き換える。
 * - source: そのまま残す（Yui 対応の貼り付け先向け）
 * - text: テキスト化する。解析できないブロックはソースのまま残す。
 */
export function transformMarkdown(markdown: string, mode: UiExportMode): string {
  if (mode === "source") return markdown;
  return parseMarkdown(markdown, { final: true })
    .map((seg) => {
      if (seg.type === "markdown") return seg.text;
      const fig = seg.result.figure;
      return fig ? toText(fig) : seg.raw;
    })
    .join("\n");
}
