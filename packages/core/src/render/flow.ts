/**
 * flow: 流れ図のレイアウト（Sugiyama 法の簡易版）。
 *
 * 1. 逆向きの辺（ループ）を見つけて外す  2. 最長経路で段を決める  3. 段をまたぐ辺に中継点を入れる
 * 4. 重心法で段の中の並びを決める  5. 座標を決める  6. 辺を直角に曲げて引く（ループは脇を回す）
 *
 * 分岐（出る辺が 2 本以上）のノードはひし形にする。形はモデルに決めさせない。
 */

import type { FlowFigure, FlowNode } from "../ir.js";
import { type Ctx, SMALL_SIZE } from "./frame.js";
import { wrap } from "./measure.js";

const NODE_SIZE = 13;
const LINE_H = 17;
const RANK_GAP = { TB: 44, LR: 64 };
const NODE_GAP = 28;

interface Box {
  id: string;
  dummy: boolean;
  lines: string[];
  shape: "box" | "decision" | "terminal";
  w: number;
  h: number;
  rank: number;
  order: number;
  /** 交差方向（TB なら x）の中心と、段方向（TB なら y）の中心。 */
  c: number;
  r: number;
}

type Pt = [number, number];

/** 角を丸めた折れ線。 */
function polyline(points: Pt[], radius = 6): string {
  const f = (n: number) => +n.toFixed(2);
  const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1]);
  if (pts.length < 2) return "";
  let d = `M${f(pts[0]![0])},${f(pts[0]![1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]!;
    const [x, y] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    const l1 = Math.hypot(x - px, y - py);
    const l2 = Math.hypot(nx - x, ny - y);
    const rr = Math.min(radius, l1 / 2, l2 / 2);
    const ax = x - ((x - px) / l1) * rr;
    const ay = y - ((y - py) / l1) * rr;
    const bx = x + ((nx - x) / l2) * rr;
    const by = y + ((ny - y) / l2) * rr;
    d += `L${f(ax)},${f(ay)}Q${f(x)},${f(y)} ${f(bx)},${f(by)}`;
  }
  const last = pts[pts.length - 1]!;
  return `${d}L${f(last[0])},${f(last[1])}`;
}

export function layoutFlow(ctx: Ctx, f: FlowFigure, top: number): number {
  if (f.nodes.length === 0) return top;
  const wantLR = f.direction === "LR";
  const lr = layoutOnce(ctx, f, wantLR ? "LR" : "TB");
  // 横向きが幅に収まらなければ縦向きにする（幅はレンダラーが決める）
  const plan = wantLR && lr.width > ctx.width * 1.05 ? layoutOnce(ctx, f, "TB") : lr;
  const dx = Math.max(ctx.pad, (ctx.width - plan.width) / 2);
  for (const it of plan.items) shift(it, dx, top);
  ctx.items.push(...plan.items);
  ctx.width = Math.max(ctx.width, plan.width + ctx.pad * 2);
  return top + plan.height + 8;
}

function shift(it: Ctx["items"][number], dx: number, dy: number): void {
  if (it.t === "rect") ((it.x += dx), (it.y += dy));
  else if (it.t === "circle") ((it.cx += dx), (it.cy += dy));
  else if (it.t === "text") ((it.x += dx), (it.y += dy));
  else it.d = it.d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => `${+(+x + dx).toFixed(2)},${+(+y + dy).toFixed(2)}`);
}

function layoutOnce(ctx: Ctx, f: FlowFigure, dir: "TB" | "LR"): { items: Ctx["items"]; width: number; height: number } {
  const items: Ctx["items"] = [];
  const maxText = dir === "TB" ? Math.min(168, (ctx.width - ctx.pad * 2) / 2.6) : 120;

  // 出る辺の数で分岐を判定する
  const outDeg = new Map<string, number>();
  for (const e of f.edges) outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
  const boxes = new Map<string, Box>();
  for (const n of f.nodes) boxes.set(n.id, makeBox(ctx, n, maxText, (outDeg.get(n.id) ?? 0) >= 2));

  // 1. 逆向きの辺: 登場順に深さ優先で辿り、辿っている途中のノードへ戻る辺
  const back = new Set<number>();
  const state = new Map<string, number>(); // 1 = 辿っている途中, 2 = 済み
  const adj = new Map<string, number[]>();
  f.edges.forEach((e, i) => adj.set(e.from, [...(adj.get(e.from) ?? []), i]));
  const visit = (id: string) => {
    state.set(id, 1);
    for (const i of adj.get(id) ?? []) {
      const to = f.edges[i]!.to;
      if (to === id) back.add(i);
      else if (state.get(to) === 1) back.add(i);
      else if (!state.has(to)) visit(to);
    }
    state.set(id, 2);
  };
  const hasIncoming = new Set(f.edges.map((e) => e.to));
  for (const n of f.nodes) if (!state.has(n.id) && !hasIncoming.has(n.id)) visit(n.id);
  for (const n of f.nodes) if (!state.has(n.id)) visit(n.id);

  // 2. 段: 前向きの辺だけで最長経路
  const fwd = f.edges.map((e, i) => ({ ...e, i })).filter((e) => !back.has(e.i) && e.from !== e.to);
  const indeg = new Map(f.nodes.map((n) => [n.id, 0]));
  for (const e of fwd) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = f.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of fwd.filter((x) => x.from === id)) {
      const b = boxes.get(e.to)!;
      b.rank = Math.max(b.rank, boxes.get(id)!.rank + 1);
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }

  // 3. 段をまたぐ辺に中継点を入れる
  const chains: { edge: (typeof fwd)[number]; ids: string[] }[] = [];
  let dummyN = 0;
  for (const e of fwd) {
    const a = boxes.get(e.from)!;
    const b = boxes.get(e.to)!;
    const ids = [a.id];
    for (let r = a.rank + 1; r < b.rank; r++) {
      const id = `_d${dummyN++}`;
      boxes.set(id, { id, dummy: true, lines: [], shape: "box", w: 2, h: 2, rank: r, order: 0, c: 0, r: 0 });
      ids.push(id);
    }
    ids.push(b.id);
    chains.push({ edge: e, ids });
  }

  // 4. 段の中の並び: 登場順から始めて、上下の隣の重心で並べ替える
  const ranks: Box[][] = [];
  for (const b of boxes.values()) (ranks[b.rank] ??= []).push(b);
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const c of chains) {
    for (let k = 0; k + 1 < c.ids.length; k++) {
      down.set(c.ids[k]!, [...(down.get(c.ids[k]!) ?? []), c.ids[k + 1]!]);
      up.set(c.ids[k + 1]!, [...(up.get(c.ids[k + 1]!) ?? []), c.ids[k]!]);
    }
  }
  ranks.forEach((rk) => rk.forEach((b, i) => (b.order = i)));
  const sweep = (rk: Box[], nb: Map<string, string[]>) => {
    const bary = (b: Box) => {
      const ns = (nb.get(b.id) ?? []).map((id) => boxes.get(id)!.order);
      return ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : b.order;
    };
    rk.sort((a, b) => bary(a) - bary(b) || a.order - b.order).forEach((b, i) => (b.order = i));
  };
  for (let it = 0; it < 4; it++) {
    for (let r = 1; r < ranks.length; r++) sweep(ranks[r]!, up);
    for (let r = ranks.length - 2; r >= 0; r--) sweep(ranks[r]!, down);
  }

  // 5. 座標: 交差方向はノードの大きさで詰めて並べ、上の段の重心に寄せる
  const along = (b: Box) => (dir === "TB" ? b.h : b.w); // 段方向の大きさ
  const across = (b: Box) => (dir === "TB" ? b.w : b.h); // 交差方向の大きさ
  const gap = NODE_GAP;
  let rPos = 0;
  ranks.forEach((rk) => {
    const thick = Math.max(...rk.map(along));
    rk.forEach((b) => (b.r = rPos + thick / 2));
    rPos += thick + RANK_GAP[dir];
  });
  const place = (rk: Box[], desired: (b: Box) => number) => {
    let cursor = -Infinity;
    for (const b of rk) {
      const want = desired(b);
      const min = cursor + across(b) / 2;
      b.c = Math.max(want, min);
      cursor = b.c + across(b) / 2 + (b.dummy ? gap / 2 : gap);
    }
    // 寄せた結果、実ノードが望んだ位置からずれた分を戻す（中継点は数えない＝本線をまっすぐ保つ）
    const real = rk.filter((b) => !b.dummy);
    const basis = real.length ? real : rk;
    const shiftBy = basis.reduce((s, b) => s + (desired(b) - b.c), 0) / basis.length;
    for (const b of rk) b.c += shiftBy;
  };
  ranks.forEach((rk) => {
    let x = 0;
    for (const b of rk) {
      b.c = x + across(b) / 2;
      x += across(b) + gap;
    }
  });
  // 寄せる先: 隣の実ノードの重心（中継点しか無ければ中継点）。中継点に引かれて本線が斜めに流れないように
  const target = (b: Box, nb: Map<string, string[]>) => {
    const ns = (nb.get(b.id) ?? []).map((id) => boxes.get(id)!);
    const real = ns.filter((n) => !n.dummy);
    const use = !b.dummy && real.length ? real : ns;
    return use.length ? use.reduce((s, n) => s + n.c, 0) / use.length : b.c;
  };
  for (let it = 0; it < 3; it++) {
    for (let r = 1; r < ranks.length; r++) {
      place(ranks[r]!, (b) => target(b, up));
    }
    for (let r = ranks.length - 2; r >= 0; r--) {
      place(ranks[r]!, (b) => target(b, down));
    }
  }
  for (let r = 1; r < ranks.length; r++) place(ranks[r]!, (b) => target(b, up));
  const all = [...boxes.values()];
  const minC = Math.min(...all.map((b) => b.c - across(b) / 2));
  for (const b of all) b.c -= minC;
  let maxC = Math.max(...all.map((b) => b.c + across(b) / 2));

  const xy = (c: number, r: number): Pt => (dir === "TB" ? [c, r] : [r, c]);

  // 6. 辺
  const labels: { at: Pt; text: string }[] = [];
  for (const { edge, ids } of chains) {
    const pts: Pt[] = [];
    for (let k = 0; k + 1 < ids.length; k++) {
      const a = boxes.get(ids[k]!)!;
      const b = boxes.get(ids[k + 1]!)!;
      const r1 = a.dummy ? a.r : a.r + along(a) / 2;
      const r2 = b.dummy ? b.r : b.r - along(b) / 2 - 1;
      const rm = (a.r + along(a) / 2 + (b.r - along(b) / 2)) / 2;
      if (k === 0) pts.push(xy(a.c, r1));
      pts.push(xy(a.c, rm), xy(b.c, rm), xy(b.c, r2));
      // ラベルは分かれた直後（出発側）に置く。合流側に置くと、同じノードに入る辺のラベルが重なる
      if (k === 0 && edge.label) {
        const straight = a.c === b.c;
        // 縦向き: 曲がった直後の縦線の上。横向き: 曲がった後の横線の少し上（ノードに重ならないように）
        const at = dir === "TB" ? xy(b.c, straight ? (r1 + rm) / 2 : rm + 12) : xy(b.c - (straight ? 0 : 11), straight ? (r1 + rm) / 2 : (rm + r2) / 2);
        labels.push({ at, text: edge.label });
      }
    }
    items.push({ t: "path", d: polyline(pts), stroke: "muted", strokeWidth: 1.5, arrow: true });
  }
  // ループ: 交差方向の外側を回す
  let lane = 0;
  f.edges.forEach((e, i) => {
    if (!back.has(i) || e.from === e.to) return;
    const a = boxes.get(e.from)!;
    const b = boxes.get(e.to)!;
    const side = maxC + 16 + lane * 12;
    lane++;
    const pts: Pt[] = [xy(a.c + across(a) / 2, a.r), xy(side, a.r), xy(side, b.r), xy(b.c + across(b) / 2 + 1, b.r)];
    items.push({ t: "path", d: polyline(pts), stroke: "muted", strokeWidth: 1.5, arrow: true });
    if (e.label) labels.push({ at: xy(side, (a.r + b.r) / 2), text: e.label });
  });
  if (lane > 0) maxC += 16 + lane * 12;

  // ノード
  for (const b of all) {
    if (b.dummy) continue;
    const [cx, cy] = xy(b.c, b.r);
    const x = cx - b.w / 2;
    const y = cy - b.h / 2;
    const hint = b.lines.join("");
    if (b.shape === "decision") {
      items.push({ t: "path", d: `M${cx},${y}L${x + b.w},${cy}L${cx},${y + b.h}L${x},${cy}Z`, fill: "accentWash", stroke: "accentLine", strokeWidth: 1, hint });
    } else {
      items.push({ t: "rect", x, y, w: b.w, h: b.h, r: b.shape === "terminal" ? b.h / 2 : 8, fill: "surface2", hint });
    }
    const y0 = cy - ((b.lines.length - 1) * LINE_H) / 2 + NODE_SIZE * 0.35;
    b.lines.forEach((l, k) => items.push({ t: "text", x: cx, y: y0 + k * LINE_H, text: l, size: NODE_SIZE, fill: "ink", anchor: "middle" }));
  }

  // 辺のラベル（線の上に背景色の札を敷く）
  for (const { at, text } of labels) {
    const w = ctx.measure(text, SMALL_SIZE) + 10;
    items.push({ t: "rect", x: at[0] - w / 2, y: at[1] - 9, w, h: 18, r: 4, fill: "surface" });
    items.push({ t: "text", x: at[0], y: at[1] + 4, text, size: SMALL_SIZE, fill: "ink2", anchor: "middle" });
  }

  const extentR = rPos - RANK_GAP[dir];
  const [width, height] = dir === "TB" ? [maxC, extentR] : [extentR, maxC];
  return { items, width, height };
}

function makeBox(ctx: Ctx, n: FlowNode, maxText: number, branch: boolean): Box {
  const shape = n.shape === "terminal" ? "terminal" : branch || n.shape === "decision" ? "decision" : "box";
  const lines = wrap(n.label, maxText, NODE_SIZE, ctx.measure, 3);
  const textW = Math.max(...lines.map((l) => ctx.measure(l, NODE_SIZE)));
  const textH = lines.length * LINE_H;
  if (shape === "decision") return { id: n.id, dummy: false, lines, shape, w: Math.max(textW * 1.5 + 32, 96), h: textH + 30, rank: 0, order: 0, c: 0, r: 0 };
  return { id: n.id, dummy: false, lines, shape, w: Math.max(textW + 28, 72), h: textH + 16, rank: 0, order: 0, c: 0, r: 0 };
}
