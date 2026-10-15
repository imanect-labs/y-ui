/**
 * IR からテキストへの変換。
 *
 * - toSource: 正規形の Yui ソース（` ```ui ` の中身）。parseBlock(toSource(f)) は f に戻る。
 * - toText: Yui 非対応の場所に貼るためのテキスト化 Markdown（表・リスト）。
 */

import { formatCalc, runCalc, shownFormulas } from "./calc/run.js";
import type { AppField, AppFigure, CalcFigure, ChartFigure, CompareCell, Figure, ListItem, FlowFigure, FunnelFigure, QuadrantFigure, ScatterFigure, StackBox, StackFigure, StatFigure, StepsFigure, TimelineFigure, TreeNode } from "./ir.js";
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
      // 時期・出来事に `:` が入っても戻せるよう、表の形で書く。2 段落目以降は字下げした行
      for (const e of f.events) {
        const [first, ...more] = e.desc === undefined ? [] : e.desc.split("\n");
        lines.push(withRefs([esc(e.when), esc(e.title), ...(first !== undefined ? [esc(first)] : [])].join(" | "), e.refs));
        for (const p of more) lines.push(`  ${p}`);
      }
      break;
    case "steps":
      f.steps.forEach((s, i) => {
        const [first, ...more] = s.desc === undefined ? [] : s.desc.split("\n");
        lines.push(withRefs(`${i + 1}. ${stepSource(s.title, first)}`, s.refs));
        for (const p of more) lines.push(`   ${p}`);
      });
      break;
    case "tree":
      treeSource(f.roots, 0, lines);
      break;
    case "cards":
      for (const c of f.cards) {
        const [first, ...more] = c.body === undefined ? [] : c.body.split("\n");
        const head = c.value !== undefined ? `${esc(c.title)} | ${esc(c.value)}${first !== undefined ? ` | ${esc(first)}` : ""}` : stepSource(c.title, first);
        lines.push(withRefs(`- ${head}`, c.refs));
        for (const p of more) lines.push(`  ${p}`);
        for (const it of c.items ?? []) lines.push(`  - ${it}`);
      }
      break;
    case "progress":
      for (const it of f.items) lines.push(withRefs([esc(it.label), esc(it.valueText), esc(it.targetText)].join(" | "), it.refs));
      break;
    case "funnel":
      if (f.unit !== undefined) lines.push(`unit: ${f.unit}`);
      for (const s of f.stages) lines.push(withRefs(`${esc(s.label)} | ${s.value}`, s.refs));
      break;
    case "quadrant":
      if (f.xLabel) lines.push(`x: ${f.xLabel}`);
      if (f.yLabel) lines.push(`y: ${f.yLabel}`);
      ["右上", "左上", "左下", "右下"].forEach((q, i) => f.quadrants[i] && lines.push(`${q}: ${f.quadrants[i]}`));
      for (const it of f.items) lines.push(withRefs(`${esc(it.label)} | ${it.x} | ${it.y}`, it.refs));
      break;
    case "gantt":
      for (const t of f.tasks) lines.push(withRefs([esc(t.label), esc(t.startText), ...(t.endText ? [esc(t.endText)] : [])].join(" | "), t.refs));
      break;
    case "calc":
      calcSource(f, lines);
      break;
    case "compare":
      if (f.highlight !== undefined) lines.push(`推奨: ${f.columns[f.highlight]}`);
      lines.push(f.columns.map(esc).join(" | "));
      for (const r of f.rows) lines.push(withRefs([esc(r.label), ...r.cells.map(cellSource)].join(" | "), r.refs));
      break;
    case "proscons": {
      // 見出しの無い側は `+ 項目` / `- 項目` で先に書く（見出しの後ろの `- ` は見出しの項目になるため）
      const sides = [
        { list: f.pros, label: f.labels[0], mark: "+", name: "メリット" },
        { list: f.cons, label: f.labels[1], mark: "-", name: "デメリット" },
      ];
      for (const s of sides) if (!s.label) for (const it of s.list) itemSource(it, `${s.mark} `, lines);
      for (const s of sides) {
        if (!s.label) continue;
        lines.push(`${s.label}:`);
        for (const it of s.list) itemSource(it, "- ", lines);
      }
      break;
    }
    case "swot":
      SWOT_NAMES.forEach((name, i) => {
        if (!f.labels[i] && f.sections[i]!.length === 0) return;
        lines.push(`${f.labels[i] || name}:`);
        for (const it of f.sections[i]!) itemSource(it, "- ", lines);
      });
      break;
    case "checklist":
      for (const it of f.items) itemSource(it, `- [${it.state === "done" ? "x" : it.state === "doing" ? "~" : " "}] `, lines);
      break;
    case "app":
      appSource(f, lines);
      break;
    case "ask":
      for (const d of f.intro?.split("\n") ?? []) lines.push(`> ${d}`);
      for (const q of f.questions) {
        lines.push(`? ${[q.text, q.multi ? "multi" : "", q.required ? "" : "任意", q.placeholder ? `例 ${q.placeholder}` : ""].filter(Boolean).join(" ")}`);
        for (const o of q.options) lines.push(`- ${o.desc !== undefined ? `${o.label}: ${o.desc}` : o.label}`);
        if (q.other) lines.push("- その他");
      }
      if (f.submitLabel) lines.push(`button ${f.submitLabel}`);
      break;
    case "plan":
      for (const d of f.intro?.split("\n") ?? []) lines.push(`> ${d}`);
      f.steps.forEach((s, i) => {
        const [first, ...more] = s.desc === undefined ? [] : s.desc.split("\n");
        lines.push(withRefs(`${i + 1}. ${stepSource(s.title, first)}`, s.refs));
        for (const p of more) lines.push(`   ${p}`);
      });
      if (f.approveLabel) lines.push(`button ${f.approveLabel}`);
      if (!f.revise) lines.push("revise: off");
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

