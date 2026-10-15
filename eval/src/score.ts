/**
 * 採点。抽出した図（中間表現）を正解と比べる。
 *
 * 判定基準は docs/eval-plan.md で実行前に固定したもの。ここを変えたら計画書も直す。
 */

import { isChart, parseNumber, type ChartFigure, type Figure, type FlowFigure, type StackFigure, type StatFigure } from "@imanect/yui";
import { flowAsSteps, scoreCards, scoreFunnel, scoreProgress, scoreScatter, scoreSteps, scoreTimeline, scoreTree } from "./score-v07.js";
import { matchByText, norm, similarity } from "./similarity.js";
import type { EvalTask } from "./tasks/types.js";

export interface Extraction {
  /** 抽出できた図（0 個以上）。 */
  figures: Figure[];
  /** 図を出そうとした形跡があるか（ui ブロック・ツール呼び出し・JSON など）。 */
  attempted: boolean;
  /** 出そうとした図がすべて構文として正しかったか。attempted=false なら true。 */
  syntaxOk: boolean;
  /** 構文エラー・警告の要約。 */
  errors: string[];
  /** 警告（行の除外など）の件数。 */
  warnings: number;
}

export interface Score {
  pass: boolean;
  /** 0..1 の連続値。 */
  semantic: number;
  syntaxOk: boolean;
  produced: boolean;
  kindOk: boolean;
  /** 資料に無い数値の個数。 */
  fabricated: number;
  detail: Record<string, number | string | boolean>;
}

/** 値の一致（相対誤差 0.5%）。 */
function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.005 * Math.max(Math.abs(a), Math.abs(b)) + 1e-9;
}

/** 単位の取り方の違い（`120万円` と `1200000`）を吸収するための倍率候補。 */
const SCALES = [1, 1e4, 1e-4, 1e8, 1e-8, 1e3, 1e-3, 1e6, 1e-6, 1e2, 1e-2];

function numericValues(f: Figure): number[] {
  if (isChart(f)) return f.rows.flatMap((r) => r.values.filter((v): v is number => v !== null));
  if (f.kind === "stat") return f.items.flatMap((i) => (i.num === undefined ? [] : [i.num]));
  if (f.kind === "scatter") return f.points.flatMap((p) => [p.x, p.y]);
  if (f.kind === "funnel") return f.stages.map((s) => s.value);
  if (f.kind === "progress") return f.items.flatMap((i) => [i.value, i.target]);
  return [];
}

export function scoreTask(task: EvalTask, ex: Extraction): Score {
  const produced = ex.figures.length > 0;
  if (task.expect === "none") {
    const numericFigures = ex.figures.filter((f) => numericValues(f).length > 0);
    const fabricated = numericFigures.reduce((s, f) => s + numericValues(f).length, 0);
    const pass = task.category === "none-nodata" ? numericFigures.length === 0 : !produced;
    return { pass, semantic: pass ? 1 : 0, syntaxOk: ex.syntaxOk, produced, kindOk: true, fabricated, detail: { figures: ex.figures.length } };
  }

  let best: Score | null = null;
  for (const f of ex.figures) {
    // 図の種類に合う正解（無ければ主の正解）と比べる
    const gold = [task.gold!, ...(task.altGolds ?? [])].find((g) => g.kind === f.kind) ?? task.gold!;
    const s = scoreFigure(task, gold, f);
    if (!best || s.semantic + (s.pass ? 1 : 0) > best.semantic + (best.pass ? 1 : 0)) best = s;
  }
  if (!best) {
    return { pass: false, semantic: 0, syntaxOk: ex.syntaxOk, produced: false, kindOk: false, fabricated: 0, detail: { reason: ex.attempted ? "unparsable" : "no_figure" } };
  }
  best.syntaxOk = ex.syntaxOk;
  return best;
}

