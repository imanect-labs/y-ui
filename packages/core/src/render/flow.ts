/**
 * flow: 流れ図のレイアウト（Sugiyama 法の簡易版）。
 *
 * 1. 逆向きの辺（ループ）を見つけて外す  2. 最長経路で段を決める  3. 段をまたぐ辺に中継点を入れる
 * 4. 重心法で段の中の並びを決める  5. 座標を決める  6. 辺を直角に曲げて引く（ループは脇を回す）
 *
 * 枠（グループ）があるときは 2 段で組む。枠の中を上の手順で組み（向きは図の向きと直交）、
 * 枠と枠の外のノードを 1 つの塊として同じ手順で段に並べ、枠をまたぐ辺は段の間の通路を通す。
 *
 * ラベル付きの分岐（出る辺が 2 本以上で、どれかにラベルがある）のノードはひし形にする。形はモデルに決めさせない。
 */

import type { FlowFigure, FlowGroup, FlowNode } from "../ir.js";
import { type Ctx, SMALL_SIZE } from "./frame.js";
import { fit, wrap } from "./measure.js";
import type { Target } from "./scene.js";
import type { Token } from "./theme.js";

const NODE_SIZE = 13;
const LINE_H = 17;
const RANK_GAP = { TB: 44, LR: 64 };
const NODE_GAP = 28;
/** 縦向きで、ラベル付きの辺が出る段の下に足す間隔（ラベルの下に矢印が見えるように）。 */
const LABEL_ROOM = 24;

/** 枠の内側の余白と、見出しの高さ。 */
const GROUP_PAD = 14;
const GROUP_HEAD = 34;
const GROUP_TITLE = 12;
/** 枠どうしの間隔（交差方向）と、段の間の通路の最小幅・線の間隔。 */
const BLOCK_GAP = 24;
const CHANNEL_MIN = 44;
const LANE = 12;
/** 枠の色（系列色から、強調の色を除いて順に使う）。 */
const GROUP_TOKENS: Token[] = ["s1", "s3", "s2", "s4", "s7", "s6", "s8"];
const EMPHASIS: Token = "s5";

type Dir = "TB" | "LR";
type Pt = [number, number];
type Items = Ctx["items"];
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** 辺（i は図全体での番号。ホバーのまとまりに使う）。 */
interface Edge {
  from: string;
  to: string;
  label?: string;
  i: number;
}
interface Plan {
  items: Items;
  /** ノードの箱（plan の座標）。 */
  rects: Map<string, Rect>;
  width: number;
  height: number;
}

interface Box {
  id: string;
  dummy: boolean;
  lines: string[];
  shape: "box" | "decision" | "terminal";
  emphasis: boolean;
  w: number;
  h: number;
  rank: number;
  order: number;
  /** 交差方向（TB なら x）の中心と、段方向（TB なら y）の中心。 */
  c: number;
  r: number;
}

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

/** 角を丸めた矩形の輪郭（破線の枠に使う）。座標はすべて x,y の組で書く（shift が組だけを動かすため）。 */
function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const p = (px: number, py: number) => `${+px.toFixed(2)},${+py.toFixed(2)}`;
  const [x1, y1] = [x + w, y + h];
  return `M${p(x + r, y)}L${p(x1 - r, y)}Q${p(x1, y)} ${p(x1, y + r)}L${p(x1, y1 - r)}Q${p(x1, y1)} ${p(x1 - r, y1)}L${p(x + r, y1)}Q${p(x, y1)} ${p(x, y1 - r)}L${p(x, y + r)}Q${p(x, y)} ${p(x + r, y)}Z`;
}

export function layoutFlow(ctx: Ctx, f: FlowFigure, top: number): number {
  if (f.nodes.length === 0) return top;
  const decision = decisions(f);
  const grouped = f.groups !== undefined && f.nodes.some((n) => n.group !== undefined);
  const plan = grouped ? planGrouped(ctx, f, decision) : planPlain(ctx, f, decision);
  const dx = Math.max(ctx.pad, (ctx.width - plan.width) / 2);
  for (const it of plan.items) shift(it, dx, top);
  ctx.items.push(...plan.items);
  ctx.targets.push(...targetsFor(f, plan.rects, dx, top));
  ctx.width = Math.max(ctx.width, plan.width + ctx.pad * 2);
  return top + plan.height + 8;
}

