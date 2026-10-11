/**
 * 方式 E: Mermaid の一部（flowchart）。flow はそのまま、stack は subgraph を層の中の要素として読む。
 *
 * 本物の Mermaid パーサではない。MiniUI の flow パーサが Mermaid 風の記法を受けることを利用し、
 * subgraph / end / classDef / style などの行だけをここで処理する。
 */

import { parseBlock, type FlowFigure, type StackBox } from "@miniui/core";
import type { Extraction } from "../score.js";
import type { Figure } from "@miniui/core";

const IGNORED = /^(classDef|class|style|linkStyle|click|direction)\b/;

function splitBr(label: string): { title: string; desc?: string } {
  const parts = label.split(/<br\s*\/?>|\\n/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return { title: parts[0] ?? label };
  return { title: parts[0]!, desc: parts.slice(1).join(" ") };
}

export function parseMermaid(body: string, asStack: boolean): { figure: Figure | null; errors: string[] } {
  const errors: string[] = [];
  const lines = body.split("\n");
  const header = lines.find((l) => l.trim() !== "")?.trim() ?? "";
  if (!/^(flowchart|graph)\b/i.test(header)) {
    errors.push(`flowchart / graph で始まっていません: ${header}`);
    return { figure: null, errors };
  }

  // subgraph の範囲を記録しつつ、flow として読める行だけを残す。
  const groups: { id?: string; label: string; members: string[] }[] = [];
  const order: { type: "group"; index: number }[] = [];
  const stack: number[] = [];
  const flowLines: string[] = [];
  const memberLines: { group: number; line: string }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("%%") || IGNORED.test(line)) continue;
    const sg = /^subgraph\s+(?:([A-Za-z0-9_]+)\s*\[(.*)\]|"?(.*?)"?)\s*$/i.exec(line);
    if (sg) {
      const label = (sg[2] ?? sg[3] ?? "").replace(/^"|"$/g, "").trim();
      groups.push(sg[1] === undefined ? { label, members: [] } : { id: sg[1], label, members: [] });
      order.push({ type: "group", index: groups.length - 1 });
      stack.push(groups.length - 1);
      continue;
    }
    if (/^end$/i.test(line)) {
      if (stack.length === 0) errors.push("対応する subgraph の無い end があります");
      stack.pop();
      continue;
    }
    flowLines.push(line);
    if (stack.length > 0) memberLines.push({ group: stack[stack.length - 1]!, line });
  }
  if (stack.length > 0) errors.push("subgraph が閉じていません");

  const r = parseBlock(`flow\n${flowLines.join("\n")}\n`, { final: true });
  for (const d of r.diagnostics) if (d.severity !== "info") errors.push(`${d.code}: ${d.message}`);
  const flow = r.figure as FlowFigure | null;
  if (!flow) return { figure: null, errors };
  if (!asStack) return { figure: flow, errors };

  // stack: グループに属するノードは子、属さないノードとグループを登場順に並べて層にする。
  const memberOf = new Map<string, number>();
  for (const { group, line } of memberLines) {
    const sub = parseBlock(`flow\n${line}\n`, { final: true }).figure as FlowFigure | null;
    for (const n of sub?.nodes ?? []) {
      const target = flow.nodes.find((x) => x.label === n.label);
      if (target && !memberOf.has(target.id)) memberOf.set(target.id, group);
    }
  }
  const tiers: { boxes: StackBox[] }[] = [];
  const emittedGroups = new Set<number>();
  const groupBox = (gi: number): StackBox => {
    const g = groups[gi]!;
    const { title, desc } = splitBr(g.label);
    const box: StackBox = { title, children: [], refs: [] };
    if (desc !== undefined) box.desc = desc;
    for (const n of flow.nodes) if (memberOf.get(n.id) === gi) box.children.push({ ...splitBr(n.label), children: [], refs: [] });
    return box;
  };
  // `client --> core` のように subgraph の id を辺に使った場合、そのノードはグループ自身を指す。
  const groupById = new Map(groups.flatMap((g, i) => (g.id === undefined ? [] : [[g.id, i] as const])));
  for (const n of flow.nodes) {
    const gi = memberOf.get(n.id) ?? groupById.get(n.label);
    if (gi === undefined) {
      const { title, desc } = splitBr(n.label);
      tiers.push({ boxes: [desc === undefined ? { title, children: [], refs: [] } : { title, desc, children: [], refs: [] }] });
    } else if (!emittedGroups.has(gi)) {
      emittedGroups.add(gi);
      tiers.push({ boxes: [groupBox(gi)] });
    }
  }
  for (const o of order) if (!emittedGroups.has(o.index)) tiers.push({ boxes: [groupBox(o.index)] });
  return { figure: { kind: "stack", title: "", refs: [], tiers }, errors };
}

export function extractMermaid(text: string, asStack: boolean): Extraction {
  const figures: Figure[] = [];
  const errors: string[] = [];
  let attempted = false;
  let syntaxOk = true;
  for (const m of text.matchAll(/^ {0,3}(`{3,}|~{3,})\s*mermaid\s*\n([\s\S]*?)\n {0,3}\1\s*$/gm)) {
    attempted = true;
    const r = parseMermaid(m[2]!, asStack);
    errors.push(...r.errors);
    if (r.errors.length > 0) syntaxOk = false;
    if (r.figure) figures.push(r.figure);
  }
  return { figures, attempted, syntaxOk, errors, warnings: 0 };
}
