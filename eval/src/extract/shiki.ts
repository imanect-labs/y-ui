/**
 * 方式 A / A′: Shiki の現行 GenUI（`emit_ui` ツール ＋ JSON の UiSpecDoc）。
 *
 * - 検証: Shiki の `validate_spec`（crates/gui）の主な規則を近似する。環境変数 SHIKI_VALIDATE_CMD に
 *   本物の検証コマンドを指定すれば、そちらを使う（標準入力に spec JSON、標準出力に {"ok":bool,"errors":[...]}）。
 * - 変換: 採点のため、表示系のコンポーネント（chart / stat / key_value / table / stepper / timeline）を
 *   Yui の中間表現に写す。Shiki のカタログに無い構成図（stack）は写さない。
 */

import { execFileSync } from "node:child_process";
import { parseNumber, type ChartFigure, type Figure, type FlowFigure, type StatFigure, type StatItem } from "@imanect/yui";
import type { Extraction } from "../score.js";

type J = unknown;
const isObj = (x: J): x is Record<string, J> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: J): x is string => typeof x === "string";
const isNum = (x: J): x is number => typeof x === "number" && Number.isFinite(x);

export const COMPONENTS = [
  "container", "text", "link", "form", "button", "table", "chart", "stat", "callout", "accordion", "tabs", "stepper",
  "badge_list", "key_value", "code_block", "question_card", "plan_card", "source_card", "itinerary", "weather",
  "comparison", "timeline", "map",
];
const CHART_KINDS = ["bar", "line", "area", "pie", "donut", "scatter", "radar", "radial_bar", "combo", "funnel", "treemap"];

/** コンポーネントごとに許されるキー（deny_unknown_fields の近似）。検証しないものは undefined。 */
const ALLOWED_KEYS: Record<string, string[]> = {
  container: ["component", "title", "layout", "children"],
  text: ["component", "text", "variant"],
  chart: ["component", "kind", "data", "title", "x_label", "y_label", "stacked", "line_series"],
  stat: ["component", "label", "value", "unit", "delta", "delta_label", "trend", "caption"],
  table: ["component", "title", "columns", "rows"],
  key_value: ["component", "title", "items"],
  stepper: ["component", "steps"],
  timeline: ["component", "title", "events"],
  callout: ["component", "tone", "title", "text"],
};