function scoreFigure(task: EvalTask, gold: Figure, f: Figure): Score {
  // incompatible: Shiki の円グラフ・表など、bar/line に写したが種類としては別物の図（extract/shiki.ts）。
  const kindOk = task.acceptKinds.includes(f.kind) && !(f as { incompatible?: boolean }).incompatible;
  const base = { syntaxOk: true, produced: true, kindOk };
  if (isChart(gold) && isChart(f)) {
    const s = scoreChart(gold, f);
    return { ...base, ...s, pass: kindOk && s.pass };
  }
  if (gold.kind === "stat" && f.kind === "stat") return { ...base, ...scoreStat(task, gold, f) };
  if (gold.kind === "flow" && f.kind === "flow") return { ...base, ...scoreFlow(gold, f, task.context) };
  if (gold.kind === "stack" && f.kind === "stack") return { ...base, ...scoreStack(gold, f, task.context) };
  if (gold.kind === "scatter" && f.kind === "scatter") return { ...base, ...scoreScatter(gold, f) };
  if (gold.kind === "timeline" && f.kind === "timeline") return { ...base, ...scoreTimeline(gold, f) };
  if (gold.kind === "tree" && f.kind === "tree") return { ...base, ...scoreTree(gold, f, task.context) };
  if (gold.kind === "cards" && f.kind === "cards") return { ...base, ...scoreCards(gold, f) };
  if (gold.kind === "progress" && f.kind === "progress") return { ...base, ...scoreProgress(gold, f) };
  if (gold.kind === "funnel" && f.kind === "funnel") return { ...base, ...scoreFunnel(gold, f) };
  // 手順と一本道の流れ図は、受ける種類に入っていれば互いに比べる
  if (kindOk && (gold.kind === "steps" || gold.kind === "flow") && (f.kind === "steps" || f.kind === "flow")) {
    const g = gold.kind === "steps" ? gold : flowAsSteps(gold);
    const m = f.kind === "steps" ? f : flowAsSteps(f);
    if (g && m) return { ...base, ...scoreSteps(g, m) };
    return { ...base, pass: false, semantic: 0, fabricated: 0, detail: { reason: "kind_mismatch", got: f.kind } };
  }
  // 種類が違う（グラフを求めたのに数値カードなど）。数値の捏造だけは数える。
  const goldNums = numericValues(gold);
  const fabricated = numericValues(f).filter((v) => !SCALES.some((k) => goldNums.some((g) => same(v, g * k)))).length;
  return { ...base, pass: false, semantic: 0, fabricated, detail: { reason: "kind_mismatch", got: f.kind } };
}

// ------------------------------------------------------------ chart

function scoreChart(gold: ChartFigure, f: ChartFigure): Omit<Score, "syntaxOk" | "produced" | "kindOk"> {
  const rowMap = matchByText(
    gold.rows.map((r) => r.label),
    f.rows.map((r) => r.label),
  );
  const goldSeries = gold.columns.length - 1;
  const modelSeries = Math.max(0, f.columns.length - 1, ...f.rows.map((r) => r.values.length));

  // 倍率と系列の対応を、一致するセルが最大になるように選ぶ。
  let bestScale = 1;
  let bestMatched = -1;
  let bestSeriesMap: number[] = [];
  for (const scale of SCALES) {
    const seriesMap: number[] = [];
    const used = new Set<number>();
    let matched = 0;
    for (let s = 0; s < goldSeries; s++) {
      let bestCol = -1;
      let bestCount = -1;
      for (let c = 0; c < modelSeries; c++) {
        if (used.has(c)) continue;
        let count = 0;
        for (const [gi, mi] of rowMap) {
          const g = gold.rows[gi]!.values[s];
          const m = f.rows[mi]!.values[c];
          if (g !== null && g !== undefined && m !== null && m !== undefined && same(m, g * scale)) count++;
        }
        // 同点なら列名の近いもの
        const nameBonus = similarity(gold.columns[s + 1] ?? "", f.columns[c + 1] ?? "") * 0.01;
        if (count + nameBonus > bestCount) {
          bestCount = count + nameBonus;
          bestCol = c;
        }
      }
      seriesMap.push(bestCol);
      if (bestCol >= 0) used.add(bestCol);
      matched += Math.floor(Math.max(0, bestCount));
    }
    if (matched > bestMatched) {
      bestMatched = matched;
      bestScale = scale;
      bestSeriesMap = seriesMap;
    }
  }

  const goldCells = gold.rows.reduce((n, r) => n + r.values.filter((v) => v !== null).length, 0);
  const recall = goldCells === 0 ? 1 : bestMatched / goldCells;

  // モデル側のセルのうち、資料（＝正解）のどの数値とも一致しないもの。
  const goldNums = gold.rows.flatMap((r) => r.values.filter((v): v is number => v !== null));
  const modelNums = f.rows.flatMap((r) => r.values.filter((v): v is number => v !== null));
  const fabricated = modelNums.filter((v) => !goldNums.some((g) => same(v, g * bestScale))).length;
  const extraRows = f.rows.length - rowMap.size;
  const precision = f.rows.length === 0 ? 0 : rowMap.size / f.rows.length;
  const semantic = recall * precision;
  return {
    pass: recall === 1 && extraRows === 0 && fabricated === 0,
    semantic,
    fabricated,
    detail: { recall, precision, scale: bestScale, extraRows, seriesMapped: bestSeriesMap.filter((c) => c >= 0).length, goldSeries },
  };
}

