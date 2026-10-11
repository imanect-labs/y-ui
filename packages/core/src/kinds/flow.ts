/**
 * flow: 矢印でつないだ流れ図。
 *
 * - `A -> B -> C`（`-->` `→` `=>` も可）
 * - ラベル付き: `A -はい-> B` / `A -->|はい| B` / `A -- はい --> B`
 * - Mermaid 風のノード定義 `A[注文] --> B{在庫あり?}` も受ける（id で同一ノード）。
 * - 矢印の無い行は単独のノード。
 */

import type { FlowFigure, FlowNode, NodeShape } from "../ir.js";
import { clip, Diagnostics, LIMITS, type Line, parseOption, stripListMarker, textKey } from "../lines.js";

const OPTIONS = ["note", "src", "dir"] as const;

/** 位置 i から矢印を読む。読めたら [消費した長さ, ラベル] を返す。 */
const ARROWS: { re: RegExp; label: number | null; needsSpace?: boolean }[] = [
  // A -->|label| B
  { re: /\s*(?:-{1,3}|={1,3})>\s*\|([^|]*)\|\s*/y, label: 1 },
  // A -- label --> B
  { re: /\s*(?:--|==)\s+([^\s>][^>]*?)\s+(?:-{2,3}|={2,3})>\s*/y, label: 1 },
  // A -label-> B（前に空白が要る。ハイフンを含む名前を誤認しないため）
  { re: /\s+-{1,2}([^\s\-<>|][^<>|]*?)-{1,2}>\s*/y, label: 1, needsSpace: true },
  // 素の矢印
  { re: /\s*(?:-{1,3}>|={1,3}>|→|⇒|⟶|➡|➔)\s*/y, label: null },
];

function readArrow(text: string, i: number): [number, string | undefined] | null {
  for (const a of ARROWS) {
    if (a.needsSpace && !/\s/.test(text[i] ?? "")) continue;
    a.re.lastIndex = i;
    const m = a.re.exec(text);
    if (m && m[0].length > 0) {
      const label = a.label === null ? undefined : m[a.label]!.trim() || undefined;
      return [m[0].length, label];
    }
  }
  return null;
}

/** 1 行をノード文字列と辺ラベルの列に分ける。 */
export function splitChain(text: string): { nodes: string[]; labels: (string | undefined)[] } {
  const nodes: string[] = [];
  const labels: (string | undefined)[] = [];
  let cur = "";
  let i = 0;
  while (i < text.length) {
    // 角括弧などの中は矢印として読まない（`A[入力 -> 検証]`）。
    const open = text[i]!;
    const close = BRACKETS[open];
    if (close && /[A-Za-z0-9_]$/.test(cur)) {
      const end = text.indexOf(close, i + 1);
      if (end > i) {
        cur += text.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    const arrow = readArrow(text, i);
    if (arrow && cur.trim() !== "") {
      nodes.push(cur.trim());
      labels.push(arrow[1]);
      cur = "";
      i += arrow[0];
      continue;
    }
    cur += text[i];
    i++;
  }
  nodes.push(cur.trim());
  return { nodes, labels };
}

const BRACKETS: Record<string, string> = { "[": "]", "(": ")", "{": "}" };

const MERMAID_NODE = /^([A-Za-z0-9_]+)\s*(\[\[|\[\(|\(\[|\(\(|\[|\(|\{\{|\{|>)\s*(.*?)\s*(\]\]|\)\]|\]\)|\)\)|\]|\)|\}\}|\})$/;

function parseNodeToken(token: string): { id?: string; label: string; shape?: NodeShape } {
  const t = token.replace(/;$/, "").trim();
  const m = MERMAID_NODE.exec(t);
  if (!m) return { label: unquote(t) };
  const open = m[2]!;
  const shape: NodeShape = open.startsWith("{") ? "decision" : open === "([" || open === "((" ? "terminal" : "box";
  return { id: m[1]!, label: unquote(m[3]!), shape };
}

function unquote(s: string): string {
  const t = s.trim();
  return /^".*"$/.test(t) ? t.slice(1, -1) : t;
}

export function parseFlow(fig: FlowFigure, body: Line[], diags: Diagnostics): void {
  const byKey = new Map<string, FlowNode>();
  const byMermaidId = new Map<string, FlowNode>();
  const edgeKeys = new Set<string>();

  const node = (token: string, line: number): FlowNode | null => {
    const parsed = parseNodeToken(token);
    if (parsed.id !== undefined) {
      const known = byMermaidId.get(parsed.id);
      if (known) {
        if (parsed.label && known.label === parsed.id) known.label = clip(parsed.label, line, diags);
        if (parsed.shape && parsed.shape !== "box") known.shape = parsed.shape;
        return known;
      }
    } else {
      const viaId = byMermaidId.get(parsed.label);
      if (viaId) return viaId;
    }
    const label = clip(parsed.label || parsed.id || "", line, diags);
    if (label === "") return null;
    const key = textKey(label);
    let n = parsed.id === undefined ? byKey.get(key) : undefined;
    if (!n) {
      if (fig.nodes.length >= LIMITS.flowNodes) {
        diags.addOnce(line, "warning", "limit_exceeded", `ノードは ${LIMITS.flowNodes} 個までです`);
        return null;
      }
      n = { id: `n${fig.nodes.length + 1}`, label, shape: parsed.shape ?? "box" };
      fig.nodes.push(n);
      if (parsed.id === undefined) byKey.set(key, n);
    }
    if (parsed.id !== undefined) byMermaidId.set(parsed.id, n);
    return n;
  };

  for (const line of body) {
    let raw = stripListMarker(line.text.trim()).text.trim();
    if (raw.startsWith("%%")) continue;

    // Mermaid のヘッダ行（`flowchart LR` / `graph TD`）は向きとして読む。
    const mh = /^(?:flowchart|graph)\s*(TB|TD|BT|LR|RL)?\s*;?$/i.exec(raw);
    if (mh) {
      if (mh[1]) fig.direction = /^(LR|RL)$/i.test(mh[1]) ? "LR" : "TB";
      continue;
    }

    const { nodes, labels } = splitChain(raw);
    if (nodes.length === 1) {
      const opt = parseOption(raw, OPTIONS);
      if (opt) {
        if (opt.key === "note") fig.note = opt.value;
        else if (opt.key === "src") fig.src = opt.value;
        else fig.direction = /^(lr|rl|横|左右|horizontal|左から右)/i.test(opt.value) ? "LR" : "TB";
        continue;
      }
      raw = raw.replace(/;$/, "");
      if (raw !== "") node(raw, line.no);
      continue;
    }

    let prev: FlowNode | null = null;
    nodes.forEach((token, idx) => {
      if (token === "") {
        diags.add(line.no, "warning", "unrecognized_line", "矢印の前後にノードがありません");
        prev = null;
        return;
      }
      const cur = node(token, line.no);
      if (prev && cur) {
        const label = labels[idx - 1];
        const key = `${prev.id}\u0000${cur.id}\u0000${label ?? ""}`;
        if (!edgeKeys.has(key)) {
          if (fig.edges.length >= LIMITS.flowEdges) {
            diags.addOnce(line.no, "warning", "limit_exceeded", `矢印は ${LIMITS.flowEdges} 本までです`);
          } else {
            edgeKeys.add(key);
            fig.edges.push(label === undefined ? { from: prev.id, to: cur.id } : { from: prev.id, to: cur.id, label: clip(label, line.no, diags) });
          }
        }
      }
      prev = cur;
    });
  }
}