export function approxValidate(spec: J): string[] {
  const errs: string[] = [];
  if (!isObj(spec)) return ["spec がオブジェクトではありません"];
  for (const k of Object.keys(spec)) if (!["version", "actions", "root"].includes(k)) errs.push(`gui.unknown_prop: ${k}`);
  if (spec.version !== 1) errs.push("gui.schema_violation: version は 1");
  if (spec.actions !== undefined && !Array.isArray(spec.actions)) errs.push("gui.schema_violation: actions は配列");
  if (!isObj(spec.root)) {
    errs.push("gui.schema_violation: root がありません");
    return errs;
  }
  let nodes = 0;
  const walk = (n: J, path: string, depth: number) => {
    nodes++;
    if (depth > 8) errs.push(`gui.limit: ${path} の深さが 8 を超えます`);
    if (!isObj(n)) return errs.push(`gui.schema_violation: ${path} がオブジェクトではありません`);
    const c = n.component;
    if (!isStr(c) || !COMPONENTS.includes(c)) return errs.push(`gui.unknown_component: ${path}.component=${JSON.stringify(c)}`);
    const allowed = ALLOWED_KEYS[c];
    if (allowed) for (const k of Object.keys(n)) if (!allowed.includes(k)) errs.push(`gui.unknown_prop: ${path}.${k}`);
    switch (c) {
      case "container":
        if (!Array.isArray(n.children)) errs.push(`gui.schema_violation: ${path}.children は配列`);
        else n.children.forEach((ch, i) => walk(ch, `${path}.children[${i}]`, depth + 1));
        break;
      case "chart":
        if (!isStr(n.kind) || !CHART_KINDS.includes(n.kind)) errs.push(`gui.schema_violation: ${path}.kind`);
        if (!Array.isArray(n.data)) errs.push(`gui.schema_violation: ${path}.data は配列`);
        else
          n.data.forEach((p, i) => {
            if (!isObj(p)) return errs.push(`gui.schema_violation: ${path}.data[${i}]`);
            for (const k of Object.keys(p)) if (!["x", "y", "series", "xv"].includes(k)) errs.push(`gui.unknown_prop: ${path}.data[${i}].${k}`);
            if (!isStr(p.x)) errs.push(`gui.schema_violation: ${path}.data[${i}].x は文字列`);
            if (!isNum(p.y)) errs.push(`gui.schema_violation: ${path}.data[${i}].y は数値`);
            if (p.series !== undefined && p.series !== null && !isStr(p.series)) errs.push(`gui.schema_violation: ${path}.data[${i}].series は文字列`);
          });
        break;
      case "stat":
        if (!isStr(n.label)) errs.push(`gui.schema_violation: ${path}.label は文字列`);
        if (!isStr(n.value)) errs.push(`gui.schema_violation: ${path}.value は文字列`);
        if (n.delta !== undefined && n.delta !== null && !isNum(n.delta)) errs.push(`gui.schema_violation: ${path}.delta は数値`);
        break;
      case "table":
        if (!Array.isArray(n.columns) || !n.columns.every((col) => isObj(col) && isStr(col.label))) errs.push(`gui.schema_violation: ${path}.columns は [{label}]`);
        if (!Array.isArray(n.rows) || !n.rows.every((r) => Array.isArray(r))) errs.push(`gui.schema_violation: ${path}.rows は配列の配列`);
        break;
      case "key_value":
        if (!Array.isArray(n.items) || !n.items.every((it) => isObj(it) && isStr(it.key) && isStr(it.value))) errs.push(`gui.schema_violation: ${path}.items は [{key,value}]`);
        break;
      case "stepper":
        if (!Array.isArray(n.steps) || !n.steps.every((s) => isObj(s) && isStr(s.title))) errs.push(`gui.schema_violation: ${path}.steps は [{title}]`);
        break;
      case "timeline":
        if (!Array.isArray(n.events) || !n.events.every((s) => isObj(s) && isStr(s.title))) errs.push(`gui.schema_violation: ${path}.events は [{title}]`);
        break;
    }
    return undefined;
  };
  walk(spec.root, "root", 1);
  if (nodes > 200) errs.push("gui.limit: ノード数が 200 を超えます");
  return errs;
}

export function validate(spec: J): string[] {
  const cmd = process.env.SHIKI_VALIDATE_CMD;
  if (!cmd) return approxValidate(spec);
  const out = execFileSync("sh", ["-c", cmd], { input: JSON.stringify(spec), encoding: "utf8" });
  const r = JSON.parse(out) as { ok: boolean; errors?: string[] };
  return r.ok ? [] : (r.errors ?? ["invalid"]);
}

/** 写した図に、元の Shiki のチャート種類が bar/line 相当でないことを示す印。 */
export type MaybeIncompatible = Figure & { incompatible?: boolean };

function chartFigure(n: Record<string, J>): MaybeIncompatible {
  const kind = isStr(n.kind) ? n.kind : "bar";
  const points = Array.isArray(n.data) ? n.data.filter(isObj) : [];
  const series: string[] = [];
  const xs: string[] = [];
  const cell = new Map<string, number>();
  for (const p of points) {
    const s = isStr(p.series) ? p.series : "値";
    const x = isStr(p.x) ? p.x : String(p.x);
    if (!series.includes(s)) series.push(s);
    if (!xs.includes(x)) xs.push(x);
    if (isNum(p.y)) cell.set(`${x}\u0000${s}`, p.y);
  }
  const f: ChartFigure & { incompatible?: boolean } = {
    kind: kind === "line" || kind === "area" ? "line" : "bar",
    title: isStr(n.title) ? n.title : "",
    refs: [],
    columns: [isStr(n.x_label) ? n.x_label : "項目", ...series],
    rows: xs.map((x) => ({ label: x, values: series.map((s) => cell.get(`${x}\u0000${s}`) ?? null), refs: [] })),
  };
  if (!["bar", "line", "area", "combo"].includes(kind)) f.incompatible = true;
  return f;
}

