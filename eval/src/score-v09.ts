/**
 * 採点（v0.9 で足した種類）: 比較表・メリット/デメリット・SWOT・チェックリスト。
 * 項目の対応付けはテキストの類似度（score-v07.ts と同じ）。
 */

import type { ChecklistFigure, CompareCell, CompareFigure, ListItem, ProsConsFigure, SwotFigure } from "@imanect/yui";
import { parseNumber } from "@imanect/yui";
import type { PartScore } from "./score-v07.js";
import { matchByText, similarity } from "./similarity.js";

function f1(tp: number, goldN: number, modelN: number): number {
  if (goldN === 0 && modelN === 0) return 1;
  const p = modelN === 0 ? 0 : tp / modelN;
  const r = goldN === 0 ? 0 : tp / goldN;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

const itemText = (i: ListItem) => (i.desc ? `${i.text} ${i.desc}` : i.text);

/** 箇条書きどうしの対応（見出しで、だめなら補足込みで）。 */
function matchItems(gold: ListItem[], model: ListItem[]): Map<number, number> {
  const map = matchByText(gold.map((i) => i.text), model.map((i) => i.text), 0.5);
  const used = new Set(map.values());
  const rest = matchByText(
    gold.map((g, i) => (map.has(i) ? "" : itemText(g))),
    model.map((m, i) => (used.has(i) ? "" : itemText(m))),
  );
  for (const [g, m] of rest) if (!map.has(g) && !used.has(m)) map.set(g, m);
  return map;
}

// ------------------------------------------------------------ compare

/** セルが同じ内容か。印は同じ印、文字は数値が同じか文字が近いか。 */
function sameCell(g: CompareCell, m: CompareCell): boolean {
  if (g.mark || m.mark) {
    if (g.mark !== m.mark) return false;
    // 印に添えた文字（`△ 90 日`）は、正解にあるときだけ見る
    return !g.text || !m.text || cellText(g.text, m.text);
  }
  return cellText(g.text, m.text);
}

function cellText(a: string, b: string): boolean {
  const na = parseNumber(a);
  const nb = parseNumber(b);
  if (na && nb) return Math.abs(na.value - nb.value) <= 0.005 * Math.max(Math.abs(na.value), Math.abs(nb.value)) + 1e-9;
  return similarity(a, b) >= 0.5;
}

export function scoreCompare(gold: CompareFigure, f: CompareFigure): PartScore {
  // 選択肢（列）と項目（行）を対応付ける。行と列を入れ替えて書いた図も受ける
  const direct = compareOnce(gold, f);
  const swapped = transpose(f);
  const best = swapped ? [direct, compareOnce(gold, swapped)].sort((a, b) => b.semantic - a.semantic)[0]! : direct;
  return best;
}

function compareOnce(gold: CompareFigure, f: CompareFigure): PartScore {
  const cols = matchByText(gold.columns.slice(1), f.columns.slice(1), 0.5);
  const rows = matchByText(gold.rows.map((r) => r.label), f.rows.map((r) => r.label), 0.5);
  let ok = 0;
  let total = 0;
  for (const [gr, mr] of rows) {
    for (let gc = 0; gc < gold.columns.length - 1; gc++) {
      total++;
      const mc = cols.get(gc);
      if (mc === undefined) continue;
      if (sameCell(gold.rows[gr]!.cells[gc]!, f.rows[mr]!.cells[mc] ?? { text: "" })) ok++;
    }
  }
  const optionF1 = f1(cols.size, gold.columns.length - 1, f.columns.length - 1);
  const rowF1 = f1(rows.size, gold.rows.length, f.rows.length);
  const cellAcc = total === 0 ? 0 : ok / total;
  const highlightOk = gold.highlight === undefined || (f.highlight !== undefined && cols.get(gold.highlight - 1) === f.highlight - 1);
  return {
    pass: optionF1 === 1 && rowF1 >= 0.85 && cellAcc >= 0.9 && highlightOk,
    semantic: optionF1 * rowF1 * cellAcc,
    fabricated: 0,
    detail: { optionF1, rowF1, cellAcc, highlightOk },
  };
}

/** 行と列を入れ替えた図（選択肢を行に書いた場合）。 */
function transpose(f: CompareFigure): CompareFigure | null {
  if (f.rows.length === 0 || f.rows.length > 6) return null;
  return {
    ...f,
    columns: [f.columns[0] ?? "", ...f.rows.map((r) => r.label)],
    rows: f.columns.slice(1).map((c, i) => ({ label: c, cells: f.rows.map((r) => r.cells[i] ?? { text: "" }), refs: [] })),
    highlight: undefined,
  };
}

// ------------------------------------------------------------ proscons / swot

/** 区分ごとの箇条書き。正しい区分に入った項目だけを正解に数える。 */
function sectionsF1(gold: ListItem[][], model: ListItem[][]): { f1: number; misplaced: number } {
  let tp = 0;
  const goldN = gold.reduce((a, s) => a + s.length, 0);
  const modelN = model.reduce((a, s) => a + s.length, 0);
  gold.forEach((g, i) => (tp += matchItems(g, model[i] ?? []).size));
  // 別の区分に入れた項目（メリットをデメリットに書いた等）
  const all = matchItems(gold.flat(), model.flat());
  return { f1: f1(tp, goldN, modelN), misplaced: all.size - tp };
}

export function scoreProsCons(gold: ProsConsFigure, f: ProsConsFigure): PartScore {
  const s = sectionsF1([gold.pros, gold.cons], [f.pros, f.cons]);
  return { pass: s.f1 >= 0.8 && s.misplaced === 0, semantic: s.f1, fabricated: 0, detail: { itemF1: s.f1, misplaced: s.misplaced } };
}

export function scoreSwot(gold: SwotFigure, f: SwotFigure): PartScore {
  const s = sectionsF1(gold.sections, f.sections);
  return { pass: s.f1 >= 0.8 && s.misplaced === 0, semantic: s.f1, fabricated: 0, detail: { itemF1: s.f1, misplaced: s.misplaced } };
}

// ------------------------------------------------------------ checklist

export function scoreChecklist(gold: ChecklistFigure, f: ChecklistFigure): PartScore {
  const asItem = (i: ChecklistFigure["items"][number]): ListItem => ({ text: i.text, ...(i.desc ? { desc: i.desc } : {}), refs: [] });
  const map = matchItems(gold.items.map(asItem), f.items.map(asItem));
  let ok = 0;
  for (const [g, m] of map) if (gold.items[g]!.state === f.items[m]!.state) ok++;
  const itemF1 = f1(map.size, gold.items.length, f.items.length);
  const stateAcc = map.size === 0 ? 0 : ok / map.size;
  return { pass: itemF1 >= 0.85 && stateAcc === 1, semantic: itemF1 * stateAcc, fabricated: 0, detail: { itemF1, stateAcc } };
}