const SWOT_NAMES = ["強み", "弱み", "機会", "脅威"];

/** 箇条書きの 1 項目（`前置き 見出し: 補足`、2 段落目以降は字下げした行）。 */
function itemSource(it: { text: string; desc?: string; refs: number[] }, prefix: string, lines: string[]): void {
  const [first, ...more] = it.desc === undefined ? [] : it.desc.split("\n");
  lines.push(withRefs(`${prefix}${first === undefined ? it.text : `${it.text}: ${first}`}`, it.refs));
  for (const p of more) lines.push(`${" ".repeat(prefix.length + 2)}${p}`);
}

const MARK_TEXT = { yes: "✓", no: "✗", partial: "△" } as const;

function fieldSource(x: AppField): string {
  const parts = [`${x.label} = ${x.type}`];
  if (x.type === "choice") parts.push(x.options!.map((o) => (o.label === o.value ? o.value : `${o.label}=${o.value}`)).join(" | "));
  if (x.type === "rating") parts.push(String(x.max ?? 5));
  else if (x.min !== undefined && x.max !== undefined) parts.push(`${x.min}..${x.max}`);
  if (x.unit) parts.push(x.unit);
  if (x.required) parts.push("必須");
  if (x.multi) parts.push("multi");
  if (x.other) parts.push("other");
  if (x.key !== x.label) parts.push(`as ${x.key}`);
  if (x.step !== undefined && x.type !== "count") parts.push(`step ${x.step}`);
  if (x.initial !== undefined) {
    const v = x.initial;
    parts.push(`初期 ${typeof v === "boolean" ? (v ? "オン" : "オフ") : Array.isArray(v) ? v.join(", ") : v}`);
  }
  if (x.placeholder) parts.push(`例 ${x.placeholder}`);
  return parts.join(" ");
}

function appSource(f: AppFigure, lines: string[]): void {
  f.sections.forEach((s) => {
    if (s.title) lines.push(`## ${s.title}`);
    for (const d of s.desc?.split("\n") ?? []) lines.push(`> ${d}`);
    for (const x of s.fields) lines.push(fieldSource(x));
    for (const a of s.actions) lines.push(`button ${a.label} -> ${a.target.kind === "chat" ? `chat${a.confirm ? " confirm" : ""}` : `workflow ${a.target.name}`}`);
  });
}

const FIELD_TYPE_JA: Record<AppField["type"], string> = { text: "文字", textarea: "文章", number: "数値", slider: "数値", count: "数", choice: "選択", date: "日付", daterange: "期間", month: "年月", toggle: "オン・オフ", rating: "評価" };

function appText(f: AppFigure, out: string[]): void {
  out.push("（入力してボタンで実行する画面。対応する画面で操作できます）");
  for (const s of f.sections) {
    out.push("");
    if (s.title) out.push(`### ${s.title}`);
    if (s.desc) out.push(s.desc.replace(/\n/g, " "));
    for (const x of s.fields) {
      const kind = [FIELD_TYPE_JA[x.type], x.required ? "必須" : "", x.type === "choice" ? [...x.options!.map((o) => o.label), ...(x.other ? ["その他"] : [])].join(" / ") : "", x.unit ?? ""].filter(Boolean).join("・");
      out.push(`- ${x.label}（${kind}）${x.placeholder ? `: 例 ${x.placeholder}` : ""}`);
    }
    for (const a of s.actions) out.push(`- ボタン「${a.label}」→ ${a.target.kind === "chat" ? "会話に送る" : `ワークフロー「${a.target.name}」を起動`}`);
  }
}

