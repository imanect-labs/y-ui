import type { Figure, Kind } from "@miniui/core";

export const CATEGORIES = [
  "bar",
  "line",
  "stat",
  "flow",
  "stack",
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
}