// ------------------------------------------------------------ stat

function statValueMatches(goldValue: string, goldNum: number | undefined, modelValue: string, modelNum: number | undefined): boolean {
  if (goldNum !== undefined && modelNum !== undefined) return SCALES.some((k) => same(modelNum, goldNum * k));
  return norm(goldValue) === norm(modelValue) || (norm(modelValue).includes(norm(goldValue)) && norm(goldValue).length >= 2);
}

function scoreStat(task: EvalTask, gold: StatFigure, f: StatFigure): Omit<Score, "syntaxOk" | "produced" | "kindOk"> {
  const map = matchByText(
    gold.items.map((i) => i.label),
    f.items.map((i) => i.label),
  );
  let matched = 0;
  const done = new Set<number>();
  for (const [gi, mi] of map) {
    const g = gold.items[gi]!;
    const m = f.items[mi]!;
    const mNum = m.num ?? parseNumber(m.value)?.value;
    if (statValueMatches(g.value, g.num, m.value, mNum)) {
      matched++;
      done.add(gi);
    }
  }
  // 別の項目の補足欄に書かれた指標（`売上 | 3,200万円 | 前年比 +18%`）も表示されているので一致とみなす。
  gold.items.forEach((g, gi) => {
    if (done.has(gi)) return;
    const inSub = f.items.some((m) => {
      if (m.sub === undefined || !norm(m.sub).includes(norm(g.label))) return false;
      const nums = [...m.sub.matchAll(/[-+△▲]?[0-9０-９][0-9０-９,，.．]*(?:億|万|千)?/g)].map((x) => parseNumber(x[0])?.value);
      return g.num !== undefined ? nums.some((v) => v !== undefined && SCALES.some((k) => same(v, g.num! * k))) : norm(m.sub).includes(norm(g.value));
    });
    if (inSub) matched++;
  });
  // 値の欄に補足として書かれた数値も資料と照合する。
  const ctxNums = [...task.context.matchAll(/[-+△▲]?[0-9０-９][0-9０-９,，.．]*(?:億|万|千)?/g)]
    .map((m) => parseNumber(m[0])?.value)
    .filter((v): v is number => v !== undefined);
  const fabricated = f.items.filter((i) => i.num !== undefined && !ctxNums.some((c) => SCALES.some((k) => same(i.num!, c * k)))).length;
  const recall = gold.items.length === 0 ? 1 : matched / gold.items.length;
  const precision = f.items.length === 0 ? 0 : matched / f.items.length;
  return {
    pass: recall === 1 && fabricated === 0,
    semantic: recall,
    fabricated,
    detail: { recall, precision },
  };
}

// ------------------------------------------------------------ flow