/** ひし形にするノード: `{判断}` と書かれたもの、またはラベル付きで 2 本以上に分かれるもの。 */
function decisions(f: FlowFigure): Set<string> {
  const out = new Map<string, { n: number; labeled: boolean }>();
  for (const e of f.edges) {
    const o = out.get(e.from) ?? { n: 0, labeled: false };
    o.n++;
    if (e.label !== undefined) o.labeled = true;
    out.set(e.from, o);
  }
  const branch = (n: FlowNode) => {
    const o = out.get(n.id);
    return o !== undefined && o.n >= 2 && o.labeled;
  };
  return new Set(f.nodes.filter((n) => n.shape === "decision" || (n.shape !== "terminal" && branch(n))).map((n) => n.id));
}

/** ホバー: この箱と、つながる線・前後の箱だけを残して薄くする（流れを追いやすくする）。 */
function targetsFor(f: FlowFigure, rects: Map<string, Rect>, dx: number, dy: number): Target[] {
  const targets: Target[] = [];
  for (const n of f.nodes) {
    const r = rects.get(n.id);
    if (!r) continue;
    const keep = new Set([`n:${n.id}`]);
    f.edges.forEach((e, i) => {
      if (e.from !== n.id && e.to !== n.id) return;
      keep.add(`e${i}`);
      keep.add(`n:${e.from}`);
      keep.add(`n:${e.to}`);
    });
    targets.push({ hit: { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }, keep: [...keep] });
  }
  return targets;
}

function shift(it: Items[number], dx: number, dy: number): void {
  if (it.t === "rect") ((it.x += dx), (it.y += dy));
  else if (it.t === "circle") ((it.cx += dx), (it.cy += dy));
  else if (it.t === "text") ((it.x += dx), (it.y += dy));
  else it.d = it.d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => `${+(+x + dx).toFixed(2)},${+(+y + dy).toFixed(2)}`);
}

function shiftPlan(p: Plan, dx: number, dy: number): void {
  for (const it of p.items) shift(it, dx, dy);
  for (const r of p.rects.values()) ((r.x += dx), (r.y += dy));
}

function planPlain(ctx: Ctx, f: FlowFigure, decision: Set<string>): Plan {
  const edges = f.edges.map((e, i) => ({ ...e, i }));
  const wantLR = f.direction === "LR";
  const lr = layoutOnce(ctx, f.nodes, edges, wantLR ? "LR" : "TB", decision);
  // 横向きが幅に収まらなければ縦向きにする（幅はレンダラーが決める）
  return wantLR && lr.width > ctx.width * 1.05 ? layoutOnce(ctx, f.nodes, edges, "TB", decision) : lr;
}

