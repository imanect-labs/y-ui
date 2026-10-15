/**
 * IR からテキストへの変換。
 *
 * - toSource: 正規形の Yui ソース（` ```ui ` の中身）。parseBlock(toSource(f)) は f に戻る。
 * - toText: Yui 非対応の場所に貼るためのテキスト化 Markdown（表・リスト）。
 */

import type { ChartFigure, Figure, FlowFigure, ScatterFigure, StackBox, StackFigure, StatFigure, StepsFigure, TimelineFigure, TreeNode } from "./ir.js";
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
    case "pie":
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
    case "scatter":
      lines.push(f.columns.map(esc).join(" | "));
      for (const p of f.points) lines.push(withRefs([esc(p.label), String(p.x), String(p.y), ...(p.group !== undefined ? [esc(p.group)] : [])].join(" | "), p.refs));
      break;
    case "timeline":
      // 時期・出来事に `:` が入っても戻せるよう、表の形で書く
      for (const e of f.events) lines.push(withRefs([esc(e.when), esc(e.title), ...(e.desc !== undefined ? [esc(e.desc)] : [])].join(" | "), e.refs));
      break;
    case "steps":
      f.steps.forEach((s, i) => lines.push(withRefs(`${i + 1}. ${stepSource(s.title, s.desc)}`, s.refs)));
      break;
    case "tree":
      treeSource(f.roots, 0, lines);
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

/** 見出しに `:` や `|` が無ければ `見出し: 説明`、あれば表の形（`見出し | 説明`）。 */
function stepSource(title: string, desc: string | undefined): string {
  const plain = !/[:：|]/.test(title) && !/^(step|ステップ|手順|stage|段階)\s*\d/i.test(title) && !(desc ?? "").includes("|");
  if (plain) return desc === undefined ? title : `${title}: ${desc}`;
  return desc === undefined ? `${esc(title)} |` : `${esc(title)} | ${esc(desc)}`;
}

function treeSource(nodes: TreeNode[], depth: number, lines: string[]): void {
  for (const n of nodes) {
    lines.push(`${"  ".repeat(depth)}- ${withRefs(n.desc === undefined ? esc(n.title) : `${esc(n.title)}: ${esc(n.desc)}`, n.refs)}`);
    treeSource(n.children, depth + 1, lines);
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
    case "pie":
      pieText(f, out);
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
    case "scatter":
      scatterText(f, out);
      break;
    case "timeline":
      timelineText(f, out);
      break;
    case "steps":
      stepsText(f, out);
      break;
    case "tree":
      treeText(f.roots, 0, out);
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

/** 円グラフは、値と割合の表にする。 */
function pieText(f: ChartFigure, out: string[]): void {
  const total = f.rows.reduce((a, r) => a + (r.values[0] ?? 0), 0);
  const head = [f.columns[0] || "項目", f.columns[1] || "値", "割合"];
  out.push(`| ${head.map(esc).join(" | ")} |`, "| --- | ---: | ---: |");
  for (const r of f.rows) {
    const v = r.values[0] ?? 0;
    out.push(`| ${withRefs(esc(r.label), r.refs)} | ${fmt.format(v)} | ${share(v, total)} |`);
  }
  if (f.unit !== undefined) out.push("", `（単位: ${f.unit}）`);
}

/** 割合の表記（10% 未満は小数 1 桁）。 */
export function share(v: number, total: number): string {
  if (total <= 0) return "-";
  const p = (v / total) * 100;
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
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

function scatterText(f: ScatterFigure, out: string[]): void {
  const group = f.columns.length > 3;
  out.push(`| ${f.columns.map(esc).join(" | ")} |`, `| --- | ---: | ---: |${group ? " --- |" : ""}`);
  for (const p of f.points) out.push(`| ${[withRefs(esc(p.label), p.refs), fmt.format(p.x), fmt.format(p.y), ...(group ? [esc(p.group ?? "")] : [])].join(" | ")} |`);
}

function timelineText(f: TimelineFigure, out: string[]): void {
  for (const e of f.events) out.push(`- ${e.when}: ${withRefs(e.desc === undefined ? e.title : `${e.title}（${e.desc}）`, e.refs)}`);
}

function stepsText(f: StepsFigure, out: string[]): void {
  f.steps.forEach((s, i) => out.push(`${i + 1}. ${withRefs(s.desc === undefined ? s.title : `${s.title}: ${s.desc}`, s.refs)}`));
}

function treeText(nodes: TreeNode[], depth: number, out: string[]): void {
  for (const n of nodes) {
    out.push(`${"  ".repeat(depth)}- ${withRefs(n.desc === undefined ? n.title : `${n.title}（${n.desc}）`, n.refs)}`);
    treeText(n.children, depth + 1, out);
  }
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
