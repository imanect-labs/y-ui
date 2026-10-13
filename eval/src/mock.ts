/**
 * 正解をそのまま書く「模範解答モデル」。API を呼ばずに、プロンプト組み立て → 抽出 → 採点の
 * 配線が正しいか（各方式で満点が出るか）を確かめるために使う。
 */

import { toSource, type Figure } from "@imanect/yui";
import type { ChatFn } from "./arms.js";
import type { ChatResult } from "./client.js";
import type { ArmId } from "./prompts.js";
import type { EvalTask } from "./tasks/types.js";

export function toJsonui(f: Figure): unknown {
  switch (f.kind) {
    case "bar":
    case "line": {
      const j: Record<string, unknown> = { t: f.kind, title: f.title, cols: f.columns, rows: f.rows.map((r) => [r.label, ...r.values]) };
      if (f.unit !== undefined) j.unit = f.unit;
      return j;
    }
    case "stat":
      return { t: "stat", title: f.title, items: f.items.map((i) => (i.sub === undefined ? [i.label, i.value] : [i.label, i.value, i.sub])) };
    case "flow": {
      const label = new Map(f.nodes.map((n) => [n.id, n.label]));
      return { t: "flow", title: f.title, edges: f.edges.map((e) => (e.label === undefined ? [label.get(e.from), label.get(e.to)] : [label.get(e.from), label.get(e.to), e.label])) };
    }
    case "stack":
      return {
        t: "stack",
        title: f.title,
        layers: f.tiers.map((t) => {
          const box = (b: (typeof t.boxes)[number]) => ({ name: b.title, ...(b.desc ? { desc: b.desc } : {}), ...(b.children.length ? { items: b.children.map((c) => c.title) } : {}) });
          return t.boxes.length === 1 ? box(t.boxes[0]!) : { row: t.boxes.map(box) };
        }),
      };
  }
}

export function toMermaid(f: Figure): string | null {
  if (f.kind === "flow") {
    const lines = ["flowchart TD", ...f.nodes.map((n) => `  ${n.id}[${n.label}]`)];
    for (const e of f.edges) lines.push(e.label === undefined ? `  ${e.from} --> ${e.to}` : `  ${e.from} -->|${e.label}| ${e.to}`);
    return lines.join("\n");
  }
  if (f.kind === "stack") {
    const lines = ["flowchart TB"];
    const tops: string[] = [];
    let k = 0;
    for (const t of f.tiers) {
      for (const b of t.boxes) {
        const id = `t${k++}`;
        tops.push(id);
        const label = b.desc ? `${b.title}<br>${b.desc}` : b.title;
        if (b.children.length === 0) {
          lines.push(`  ${id}[${label}]`);
        } else {
          lines.push(`  subgraph ${id}[${label}]`);
          b.children.forEach((c, i) => lines.push(`    ${id}c${i}[${c.title}]`));
          lines.push("  end");
        }
      }
    }
    lines.push(`  ${tops.join(" --> ")}`);
    return lines.join("\n");
  }
  return null;
}

function toShikiSpec(f: Figure): unknown | null {
  if (f.kind === "bar" || f.kind === "line") {
    const data = f.rows.flatMap((r) => r.values.flatMap((v, i) => (v === null ? [] : [{ x: r.label, y: v, ...(f.columns.length > 2 ? { series: f.columns[i + 1] } : {}) }])));
    return { version: 1, root: { component: "chart", kind: f.kind, title: f.title, data } };
  }
  if (f.kind === "stat") {
    return { version: 1, root: { component: "container", title: f.title, layout: "horizontal", children: f.items.map((i) => ({ component: "stat", label: i.label, value: i.value })) } };
  }
  return null;
}

function result(text: string, toolCalls: ChatResult["toolCalls"] = []): ChatResult {
  return { text, toolCalls, usage: { promptTokens: 0, completionTokens: Math.ceil(text.length / 2) }, ttftMs: 1, totalMs: 2, finishReason: "stop" };
}

export function mockChat(arm: ArmId, task: EvalTask): ChatFn {
  return async (_req, figureReady) => {
    const f = task.gold;
    if (task.expect === "none" || !f) return result("資料に基づいて回答します。図は不要です。");
    const lead = "資料をもとに整理しました。\n\n";
    let r: ChatResult;
    switch (arm) {
      case "A":
      case "A2": {
        const spec = toShikiSpec(f);
        r = spec ? result("", [{ id: "call_1", name: "emit_ui", arguments: JSON.stringify({ spec }) }]) : result("このカタログでは表現できないため文章で説明します。");
        break;
      }
      case "B":
      case "C":
      case "F":
        r = result(`${lead}\`\`\`ui\n${toSource(f)}\`\`\`\n`);
        break;
      case "D":
        r = result(`${lead}\`\`\`uijson\n${JSON.stringify(toJsonui(f))}\n\`\`\`\n`);
        break;
      case "E": {
        const m = toMermaid(f);
        r = result(m ? `${lead}\`\`\`mermaid\n${m}\n\`\`\`\n` : "図は省略します。");
        break;
      }
    }
    if (figureReady && figureReady(r.text)) r.firstFigureMs = 1;
    return r;
  };
}