function layoutOnce(ctx: Ctx, nodes: FlowNode[], edges: Edge[], dir: Dir, decision: Set<string>, tint?: Token): Plan {
  const items: Items = [];
  const rects = new Map<string, Rect>();
  const maxText = dir === "TB" ? Math.min(168, (ctx.width - ctx.pad * 2) / 2.6) : 120;

  const boxes = new Map<string, Box>();
  for (const n of nodes) boxes.set(n.id, makeBox(ctx, n, maxText, decision.has(n.id)));

  // 1. 逆向きの辺: 登場順に深さ優先で辿り、辿っている途中のノードへ戻る辺
  const back = new Set<number>();
  const state = new Map<string, number>(); // 1 = 辿っている途中, 2 = 済み
  const adj = new Map<string, number[]>();
  edges.forEach((e, k) => adj.set(e.from, [...(adj.get(e.from) ?? []), k]));
  const visit = (id: string) => {
    state.set(id, 1);
    for (const k of adj.get(id) ?? []) {
      const to = edges[k]!.to;
      if (to === id) back.add(k);
      else if (state.get(to) === 1) back.add(k);
      else if (!state.has(to)) visit(to);
    }
    state.set(id, 2);
  };
  const hasIncoming = new Set(edges.map((e) => e.to));
  for (const n of nodes) if (!state.has(n.id) && !hasIncoming.has(n.id)) visit(n.id);
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);

  // 2. 段: 前向きの辺だけで最長経路
  const fwd = edges.filter((e, k) => !back.has(k) && e.from !== e.to);
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of fwd) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
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
  const chains: { edge: Edge; ids: string[] }[] = [];
  let dummyN = 0;
  for (const e of fwd) {
    const a = boxes.get(e.from)!;
    const b = boxes.get(e.to)!;
    const ids = [a.id];
    for (let r = a.rank + 1; r < b.rank; r++) {
      const id = `_d${dummyN++}`;
      boxes.set(id, { id, dummy: true, lines: [], shape: "box", emphasis: false, w: 2, h: 2, rank: r, order: 0, c: 0, r: 0 });
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
  // 縦向きのラベルは出発側の縦線の上に置くので、その段の下だけ広げて矢印を隠さない
  const labeled = new Set<number>();
  if (dir === "TB") for (const { edge, ids } of chains) if (edge.label) labeled.add(boxes.get(ids[0]!)!.rank);
  let rPos = 0;
  ranks.forEach((rk, i) => {
    const thick = Math.max(...rk.map(along));
    rk.forEach((b) => (b.r = rPos + thick / 2));
    rPos += thick + RANK_GAP[dir] + (labeled.has(i) ? LABEL_ROOM : 0);
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
  const labels: { at: Pt; text: string; group: string }[] = [];
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
        labels.push({ at, text: edge.label, group: `e${edge.i}` });
      }
    }
    items.push({ t: "path", d: polyline(pts), stroke: "muted", strokeWidth: 1.5, arrow: true, group: `e${edge.i}` });
  }
  // ループ: 交差方向の外側を回す
  let lane = 0;
  edges.forEach((e, k) => {
    if (!back.has(k) || e.from === e.to) return;
    const a = boxes.get(e.from)!;
    const b = boxes.get(e.to)!;
    const side = maxC + 16 + lane * 12;
    lane++;
    const pts: Pt[] = [xy(a.c + across(a) / 2, a.r), xy(side, a.r), xy(side, b.r), xy(b.c + across(b) / 2 + 1, b.r)];
    items.push({ t: "path", d: polyline(pts), stroke: "muted", strokeWidth: 1.5, arrow: true, group: `e${e.i}` });
    if (e.label) labels.push({ at: xy(side, (a.r + b.r) / 2), text: e.label, group: `e${e.i}` });
  });
  if (lane > 0) maxC += 16 + lane * 12;

  // ノード
  for (const b of all) {
    if (b.dummy) continue;
    const [cx, cy] = xy(b.c, b.r);
    const x = cx - b.w / 2;
    const y = cy - b.h / 2;
    const hint = b.lines.join("");
    const group = `n:${b.id}`;
    const width = b.emphasis ? 2 : 1;
    if (b.shape === "decision") {
      items.push({ t: "path", d: `M${cx},${y}L${x + b.w},${cy}L${cx},${y + b.h}L${x},${cy}Z`, fill: "accentWash", stroke: b.emphasis ? EMPHASIS : "accentLine", strokeWidth: width, hint, group });
    } else {
      const r = b.shape === "terminal" ? b.h / 2 : 8;
      const wash = b.emphasis ? EMPHASIS : tint;
      items.push({ t: "rect", x: x + 0.5, y: y + 0.5, w: b.w - 1, h: b.h - 1, r, fill: wash ? "surface" : "surface2", stroke: b.emphasis ? EMPHASIS : (tint ?? "border"), strokeWidth: width, hint, group });
      // 枠の色・強調の色を薄く敷く（地の色に重ねるので、明暗どちらでも文字が読める）
      if (wash) items.push({ t: "rect", x: x + 0.5, y: y + 0.5, w: b.w - 1, h: b.h - 1, r, fill: wash, opacity: 0.1, group });
    }
    const y0 = cy - ((b.lines.length - 1) * LINE_H) / 2 + NODE_SIZE * 0.35;
    b.lines.forEach((l, k) => items.push({ t: "text", x: cx, y: y0 + k * LINE_H, text: l, size: NODE_SIZE, fill: "ink", anchor: "middle", group }));
    rects.set(b.id, { x, y, w: b.w, h: b.h });
  }

  // 辺のラベル（線の上に背景色の札を敷く）
  for (const { at, text, group } of labels) items.push(...labelItems(ctx, at, text, group));

  const extentR = rPos - RANK_GAP[dir];
  const [width, height] = dir === "TB" ? [maxC, extentR] : [extentR, maxC];
  return { items, rects, width, height };
}

