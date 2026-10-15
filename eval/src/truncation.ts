/**
 * 生成途中で切れたときの強さ（モデル不要）。
 *
 * 各課題の正解を Yui のソース（正規形と、モデルが書きがちな崩した形）にして文章に埋め込み、
 * 先頭から 1 文字ずつ伸ばしながら解析する。確かめること:
 *   1. 例外を出さない
 *   2. 途中で表示した行・項目・辺・層が、最終結果の先頭部分と一致する（途中で誤った値を出さない）
 *   3. 表示される量が減らない（ちらつかない）
 * あわせて、図が最初に描けるようになる位置と、解析にかかる時間を測る。
 */

import { isChart, parseMarkdown, toSource, type Figure } from "@imanect/yui";
import type { EvalTask } from "./tasks/types.js";

export interface TruncationCase {
  id: string;
  variant: string;
  doc: string;
}

/** モデルが書きがちな崩した形（GFM の表、Mermaid 風の矢印、記号なしの箇条書きなど）。 */
function variants(f: Figure): { variant: string; src: string }[] {
  const canonical = toSource(f);
  const out = [{ variant: "canonical", src: canonical }];
  if (isChart(f)) {
    const head = `| ${f.columns.join(" | ")} |\n|${f.columns.map(() => "---").join("|")}|\n`;
    const rows = f.rows.map((r) => `| ${r.label} | ${r.values.map((v) => (v === null ? "-" : v.toLocaleString("ja-JP"))).join(" | ")} |`).join("\n");
    out.push({ variant: "gfm-table", src: `${f.kind} | ${f.title}\n${f.unit ? `unit: ${f.unit}\n` : ""}${head}${rows}\n` });
  }
  if (f.kind === "flow") {
    const lines = ["flowchart TD", ...f.nodes.map((n) => `  ${n.id}[${n.label}]`)];
    for (const e of f.edges) lines.push(e.label === undefined ? `  ${e.from} --> ${e.to}` : `  ${e.from} -->|${e.label}| ${e.to}`);
    out.push({ variant: "mermaid-style", src: `flow ${f.title}\n${lines.join("\n")}\n` });
  }
  if (f.kind === "stat") {
    out.push({ variant: "colon", src: `stat ${f.title}\n${f.items.map((i) => `- ${i.label}: ${i.value}`).join("\n")}\n` });
  }
  return out;
}

export function truncationCases(tasks: EvalTask[]): TruncationCase[] {
  return tasks.flatMap((t) =>
    t.gold
      ? variants(t.gold).map((v) => ({
          id: t.id,
          variant: v.variant,
          doc: `資料をもとに整理しました。\n\n\`\`\`ui\n${v.src}\`\`\`\n\n以上です。`,
        }))
      : [],
  );
}

/** 図の「表示される単位」の列。途中結果はこの列の先頭部分であるべき。 */
function units(f: Figure): string[] {
  switch (f.kind) {
    case "bar":
    case "line":
    case "pie":
    case "radar":
    case "treemap":
      return [JSON.stringify(f.columns), ...f.rows.map((r) => JSON.stringify(r))];
    case "callout":
      return [...(f.body ? f.body.split("\n") : []), ...f.items];
    case "map":
      return f.markers.map((m) => JSON.stringify(m));
    case "stat":
      return f.items.map((i) => JSON.stringify(i));
    case "flow": {
      const label = new Map(f.nodes.map((n) => [n.id, n.label]));
      return f.edges.map((e) => `${label.get(e.from)}>${e.label ?? ""}>${label.get(e.to)}`);
    }
    case "stack":
      // 層は子が後から増えるので、層の見出しだけを単位にし、子は別に確かめる。
      return f.tiers.map((t) => JSON.stringify(t.boxes.map((b) => [b.title, b.desc])));
    case "scatter":
      return [JSON.stringify(f.columns), ...f.points.map((p) => JSON.stringify(p))];
    case "timeline":
      // 説明は字下げした次の行で後から伸びるので、時期と出来事だけを単位にする
      return f.events.map((e) => JSON.stringify([e.when, e.title]));
    case "steps":
      return f.steps.map((s) => s.title);
    case "cards":
      // 本文は字下げした次の行で後から伸びるので、見出しだけを単位にする
      return f.cards.map((c) => c.title);
    case "progress":
      return f.items.map((i) => JSON.stringify(i));
    case "funnel":
      return f.stages.map((s) => JSON.stringify(s));
    case "quadrant":
      return f.items.map((i) => JSON.stringify(i));
    case "gantt":
      return f.tasks.map((t) => JSON.stringify(t));
    case "calc":
      return f.defs.map((d) => JSON.stringify(d));
    case "compare":
      // 見出し行が確定するまでは列が空
      return [...(f.columns.length ? [JSON.stringify(f.columns)] : []), ...f.rows.map((r) => JSON.stringify(r))];
    case "proscons":
      // 補足は字下げした次の行で後から伸びるので、項目の見出しだけを単位にする
      return [...f.pros.map((i) => `+${i.text}`), ...f.cons.map((i) => `-${i.text}`)];
    case "swot":
      return f.sections.flatMap((s, k) => s.map((i) => `${k}:${i.text}`));
    case "checklist":
      return f.items.map((i) => JSON.stringify([i.text, i.state]));
    case "ask":
      // 選択肢は質問の後から伸びるので、質問の文だけを単位にする
      return f.questions.map((q) => q.text);
    case "plan":
      return f.steps.map((s) => s.title);
    case "app":
      // 機能の見出し・部品・ボタンを書かれた順に（説明は後から伸びるので含めない）
      return f.sections.flatMap((s) => [`#${s.title ?? ""}`, ...s.fields.map((x) => JSON.stringify(x)), ...s.actions.map((a) => JSON.stringify(a))]);
    case "tree": {
      const out: string[] = [];
      const walk = (ns: typeof f.roots, d: number) => ns.forEach((n) => (out.push(`${d}:${n.title}`), walk(n.children, d + 1)));
      walk(f.roots, 0);
      return out;
    }
  }
}

