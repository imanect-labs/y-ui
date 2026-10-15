/** ` ```ui ` ブロック 1 つ分のソースを IR にする。 */

import type { Figure, Kind, ParseResult } from "./ir.js";
import { Diagnostics, type Line, takeRefs } from "./lines.js";
import { parseChart } from "./kinds/chart.js";
import { parseFlow } from "./kinds/flow.js";
import { parsePie } from "./kinds/pie.js";
import { parseScatter } from "./kinds/scatter.js";
import { parseSteps, parseTimeline } from "./kinds/seq.js";
import { parseTree } from "./kinds/tree.js";
import { parseCards, parseFunnel, parseProgress } from "./kinds/v08.js";
import { parseGantt, parseQuadrant } from "./kinds/v08b.js";
import { parseCalc } from "./kinds/calc.js";
import { parseApp } from "./kinds/app.js";
import { parseAsk, parsePlan } from "./kinds/ask.js";
import { parseCallout, parseMap } from "./kinds/callout.js";
import { parseRadar, parseTreemap } from "./kinds/chart2.js";
import { parseChecklist, parseCompare, parseProsCons, parseSwot } from "./kinds/v09.js";
import { parseStack } from "./kinds/stack.js";
import { parseStat } from "./kinds/stat.js";

/** 種類の名前と別名。モデルが書きがちな表記を受ける。 */
export const KIND_ALIASES: Readonly<Record<string, Kind>> = {
  bar: "bar",
  bars: "bar",
  column: "bar",
  棒: "bar",
  棒グラフ: "bar",
  line: "line",
  折れ線: "line",
  折れ線グラフ: "line",
  pie: "pie",
  donut: "pie",
  円: "pie",
  円グラフ: "pie",
  ドーナツ: "pie",
  scatter: "scatter",
  散布図: "scatter",
  timeline: "timeline",
  年表: "timeline",
  沿革: "timeline",
  タイムライン: "timeline",
  steps: "steps",
  step: "steps",
  手順: "steps",
  ステップ: "steps",
  tree: "tree",
  ツリー: "tree",
  階層: "tree",
  組織図: "tree",
  cards: "cards",
  card: "cards",
  カード: "cards",
  要点: "cards",
  progress: "progress",
  進捗: "progress",
  達成率: "progress",
  funnel: "funnel",
  ファネル: "funnel",
  歩留まり: "funnel",
  quadrant: "quadrant",
  matrix: "quadrant",
  "4象限": "quadrant",
  四象限: "quadrant",
  マトリクス: "quadrant",
  gantt: "gantt",
  ガント: "gantt",
  ガントチャート: "gantt",
  工程表: "gantt",
  calc: "calc",
  計算: "calc",
  試算: "calc",
  calculator: "calc",
  compare: "compare",
  comparison: "compare",
  比較: "compare",
  比較表: "compare",
  proscons: "proscons",
  "pros-cons": "proscons",
  pros_cons: "proscons",
  メリット・デメリット: "proscons",
  メリットデメリット: "proscons",
  長所短所: "proscons",
  swot: "swot",
  checklist: "checklist",
  check: "checklist",
  todo: "checklist",
  チェックリスト: "checklist",
  確認事項: "checklist",
  app: "app",
  form: "app",
  アプリ: "app",
  フォーム: "app",
  ask: "ask",
  question: "ask",
  questions: "ask",
  質問: "ask",
  確認: "ask",
  plan: "plan",
  計画: "plan",
  radar: "radar",
  レーダー: "radar",
  レーダーチャート: "radar",
  treemap: "treemap",
  ツリーマップ: "treemap",
  callout: "callout",
  alert: "callout",
  注意書き: "callout",
  map: "map",
  地図: "map",
  マップ: "map",
  stat: "stat",
  stats: "stat",
  kpi: "stat",
  flow: "flow",
  flowchart: "flow",
  フロー: "flow",
  stack: "stack",
  layers: "stack",
  arch: "stack",
  構成: "stack",
  構成図: "stack",
};

