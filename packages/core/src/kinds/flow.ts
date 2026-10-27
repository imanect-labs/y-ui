/**
 * flow: 矢印でつないだ流れ図。
 *
 * - `A -> B -> C`（`-->` `→` `=>` も可）
 * - ラベル付き: `A -はい-> B` / `A -->|はい| B` / `A -- はい --> B`
 * - Mermaid 風のノード定義 `A[注文] --> B{在庫あり?}` も受ける（id で同一ノード）。
 * - 矢印の無い行は単独のノード。
 * - `subgraph 名前` 〜 `end`（または `## 名前`）で囲み枠。`**名前**` で強調。
 */

import type { FlowFigure, FlowGroup, FlowNode, NodeShape } from "../ir.js";
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

// 丸括弧は id の直後だけ（`Book (PDF/Text)` は名前のまま読む）。角括弧・波括弧は空白を挟んでもよい
const MERMAID_NODE = /^([A-Za-z0-9_]+)(?:(\(\[|\(\(|\()|\s*(\[\[|\[\(|\[|\{\{|\{|>))\s*(.*?)\s*(\]\]|\)\]|\]\)|\)\)|\]|\)|\}\}|\})$/;

function parseNodeToken(token: string): { id?: string; label: string; shape?: NodeShape; emphasis: boolean } {
  let t = token.replace(/;$/, "").trim();
  let emphasis = false;
  // Mermaid のクラス指定 `A:::key` は強調として読む（色はレンダラーが決める）
  const cls = /\s*:::[\w-]+$/.exec(t);
  if (cls) ((emphasis = true), (t = t.slice(0, cls.index)));
  const m = MERMAID_NODE.exec(t);
  let parsed: { id?: string; label: string; shape?: NodeShape };
  if (!m) parsed = { label: unquote(t) };
  else {
    const open = m[2] ?? m[3]!;
    const shape: NodeShape = open.startsWith("{") ? "decision" : open === "([" || open === "((" ? "terminal" : "box";
    parsed = { id: m[1]!, label: unquote(m[4]!), shape };
  }
  const bold = /^\*\*(.+)\*\*$/.exec(parsed.label);
  if (bold) ((emphasis = true), (parsed.label = bold[1]!.trim()));
  return { ...parsed, emphasis };
}

function unquote(s: string): string {
  const t = s.trim();
  return /^".*"$/.test(t) ? t.slice(1, -1) : t;
}

const DIRECTION = /^(TB|TD|BT|LR|RL)$/i;
const toDir = (d: string): "TB" | "LR" => (/^(LR|RL)$/i.test(d) ? "LR" : "TB");

