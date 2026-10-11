/**
 * 方式 D: 短く詰めた JSON を ` ```uijson ` ブロックに書かせる。
 * 「JSON か独自記法か」を「ツールで出すか本文で出すか」と切り分けるための比較対象。
 *
 * 形（prompts/jsonui.md と一致させる）:
 *   {"t":"bar"|"line","title":"…","cols":["月","売上"],"rows":[["1月",120]],"unit":"万円"}
 *   {"t":"stat","title":"…","items":[["売上","320万円","前年比 +18%"]]}
 *   {"t":"flow","title":"…","edges":[["A","B"],["B","C","はい"]]}
 *   {"t":"stack","title":"…","layers":[{"name":"API","desc":"…","items":["認証"]},{"row":[{"name":"DB"},{"name":"Cache"}]}]}
 */

import { parseCell, parseNumber, splitMarkdown, type Figure, type StackBox, type StackTier } from "@y-ui/core";
import type { Extraction } from "../score.js";

type Json = unknown;

const isStr = (x: Json): x is string => typeof x === "string";
const isArr = Array.isArray;
const isObj = (x: Json): x is Record<string, Json> => typeof x === "object" && x !== null && !Array.isArray(x);

class ShapeError extends Error {}

function str(x: Json, what: string): string {
  if (isStr(x)) return x;
  if (typeof x === "number") return String(x);
  throw new ShapeError(`${what} が文字列ではありません`);
}

function value(x: Json): number | null {
  if (x === null) return null;
  if (typeof x === "number") return x;
  if (isStr(x)) {
    const c = parseCell(x);
    if (c.kind === "number") return c.value;
    if (c.kind === "missing") return null;
  }
  throw new ShapeError(`値 ${JSON.stringify(x)} が数値ではありません`);
}

export function toFigure(j: Json): Figure {
  if (!isObj(j)) throw new ShapeError("オブジェクトではありません");
  const t = j.t;
  const title = isStr(j.title) ? j.title : "";
  switch (t) {
    case "bar":
    case "line": {
      if (!isArr(j.cols) || !isArr(j.rows)) throw new ShapeError("cols / rows がありません");
      const columns = j.cols.map((c, i) => str(c, `cols[${i}]`));
      const rows = j.rows.map((r, i) => {
        if (!isArr(r) || r.length === 0) throw new ShapeError(`rows[${i}] が配列ではありません`);
        return { label: str(r[0], `rows[${i}][0]`), values: r.slice(1).map(value), refs: [] };
      });
      const f: Figure = { kind: t, title, refs: [], columns, rows };
      if (isStr(j.unit)) f.unit = j.unit;
      return f;
    }
    case "stat": {
      if (!isArr(j.items)) throw new ShapeError("items がありません");
      return {
        kind: "stat",
        title,
        refs: [],
        items: j.items.map((it, i) => {
          if (!isArr(it) || it.length < 2) throw new ShapeError(`items[${i}] は [項目, 値] の配列です`);
          const v = str(it[1], `items[${i}][1]`);
          const out: { label: string; value: string; num?: number; sub?: string; refs: number[] } = { label: str(it[0], `items[${i}][0]`), value: v, refs: [] };
          const n = parseNumber(v);
          if (n) out.num = n.value;
          if (it.length > 2 && it[2] !== null) out.sub = str(it[2], `items[${i}][2]`);
          return out;
        }),
      };
    }
    case "flow": {
      if (!isArr(j.edges)) throw new ShapeError("edges がありません");
      const ids = new Map<string, string>();
      const nodes: { id: string; label: string; shape: "box" }[] = [];
      const id = (label: string) => {
        let v = ids.get(label);
        if (!v) {
          v = `n${nodes.length + 1}`;
          ids.set(label, v);
          nodes.push({ id: v, label, shape: "box" });
        }
        return v;
      };
      const edges = j.edges.map((e, i) => {
        if (!isArr(e) || e.length < 2) throw new ShapeError(`edges[${i}] は [元, 先, ラベル?] の配列です`);
        const edge: { from: string; to: string; label?: string } = { from: id(str(e[0], "from")), to: id(str(e[1], "to")) };
        if (e.length > 2 && e[2] !== null && e[2] !== "") edge.label = str(e[2], "label");
        return edge;
      });
      return { kind: "flow", title, refs: [], direction: "TB", nodes, edges };
    }
    case "stack": {
      if (!isArr(j.layers)) throw new ShapeError("layers がありません");
      const box = (b: Json, what: string): StackBox => {
        if (isStr(b)) return { title: b, children: [], refs: [] };
        if (!isObj(b)) throw new ShapeError(`${what} がオブジェクトではありません`);
        const out: StackBox = { title: str(b.name, `${what}.name`), children: [], refs: [] };
        if (isStr(b.desc) && b.desc !== "") out.desc = b.desc;
        if (b.items !== undefined) {
          if (!isArr(b.items)) throw new ShapeError(`${what}.items が配列ではありません`);
          out.children = b.items.map((c, i) => box(c, `${what}.items[${i}]`));
        }
        return out;
      };
      const tiers: StackTier[] = j.layers.map((l, i) => {
        if (isObj(l) && isArr(l.row)) return { boxes: l.row.map((b, k) => box(b, `layers[${i}].row[${k}]`)) };
        return { boxes: [box(l, `layers[${i}]`)] };
      });
      return { kind: "stack", title, refs: [], tiers };
    }
    default:
      throw new ShapeError(`t=${JSON.stringify(t)} は対応していない種類です`);
  }
}

export function extractJsonui(text: string): Extraction {
  const figures: Figure[] = [];
  const errors: string[] = [];
  let attempted = false;
  let syntaxOk = true;
  for (const seg of splitMarkdown(text)) {
    if (seg.type === "ui") continue;
    // splitMarkdown は ui 以外のフェンスを markdown として返すので、ここで uijson を探す。
    for (const m of seg.text.matchAll(/^ {0,3}(`{3,}|~{3,})\s*uijson\s*\n([\s\S]*?)\n {0,3}\1\s*$/gm)) {
      attempted = true;
      try {
        figures.push(toFigure(JSON.parse(m[2]!)));
      } catch (e) {
        syntaxOk = false;
        errors.push(e instanceof SyntaxError ? `JSON: ${e.message}` : String((e as Error).message));
      }
    }
  }
  return { figures, attempted, syntaxOk, errors, warnings: 0 };
}