function f1(tp: number, goldN: number, modelN: number): number {
  if (goldN === 0 && modelN === 0) return 1;
  const p = modelN === 0 ? 0 : tp / modelN;
  const r = goldN === 0 ? 0 : tp / goldN;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

/**
 * 正解に無い中間の手順（入る辺・出る辺が 1 本ずつ）で、名前が資料に書かれているものは縮約する
 * （「出張 → 帰着 → 旅費精算」を「出張 → 旅費精算」として比べる）。
 */
function contractMentionedSteps(f: FlowFigure, matched: Set<string>, context: string): FlowFigure {
  const ctx = norm(context);
  let edges = [...f.edges];
  for (const n of f.nodes) {
    if (matched.has(n.id) || norm(n.label).length < 2 || !ctx.includes(norm(n.label))) continue;
    const ins = edges.filter((e) => e.to === n.id);
    const outs = edges.filter((e) => e.from === n.id);
    if (ins.length !== 1 || outs.length !== 1 || ins[0]!.from === n.id) continue;
    const label = ins[0]!.label ?? outs[0]!.label;
    const merged = label === undefined ? { from: ins[0]!.from, to: outs[0]!.to } : { from: ins[0]!.from, to: outs[0]!.to, label };
    edges = [...edges.filter((e) => e !== ins[0] && e !== outs[0]), merged];
  }
  return { ...f, edges };
}

/**
 * 名前だけでは対応しなかったノードを、つながりで補って対応付ける（「精算書提出」と「申請者が提出」）。
 * 名前が少しでも似ていて（類似度 0.2 以上）、対応付けると一致する辺が増える組だけを、増える辺の多い順に採る。
 */
function alignByStructure(gold: FlowFigure, f: FlowFigure, nodeMap: Map<number, number>): void {
  const gi = new Map(gold.nodes.map((n, i) => [n.id, i]));
  const mi = new Map(f.nodes.map((n, i) => [n.id, i]));
  const gEdges = gold.edges.map((e) => [gi.get(e.from)!, gi.get(e.to)!] as const);
  const mEdges = new Set(f.edges.map((e) => `${mi.get(e.from)}>${mi.get(e.to)}`));
  for (;;) {
    const used = new Set(nodeMap.values());
    let best: { g: number; m: number; gain: number; sim: number } | null = null;
    gold.nodes.forEach((gn, g) => {
      if (nodeMap.has(g)) return;
      f.nodes.forEach((mn, m) => {
        if (used.has(m)) return;
        const sim = similarity(gn.label, mn.label);
        if (sim < 0.2) return;
        let gain = 0;
        for (const [a, b] of gEdges) {
          if (a === g && nodeMap.has(b) && mEdges.has(`${m}>${nodeMap.get(b)}`)) gain++;
          if (b === g && nodeMap.has(a) && mEdges.has(`${nodeMap.get(a)}>${m}`)) gain++;
        }
        if (gain > 0 && (!best || gain > best.gain || (gain === best.gain && sim > best.sim))) best = { g, m, gain, sim };
      });
    });
    if (!best) return;
    const b: { g: number; m: number } = best;
    nodeMap.set(b.g, b.m);
  }
}

function scoreFlow(gold: FlowFigure, f0: FlowFigure, context: string): Omit<Score, "syntaxOk" | "produced" | "kindOk" | "fabricated"> & { fabricated: number } {
  const nodeMap = matchByText(
    gold.nodes.map((n) => n.label),
    f0.nodes.map((n) => n.label),
  );
  alignByStructure(gold, f0, nodeMap);
  const f = contractMentionedSteps(f0, new Set([...nodeMap.values()].map((i) => f0.nodes[i]!.id)), context);
  const goldIdx = new Map(gold.nodes.map((n, i) => [n.id, i]));
  const modelIdx = new Map(f.nodes.map((n, i) => [n.id, i]));
  const modelEdges = new Map<string, string | undefined>();
  for (const e of f.edges) modelEdges.set(`${modelIdx.get(e.from)}>${modelIdx.get(e.to)}`, e.label);

  // 分岐（出る辺が 2 本以上）のラベルだけを採点する。
  const outDegree = new Map<string, number>();
  for (const e of gold.edges) outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);

  let tp = 0;
  let labelNeeded = 0;
  let labelOk = 0;
  for (const e of gold.edges) {
    const a = nodeMap.get(goldIdx.get(e.from)!);
    const b = nodeMap.get(goldIdx.get(e.to)!);
    const branch = (outDegree.get(e.from) ?? 0) >= 2 && e.label !== undefined;
    if (branch) labelNeeded++;
    if (a === undefined || b === undefined) continue;
    const key = `${a}>${b}`;
    if (!modelEdges.has(key)) continue;
    tp++;
    if (branch) {
      const ml = modelEdges.get(key);
      if (ml !== undefined && similarity(e.label!, ml) >= 0.5) labelOk++;
    }
  }
  const edgeF1 = f1(tp, gold.edges.length, f.edges.length);
  const labelAcc = labelNeeded === 0 ? 1 : labelOk / labelNeeded;
  const nodeRecall = gold.nodes.length === 0 ? 1 : nodeMap.size / gold.nodes.length;
  return {
    pass: edgeF1 >= 0.85 && labelAcc >= 0.75,
    semantic: edgeF1,
    fabricated: 0,
    detail: { edgeF1, labelAcc, nodeRecall, goldEdges: gold.edges.length, modelEdges: f.edges.length },
  };
}

// ------------------------------------------------------------ stack

const boxText = (b: { title: string; desc?: string }) => (b.desc ? `${b.title} ${b.desc}` : b.title);

/**
 * 横並びを「見出し付きのまとまり＋中の要素」で書いた層（`- データ保存` の下に `- PostgreSQL | Redis | S3`）を、
 * 横並びの層に開く。1 箱だけの層で、見出しが正解の箱とほぼ同じ（0.85 以上）でなく、子の過半数が
 * 正解の「層の中の要素」より「層の箱」に近い場合に限る。
 * 見出しの似かたを 0.5 で切ると「データソース」と「データウェアハウス」のような別物を同じとみなし、開けなかった。
 */