export function parseFlow(fig: FlowFigure, body: Line[], diags: Diagnostics): void {
  const byKey = new Map<string, FlowNode>();
  const byMermaidId = new Map<string, FlowNode>();
  const edgeKeys = new Set<string>();
  const groups: FlowGroup[] = [];
  const groupRefs = new Map<string, FlowGroup>();
  // 開いている枠（上限を超えた枠は null。`end` の対応を崩さないため）
  const open: (FlowGroup | null)[] = [];

  const openGroup = (rest: string, line: number): FlowGroup | null => {
    const m = /^([A-Za-z0-9_-]+)\s*\[\s*(.*?)\s*\]$/.exec(rest);
    const id = m ? m[1]! : /^[A-Za-z0-9_-]+$/.test(rest) ? rest : undefined;
    const label = clip(unquote(m ? m[2]! : rest), line, diags);
    if (groups.length >= LIMITS.flowGroups) {
      diags.addOnce(line, "warning", "limit_exceeded", `枠は ${LIMITS.flowGroups} 個までです`);
      return null;
    }
    const g: FlowGroup = { id: `g${groups.length + 1}`, label };
    groups.push(g);
    if (id !== undefined && !groupRefs.has(id)) groupRefs.set(id, g);
    if (label !== "" && !groupRefs.has(textKey(label))) groupRefs.set(textKey(label), g);
    return g;
  };

  const find = (ref: string): FlowNode | undefined => byMermaidId.get(ref) ?? byKey.get(textKey(ref));

  /** ノード（または矢印の端のグループ）を引き、無ければ作る。id を返す。 */
  const endpoint = (token: string, line: number, allowGroup: boolean): string | null => {
    const parsed = parseNodeToken(token);
    let n: FlowNode | undefined;
    if (parsed.id !== undefined) {
      n = byMermaidId.get(parsed.id);
      if (n) {
        if (parsed.label && n.label === parsed.id) n.label = clip(parsed.label, line, diags);
        if (parsed.shape && parsed.shape !== "box") n.shape = parsed.shape;
      }
    } else {
      n = find(parsed.label);
    }
    if (!n && allowGroup && parsed.id === undefined) {
      const g = groupRefs.get(parsed.label) ?? groupRefs.get(textKey(parsed.label));
      if (g) return g.id;
    }
    if (!n) {
      const label = clip(parsed.label || parsed.id || "", line, diags);
      if (label === "") return null;
      if (fig.nodes.length >= LIMITS.flowNodes) {
        diags.addOnce(line, "warning", "limit_exceeded", `ノードは ${LIMITS.flowNodes} 個までです`);
        return null;
      }
      n = { id: `n${fig.nodes.length + 1}`, label, shape: parsed.shape ?? "box" };
      fig.nodes.push(n);
      if (parsed.id === undefined) byKey.set(textKey(label), n);
    }
    if (parsed.id !== undefined) byMermaidId.set(parsed.id, n);
    if (parsed.emphasis) n.emphasis = true;
    // 最初に書かれた枠に属する（枠の外で先に書かれたノードも、後から枠の中に書けば入る）
    const cur = open[open.length - 1];
    if (cur && n.group === undefined) n.group = cur.id;
    return n.id;
  };

  for (const line of body) {
    let raw = stripListMarker(line.text.trim()).text.trim();
    if (raw.startsWith("%%")) continue;

    // Mermaid のヘッダ行（`flowchart LR` / `graph TD`）は向きとして読む。
    const mh = /^(?:flowchart|graph)\s*(TB|TD|BT|LR|RL)?\s*;?$/i.exec(raw);
    if (mh) {
      if (mh[1]) fig.direction = toDir(mh[1]);
      continue;
    }

    const { nodes, labels } = splitChain(raw);
    if (nodes.length === 1) {
      // Mermaid の予約語は小文字だけ（`End` という名前のノードを枠の終わりと読まないため）
      // 枠: `subgraph 名前` 〜 `end`、`## 名前`（次の見出しまで）
      const sg = /^subgraph(?:\s+(.*?))?\s*;?$/.exec(raw);
      const hd = /^#{1,6}\s+(.+)$/.exec(raw);
      if (sg || hd) {
        if (hd) open.length = 0;
        else if (open.length > 0) diags.add(line.no, "info", "nested_too_deep", "枠の中の枠は、外に並べて描きます");
        open.push(openGroup((sg ? (sg[1] ?? "") : hd![1]!).trim(), line.no));
        continue;
      }
      if (/^end\s*;?$/.test(raw)) {
        if (open.length > 0) open.pop();
        else diags.add(line.no, "info", "unrecognized_line", "対応する subgraph の無い end です");
        continue;
      }
      const dm = /^direction\s+(\S+?)\s*;?$/.exec(raw);
      if (dm && DIRECTION.test(dm[1]!)) {
        const cur = open[open.length - 1];
        if (cur) cur.direction = toDir(dm[1]!);
        else if (open.length === 0) fig.direction = toDir(dm[1]!);
        continue;
      }
      // Mermaid の書式の指定。`style A fill:…` と `class A,B 名前` は強調として読み、色は使わない
      const st = /^style\s+(\S+)\s+\S*:/.exec(raw) ?? /^class\s+(\S+)\s+[\w-]+\s*;?$/.exec(raw);
      if (st) {
        for (const ref of st[1]!.split(",")) {
          const n = find(ref.trim());
          if (n) n.emphasis = true;
          else diags.add(line.no, "info", "unrecognized_line", `強調する「${ref.trim()}」がありません`);
        }
        continue;
      }
      if (/^(classDef|linkStyle|click)\s/.test(raw)) {
        diags.addOnce(line.no, "info", "unrecognized_line", "色や書式の指定は読みません（色はレンダラーが決めます）");
        continue;
      }

      const opt = parseOption(raw, OPTIONS);
      if (opt) {
        if (opt.key === "note") fig.note = opt.value;
        else if (opt.key === "src") fig.src = opt.value;
        else fig.direction = /^(lr|rl|横|左右|horizontal|左から右)/i.test(opt.value) ? "LR" : "TB";
        continue;
      }
      raw = raw.replace(/;$/, "");
      if (raw !== "") endpoint(raw, line.no, false);
      continue;
    }

    let prev: string | null = null;
    nodes.forEach((token, idx) => {
      if (token === "") {
        diags.add(line.no, "warning", "unrecognized_line", "矢印の前後にノードがありません");
        prev = null;
        return;
      }
      const cur = endpoint(token, line.no, true);
      if (prev && cur) {
        const label = labels[idx - 1];
        const key = `${prev}\u0000${cur}\u0000${label ?? ""}`;
        if (!edgeKeys.has(key)) {
          if (fig.edges.length >= LIMITS.flowEdges) {
            diags.addOnce(line.no, "warning", "limit_exceeded", `矢印は ${LIMITS.flowEdges} 本までです`);
          } else {
            edgeKeys.add(key);
            fig.edges.push(label === undefined ? { from: prev, to: cur } : { from: prev, to: cur, label: clip(label, line.no, diags) });
          }
        }
      }
      prev = cur;
    });
  }
  if (groups.length > 0) fig.groups = groups;
}