function statItem(n: Record<string, J>): StatItem {
  const value = `${isStr(n.value) ? n.value : String(n.value ?? "")}${isStr(n.unit) ? n.unit : ""}`;
  const item: StatItem = { label: isStr(n.label) ? n.label : "", value, refs: [] };
  const num = parseNumber(value);
  if (num) item.num = num.value;
  // delta は数値（前年比などの増減）。表示上は delta_label と並ぶので、補足として持たせる。
  const delta = isNum(n.delta) ? `${n.delta >= 0 ? "+" : ""}${n.delta}` : undefined;
  const sub = [isStr(n.delta_label) ? n.delta_label : undefined, delta, isStr(n.caption) ? n.caption : undefined].filter((x): x is string => x !== undefined).join(" ");
  if (sub) item.sub = sub;
  return item;
}

function chain(title: string, steps: string[]): FlowFigure {
  const nodes = steps.map((label, i) => ({ id: `n${i + 1}`, label, shape: "box" as const }));
  return { kind: "flow", title, refs: [], direction: "TB", nodes, edges: nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id })) };
}

export function specToFigures(spec: J): MaybeIncompatible[] {
  const figures: MaybeIncompatible[] = [];
  const stats: StatItem[] = [];
  let statTitle = "";
  const walk = (n: J, containerTitle: string) => {
    if (!isObj(n)) return;
    switch (n.component) {
      case "container":
        if (Array.isArray(n.children)) n.children.forEach((c) => walk(c, isStr(n.title) ? n.title : containerTitle));
        break;
      case "chart":
        figures.push(chartFigure(n));
        break;
      case "stat":
        statTitle ||= containerTitle;
        stats.push(statItem(n));
        break;
      case "key_value":
        if (Array.isArray(n.items)) {
          const f: StatFigure = { kind: "stat", title: isStr(n.title) ? n.title : containerTitle, refs: [], items: [] };
          for (const it of n.items.filter(isObj)) f.items.push(statItem({ label: it.key, value: it.value }));
          figures.push(f);
        }
        break;
      case "table": {
        // 表はグラフではない（種類違い）。数値の捏造の検出のためだけに写す。
        const cols = Array.isArray(n.columns) ? n.columns.filter(isObj).map((c) => (isStr(c.label) ? c.label : "")) : [];
        const rows = Array.isArray(n.rows) ? n.rows.filter(Array.isArray) : [];
        const f: ChartFigure & { incompatible?: boolean } = {
          kind: "bar",
          title: isStr(n.title) ? n.title : containerTitle,
          refs: [],
          columns: cols,
          rows: rows.map((r) => ({
            label: String(r[0] ?? ""),
            values: r.slice(1).map((v) => (isNum(v) ? v : isStr(v) ? (parseNumber(v)?.value ?? null) : null)),
            refs: [],
          })),
          incompatible: true,
        };
        figures.push(f);
        break;
      }
      case "stepper":
        if (Array.isArray(n.steps)) figures.push(chain(containerTitle, n.steps.filter(isObj).map((s) => String(s.title ?? ""))));
        break;
      case "timeline":
        if (Array.isArray(n.events)) figures.push(chain(isStr(n.title) ? n.title : containerTitle, n.events.filter(isObj).map((s) => String(s.title ?? ""))));
        break;
    }
  };
  if (isObj(spec)) walk(spec.root, "");
  if (stats.length > 0) figures.unshift({ kind: "stat", title: statTitle, refs: [], items: stats });
  return figures;
}

export interface ToolCall {
  name: string;
  arguments: string;
}

/**
 * ツール呼び出しから図を取り出す。複数回呼んだ場合は、検証を通った最後の呼び出しを採る
 * （Shiki では検証を通ったものだけが表示される）。
 */
export function extractShiki(calls: ToolCall[]): Extraction & { validationErrors: string[][] } {
  const ui = calls.filter((c) => c.name === "emit_ui");
  const validationErrors: string[][] = [];
  let figures: Figure[] = [];
  let anyValid = false;
  for (const c of ui) {
    let args: J;
    try {
      args = JSON.parse(c.arguments || "{}");
    } catch (e) {
      validationErrors.push([`tool arguments の JSON が壊れています: ${(e as Error).message}`]);
      continue;
    }
    const spec = isObj(args) ? args.spec : undefined;
    const errs = spec === undefined ? ["spec がありません"] : validate(spec);
    validationErrors.push(errs);
    if (errs.length === 0) {
      anyValid = true;
      figures = specToFigures(spec);
    }
  }
  return {
    figures,
    attempted: ui.length > 0,
    syntaxOk: ui.length === 0 || anyValid,
    errors: validationErrors.flat(),
    warnings: 0,
    validationErrors,
  };
}