function unwrapGroups(gold: StackFigure, f: StackFigure): StackFigure {
  const tops = gold.tiers.flatMap((t) => t.boxes.map(boxText));
  const kids = gold.tiers.flatMap((t) => t.boxes.flatMap((b) => b.children.map(boxText)));
  const best = (s: string, pool: string[]) => Math.max(0, ...pool.map((g) => similarity(g, s)));
  return {
    ...f,
    tiers: f.tiers.map((t) => {
      const b = t.boxes[0];
      if (t.boxes.length !== 1 || !b || b.children.length === 0) return t;
      if (tops.some((g) => similarity(g, b.title) >= 0.85)) return t;
      const asTop = b.children.filter((c) => {
        const s = best(boxText(c), tops);
        return s >= 0.5 && s > best(boxText(c), kids);
      }).length;
      if (asTop * 2 <= b.children.length) return t;
      return { ...t, boxes: b.children.map((c) => ({ ...c, children: [] })) };
    }),
  };
}

/**
 * 正解では説明（desc）に書いた中身を、モデルが子として書いた分を除く（`Web / モバイル` を子にするなど）。
 * 説明しか持たない正解の箱に限る。
 */
function childrenAgainst(goldBox: StackFigure["tiers"][number]["boxes"][number], modelChildren: StackFigure["tiers"][number]["boxes"][number]["children"]) {
  if (goldBox.children.length > 0 || !goldBox.desc) return modelChildren;
  const d = norm(goldBox.desc);
  return modelChildren.filter((c) => !(norm(c.title).length >= 2 && d.includes(norm(c.title))));
}

function scoreStack(gold: StackFigure, f0: StackFigure, context: string): Omit<Score, "syntaxOk" | "produced" | "kindOk"> {
  const f = unwrapGroups(gold, f0);
  const flat = (s: StackFigure) => s.tiers.flatMap((t, ti) => t.boxes.map((b) => ({ tier: ti, box: b })));
  const g = flat(gold);
  const m = flat(f);
  // 見出しで対応付け、だめなら説明込みで対応付ける（`IdP: SAML / OIDC` を `IdP（SAML / OIDC）` と書くなど）。
  const map = matchByText(
    g.map((x) => boxText(x.box)),
    m.map((x) => boxText(x.box)),
  );
  // 正解に無い箱でも、見出しが資料に書かれているもの（「利用者」の層など）は誤りとしない。
  const ctx = norm(context);
  const matchedModel = new Set(map.values());
  const extraNotInContext = m.filter((x, i) => !matchedModel.has(i) && !(norm(x.box.title).length >= 2 && ctx.includes(norm(x.box.title)))).length;
  const boxF1 = f1(map.size, g.length, map.size + extraNotInContext);

  // 層の順序: 対応した組のすべての対で、上下関係（同じ層かどうかも含む）が一致する割合。
  const pairs = [...map.entries()];
  let concordant = 0;
  let reversed = 0;
  let total = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [gi, mi] = pairs[i]!;
      const [gj, mj] = pairs[j]!;
      const gs = Math.sign(g[gi]!.tier - g[gj]!.tier);
      const ms = Math.sign(m[mi]!.tier - m[mj]!.tier);
      total++;
      if (gs === ms) concordant++;
      // 同じ層どうし（0 と 0）は、逆向きでも一致として数える
      if (gs === -ms) reversed++;
    }
  }
  // 上下の向きは、資料が「上から」「最上位」のように決めていなければ、逆（利用側を上・下のどちらに置くか）も許す
  const fixedDirection = /上から|下から|最上位|最下層|その下に|一番上|一番下/.test(context);
  const ordered = total === 0 ? (map.size > 0 ? 1 : 0) : concordant / total;
  const order = fixedDirection || total === 0 ? ordered : Math.max(ordered, reversed / total);

  // 層の中の要素: 対応した親どうしで子を比べる。親が対応しなかった子は取りこぼし扱い。
  let childTp = 0;
  let childGold = 0;
  let childModel = 0;
  const pairedModel = new Map([...map.entries()].map(([gi, mi]) => [mi, gi]));
  g.forEach((x, gi) => {
    childGold += x.box.children.length;
    const mi = map.get(gi);
    if (mi === undefined) return;
    const mc = childrenAgainst(x.box, m[mi]!.box.children);
    childTp += matchByText(
      x.box.children.map(boxText),
      mc.map(boxText),
    ).size;
  });
  m.forEach((x, mi) => {
    const gi = pairedModel.get(mi);
    childModel += gi === undefined ? x.box.children.length : childrenAgainst(g[gi]!.box, x.box.children).length;
  });
  const childF1 = f1(childTp, childGold, childModel);

  return {
    pass: boxF1 >= 0.85 && childF1 >= 0.85 && order >= 0.95,
    semantic: (boxF1 + childF1 + order) / 3,
    fabricated: 0,
    detail: { boxF1, childF1, order, goldBoxes: g.length, modelBoxes: m.length },
  };
}
