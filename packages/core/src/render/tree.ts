/**
 * tree のレイアウト。
 *
 * 末端の数が幅に収まり、深さが 3 段までなら上から下への組織図にする（親は子の中央、線は直角に折る）。
 * 収まらなければ、字下げした一覧（ファイルの一覧のような形）にする。
 */

import type { TreeFigure, TreeNode } from "../ir.js";
import { BODY_SIZE, type Ctx } from "./frame.js";
import { fit, wrap } from "./measure.js";

const NODE_MIN = 88;
const NODE_MAX = 168;
const H_GAP = 10;
const V_GAP = 30;
const ROW = 26;
const INDENT = 22;
/** 縦に積む子の字下げ。 */
const STACK_INDENT = 16;

const refsOf = (r: number[]) => (r.length ? ` ${r.map((n) => `[${n}]`).join("")}` : "");

function depth(ns: TreeNode[]): number {
  return ns.length === 0 ? 0 : 1 + Math.max(...ns.map((n) => depth(n.children)));
}

interface Placed {
  node: TreeNode;
  depth: number;
  /** 中心の x。 */
  cx: number;
  parent: number | null;
  path: string[];
}

export function layoutTree(ctx: Ctx, f: TreeFigure, top: number): number {
  if (f.roots.length === 0) return top;
  const inner = ctx.width - ctx.pad * 2;
  const D = depth(f.roots);
  const widthFor = (slots: number) => Math.min(NODE_MAX, (inner - H_GAP * (slots - 1)) / slots);
  // 末端まで横に並べる → 末端だけを親の下に縦に積む → 字下げの一覧、の順に、収まるものを使う
  const full = widthFor(f.roots.reduce((a, r) => a + slots(r, 0, false), 0));
  if (D <= 3 && full >= NODE_MIN) return orgChart(ctx, f, top, full, false);
  const compact = widthFor(f.roots.reduce((a, r) => a + slots(r, 0, true), 0));
  if (D <= 4 && compact >= NODE_MIN) return orgChart(ctx, f, top, compact, true);
  return indented(ctx, f, top);
}

/** 子がすべて末端で、親が最上位でないなら、子を親の下に縦に積む（コンパクト表示のとき）。 */
function stacks(n: TreeNode, d: number, compact: boolean): boolean {
  return compact && d >= 1 && n.children.length > 0 && n.children.every((c) => c.children.length === 0);
}

function slots(n: TreeNode, d: number, compact: boolean): number {
  if (n.children.length === 0 || stacks(n, d, compact)) return 1;
  return n.children.reduce((a, c) => a + slots(c, d + 1, compact), 0);
}

// ---------------------------------------------------------------- 組織図

function orgChart(ctx: Ctx, f: TreeFigure, top: number, nodeW: number, compact: boolean): number {
  const S = f.roots.reduce((a, r) => a + slots(r, 0, compact), 0);
  const total = S * nodeW + (S - 1) * H_GAP;
  const x0 = ctx.pad + (ctx.width - ctx.pad * 2 - total) / 2;
  const placed: Placed[] = [];
  /** 親の下に縦に積む子（親の番号 → 子の番号）。 */
  const stacked = new Map<number, number[]>();
  let slot = 0;
  const place = (n: TreeNode, d: number, parent: number | null, path: string[]): number => {
    const idx = placed.length;
    const g = `n${idx}`;
    placed.push({ node: n, depth: d, cx: 0, parent, path: [...path, g] });
    if (n.children.length === 0 || stacks(n, d, compact)) {
      placed[idx]!.cx = x0 + slot * (nodeW + H_GAP) + nodeW / 2;
      slot++;
      if (n.children.length > 0) {
        stacked.set(
          idx,
          n.children.map((c) => {
            const ci = placed.length;
            placed.push({ node: c, depth: d + 1, cx: placed[idx]!.cx + STACK_INDENT / 2, parent: idx, path: [...path, g, `n${ci}`] });
            return ci;
          }),
        );
      }
    } else {
      const kids = n.children.map((c) => place(c, d + 1, idx, [...path, g]));
      placed[idx]!.cx = (placed[kids[0]!]!.cx + placed[kids[kids.length - 1]!]!.cx) / 2;
    }
    return idx;
  };
  f.roots.forEach((r) => place(r, 0, null, []));
  const inStack = new Set([...stacked.values()].flat());

  // 箱の中の文字（縦に積む子は幅が狭い）
  const pad = 8;
  const lines = placed.map((p, i) => {
    const w = (inStack.has(i) ? nodeW - STACK_INDENT : nodeW) - pad * 2;
    return { title: wrap(p.node.title + refsOf(p.node.refs), w, BODY_SIZE + 1, ctx.measure, 2, 600), desc: p.node.desc ? wrap(p.node.desc, w, BODY_SIZE - 1, ctx.measure, 2) : [] };
  });
  const boxH = (i: number) => pad * 2 + lines[i]!.title.length * 17 + lines[i]!.desc.length * 15;

  // 段ごとに箱の高さを揃える（縦に積む子は段に数えない）
  const D = Math.max(...placed.filter((_, i) => !inStack.has(i)).map((p) => p.depth)) + 1;
  const levelH = Array.from({ length: D }, (_, d) => Math.max(0, ...placed.map((p, i) => (p.depth === d && !inStack.has(i) ? boxH(i) : 0))));
  const levelY: number[] = [];
  let y = top + 4;
  for (let d = 0; d < D; d++) {
    levelY.push(y);
    y += levelH[d]! + V_GAP;
  }
  let bottom = y - V_GAP;

  // 縦に積む子の位置
  const boxes = new Map<number, { x: number; y: number; w: number; h: number }>();
  placed.forEach((p, i) => {
    if (!inStack.has(i)) boxes.set(i, { x: p.cx - nodeW / 2, y: levelY[p.depth]!, w: nodeW, h: levelH[p.depth]! });
  });
  for (const [pi, kids] of stacked) {
    const par = boxes.get(pi)!;
    let cy = par.y + par.h + 10;
    for (const ci of kids) {
      const h = boxH(ci);
      boxes.set(ci, { x: par.x + STACK_INDENT, y: cy, w: nodeW - STACK_INDENT, h });
      cy += h + 6;
    }
    bottom = Math.max(bottom, cy - 6);
  }

  // 線（親の下端 → 折れ点 → 子の上端。縦に積む子は、親の左寄りから下ろして横に入る）
  placed.forEach((p, i) => {
    if (p.parent === null) return;
    const par = boxes.get(p.parent)!;
    const b = boxes.get(i)!;
    const g = p.path[p.path.length - 1]!;
    if (inStack.has(i)) {
      const lx = par.x + STACK_INDENT / 2;
      ctx.items.push({ t: "path", d: `M${lx},${par.y + par.h}V${b.y + b.h / 2}H${b.x}`, stroke: "axis", strokeWidth: 1.5, group: g });
      return;
    }
    const pcx = par.x + par.w / 2;
    const mid = Math.round((par.y + par.h + b.y) / 2) + 0.5;
    ctx.items.push({ t: "path", d: `M${pcx},${par.y + par.h}V${mid}H${p.cx}V${b.y}`, stroke: "axis", strokeWidth: 1.5, group: g });
  });

  placed.forEach((p, i) => {
    const g = p.path[p.path.length - 1]!;
    const b = boxes.get(i)!;
    const root = p.depth === 0;
    ctx.items.push({ t: "rect", x: b.x + 0.5, y: b.y + 0.5, w: b.w - 1, h: b.h - 1, r: 8, fill: root ? "accentWash" : "surface2", stroke: root ? "accentLine" : "border", strokeWidth: 1, group: g, hint: p.node.desc ? `${p.node.title}: ${p.node.desc}` : p.node.title });
    const l = lines[i]!;
    const blockH = l.title.length * 17 + l.desc.length * 15;
    const ty = b.y + (b.h - blockH) / 2;
    const cx = b.x + b.w / 2;
    l.title.forEach((t, k) => ctx.items.push({ t: "text", x: cx, y: ty + 13 + k * 17, text: t, size: BODY_SIZE + 1, weight: 600, fill: "ink", anchor: "middle", group: g }));
    l.desc.forEach((t, k) => ctx.items.push({ t: "text", x: cx, y: ty + l.title.length * 17 + 11 + k * 15, text: t, size: BODY_SIZE - 1, fill: "muted", anchor: "middle", group: g }));
    ctx.targets.push({ hit: b, keep: p.path, tip: { title: p.node.title, rows: [], ...(p.node.desc ? { footer: p.node.desc } : {}), x: cx, y: b.y } });
  });
  return bottom + 8;
}