function labelItems(ctx: Ctx, at: Pt, text: string, group: string): Items {
  const w = ctx.measure(text, SMALL_SIZE) + 10;
  return [
    { t: "rect", x: at[0] - w / 2, y: at[1] - 9, w, h: 18, r: 4, fill: "surface", group },
    { t: "text", x: at[0], y: at[1] + 4, text, size: SMALL_SIZE, fill: "ink2", anchor: "middle", group },
  ];
}

function makeBox(ctx: Ctx, n: FlowNode, maxText: number, decision: boolean): Box {
  const shape = n.shape === "terminal" ? "terminal" : decision ? "decision" : "box";
  const lines = wrap(n.label, maxText, NODE_SIZE, ctx.measure, 3);
  const textW = Math.max(...lines.map((l) => ctx.measure(l, NODE_SIZE)));
  const textH = lines.length * LINE_H;
  const base = { id: n.id, dummy: false, lines, shape, emphasis: n.emphasis === true, rank: 0, order: 0, c: 0, r: 0 } as const;
  if (shape === "decision") return { ...base, w: Math.max(textW * 1.5 + 32, 96), h: textH + 30 };
  return { ...base, w: Math.max(textW + 28, 72), h: textH + 16 };
}

// ---------------------------------------------------------------- 枠のある図

/** 塊: 枠 1 つ、または枠の外のノード 1 つ。 */
interface Block {
  id: string;
  group?: FlowGroup;
  token?: Token;
  title: string;
  inner: Plan;
  w: number;
  h: number;
  /** 中身の位置（塊の左上から）。 */
  ix: number;
  iy: number;
  rank: number;
  order: number;
  /** 交差方向・段方向の、塊の始まりの位置。 */
  c: number;
  r: number;
}

/** 枠をまたぐ辺。端は塊の中の箱（枠につなぐ辺なら枠そのもの）。 */
interface Cross {
  edge: Edge;
  from: Block;
  to: Block;
  /** 塊の中での端の箱。 */
  fromRect: Rect;
  toRect: Rect;
}

function planGrouped(ctx: Ctx, f: FlowFigure, decision: Set<string>): Plan {
  // 幅に収まる組み方を順に試す: 指定の向き → 縦に積む → 枠の中も縦
  const tries: [Dir, boolean][] = f.direction === "LR" ? [["LR", false], ["TB", false], ["TB", true]] : [["TB", false], ["TB", true]];
  let best: Plan | null = null;
  for (const [outer, allTB] of tries) {
    const p = groupedOnce(ctx, f, decision, outer, (g) => (allTB ? "TB" : (g.direction ?? (outer === "LR" ? "TB" : "LR"))));
    if (p.width <= ctx.width * 1.05) return p;
    if (!best || p.width < best.width) best = p;
  }
  return best!;
}