export function resolveKind(token: string): Kind | undefined {
  return KIND_ALIASES[token.normalize("NFKC").toLowerCase()];
}

export interface ParseOptions {
  /**
   * ブロックが確定しているか（閉じフェンスを受け取った、またはストリームが終わった）。
   * false の場合、改行で終わっていない最終行は未確定として読まない。
   */
  final?: boolean;
  /** フェンスの情報文字列で種類が指定されている場合（` ```ui bar `）。 */
  kind?: Kind;
}

const HEADER = /^\s*([^\s|:：]+)\s*(?:[|:：]\s*)?(.*)$/;

export function parseBlock(source: string, opts: ParseOptions = {}): ParseResult {
  const diags = new Diagnostics();
  let text = source;
  let pending = false;
  if (!opts.final && !text.endsWith("\n")) {
    const cut = text.lastIndexOf("\n");
    pending = text.length > 0;
    text = cut >= 0 ? text.slice(0, cut + 1) : "";
  }

  const lines: Line[] = text
    .split(/\r?\n/)
    .map((t, i) => ({ no: i + 1, text: t }))
    .filter((l) => l.text.trim() !== "");

  let kind = opts.kind;
  let title = "";
  let body = lines;

  const first = lines[0];
  if (first) {
    const m = HEADER.exec(first.text);
    const headerKind = m ? resolveKind(m[1]!) : undefined;
    if (headerKind && (!kind || kind === headerKind)) {
      kind = headerKind;
      title = m![2]!.trim();
      body = lines.slice(1);
    } else if (kind && isTitleLine(first.text)) {
      title = first.text.trim();
      body = lines.slice(1);
    } else if (!kind) {
      diags.add(first.no, "error", "unknown_kind", `図の種類が分かりません: ${m?.[1] ?? first.text.trim()}（bar / line / pie / scatter / stat / flow / stack / timeline / steps / tree / cards / progress / funnel / quadrant / gantt / calc / compare / proscons / swot / checklist / app / ask / plan / radar / treemap / callout / map）`);
      return { figure: null, diagnostics: diags.list, pending };
    }
  }

  if (!kind) {
    if (opts.final) diags.add(0, "error", "empty", "ブロックが空です");
    return { figure: null, diagnostics: diags.list, pending };
  }

  const t = takeRefs(title.replace(/^#+\s*/, ""));
  const figure = emptyFigure(kind, t.text, t.refs);
  switch (figure.kind) {
    case "bar":
    case "line":
      parseChart(figure, body, diags);
      break;
    case "pie":
      parsePie(figure, body, diags);
      break;
    case "stat":
      parseStat(figure, body, diags);
      break;
    case "flow":
      parseFlow(figure, body, diags);
      break;
    case "stack":
      parseStack(figure, body, diags);
      break;
    case "scatter":
      parseScatter(figure, body, diags);
      break;
    case "timeline":
      parseTimeline(figure, body, diags);
      break;
    case "steps":
      parseSteps(figure, body, diags);
      break;
    case "tree":
      parseTree(figure, body, diags);
      break;
    case "cards":
      parseCards(figure, body, diags);
      break;
    case "progress":
      parseProgress(figure, body, diags);
      break;
    case "funnel":
      parseFunnel(figure, body, diags);
      break;
    case "quadrant":
      parseQuadrant(figure, body, diags);
      break;
    case "gantt":
      parseGantt(figure, body, diags);
      break;
    case "calc":
      parseCalc(figure, body, diags);
      break;
    case "compare":
      parseCompare(figure, body, diags);
      break;
    case "proscons":
      parseProsCons(figure, body, diags);
      break;
    case "swot":
      parseSwot(figure, body, diags);
      break;
    case "checklist":
      parseChecklist(figure, body, diags);
      break;
    case "app":
      parseApp(figure, body, diags);
      break;
    case "ask":
      parseAsk(figure, body, diags);
      break;
    case "plan":
      parsePlan(figure, body, diags);
      break;
    case "radar":
      parseRadar(figure, body, diags);
      break;
    case "treemap":
      parseTreemap(figure, body, diags);
      break;
    case "callout":
      parseCallout(figure, body, diags);
      break;
    case "map":
      parseMap(figure, body, diags);
      break;
  }

  if (opts.final && isEmpty(figure)) {
    diags.add(0, "error", "empty", "表示できるデータがありません");
  }
  return { figure, diagnostics: diags.list, pending };
}

/** 種類が別に分かっているとき、先頭行が見出しだけの行か。 */
function isTitleLine(text: string): boolean {
  return !/[|\t]|->|→|^\s*[-*+]\s/.test(text);
}

function emptyFigure(kind: Kind, title: string, refs: number[]): Figure {
  switch (kind) {
    case "bar":
    case "line":
    case "pie":
    case "radar":
    case "treemap":
      return { kind, title, refs, columns: [], rows: [] };
    case "callout":
      return { kind, title, refs, tone: "info", body: "", items: [] };
    case "map":
      return { kind, title, refs, markers: [] };
    case "stat":
      return { kind, title, refs, items: [] };
    case "flow":
      return { kind, title, refs, direction: "TB", nodes: [], edges: [] };
    case "stack":
      return { kind, title, refs, tiers: [] };
    case "scatter":
      return { kind, title, refs, columns: [], points: [] };
    case "timeline":
      return { kind, title, refs, events: [] };
    case "steps":
      return { kind, title, refs, steps: [] };
    case "tree":
      return { kind, title, refs, roots: [] };
    case "cards":
      return { kind, title, refs, cards: [] };
    case "progress":
      return { kind, title, refs, items: [] };
    case "funnel":
      return { kind, title, refs, stages: [] };
    case "quadrant":
      return { kind, title, refs, xLabel: "", yLabel: "", quadrants: ["", "", "", ""], items: [] };
    case "gantt":
      return { kind, title, refs, tasks: [], noYear: true };
    case "calc":
      return { kind, title, refs, defs: [], show: [], hide: [] };
    case "compare":
      return { kind, title, refs, columns: [], rows: [] };
    case "proscons":
      return { kind, title, refs, pros: [], cons: [], labels: ["", ""] };
    case "swot":
      return { kind, title, refs, sections: [[], [], [], []], labels: ["", "", "", ""] };
    case "checklist":
      return { kind, title, refs, items: [] };
    case "app":
      return { kind, title, refs, sections: [] };
    case "ask":
      return { kind, title, refs, questions: [] };
    case "plan":
      return { kind, title, refs, steps: [], revise: true };
  }
}

export function isEmpty(f: Figure): boolean {
  switch (f.kind) {
    case "bar":
    case "line":
    case "pie":
    case "radar":
    case "treemap":
      return f.rows.length === 0;
    case "stat":
      return f.items.length === 0;
    case "flow":
      return f.nodes.length === 0;
    case "stack":
      return f.tiers.length === 0;
    case "scatter":
      return f.points.length === 0;
    case "timeline":
      return f.events.length === 0;
    case "steps":
      return f.steps.length === 0;
    case "tree":
      return f.roots.length === 0;
    case "cards":
      return f.cards.length === 0;
    case "progress":
      return f.items.length === 0;
    case "funnel":
      return f.stages.length === 0;
    case "quadrant":
      return f.items.length === 0;
    case "gantt":
      return f.tasks.length === 0;
    case "calc":
      return !f.defs.some((d) => d.type === "formula");
    case "compare":
      return f.rows.length === 0;
    case "proscons":
      return f.pros.length + f.cons.length === 0;
    case "swot":
      return f.sections.every((s) => s.length === 0);
    case "checklist":
      return f.items.length === 0;
    case "app":
      return f.sections.length === 0;
    case "ask":
      return f.questions.length === 0;
    case "plan":
      return f.steps.length === 0;
    case "callout":
      return f.body === "" && f.items.length === 0;
    case "map":
      return f.markers.length === 0;
  }
}
