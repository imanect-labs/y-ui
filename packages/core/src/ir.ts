/**
 * Yui の中間表現（IR）。
 *
 * パーサの出力であり、レンダラー・テキスト化・評価の入力。
 * LLM が書くソースは寛容に受けるが、IR は常にこの形に正規化されている。
 */

export const KINDS = ["bar", "line", "pie", "scatter", "stat", "flow", "stack", "timeline", "steps", "tree", "cards", "progress", "funnel", "quadrant", "gantt", "calc", "compare", "proscons", "swot", "checklist", "app"] as const;
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

/** 要点・特徴・選択肢のカード。 */
export interface Card {
  title: string;
  /** 大きく出す値（`Starter | ¥4,800 | 月額相当` の 2 列目が数値のとき）。 */
  value?: string;
  /** 本文。段落は改行で区切る。 */
  body?: string;
  /** 字下げした箇条書き（チェックリストとして描く）。 */
  items?: string[];
  refs: number[];
}

export interface CardsFigure extends FigureBase {
  kind: "cards";
  cards: Card[];
}

/** 目標に対する進捗の 1 行。 */
export interface ProgressItem {
  label: string;
  /** 実績（数値）と、書かれたままの表記。 */
  value: number;
  valueText: string;
  /** 目標。書かれていなければ、実績が % なら 100。 */
  target: number;
  targetText: string;
  refs: number[];
}

export interface ProgressFigure extends FigureBase {
  kind: "progress";
  items: ProgressItem[];
}

/** 段階ごとの数（営業・採用の歩留まり）。 */
export interface FunnelStage {
  label: string;
  value: number;
  refs: number[];
}

export interface FunnelFigure extends FigureBase {
  kind: "funnel";
  stages: FunnelStage[];
  unit?: string;
}

/** 2 軸の位置づけ（2×2）の項目。x・y は 0〜100。 */
export interface QuadrantItem {
  label: string;
  x: number;
  y: number;
  refs: number[];
}

export interface QuadrantFigure extends FigureBase {
  kind: "quadrant";
  /** 軸の名前（`x: 効果`）。 */
  xLabel: string;
  yLabel: string;
  /** 象限の名前（右上・左上・左下・右下の順。無ければ空文字）。 */
  quadrants: [string, string, string, string];
  items: QuadrantItem[];
}

/** 工程表のタスク。日付は 1970-01-01 からの日数（年の書かれていない日付は仮の年で数える）。 */
export interface GanttTask {
  label: string;
  start: number;
  end: number;
  /** 書かれたままの開始・終了。 */
  startText: string;
  endText: string;
  /** 終了が無い 1 日だけのもの（マイルストーン）。 */
  milestone?: boolean;
  refs: number[];
}

export interface GanttFigure extends FigureBase {
  kind: "gantt";
  tasks: GanttTask[];
  /** どの日付にも年が書かれていない（目盛りに年を出さない）。 */
  noYear: boolean;
}

/** calc の入力（スライダー・数の増減・選択・オンオフ）。 */
export interface CalcInput {
  type: "input";
  name: string;
  control: "slider" | "count" | "choice" | "toggle";
  min: number;
  max: number;
  step: number;
  initial: number;
  /** choice の選択肢（表示名と値）。 */
  options?: { label: string; value: number }[];
  unit?: string;
}

/** calc の式。expr は構文木（calc/expr.ts の Expr）。 */
export interface CalcFormula {
  type: "formula";
  name: string;
  /** 正規形の式（名前のまま）。 */
  source: string;
  expr: import("./calc/expr.js").Expr;
  unit?: string;
  /** 表示の小数桁（既定 0。値が 1 未満なら有効数字 2 桁）。 */
  round?: number;
}

export interface CalcFigure extends FigureBase {
  kind: "calc";
  /** 書かれた順の定義（式は前の名前だけを参照する）。 */
  defs: (CalcInput | CalcFormula)[];
  /** 大きく出す結果（無ければ最後の式）。 */
  show: string[];
  /** 内訳に出さない式。 */
  hide: string[];
}

/** 箇条書きの 1 項目（proscons・swot）。 */
export interface ListItem {
  text: string;
  /** `項目: 補足` の補足と、字下げした続き（段落は改行で区切る）。 */
  desc?: string;
  refs: number[];
}

/** 比較表のセル。✓・✗・△ は mark に、残りの文字は text に持つ。 */
export interface CompareCell {
  mark?: "yes" | "no" | "partial";
  text: string;
}

export interface CompareRow {
  label: string;
  /** 選択肢ごとのセル（columns.length - 1 個）。 */
  cells: CompareCell[];
  refs: number[];
}

export interface CompareFigure extends FigureBase {
  kind: "compare";
  /** 見出し行。columns[0] は項目の列の見出し、columns[1..] が比べる選択肢。 */
  columns: string[];
  rows: CompareRow[];
  /** 強調する選択肢（`推奨: Pro`）。columns の添字（1 以上）。 */
  highlight?: number;
}

export interface ProsConsFigure extends FigureBase {
  kind: "proscons";
  pros: ListItem[];
  cons: ListItem[];
  /** 見出しの書かれたままの名前（`良い点:`）。無ければ空文字（ロケールの既定を使う）。 */
  labels: [string, string];
}

export interface SwotFigure extends FigureBase {
  kind: "swot";
  /** 強み・弱み・機会・脅威の順。 */
  sections: [ListItem[], ListItem[], ListItem[], ListItem[]];
  /** 見出しの書かれたままの名前。無ければ空文字。 */
  labels: [string, string, string, string];
}

export interface ChecklistItem {
  text: string;
  desc?: string;
  /** 済・未・進行中。 */
  state: "done" | "todo" | "doing";
  refs: number[];
}

export interface ChecklistFigure extends FigureBase {
  kind: "checklist";
  items: ChecklistItem[];
}

/** app の入力部品。key は実行先に渡す名前（`as キー`、無ければラベル）。 */
export interface AppField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "slider" | "count" | "choice" | "date" | "month" | "toggle";
  required: boolean;
  /** 入力の例（`例 …`）。 */
  placeholder?: string;
  initial?: string | number | boolean | string[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** choice の選択肢（表示名と値）。 */
  options?: { label: string; value: string }[];
  /** choice の複数選択。 */
  multi?: boolean;
}

/** app のボタン。id はソースの順の `a1`・`a2`…（ホストはこれを束縛の id にする）。 */
export interface AppAction {
  id: string;
  label: string;
  target: { kind: "workflow"; name: string } | { kind: "chat" };
  /** 押した後に確認を挟むか（workflow は既定で挟む）。 */
  confirm: boolean;
}

/** 機能（入力のまとまりとボタン）。ボタンはその機能の入力値だけを送る。 */
export interface AppSection {
  title?: string;
  desc?: string;
  fields: AppField[];
  actions: AppAction[];
}

export interface AppFigure extends FigureBase {
  kind: "app";
  sections: AppSection[];
}

export type Figure =
  | ChartFigure
  | ScatterFigure
  | StatFigure
  | FlowFigure
  | StackFigure
  | TimelineFigure
  | StepsFigure
  | TreeFigure
  | CardsFigure
  | ProgressFigure
  | FunnelFigure
  | QuadrantFigure
  | GanttFigure
  | CalcFigure
  | CompareFigure
  | ProsConsFigure
  | SwotFigure
  | ChecklistFigure
  | AppFigure;

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
