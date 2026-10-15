/**
 * Yui の中間表現（IR）。
 *
 * パーサの出力であり、レンダラー・テキスト化・評価の入力。
 * LLM が書くソースは寛容に受けるが、IR は常にこの形に正規化されている。
 */

export const KINDS = ["bar", "line", "pie", "scatter", "stat", "flow", "stack", "timeline", "steps", "tree"] as const;
export type Kind = (typeof KINDS)[number];

/** 全図に共通する項目。 */
export interface FigureBase {
  kind: Kind;
  /** 見出し。無ければ空文字。 */
  title: string;
  /** 見出しに付いた引用番号（`[1]` → 1）。 */
  refs: number[];
  /** 図の下の注記（`note:`）。 */
  note?: string;
  /**
   * データ参照（`src:`）。Yui 本体は解決しない。
   * ホストが閲覧者の権限で解決する前提の不透明な文字列。
   */
  src?: string;
}

export interface ChartRow {
  label: string;
  /** 列ごとの値。欠損（空・`-`）は null。 */
  values: (number | null)[];
  refs: number[];
}

export interface ChartFigure extends FigureBase {
  /** pie は 1 系列（columns[1]）だけを持ち、値はすべて 0 以上。 */
  kind: "bar" | "line" | "pie";
  /** 列名。columns[0] はラベル列の見出し、columns[1..] が系列名。 */
  columns: string[];
  rows: ChartRow[];
  unit?: string;
  stacked?: boolean;
  horizontal?: boolean;
}

export interface StatItem {
  label: string;
  /** 表示用の文字列（書かれたまま）。 */
  value: string;
  /** value を数値として読めた場合の値。 */
  num?: number;
  /** 補足（3 列目）。 */
  sub?: string;
  refs: number[];
}

export interface StatFigure extends FigureBase {
  kind: "stat";
  items: StatItem[];
}

export type NodeShape = "box" | "decision" | "terminal";

export interface FlowNode {
  id: string;
  label: string;
  shape: NodeShape;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface FlowFigure extends FigureBase {
  kind: "flow";
  direction: "TB" | "LR";
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface StackBox {
  title: string;
  desc?: string;
  children: StackBox[];
  refs: number[];
}

/** 層。boxes が 1 つなら通常の層、複数なら横並び。 */
export interface StackTier {
  boxes: StackBox[];
  /** この層の直前の矢印に付くラベル（`↓ HTTPS`）。 */
  arrowLabel?: string;
}

export interface StackFigure extends FigureBase {
  kind: "stack";
  tiers: StackTier[];
}

/** 散布図の点。 */
export interface ScatterPoint {
  label: string;
  x: number;
  y: number;
  /** 色分けのまとまり（4 列目）。 */
  group?: string;
  refs: number[];
}

export interface ScatterFigure extends FigureBase {
  kind: "scatter";
  /** [ラベル列, X の名前, Y の名前]（4 列目があればまとまりの名前）。 */
  columns: string[];
  points: ScatterPoint[];
}

/** 年表の出来事。 */
export interface TimelineEvent {
  /** 時期（書かれたまま。並べ替えない）。 */
  when: string;
  title: string;
  desc?: string;
  refs: number[];
}

export interface TimelineFigure extends FigureBase {
  kind: "timeline";
  events: TimelineEvent[];
}

/** 手順の 1 段。番号は書かれた順に振る。 */
export interface Step {
  title: string;
  desc?: string;
  refs: number[];
}

export interface StepsFigure extends FigureBase {
  kind: "steps";
  steps: Step[];
}

export interface TreeNode {
  title: string;
  desc?: string;
  children: TreeNode[];
  refs: number[];
}

export interface TreeFigure extends FigureBase {
  kind: "tree";
  /** 最上位の節（複数可）。深さは 4 段まで。 */
  roots: TreeNode[];
}

export type Figure = ChartFigure | ScatterFigure | StatFigure | FlowFigure | StackFigure | TimelineFigure | StepsFigure | TreeFigure;

/** 表形式のデータを持つ図（bar / line / pie）。 */
export function isChart(f: Figure): f is ChartFigure {
  return f.kind === "bar" || f.kind === "line" || f.kind === "pie";
}

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  /** ブロック内の行番号（1 始まり）。ブロック全体に関するものは 0。 */
  line: number;
  severity: Severity;
  code: DiagnosticCode;
  message: string;
}

export type DiagnosticCode =
  | "empty"
  | "unknown_kind"
  | "missing_header"
  | "bad_number"
  | "extra_cells"
  | "unrecognized_line"
  | "unknown_option"
  | "limit_exceeded"
  | "text_too_long"
  | "nested_too_deep";

export interface ParseResult {
  /** 描画できる図。種類が分からない場合のみ null。 */
  figure: Figure | null;
  diagnostics: Diagnostic[];
  /**
   * 未確定の最終行を保留したか（ストリーミング中で、末尾が改行で終わっていない）。
   */
  pending: boolean;
}