function cellSource(c: CompareCell): string {
  if (!c.mark) return esc(c.text);
  return c.text ? `${MARK_TEXT[c.mark]} ${esc(c.text)}` : MARK_TEXT[c.mark];
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
    case "cards":
      for (const c of f.cards) {
        const head = [c.value, c.body?.replace(/\n/g, " ")].filter(Boolean).join(" ");
        out.push(`- **${c.title}**${head ? `: ${head}` : ""}${c.refs.length ? ` ${refsText(c.refs)}` : ""}`);
        for (const it of c.items ?? []) out.push(`  - ${it}`);
      }
      break;
    case "progress":
      for (const it of f.items) out.push(`- ${withRefs(`${it.label}: ${it.valueText} / ${it.targetText}（${share(it.value, it.target)}）`, it.refs)}`);
      break;
    case "funnel":
      funnelText(f, out);
      break;
    case "quadrant":
      if (f.xLabel || f.yLabel) out.push(`（横軸: ${f.xLabel || "-"}、縦軸: ${f.yLabel || "-"}。0〜100）`, "");
      for (const it of f.items) out.push(`- ${withRefs(`${it.label}: 横 ${it.x}・縦 ${it.y}${quadrantName(f, it.x, it.y)}`, it.refs)}`);
      break;
    case "gantt":
      for (const t of f.tasks) out.push(`- ${withRefs(`${t.label}: ${t.endText ? `${t.startText} 〜 ${t.endText}` : t.startText}`, t.refs)}`);
      break;
    case "calc":
      calcText(f, out);
      break;
    case "compare": {
      const head = [f.columns[0] || "項目", ...f.columns.slice(1).map((c, i) => (f.highlight === i + 1 ? `${c}（推奨）` : c))];
      out.push(`| ${head.map(esc).join(" | ")} |`, `|${head.map(() => " --- ").join("|")}|`);
      for (const r of f.rows) out.push(`| ${[withRefs(r.label, r.refs), ...r.cells.map((c) => (c.mark ? `${MARK_TEXT[c.mark]}${c.text ? ` ${c.text}` : ""}` : c.text))].map(esc).join(" | ")} |`);
      break;
    }
    case "proscons":
      listText(f.labels[0] || "メリット", f.pros, out);
      listText(f.labels[1] || "デメリット", f.cons, out);
      break;
    case "swot":
      SWOT_NAMES.forEach((name, i) => listText(f.labels[i] || name, f.sections[i]!, out));
      break;
    case "app":
      appText(f, out);
      break;
    case "ask":
      if (f.intro) out.push(f.intro.replace(/\n/g, " "), "");
      f.questions.forEach((q, i) => {
        out.push(`${i + 1}. ${q.text}${q.multi ? "（複数選択可）" : ""}${q.required ? "" : "（任意）"}`);
        for (const o of q.options) out.push(`   - ${o.desc ? `${o.label}: ${o.desc}` : o.label}`);
        if (q.other) out.push("   - その他（自由記述）");
      });
      break;
    case "plan":
      if (f.intro) out.push(f.intro.replace(/\n/g, " "), "");
      f.steps.forEach((s, i) => out.push(`${i + 1}. ${withRefs(s.desc ? `${s.title}: ${s.desc.replace(/\n/g, " ")}` : s.title, s.refs)}`));
      break;
    case "checklist": {
      const done = f.items.filter((it) => it.state === "done").length;
      out.push(`（${f.items.length} 項目中 ${done} 項目が完了）`, "");
      for (const it of f.items) out.push(`- [${it.state === "done" ? "x" : " "}] ${withRefs(it.desc ? `${it.text}: ${it.desc.replace(/\n/g, " ")}` : it.text, it.refs)}${it.state === "doing" ? "（進行中）" : ""}`);
      break;
    }
  }
  if (f.note !== undefined) out.push("", `※ ${f.note}`);
  return out.join("\n");
}

