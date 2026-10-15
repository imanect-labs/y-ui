/**
 * 採点（v0.7 で足した種類）: 散布図・年表・手順・階層。判定の考え方は score.ts と同じ
 * （対応付けはテキストの類似度、数値は相対誤差 0.5% と単位の倍率を吸収）。
 */

import type { FlowFigure, ScatterFigure, StepsFigure, TimelineFigure, TreeFigure, TreeNode } from "@imanect/yui";
import { matchByText, norm, similarity } from "./similarity.js";

export interface PartScore {
  pass: boolean;
  semantic: number;
  fabricated: number;
  detail: Record<string, number | string | boolean>;
}

const SCALES = [1, 1e4, 1e-4, 1e8, 1e-8, 1e3, 1e-3, 1e6, 1e-6, 1e2, 1e-2];
const same = (a: number, b: number) => Math.abs(a - b) <= 0.005 * Math.max(Math.abs(a), Math.abs(b)) + 1e-9;

function f1(tp: number, goldN: number, modelN: number): number {
  if (goldN === 0 && modelN === 0) return 1;
  const p = modelN === 0 ? 0 : tp / modelN;
  const r = goldN === 0 ? 0 : tp / goldN;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

/** 対応した組の前後関係の一致率（同順・逆順）。 */
function concordance(map: Map<number, number>): { same: number; reversed: number } {
  const pairs = [...map.entries()].sort((a, b) => a[0] - b[0]);
  let s = 0;
  let r = 0;
  let total = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      total++;
      if (pairs[j]![1] > pairs[i]![1]) s++;
      else r++;
    }
  }
  return total === 0 ? { same: 1, reversed: 1 } : { same: s / total, reversed: r / total };
}

// ------------------------------------------------------------ scatter

export function scoreScatter(gold: ScatterFigure, f: ScatterFigure): PartScore {
  const map = matchByText(
    gold.points.map((p) => p.label),
    f.points.map((p) => p.label),
  );
  // 軸の入れ替え（X と Y を逆に書く）と、軸ごとの単位の倍率を許す。
  let best = { ok: -1, swap: false, sx: 1, sy: 1 };
  for (const swap of [false, true]) {
    for (const sx of SCALES) {
      for (const sy of SCALES) {
        let ok = 0;
        for (const [gi, mi] of map) {
          const g = gold.points[gi]!;
          const m = f.points[mi]!;
          const [mx, my] = swap ? [m.y, m.x] : [m.x, m.y];
          if (same(mx, g.x * sx) && same(my, g.y * sy)) ok++;
        }
        if (ok > best.ok) best = { ok, swap, sx, sy };
      }
    }
  }
  const goldNums = gold.points.flatMap((p) => [p.x, p.y]);
  const fabricated = f.points.flatMap((p) => [p.x, p.y]).filter((v) => !SCALES.some((k) => goldNums.some((g) => same(v, g * k)))).length;
  const recall = gold.points.length === 0 ? 1 : best.ok / gold.points.length;
  const extra = f.points.length - map.size;
  const precision = f.points.length === 0 ? 0 : map.size / f.points.length;
  return { pass: recall === 1 && extra === 0 && fabricated === 0, semantic: recall * precision, fabricated, detail: { recall, precision, extra, swap: best.swap } };
}

// ------------------------------------------------------------ timeline / steps

/**
 * 項目の列を比べる。項目は全文（時期・見出し・説明）で対応付け、年表は時期も一致を求める。
 * 順序は書かれた順との一致。年表は新しい順（逆順）も許す。
 */
function scoreSeq(gold: { key: string; text: string }[], model: { key: string; text: string }[], opts: { checkKey: boolean; allowReverse: boolean }): PartScore {
  const map = matchByText(
    gold.map((g) => g.text),
    model.map((m) => m.text),
  );
  let tp = 0;
  let keyOk = 0;
  for (const [gi, mi] of map) {
    const k = !opts.checkKey || norm(gold[gi]!.key) === norm(model[mi]!.key) || similarity(gold[gi]!.key, model[mi]!.key) >= 0.85;
    if (k) keyOk++;
    tp++;
  }
  const itemF1 = f1(opts.checkKey ? keyOk : tp, gold.length, model.length);
  const c = concordance(map);
  const order = opts.allowReverse ? Math.max(c.same, c.reversed) : c.same;
  return { pass: itemF1 >= 0.85 && order >= 0.95, semantic: (itemF1 + order) / 2, fabricated: 0, detail: { itemF1, order, keyOk, goldItems: gold.length, modelItems: model.length } };
}