// ---------------------------------------------------------------- 字下げの一覧

function indented(ctx: Ctx, f: TreeFigure, top: number): number {
  const rows: { node: TreeNode; depth: number; parentRow: number | null; path: string[] }[] = [];
  const walk = (ns: TreeNode[], d: number, parentRow: number | null, path: string[]) => {
    for (const n of ns) {
      const i = rows.length;
      const g = `n${i}`;
      rows.push({ node: n, depth: d, parentRow, path: [...path, g] });
      walk(n.children, d + 1, i, [...path, g]);
    }
  };
  walk(f.roots, 0, null, []);
  const rowY = (i: number) => top + 4 + i * ROW;
  const dotX = (d: number) => ctx.pad + 6 + d * INDENT;

  // 線: 親の点から、子の行の高さまで縦に下ろし、横に折る
  rows.forEach((r, i) => {
    if (r.parentRow === null) return;
    const px = dotX(r.depth - 1);
    const cy = rowY(i) + ROW / 2;
    ctx.items.push({ t: "path", d: `M${px},${rowY(r.parentRow) + ROW / 2 + 5}V${cy}H${dotX(r.depth) - 6}`, stroke: "axis", strokeWidth: 1.5, group: r.path[r.path.length - 1]! });
  });

  rows.forEach((r, i) => {
    const g = r.path[r.path.length - 1]!;
    const cy = rowY(i) + ROW / 2;
    const x = dotX(r.depth);
    const branch = r.node.children.length > 0;
    ctx.items.push({ t: "circle", cx: x, cy, r: branch ? 4.5 : 3.5, fill: branch ? "s1" : "axis", group: g });
    const tx = x + 12;
    const avail = ctx.width - ctx.pad - tx;
    const titleText = r.node.title + refsOf(r.node.refs);
    const weight = r.depth === 0 || branch ? 600 : 400;
    const title = fit(titleText, avail, BODY_SIZE + 1, ctx.measure, weight);
    ctx.items.push({ t: "text", x: tx, y: cy + 4.5, text: title, size: BODY_SIZE + 1, weight, fill: "ink", group: g });
    if (r.node.desc) {
      const used = ctx.measure(title, BODY_SIZE + 1, weight) + 10;
      if (avail - used > 48) ctx.items.push({ t: "text", x: tx + used, y: cy + 4.5, text: fit(r.node.desc, avail - used, BODY_SIZE, ctx.measure), size: BODY_SIZE, fill: "muted", group: g });
    }
    ctx.targets.push({ hit: { x: ctx.pad, y: rowY(i), w: ctx.width - ctx.pad * 2, h: ROW }, keep: r.path, tip: { title: r.node.title, rows: [], ...(r.node.desc ? { footer: r.node.desc } : {}), x: tx + 30, y: rowY(i) } });
  });
  return rowY(rows.length) + 8;
}
