import type { Figure, Kind } from "@imanect/yui";

export const CATEGORIES = [
  "bar",
  "line",
  "pie",
  "stat",
  "flow",
  "stack",
  "scatter",
  "timeline",
  "steps",
  "tree",
  "cards",
  "progress",
  "funnel",
  "quadrant",
  "gantt",
  "calc",
  "compare",
  "proscons",
  "swot",
  "checklist",
  "app",
  "ask",
  "plan",
  "radar",
  "treemap",
  "callout",
  "map",
  "long",
  "jpnum",
  "none-unneeded",
  "none-nodata",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface EvalTask {
  id: string;
  category: Category;
  /** 利用者の質問（user メッセージの末尾）。 */
  question: string;
  /** 参考資料（RAG の検索結果を想定）。 */
  context: string;
  expect: "figure" | "none";
  /** 正解として認める図の種類。 */
  acceptKinds: Kind[];
  /** 正解の中間表現。expect=none では無い。 */
  gold?: Figure;
  /** 別の種類で描いた場合の正解（構成図の課題を流れ図で描いてもよい場合など）。acceptKinds にその種類があること。 */
  altGolds?: Figure[];
  /** calc の課題: 入力の値（正解の名前）と、期待する結果。 */
  calcChecks?: { inputs: Record<string, number>; expect: Record<string, number> }[];
}