export function scoreTimeline(gold: TimelineFigure, f: TimelineFigure): PartScore {
  const items = (t: TimelineFigure) => t.events.map((e) => ({ key: e.when, text: [e.when, e.title, e.desc ?? ""].join(" ") }));
  return scoreSeq(items(gold), items(f), { checkKey: true, allowReverse: true });
}

export function scoreSteps(gold: StepsFigure, f: StepsFigure): PartScore {
  const items = (s: StepsFigure) => s.steps.map((x) => ({ key: "", text: x.desc ? `${x.title} ${x.desc}` : x.title }));
  return scoreSeq(items(gold), items(f), { checkKey: false, allowReverse: false });
}

/** 分岐の無い流れ図を手順にする（流れ図で答えた手順の課題・手順で答えた一本道の流れ図の課題を比べるため）。 */
export function flowAsSteps(f: FlowFigure): StepsFigure | null {
  const outs = new Map<string, string[]>();
  const ins = new Map<string, number>();
  for (const e of f.edges) {
    outs.set(e.from, [...(outs.get(e.from) ?? []), e.to]);
    ins.set(e.to, (ins.get(e.to) ?? 0) + 1);
  }
  if ([...outs.values()].some((o) => o.length > 1) || [...ins.values()].some((n) => n > 1)) return null;
  const start = f.nodes.find((n) => !ins.has(n.id));
  if (!start) return null;
  const order: string[] = [];
  for (let id: string | undefined = start.id; id !== undefined && !order.includes(id); id = outs.get(id)?.[0]) order.push(id);
  if (order.length !== f.nodes.length) return null;
  const label = new Map(f.nodes.map((n) => [n.id, n.label]));
  return { kind: "steps", title: f.title, refs: f.refs, steps: order.map((id) => ({ title: label.get(id)!, refs: [] })) };
}

// ------------------------------------------------------------ tree

interface Flat {
  node: TreeNode;
  parent: number | null;
}

function flatten(roots: TreeNode[]): Flat[] {
  const out: Flat[] = [];
  const walk = (ns: TreeNode[], parent: number | null) => {
    for (const n of ns) {
      const i = out.length;
      out.push({ node: n, parent });
      walk(n.children, i);
    }
  };
  walk(roots, null);
  return out;
}

export function scoreTree(gold: TreeFigure, f: TreeFigure, context: string): PartScore {
  const g = flatten(gold.roots);
  const m = flatten(f.roots);
  const text = (n: TreeNode) => (n.desc ? `${n.title} ${n.desc}` : n.title);
  const map = matchByText(
    g.map((x) => text(x.node)),
    m.map((x) => text(x.node)),
  );
  // 正解に無い節でも、名前が資料に書かれているもの（まとめの見出しなど）は誤りとしない。
  const ctx = norm(context);
  const matched = new Set(map.values());
  const extra = m.filter((x, i) => !matched.has(i) && !(norm(x.node.title).length >= 2 && ctx.includes(norm(x.node.title)))).length;
  const nodeF1 = f1(map.size, g.length, map.size + extra);
  // 親子関係: 正解の親が対応していて、モデルでもその親（または、対応しない資料由来の節を挟んだ祖先）の下にあるか
  let parentOk = 0;
  let parentTotal = 0;
  g.forEach((x, gi) => {
    const mi = map.get(gi);
    if (mi === undefined) return;
    parentTotal++;
    const want = x.parent === null ? null : (map.get(x.parent) ?? -1);
    let p = m[mi]!.parent;
    while (p !== null && !matched.has(p)) p = m[p]!.parent;
    if (p === want) parentOk++;
  });
  const parentAcc = parentTotal === 0 ? 0 : parentOk / parentTotal;
  return { pass: nodeF1 >= 0.85 && parentAcc >= 0.85, semantic: (nodeF1 + parentAcc) / 2, fabricated: 0, detail: { nodeF1, parentAcc, goldNodes: g.length, modelNodes: m.length } };
}