function groupedOnce(ctx: Ctx, f: FlowFigure, decision: Set<string>, outer: Dir, innerDir: (g: FlowGroup) => Dir): Plan {
  const groups = new Map((f.groups ?? []).map((g, i) => [g.id, { g, token: GROUP_TOKENS[i % GROUP_TOKENS.length]! }]));
  const edges = f.edges.map((e, i) => ({ ...e, i }));

  // 塊を作る（ノードの登場順）
  const blockOf = new Map<string, string>();
  const members = new Map<string, FlowNode[]>();
  for (const n of f.nodes) {
    const bid = n.group !== undefined && groups.has(n.group) ? n.group : n.id;
    blockOf.set(n.id, bid);
    members.set(bid, [...(members.get(bid) ?? []), n]);
  }
  const blocks = new Map<string, Block>();
  for (const [bid, ns] of members) {
    const ids = new Set(ns.map((n) => n.id));
    const inside = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    const grp = groups.get(bid);
    if (!grp) {
      const inner = layoutOnce(ctx, ns, inside, outer, decision);
      blocks.set(bid, { id: bid, title: "", inner, w: inner.width, h: inner.height, ix: 0, iy: 0, rank: 0, order: 0, c: 0, r: 0 });
      continue;
    }
    const inner = layoutOnce(ctx, ns, inside, innerDir(grp.g), decision, grp.token);
    const titleW = ctx.measure(grp.g.label, GROUP_TITLE, 600);
    const title = grp.g.label === "" ? "" : fit(grp.g.label, Math.max(inner.width, Math.min(titleW, 220)), GROUP_TITLE, ctx.measure, 600);
    const head = title === "" ? GROUP_PAD : GROUP_HEAD;
    const w = Math.max(inner.width, title === "" ? 0 : ctx.measure(title, GROUP_TITLE, 600)) + GROUP_PAD * 2;
    blocks.set(bid, { id: bid, group: grp.g, token: grp.token, title, inner, w, h: inner.height + head + GROUP_PAD, ix: (w - inner.width) / 2, iy: head, rank: 0, order: 0, c: 0, r: 0 });
  }
  const list = [...blocks.values()];

  // 枠をまたぐ辺（同じ塊の中の辺は中身の組み方で描いた。枠から自分の中への辺は描かない）
  const endRect = (b: Block, id: string): Rect => {
    if (id === b.id && b.group) return { x: 0, y: 0, w: b.w, h: b.h };
    const r = b.inner.rects.get(id)!;
    return { x: r.x + b.ix, y: r.y + b.iy, w: r.w, h: r.h };
  };
  const cross: Cross[] = [];
  for (const e of edges) {
    const fb = blocks.get(blockOf.get(e.from) ?? e.from);
    const tb = blocks.get(blockOf.get(e.to) ?? e.to);
    if (!fb || !tb || fb === tb) continue;
    cross.push({ edge: e, from: fb, to: tb, fromRect: endRect(fb, e.from), toRect: endRect(tb, e.to) });
  }

  // 1. 塊の段: 逆向きを外して最長経路
  const adj = new Map<string, string[]>();
  for (const c of cross) adj.set(c.from.id, [...(adj.get(c.from.id) ?? []), c.to.id]);
  const back = new Set<string>();
  const state = new Map<string, number>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of adj.get(id) ?? []) {
      if (state.get(to) === 1) back.add(`${id}>${to}`);
      else if (!state.has(to)) visit(to);
    }
    state.set(id, 2);
  };
  const hasIncoming = new Set(cross.map((c) => c.to.id));
  for (const b of list) if (!state.has(b.id) && !hasIncoming.has(b.id)) visit(b.id);
  for (const b of list) if (!state.has(b.id)) visit(b.id);
  const fwd = cross.filter((c) => !back.has(`${c.from.id}>${c.to.id}`));
  for (let changed = true, guard = 0; changed && guard < list.length + 1; guard++) {
    changed = false;
    for (const c of fwd) {
      if (c.to.rank < c.from.rank + 1) ((c.to.rank = c.from.rank + 1), (changed = true));
    }
  }

  // 2. 段の中の並び（重心法）
  const ranks: Block[][] = [];
  for (const b of list) (ranks[b.rank] ??= []).push(b);
  for (let r = 0; r < ranks.length; r++) ranks[r] ??= [];
  ranks.forEach((rk) => rk.forEach((b, i) => (b.order = i)));
  const nbrs = (b: Block, rank: (o: Block) => boolean) => cross.flatMap((c) => (c.from === b && rank(c.to) ? [c.to] : c.to === b && rank(c.from) ? [c.from] : []));
  for (let it = 0; it < 4; it++) {
    for (let r = 1; r < ranks.length; r++) sortBy(ranks[r]!, (b) => nbrs(b, (o) => o.rank < b.rank));
    for (let r = ranks.length - 2; r >= 0; r--) sortBy(ranks[r]!, (b) => nbrs(b, (o) => o.rank > b.rank));
  }

  // 3. 交差方向: 塊を詰めて並べ、つながる箱どうしがまっすぐ向き合うように寄せる
  const across = (b: Block) => (outer === "LR" ? b.h : b.w);
  const along = (b: Block) => (outer === "LR" ? b.w : b.h);
  const midC = (r: Rect) => (outer === "LR" ? r.y + r.h / 2 : r.x + r.w / 2);
  const desired = (b: Block, other: (o: Block) => boolean) => {
    const ws: number[] = [];
    for (const c of cross) {
      if (c.from === b && other(c.to)) ws.push(c.to.c + midC(c.toRect) - midC(c.fromRect));
      else if (c.to === b && other(c.from)) ws.push(c.from.c + midC(c.fromRect) - midC(c.toRect));
    }
    return ws.length ? ws.reduce((s, x) => s + x, 0) / ws.length : b.c;
  };
  const place = (rk: Block[], want: (b: Block) => number) => {
    if (rk.length === 0) return;
    let cursor = -Infinity;
    const wants = rk.map(want);
    rk.forEach((b, i) => {
      b.c = Math.max(wants[i]!, cursor);
      cursor = b.c + across(b) + BLOCK_GAP;
    });
    const shiftBy = rk.reduce((s, b, i) => s + (wants[i]! - b.c), 0) / rk.length;
    for (const b of rk) b.c += shiftBy;
  };
  ranks.forEach((rk) => {
    let c = 0;
    for (const b of rk) ((b.c = c), (c += across(b) + BLOCK_GAP));
  });
  for (let it = 0; it < 3; it++) {
    for (let r = 1; r < ranks.length; r++) place(ranks[r]!, (b) => desired(b, (o) => o.rank < b.rank));
    for (let r = ranks.length - 2; r >= 0; r--) place(ranks[r]!, (b) => desired(b, (o) => o.rank > b.rank));
  }
  for (let r = 1; r < ranks.length; r++) place(ranks[r]!, (b) => desired(b, (o) => o.rank < b.rank));
  const minC = Math.min(...list.map((b) => b.c));
  for (const b of list) b.c -= minC;
  let maxC = Math.max(...list.map((b) => b.c + across(b)));

  // 4. 通路: 段 k の後ろ（k = -1 は最初の段の前）。隣の段への辺は行き先ごとに 1 本の線にまとめる。
  //    段を飛ばす辺・戻る辺は、出発の段の後ろの通路から図の外側（先へは上・左、戻るのは下・右）を回る
  const channels = new Map<number, string[]>();
  const useLane = (ch: number, key: string) => {
    const l = channels.get(ch) ?? [];
    if (!l.includes(key)) l.push(key);
    channels.set(ch, l);
  };
  // 箱から段の向きにまっすぐ出られない（同じ枠の中で先に箱がある）辺は、横から出して外側を回す。
  // 枠の中も段と同じ向きに並べたとき（狭い幅で全部を縦に積んだときなど）に、線が箱を貫かないように
  const midR = (r: Rect) => (outer === "LR" ? r.x + r.w / 2 : r.y + r.h / 2);
  const span = (r: Rect): [number, number, number, number] => (outer === "LR" ? [r.y, r.y + r.h, r.x, r.x + r.w] : [r.x, r.x + r.w, r.y, r.y + r.h]);
  const blocked = (b: Block, r: Rect, ahead: boolean) => {
    const c = midC(r);
    const [, , r0, r1] = span(r);
    for (const o of b.inner.rects.values()) {
      const [oc0, oc1, or0, or1] = span({ ...o, x: o.x + b.ix, y: o.y + b.iy });
      if (c < oc0 || c > oc1) continue;
      if (ahead ? or0 >= r1 - 0.5 : or1 <= r0 + 0.5) return true;
    }
    return false;
  };
  let before = 0;
  let after = 0;
  const sideLanes = new Map<string, number>();
  const routes = cross.map((c): { c: Cross; entry: string; exit: string; around: number; side?: number } => {
    const ra = c.from.rank;
    const rb = c.to.rank;
    const entry = `t:${c.edge.to}`;
    if (blocked(c.from, c.fromRect, true) || blocked(c.to, c.toRect, false)) {
      // 行き先が同じなら 1 本の線にまとめる
      if (!sideLanes.has(entry)) sideLanes.set(entry, ++after);
      return { c, entry, exit: entry, around: 0, side: sideLanes.get(entry)! };
    }
    if (rb === ra + 1) {
      useLane(ra, entry);
      return { c, entry, exit: entry, around: 0 };
    }
    const exit = `e:${c.edge.i}`;
    useLane(ra, exit);
    useLane(rb - 1, entry);
    return { c, entry, exit, around: rb > ra ? -++before : ++after };
  });
  // 線の並び: 行き先の位置の順（交差を減らす）
  const absC = (b: Block, r: Rect) => b.c + midC(r);
  for (const [ch, keys] of channels) {
    const pos = (key: string) => {
      const rt = routes.find((x) => x.entry === key || x.exit === key)!;
      return key.startsWith("t:") ? absC(rt.c.to, rt.c.toRect) : absC(rt.c.from, rt.c.fromRect);
    };
    channels.set(ch, [...keys].sort((a, b) => pos(a) - pos(b)));
  }
  const last = ranks.length - 1;
  const channelW = (ch: number) => {
    const n = channels.get(ch)?.length ?? 0;
    const inner = ch >= 0 && ch < last;
    return n === 0 ? (inner ? CHANNEL_MIN : 0) : Math.max(inner ? CHANNEL_MIN : 0, 24 + (n - 1) * LANE);
  };
  const rankStart: number[] = [];
  const chStart = new Map<number, number>();
  let pos = 0;
  chStart.set(-1, 0);
  pos += channelW(-1);
  ranks.forEach((rk, k) => {
    rankStart[k] = pos;
    const thick = Math.max(0, ...rk.map(along));
    for (const b of rk) b.r = pos + (thick - along(b)) / 2;
    pos += thick;
    chStart.set(k, pos);
    pos += channelW(k);
  });
  const extentR = pos;
  const laneR = (ch: number, key: string) => {
    const keys = channels.get(ch)!;
    const j = keys.indexOf(key);
    return chStart.get(ch)! + channelW(ch) / 2 + (j - (keys.length - 1) / 2) * LANE;
  };
  // 外側を回る線の分だけ、交差方向を広げる
  const outside = (n: number) => (n === 0 ? 0 : 16 + (n - 1) * LANE + 8);
  const shiftC = outside(before);
  for (const b of list) b.c += shiftC;
  const inner = maxC + shiftC;
  const sideBefore = (k: number) => shiftC - 16 - (k - 1) * LANE;
  const sideAfter = (k: number) => inner + 16 + (k - 1) * LANE;
  maxC = inner + outside(after);

  const xy = (c: number, r: number): Pt => (outer === "LR" ? [r, c] : [c, r]);
  const origin = (b: Block): Pt => xy(b.c, b.r);

  const items: Items = [];
  const rects = new Map<string, Rect>();
  // 枠（いちばん奥）
  for (const b of list) {
    if (!b.group || !b.token) continue;
    const [x, y] = origin(b);
    items.push({ t: "rect", x, y, w: b.w, h: b.h, r: 10, fill: b.token, opacity: 0.06 });
    items.push({ t: "path", d: roundRect(x + 0.5, y + 0.5, b.w - 1, b.h - 1, 10), stroke: b.token, strokeWidth: 1.2, dash: "5 4" });
  }
  // 枠をまたぐ辺
  const labels: { at: Pt; text: string; group: string }[] = [];
  const entering = new Map<Block, number[]>();
  for (const { c, entry, exit, around, side } of routes) {
    const [fx, fy] = origin(c.from);
    const [tx, ty] = origin(c.to);
    const a = { x: c.fromRect.x + fx, y: c.fromRect.y + fy, w: c.fromRect.w, h: c.fromRect.h };
    const b = { x: c.toRect.x + tx, y: c.toRect.y + ty, w: c.toRect.w, h: c.toRect.h };
    const cA = midC(a);
    const cB = midC(b);
    const rA = span(a)[3];
    const rB = span(b)[2] - 1;
    let pts: [number, number][];
    if (side !== undefined) {
      const s = sideAfter(side);
      pts = [[span(a)[1], midR(a)], [s, midR(a)], [s, midR(b)], [span(b)[1] + 1, midR(b)]];
    } else if (around === 0) {
      const l1 = laneR(c.from.rank, exit);
      pts = [[cA, rA], [cA, l1], [cB, l1], [cB, rB]];
    } else {
      const s = around < 0 ? sideBefore(-around) : sideAfter(around);
      const l1 = laneR(c.from.rank, exit);
      const l2 = laneR(c.to.rank - 1, entry);
      pts = [[cA, rA], [cA, l1], [s, l1], [s, l2], [cB, l2], [cB, rB]];
    }
    const path = pts.map(([pc, pr]) => xy(pc, pr));
    items.push({ t: "path", d: polyline(path), stroke: "muted", strokeWidth: 1.5, arrow: true, group: `e${c.edge.i}` });
    if (c.edge.label) {
      // 隣の段への辺は出発側（箱から通路まで）に置く。入る側は枠の見出しと重なりやすい
      const exitLen = Math.hypot(path[1]![0] - path[0]![0], path[1]![1] - path[0]![1]);
      const at: Pt = side === undefined && around === 0 && exitLen >= 24 ? [(path[0]![0] + path[1]![0]) / 2, (path[0]![1] + path[1]![1]) / 2] : longestMid(path);
      labels.push({ at, text: c.edge.label, group: `e${c.edge.i}` });
    }
    // 縦に積んだ図では、上から入る線が枠の見出しを横切る。その x を覚えて見出しを避ける
    if (side === undefined && outer === "TB") entering.set(c.to, [...(entering.get(c.to) ?? []), cB]);
  }
  // 枠の見出し: 左に置き、入る線に重なるなら右へ。どちらも重なるなら地の色の札を敷く
  for (const b of list) {
    if (!b.title) continue;
    const [x, y] = origin(b);
    const tw = ctx.measure(b.title, GROUP_TITLE, 600);
    const hits = (x0: number) => (entering.get(b) ?? []).some((cx) => cx > x0 - 4 && cx < x0 + tw + 4);
    const right = x + b.w - GROUP_PAD - tw;
    const tx = !hits(x + GROUP_PAD) ? x + GROUP_PAD : !hits(right) ? right : x + GROUP_PAD;
    if (hits(tx)) items.push({ t: "rect", x: tx - 4, y: y + 9, w: tw + 8, h: 18, r: 4, fill: "surface" });
    items.push({ t: "text", x: tx, y: y + 22, text: b.title, size: GROUP_TITLE, weight: 600, fill: "ink" });
  }
  // 中身（枠の中の辺とノード）
  for (const b of list) {
    const [x, y] = origin(b);
    shiftPlan(b.inner, x + b.ix, y + b.iy);
    items.push(...b.inner.items);
    for (const [id, r] of b.inner.rects) rects.set(id, r);
  }
  for (const { at, text, group } of labels) items.push(...labelItems(ctx, at, text, group));

  const [width, height] = outer === "LR" ? [extentR, maxC] : [maxC, extentR];
  return { items, rects, width, height };
}

/** 並びを、隣の塊の並びの重心で並べ替える。 */
function sortBy<T extends { order: number }>(rk: T[], nbrs: (b: T) => T[]): void {
  const bary = (b: T) => {
    const ns = nbrs(b);
    return ns.length ? ns.reduce((s, x) => s + x.order, 0) / ns.length : b.order;
  };
  rk.sort((a, b) => bary(a) - bary(b) || a.order - b.order).forEach((b, i) => (b.order = i));
}

/** 折れ線のいちばん長い区間の中点（ラベルを置く）。 */
function longestMid(pts: Pt[]): Pt {
  let best: Pt = pts[0]!;
  let len = -1;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[i + 1]!;
    const l = Math.hypot(bx - ax, by - ay);
    if (l > len) ((len = l), (best = [(ax + bx) / 2, (ay + by) / 2]));
  }
  return best;
}
