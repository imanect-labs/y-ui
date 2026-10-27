/**
 * 種類ごとの用途・書き方・オプション・上限・使い分け。
 * 種類の一覧（docs/kinds.md・scripts/kinds-doc.ts）と、LLM 向けの書き方（[`kindGuide`](./index.ts)）の単一の定義。
 * 種類・別名・上限はコード（KINDS・KIND_ALIASES・LIMITS）から取り、ここには説明だけを書く。
 */

import type { Kind } from "../ir.js";
import { LIMITS } from "../lines.js";

export interface KindGuide {
  /** 日本語の名前。 */
  name: string;
  /** 何に使うか（1 文）。 */
  use: string;
  /** 書き方の要点（箇条書き）。 */
  syntax: string[];
  /** その種類で使えるオプション行（全種類に共通の `note:` `src:` は [`COMMON_OPTIONS`]）。 */
  options: string[];
  /** 上限（LIMITS から）。 */
  limits: string[];
  /** 近い種類との使い分け。 */
  instead?: string;
  /** 仕様の節。 */
  spec: string;
}

/** 全種類に共通のオプション行。 */
export const COMMON_OPTIONS = ["`note:` 注記", "`src:` データ参照（ホストが解決）"] as const;

/** 種類ごとの用途・書き方・使い分け（`docs/kinds.md` と LLM 向けの書き方の元）。 */
export const KIND_GUIDE: Record<Kind, KindGuide> = {
  bar: {
    name: "棒グラフ",
    use: "項目や時期ごとの数値の比較。系列が複数なら並べる・積み上げる。",
    syntax: ["2 行目に列名、以降「ラベル | 数値 | 数値…」", "GFM の表、`1月: 120` の形も受ける", "行が多い・項目名が長いと横向きになる"],
    options: ["`unit:` 単位", "`stacked: true` 積み上げ", "`horizontal: true` 横向き"],
    limits: [`${LIMITS.chartRows} 行 × ${LIMITS.chartColumns} 列`],
    instead: "全体に占める割合は pie、時間の流れに沿った推移は line。",
    spec: "5.1 bar / line",
  },
  line: {
    name: "折れ線グラフ",
    use: "時期ごとの推移。系列が 2 つ以上なら凡例が付く。",
    syntax: ["書き方は bar と同じ"],
    options: ["`unit:` 単位", "`stacked: true` 積み上げ（面グラフの代わり）"],
    limits: [`${LIMITS.chartRows} 行 × ${LIMITS.chartColumns} 列`],
    instead: "項目どうしの比較は bar。",
    spec: "5.1 bar / line",
  },
  pie: {
    name: "円グラフ（ドーナツ）",
    use: "全体に占める割合・内訳。割合はレンダラーが計算する。",
    syntax: ["書き方は bar と同じで、数値の列は 1 つ", "値は 0 以上。扇は書いた順に並ぶ"],
    options: ["`unit:` 単位"],
    limits: [`${LIMITS.pieSlices} 項目（9 項目目以降は灰色）`],
    instead: "項目が多い・値どうしを比べたいなら bar。",
    spec: "5.5 pie",
  },
  scatter: {
    name: "散布図",
    use: "2 つの量の関係・ばらつき。",
    syntax: ["2 行目に「ラベル | 横軸の名前 | 縦軸の名前」、以降「名前 | 数値 | 数値」", "4 列目に名前があれば、まとまりごとに色分け", "単位は軸の名前に括弧で書く"],
    options: [],
    limits: [`${LIMITS.scatterPoints} 点（15 点までは名前を添える）`],
    instead: "0〜100 の評価で 2×2 に位置づけるなら quadrant。",
    spec: "5.6 scatter",
  },
  stat: {
    name: "数値カード",
    use: "主な指標をいくつか大きく並べる（件数・率・金額など）。",
    syntax: ["「項目 | 値 | 補足（任意）」または「項目: 値」", "値は書かれた表記のまま出す"],
    options: [],
    limits: [`${LIMITS.statItems} 項目`],
    instead: "目標に対する進み具合は progress、段階ごとに減る数は funnel、文章の要点は cards。",
    spec: "5.2 stat",
  },
  progress: {
    name: "進捗",
    use: "目標に対してどこまで進んだか。達成率はレンダラーが計算する。",
    syntax: ["「項目 | 実績 | 目標」、「項目 | 実績 / 目標」、「項目: 64%」（% だけなら目標は 100%）", "100% 以上は色が変わる"],
    options: [],
    limits: [`${LIMITS.progressItems} 項目`],
    instead: "値が小さいほど良い指標（解約率など）は表せないので bar か stat。",
    spec: "5.11 progress",
  },
  funnel: {
    name: "ファネル",
    use: "段階ごとに減っていく数（選考・商談・購入まで）。前の段階からの割合を計算する。",
    syntax: ["「段階 | 数」または「段階: 数」を最初の段階から順に"],
    options: ["`unit:` 単位"],
    limits: [`${LIMITS.funnelStages} 段階`],
    instead: "段階が順につながらない指標の一覧は stat。",
    spec: "5.12 funnel",
  },
  flow: {
    name: "流れ図",
    use: "承認・処理の流れ。分岐・差戻し・繰り返しを含められる。",
    syntax: ["「A -> B -> C」、条件は「A -ラベル-> B」", "同じ名前は同じ箱。分岐はひし形、ループは脇を回る"],
    options: ["`dir: LR` 横向き"],
    limits: [`${LIMITS.flowNodes} ノード、${LIMITS.flowEdges} 辺`],
    instead: "分岐の無い手順は steps、システムの構成は stack。",
    spec: "5.3 flow",
  },
  steps: {
    name: "手順",
    use: "分岐の無い手順・段取り。番号は書いた順に振る。",
    syntax: ["「1. 見出し: 説明」、「見出し | 説明」", "字下げした行は直前の手順の説明の段落（1 行 1 段落）"],
    options: [],
    limits: [`${LIMITS.steps} 手順`],
    instead: "分岐・差戻しがあれば flow。",
    spec: "5.8 steps",
  },
  timeline: {
    name: "年表",
    use: "沿革・予定・時刻順の出来事。書いた順に並べる。",
    syntax: ["「- 時期: 出来事」、「時期 | 出来事 | 補足」、「10:00 出来事」", "字下げした行は直前の出来事の補足の段落"],
    options: [],
    limits: [`${LIMITS.timelineEvents} 出来事`],
    instead: "いつからいつまでの期間があるなら gantt。",
    spec: "5.7 timeline",
  },
  gantt: {
    name: "工程表",
    use: "いつからいつまでの作業か。1 日だけのものはマイルストーン。",
    syntax: ["「タスク | 開始 | 終了」、「タスク: 開始 〜 終了」", "日付は `2025/4/1`・`4/1`・`2025年4月`・`4月`。年は直前の行から引き継ぐ"],
    options: [],
    limits: [`${LIMITS.ganttTasks} タスク`],
    instead: "出来事の時期だけなら timeline。",
    spec: "5.14 gantt",
  },
  stack: {
    name: "構成図",
    use: "システム構成・アーキテクチャなど、層の積み重ね。層の間の矢印は自動で引く。",
    syntax: ["上の層から「- 名前: 説明」", "層の中の要素は字下げして「  - 名前」", "同じ段に横に並べるものは「名前 | 名前」"],
    options: [],
    limits: [`${LIMITS.stackTiers} 層、横並び ${LIMITS.stackBoxesPerTier}、層の中の要素 ${LIMITS.stackChildren}`],
    instead: "組織図・分類など親子の階層は tree、処理の順序は flow。",
    spec: "5.4 stack",
  },
  tree: {
    name: "階層",
    use: "組織図・分類・目次・フォルダ構成など、親子の階層。",
    syntax: ["字下げした箇条書き（深さは 4 段まで）", "「名前: 説明」、1 行の中の `|` は兄弟の並び", "幅に収まれば組織図、収まらなければ字下げの一覧で描く"],
    options: [],
    limits: [`${LIMITS.treeNodes} 項目、深さ ${LIMITS.treeDepth}`],
    instead: "システムの層構成は stack。",
    spec: "5.9 tree",
  },
  quadrant: {
    name: "4象限",
    use: "2 つの軸での位置づけ（優先度・ポジショニング）。",
    syntax: ["`x: 横軸の名前`・`y: 縦軸の名前`", "象限の名前は `右上: すぐやる` など（任意）", "項目は「名前 | 横 | 縦」で、位置は 0〜100"],
    options: [],
    limits: [`${LIMITS.quadrantItems} 項目`],
    instead: "実際の数値どうしの関係は scatter。",
    spec: "5.13 quadrant",
  },
  cards: {
    name: "カード",
    use: "要点・特徴・選択肢・料金プランを並べて見せる。",
    syntax: ["「- 見出し: 本文」、「見出し | 本文」", "値を大きく出すなら「- 見出し | 値 | 本文」（料金・数値）", "字下げした行は本文の段落、字下げした「- 項目」は ✓ の付いた一覧"],
    options: [],
    limits: [`${LIMITS.cards} 枚、1 枚に項目 ${LIMITS.cardItems}`],
    instead: "数値を大きく見せるなら stat。",
    spec: "5.10 cards",
  },
  calc: {
    name: "計算機",
    use: "利用者が値を動かすと結果が変わる計算（ローン・料金の試算・割り勘）。式は Yui が解釈し、JavaScript は実行しない。",
    syntax: [
      "1 行に 1 つ「名前 = 中身 単位」。名前は日本語でよいが、空白・記号（`+-*/^()=,|`）を含めない（`身長(m)` ではなく `身長m`）",
      "入力: `slider 最小..最大 step 刻み 初期 値`・`count 最小..最大 初期 値`（整数）・`choice 表示名=値 | 表示名=値`・`toggle`（オン 1・オフ 0）",
      "利用者が動かしたい値は入力にし、資料の値を初期値にする。範囲は初期値より十分広く取る",
      "式: 前に定義した名前と数値、`+ - * / ^ ( )`、`min` `max` `round` `if(条件, 真, 偽)` など。比較は `< <= > >= == !=`（等しいは `==`）",
      "式の中の数は半角の数字と小数点だけ（`1,000`・`3万` は書かない）。単位は表示用で計算には使わない",
    ],
    options: ["`show 名前 | 名前` 大きく出す結果", "`hide: 名前, 名前` 内訳に出さない式", "`round N` 表示の小数桁（式の行末）"],
    limits: [`${LIMITS.calcDefs} 定義、1 式 ${LIMITS.calcExprLength} 文字`],
    spec: "5.15 calc",
  },
  compare: {
    name: "比較表",
    use: "製品・プラン・案を項目ごとに比べる。✓ / ✗ / △ は印で描く。",
    syntax: ["1 行目に「項目 | 選択肢 | 選択肢…」、以降「項目 | セル | セル…」", "セルの `✓` `○` `あり` は ✓、`✗` `×` `-` `なし` は ✗、`△` `一部` は △。印の後ろに文字を続けてもよい"],
    options: ["`推奨: 選択肢` その列を強調する"],
    limits: [`選択肢 ${LIMITS.compareOptions}、${LIMITS.compareRows} 項目`],
    instead: "数値の大小を比べるなら bar。選択肢の要点を並べるだけなら cards。",
    spec: "5.16 compare",
  },
  proscons: {
    name: "メリット・デメリット",
    use: "案・選択の良い点と悪い点を左右に並べる。",
    syntax: ["`メリット:` `デメリット:` の見出しの下に「- 項目: 補足」", "見出しを書かないなら「+ 項目」（メリット）と「- 項目」（デメリット）", "「メリット | デメリット」の 2 列の表も受ける"],
    options: [],
    limits: [`それぞれ ${LIMITS.prosconsItems} 項目`],
    instead: "複数の案を項目ごとに比べるなら compare。",
    spec: "5.17 proscons",
  },
  swot: {
    name: "SWOT",
    use: "強み・弱み・機会・脅威の 4 つに分けた整理。",
    syntax: ["`強み:` `弱み:` `機会:` `脅威:`（`Strengths:` `S:` も可）の見出しの下に「- 項目」"],
    options: [],
    limits: [`それぞれ ${LIMITS.swotItems} 項目`],
    instead: "2 つの軸での位置づけは quadrant。",
    spec: "5.18 swot",
  },
  checklist: {
    name: "チェックリスト",
    use: "確認事項・タスクの済・未・進行中と、完了の数。",
    syntax: ["「- [x] 済んだ項目」「- [ ] 未の項目」「- [~] 進行中の項目」", "「項目: 補足」、字下げした行は補足の段落", "「項目 | 状態」の表（状態は 完了・未・進行中）も受ける"],
    options: [],
    limits: [`${LIMITS.checklistItems} 項目`],
    instead: "数値の目標に対する進み具合は progress、順序のある段取りは steps。",
    spec: "5.19 checklist",
  },
  app: {
    name: "アプリ（入力と実行）",
    use: "入力部品とボタンを並べ、押すとホストがその値でワークフローを起動する（Yui は実行しない）。機能ごとに分けて並べられる。",
    syntax: ["`## 見出し` で機能を分け、`> 説明`", "入力は「ラベル = 種類」（text・textarea・number・choice・date・daterange・month・toggle・slider・count・rating）。`必須`・`例 …`・`初期 …`・`as キー`", "選択肢の中の縦棒は前にバックスラッシュを付ける（`A\\|B`）。数値の範囲は「最小..最大」の両方を書く（片側だけは読まずに警告）", "ボタンは「button ラベル -> workflow 名前」か「-> chat」"],
    options: [],
    limits: [`機能 ${LIMITS.appSections}、入力 1 機能 ${LIMITS.appSectionFields}・全体 ${LIMITS.appFields}、ボタン 1 機能 ${LIMITS.appSectionActions}`],
    instead: "画面の中で計算が完結するなら calc。",
    spec: "5.20 app（docs/app.md）",
  },
  ask: {
    name: "質問のカード",
    use: "答える前に利用者に確かめる質問（選択肢・複数選択・その他・自由記述）。回答は会話に送る。",
    syntax: ["`? 質問文` の下に「- 選択肢: 説明」", "`multi` で複数選択、`- その他` で自由記述も受ける、`任意` で回答しなくてもよい", "選択肢の無い質問は自由記述（`例 …` で入力の例）"],
    options: ["`button 文言` 送るボタンの文言", "`> 前置き`"],
    limits: [`質問 ${LIMITS.askQuestions}、選択肢 1 つの質問に ${LIMITS.askOptions}`],
    instead: "値を入れてワークフローを起動するなら app。",
    spec: "5.21 ask",
  },
  plan: {
    name: "計画のカード",
    use: "これから行う手順を示し、「この計画で進める」か「修正を依頼」を会話に送ってもらう。",
    syntax: ["steps と同じ「1. 見出し: 説明」", "`> 前置き`"],
    options: ["`button 文言` 進めるボタンの文言", "`revise: off` 修正の依頼を受けない"],
    limits: [`手順 ${LIMITS.planSteps}`],
    instead: "ただの手順の説明は steps。",
    spec: "5.22 plan",
  },
  radar: {
    name: "レーダーチャート",
    use: "いくつかの観点（3 つ以上）での点数を、比べるもの同士で重ねて見せる。",
    syntax: ["bar と同じ表。行が観点、列が比べるもの", "値は 0 以上"],
    options: ["`unit:` 単位"],
    limits: [`観点 ${LIMITS.radarAxes}`],
    instead: "観点が 2 つ以下・正確な値を比べるなら bar。",
    spec: "5.23 radar",
  },
  treemap: {
    name: "ツリーマップ",
    use: "項目の多い構成比を面積で見せる（予算・売上の内訳など）。",
    syntax: ["pie と同じ「項目 | 値」", "値は 0 より大きい"],
    options: ["`unit:` 単位"],
    limits: [`${LIMITS.treemapItems} 項目`],
    instead: "項目が 6 つ程度までなら pie。",
    spec: "5.24 treemap",
  },
  callout: {
    name: "注意書き",
    use: "読み落としてほしくない注意・警告・補足を、重さ（info・success・warning・danger）を付けて目立たせる。",
    syntax: ["1 行目「callout 種類 見出し」（info・success・warning・danger、`注意`・`警告` も可）", "本文は段落、`- ` は箇条書き"],
    options: [],
    limits: [`箇条書き ${LIMITS.calloutItems}`],
    spec: "5.25 callout",
  },
  map: {
    name: "地図",
    use: "地点の位置と道順。背景の地図はホストが描く（Yui の静止画は位置関係だけ）。",
    syntax: ["「- 名前 | 緯度 | 経度 | 説明」、「名前: 緯度, 経度」", "`route: A -> B -> C (walk)`（walk・drive・transit）"],
    options: ["`zoom: 14`"],
    limits: [`地点 ${LIMITS.mapMarkers}`],
    spec: "5.26 map",
  },
};

/** 一覧での並び（用途のまとまり）。すべての種類がちょうど 1 回ずつ現れる。 */
export const KIND_GROUPS: readonly { title: string; kinds: readonly Kind[] }[] = [
  { title: "グラフ", kinds: ["bar", "line", "pie", "scatter", "radar", "treemap"] },
  { title: "数値", kinds: ["stat", "progress", "funnel"] },
  { title: "流れ・手順・時間", kinds: ["flow", "steps", "timeline", "gantt"] },
  { title: "構造・整理", kinds: ["stack", "tree", "quadrant", "cards", "callout", "map"] },
  { title: "比較・判断", kinds: ["compare", "proscons", "swot", "checklist"] },
  { title: "操作できる図", kinds: ["calc", "app", "ask", "plan"] },
];