function stackChildren(f: Figure): string[][] {
  return f.kind === "stack" ? f.tiers.flatMap((t) => t.boxes.map((b) => b.children.map((c) => JSON.stringify(c)))) : [];
}

export interface TruncationResult {
  id: string;
  variant: string;
  length: number;
  exceptions: number;
  /** 途中で、最終結果と食い違う内容を表示した回数。 */
  inconsistent: number;
  /** 表示量が減った回数。 */
  shrinks: number;
  /** 図が最初に描けた位置（ui ブロック内の割合 0..1）。 */
  firstFigureAt: number | null;
  /** 1 回の解析の最大時間（ms）。 */
  maxParseMs: number;
  /** 全接頭辞の解析時間の合計（ms）。毎チャンク全体を解析し直す場合のコスト。 */
  totalParseMs: number;
  example?: string;
}

export function checkCase(c: TruncationCase): TruncationResult {
  const final = parseMarkdown(c.doc, { final: true }).find((s) => s.type === "ui");
  const finalFig = final && final.type === "ui" ? final.result.figure : null;
  const finalUnits = finalFig ? units(finalFig) : [];
  const finalChildren = finalFig ? stackChildren(finalFig) : [];
  const blockStart = c.doc.indexOf("```ui");
  const blockEnd = c.doc.indexOf("```", blockStart + 5);

  const res: TruncationResult = { id: c.id, variant: c.variant, length: c.doc.length, exceptions: 0, inconsistent: 0, shrinks: 0, firstFigureAt: null, maxParseMs: 0, totalParseMs: 0 };
  let prevCount = 0;
  for (let i = 1; i <= c.doc.length; i++) {
    const prefix = c.doc.slice(0, i);
    const t0 = performance.now();
    let segs;
    try {
      segs = parseMarkdown(prefix);
    } catch (e) {
      res.exceptions++;
      res.example ??= `@${i}: ${(e as Error).message}`;
      continue;
    }
    const dt = performance.now() - t0;
    res.totalParseMs += dt;
    res.maxParseMs = Math.max(res.maxParseMs, dt);
    const ui = segs.find((s) => s.type === "ui");
    const fig = ui && ui.type === "ui" ? ui.result.figure : null;
    if (!fig) continue;
    const u = units(fig);
    // 列名の行は、データ行が来るまで補完値のことがあるので、行が 1 つ以上あるときだけ比べる。
    const comparable = (isChart(fig) && fig.rows.length === 0) || (fig.kind === "scatter" && fig.points.length === 0) ? [] : u;
    comparable.forEach((x, k) => {
      if (finalUnits[k] !== x) {
        res.inconsistent++;
        res.example ??= `@${i}: ${x} ≠ ${finalUnits[k]}`;
      }
    });
    stackChildren(fig).forEach((cs, bi) =>
      cs.forEach((x, k) => {
        if (finalChildren[bi]?.[k] !== x) {
          res.inconsistent++;
          res.example ??= `@${i}: 子 ${x}`;
        }
      }),
    );
    const count = u.length + stackChildren(fig).flat().length;
    if (count < prevCount) res.shrinks++;
    prevCount = count;
    if (res.firstFigureAt === null && comparable.length > (isChart(fig) ? 1 : 0)) {
      res.firstFigureAt = Math.max(0, (i - blockStart) / Math.max(1, blockEnd - blockStart));
    }
  }
  return res;
}

export function summarize(results: TruncationResult[]): string {
  const bad = results.filter((r) => r.exceptions || r.inconsistent || r.shrinks);
  const firsts = results.flatMap((r) => (r.firstFigureAt === null ? [] : [r.firstFigureAt])).sort((a, b) => a - b);
  const q = (p: number) => firsts[Math.min(firsts.length - 1, Math.floor(p * firsts.length))] ?? NaN;
  const maxParse = Math.max(...results.map((r) => r.maxParseMs));
  const lines = [
    "# 生成途中で切れたときの検証",
    "",
    `- ケース: ${results.length}（課題 × 書き方の崩し）、接頭辞の解析回数: ${results.reduce((n, r) => n + r.length, 0).toLocaleString()}`,
    `- 例外: ${results.reduce((n, r) => n + r.exceptions, 0)}、途中表示の食い違い: ${results.reduce((n, r) => n + r.inconsistent, 0)}、表示量の減少: ${results.reduce((n, r) => n + r.shrinks, 0)}`,
    `- 図が最初に描ける位置（ui ブロック内の割合）: 中央値 ${(q(0.5) * 100).toFixed(0)}%、90 パーセンタイル ${(q(0.9) * 100).toFixed(0)}%`,
    `- 1 回の解析の最大時間: ${maxParse.toFixed(2)} ms`,
    "",
  ];
  if (bad.length > 0) {
    lines.push("## 問題のあったケース", "", "| 課題 | 書き方 | 例外 | 食い違い | 減少 | 例 |", "|---|---|---:|---:|---:|---|");
    for (const r of bad) lines.push(`| ${r.id} | ${r.variant} | ${r.exceptions} | ${r.inconsistent} | ${r.shrinks} | ${(r.example ?? "").replace(/\|/g, "\\|").slice(0, 80)} |`);
  }
  return lines.join("\n");
}