function listText(label: string, items: ListItem[], out: string[]): void {
  if (items.length === 0) return;
  if (out.length > 0 && out[out.length - 1] !== "") out.push("");
  out.push(`**${label}**`);
  for (const it of items) out.push(`- ${withRefs(it.desc ? `${it.text}: ${it.desc.replace(/\n/g, " ")}` : it.text, it.refs)}`);
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

function calcSource(f: CalcFigure, lines: string[]): void {
  for (const d of f.defs) {
    const unit = d.unit ? ` ${d.unit}` : "";
    if (d.type === "formula") {
      lines.push(`${d.name} = ${d.source}${unit}${d.round !== undefined ? ` round ${d.round}` : ""}`);
      continue;
    }
    switch (d.control) {
      case "slider":
        lines.push(`${d.name} = slider ${d.min}..${d.max} step ${d.step} 初期 ${d.initial}${unit}`);
        break;
      case "count":
        lines.push(`${d.name} = count ${d.min}..${d.max} 初期 ${d.initial}${unit}`);
        break;
      case "choice":
        lines.push(`${d.name} = choice ${d.options!.map((o) => `${o.label}=${o.value}`).join(" | ")}${unit}`);
        break;
      case "toggle":
        lines.push(`${d.name} = toggle${d.initial ? " 初期 オン" : ""}`);
        break;
    }
  }
  if (f.show.length) lines.push(`show ${f.show.join(" | ")}`);
  if (f.hide.length) lines.push(`hide: ${f.hide.join(", ")}`);
}

/** 計算はテキストにすると操作できないので、初期値での結果と式を並べる。 */
function calcText(f: CalcFigure, out: string[]): void {
  const v = runCalc(f);
  const show = new Set(shownFormulas(f).map((x) => x.name));
  out.push("入力（初期値）:");
  for (const d of f.defs) {
    if (d.type !== "input") continue;
    const label = d.control === "choice" ? (d.options!.find((o) => o.value === d.initial)?.label ?? String(d.initial)) : d.control === "toggle" ? (d.initial ? "オン" : "オフ") : `${fmt.format(d.initial)}${d.unit ?? ""}`;
    out.push(`- ${d.name}: ${label}`);
  }
  out.push("", "結果:");
  for (const d of f.defs) {
    if (d.type !== "formula" || f.hide.includes(d.name)) continue;
    const value = `${formatCalc(v.get(d.name) ?? null, d.round, "ja-JP")}${d.unit ?? ""}`;
    out.push(`- ${show.has(d.name) ? `**${d.name}**` : d.name}: ${value}（= ${d.source}）`);
  }
}

/** 項目が入る象限の名前（`（すぐやる）`）。名前が無ければ空文字。 */
function quadrantName(f: QuadrantFigure, x: number, y: number): string {
  const i = y >= 50 ? (x >= 50 ? 0 : 1) : x >= 50 ? 3 : 2;
  return f.quadrants[i] ? `（${f.quadrants[i]}）` : "";
}

function funnelText(f: FunnelFigure, out: string[]): void {
  const first = f.stages[0]?.value ?? 0;
  out.push(`| 段階 | ${f.unit ? `数（${f.unit}）` : "数"} | 前の段階から | 最初から |`, "| --- | ---: | ---: | ---: |");
  f.stages.forEach((s, i) => {
    const prev = i === 0 ? "-" : share(s.value, f.stages[i - 1]!.value);
    out.push(`| ${withRefs(esc(s.label), s.refs)} | ${fmt.format(s.value)} | ${prev} | ${i === 0 ? "-" : share(s.value, first)} |`);
  });
}

function scatterText(f: ScatterFigure, out: string[]): void {
  const group = f.columns.length > 3;
  out.push(`| ${f.columns.map(esc).join(" | ")} |`, `| --- | ---: | ---: |${group ? " --- |" : ""}`);
  for (const p of f.points) out.push(`| ${[withRefs(esc(p.label), p.refs), fmt.format(p.x), fmt.format(p.y), ...(group ? [esc(p.group ?? "")] : [])].join(" | ")} |`);
}

function timelineText(f: TimelineFigure, out: string[]): void {
  for (const e of f.events) out.push(`- ${e.when}: ${withRefs(e.desc === undefined ? e.title : `${e.title}（${e.desc.replace(/\n/g, " ")}）`, e.refs)}`);
}

function stepsText(f: StepsFigure, out: string[]): void {
  f.steps.forEach((s, i) => out.push(`${i + 1}. ${withRefs(s.desc === undefined ? s.title : `${s.title}: ${s.desc.replace(/\n/g, " ")}`, s.refs)}`));
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
