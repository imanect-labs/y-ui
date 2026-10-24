/**
 * app の記法の共通課題集（spec-tests/app.json）を作る。Rust 版のパーサ（Shiki）が同じ結果を出すかを確かめるため。
 *   pnpm tsx scripts/app-fixtures.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { figureActions, parseBlock, validateActionValues, type Figure } from "@imanect/yui";

const SOURCES: Record<string, string> = {
  full: `app 経費の処理
## 経費の申請
> 領収書の内容を入力してください。
件名 = text 必須 例 4月 大阪出張の交通費
金額 = number 1..1000000 円 必須 as amount
区分 = choice 交通費 | 出張費 | 備品
日付 = date 必須
内容 = textarea
立替 = toggle 初期 オン
button 申請する -> workflow 経費申請

## 月次の集計
対象月 = month 必須
部署 = choice 営業=sales | 開発=dev | 管理=admin multi 初期 sales
人数 = count 1..10 初期 2
button 集計する -> workflow 月次集計
button 会話で相談する -> chat
note: 申請は上長の承認後に経理へ回ります。
`,
  noHeading: "app 休暇\n開始日 = date 必須\n日数 = count 1..20 初期 1\n理由 = textarea 例 家族の行事\nbutton 申請 -> workflow 休暇申請\n",
  english: "app Expenses\n## Submit\nSubject = text required e.g. Taxi to the airport\nAmount = number 1..10000 USD required as amount\nbutton Submit -> workflow expense-approval\n",
  rejected: "app x\n開始日 = date\n種類 = color\nbutton 送る -> https://example.com/x\nbutton 申請 -> workflow 休暇申請\nこれは説明ではない\nbutton 相談 -> chat confirm\n",
  slider: "app 設定\n上限 = slider 0..100 step 5 初期 50 %\nbutton 保存 -> workflow 設定の保存\n",
  extended: "app 研修の感想\n満足度 = rating 5 必須\n受講期間 = date range 必須\n参加の形 = choice 会場 | オンライン | その他\n関心 = choice AI | セキュリティ | 法務 multi other\nbutton 送る -> chat\n",
  ask: "ask 調べる前の確認\n> いくつか教えてください。\n? 対象の期間は？\n- 直近 1 年\n- 直近 3 年: 傾向を見るならこちら\n? 出力の形式は？ multi\n- 表\n- グラフ\n- その他\n? 補足があれば 任意 例 部署を絞るなど\nbutton 回答する\n",
  askOne: "ask x\n? 一つだけ\n- A\nこれは読めない\n",
  askOther: "ask x\n? 読む人は？\n- 経営層\n- 現場\n- その他: 自由に記入\n",
  edgeApp: [
    "app 境界 [2]",
    "note: 注記です",
    "# 見出しだけ",
    "## 本当の見出し",
    "> 説明 1",
    "> 説明 2",
    "- 名前＝text 必須 as name_1 例 山田 太郎",
    "* 年齢 = number 0..120 歳 初期 30 step 0",
    "+ 予算 = slider 10..1 step 2.5 初期 5 万円",
    "１. 人数 = count 1..5 初期 9",
    "種類 = select A=a | B=b | その他 multi 初期 b, a",
    "色 = choice 赤 | 青 初期 緑",
    "始業 = date 初期 2025/4/1",
    "期間 = date range 必須 初期 2025/4/1 〜 2025/4/3",
    "月 = month 初期 2025/04",
    "点 = rating 3 初期 9",
    "点2 = rating",
    "通知 = switch 初期 off",
    "メモ = textarea 初期 こんにちは",
    "名前 = text",
    "壊れ = slider 初期 1",
    "button 送る -> workflow:経費 申請",
    "button 二つ目 → ワークフロー 集計",
    "button 三つ目 => chat 確認",
    "button 四つ目 -> chat",
    "button 名無し -> ",
    "src: data://x",
  ].join("\n"),
  overflowSections: `app x\n${Array.from({ length: 9 }, (_, i) => `## 機能${i}\n> d\n値${i} = text`).join("\n")}\n`,
  askEdge: "ask 確認 [1]\n> 前置き\nQ: 質問1 （複数可） 例 書いて\n- A: 説明 A\n- B\n- その他（自由に）\n質問：質問2 optional\n1. X\n2. Y\n? 自由 例 なんでも\nbutton 送信\n? 選択肢が一つ\n- だけ\n",
  planEdge: "計画 進め方\n> 前置き\n| 手順 | 内容 |\n|---|---|\n| 1 | 検索 | 規程 |\nSTEP2: 比較表\n   - 列を決める\n   追加の説明\nStep 3〜4: まとめ [3]\nnote: 概算\nrevise: なし\n",
  escapedChoice: "app 区分\n記号 = choice A\\|B | C｜D | 表示\\|名=v\\|1 初期 A\\|B, v\\|1 multi\n単位 = choice 1\\| | 2\n全角 = choice A\\｜B ｜ C\nbutton 送る -> workflow 記号\n",
  halfRange: "app 範囲\n下限 = number 1.. 円\n上限 = number ..100\n全角 = number 1〜 個 必須\n両方 = number 1..2 円\n続けて = number 1..円\nbutton 送る -> workflow 範囲\n",
  plain: "bar x\na | 1\n",
  plan: "plan 調査の進め方\n> 次の手順で進めます。\n1. 社内文書を検索する: 経費規程と過去の申請\n2. 比較表を作る\n3. 要点をまとめる\nbutton 進める\nrevise: off\n",
};

/** フェンスの情報文字列で種類が分かっているブロック（` ```ui:app ` など・先頭行が見出しかデータか）。 */
const HINTED: Record<string, { kind: "app" | "ask" | "plan"; source: string }> = {
  hintedApp: { kind: "app", source: "金額 = number 必須 円 as amount\n区分 = choice A | B\nbutton 送る -> chat\n" },
  hintedAppTitle: { kind: "app", source: "経費の申請\n金額 = number 必須\nbutton 送る -> chat\n" },
  hintedAsk: { kind: "ask", source: "? 地域は\n- 関東\n- 関西\n" },
  hintedPlan: { kind: "plan", source: "1. 調べる\n2. まとめる\n" },
  hintedButton: { kind: "app", source: "button 送る -> chat\n名前 = text\n" },
};

const VALUES: { source: string; action: string; input: Record<string, unknown> }[] = [
  { source: "full", action: "a1", input: { 件名: "", amount: "0", 区分: "家賃", 日付: "2025-02-30", 立替: "yes" } },
  { source: "full", action: "a1", input: { 件名: "出張", amount: "12,300", 区分: "交通費", 日付: "2025-04-01", 内容: "", 立替: false, 余計: "x" } },
  { source: "full", action: "a2", input: { 対象月: "2025-13", 部署: ["hr"], 人数: 2.5 } },
  { source: "full", action: "a2", input: { 対象月: "2025-04", 部署: ["sales", "dev", "dev"], 人数: 3 } },
  { source: "slider", action: "a1", input: { 上限: 105 } },
  { source: "extended", action: "a1", input: { 満足度: 4, 受講期間: "2025-04-01/2025-04-03", 参加の形: "社内の研修室", 関心: ["AI", "経理"] } },
  { source: "extended", action: "a1", input: { 満足度: 6, 受講期間: "2025-04-03/2025-04-01", 関心: ["x", "y"] } },
  { source: "ask", action: "a1", input: { q1: "直近 1 年", q2: ["表", "PDF"], q3: "" } },
  { source: "ask", action: "a1", input: { q1: "直近 10 年", q2: ["A", "B"] } },
  { source: "plan", action: "approve", input: {} },
  { source: "plan", action: "revise", input: { comment: "x" } },
  { source: "edgeApp", action: "a1", input: { name_1: "", 年齢: "１２０", 予算: 3, 人数: "2", 種類: ["a", "自由", "b", "a"], 色: "緑", 始業: "2025-04-31", 期間: "2025-04-01/2025-04-01", 月: "2025-00", 点: "3", 点2: true, 通知: false, メモ: "x".repeat(10001), 名前: "改行\nあり" } },
  { source: "edgeApp", action: "a1", input: { name_1: "山田", 年齢: "1e2", 予算: "abc", 人数: 1.5, 種類: "a", 色: "赤", 点: 0, 点2: 5, 通知: "on", 名前: 3 } },
  { source: "edgeApp", action: "a3", input: {} },
  { source: "edgeApp", action: "a9", input: {} },
  { source: "askEdge", action: "a1", input: { q1: ["A", "自由", "B"], q2: "X", q3: "  なにか  " } },
  { source: "askEdge", action: "a1", input: { q1: ["自由1", "自由2"], q2: "Z", q3: 5 } },
  { source: "planEdge", action: "approve", input: { comment: "x" } },
  { source: "planEdge", action: "revise", input: {} },
  { source: "hintedApp", action: "a1", input: { amount: "", 区分: "A" } },
  { source: "escapedChoice", action: "a1", input: { 記号: ["A|B", "C", "v|1", "A"], 単位: "1|" } },
];

const entries: [string, string, "app" | "ask" | "plan" | undefined][] = [
  ...Object.entries(SOURCES).map(([name, source]) => [name, source, undefined] as [string, string, undefined]),
  ...Object.entries(HINTED).map(([name, h]) => [name, h.source, h.kind] as [string, string, "app" | "ask" | "plan"]),
];
const cases = entries.map(([name, source, kind]) => {
  const r = parseBlock(source, { final: true, ...(kind ? { kind } : {}) });
  return { name, source, ...(kind ? { kind } : {}), figure: r.figure as Figure, actions: r.figure ? figureActions(r.figure) : [], diagnostics: r.diagnostics.map((d) => ({ line: d.line, code: d.code })) };
});
const values = VALUES.map((v) => ({ ...v, expect: validateActionValues(cases.find((c) => c.name === v.source)!.figure, v.action, v.input) }));
writeFileSync(join(import.meta.dirname, "../spec-tests/app.json"), `${JSON.stringify({ note: "scripts/app-fixtures.ts で生成。TS 版と Rust 版の、操作を持つ種類（app・ask・plan）のパーサ・ボタン・値の検証が同じ結果を出すかを確かめる。", cases, values }, null, 2)}\n`);
console.log(`wrote ${cases.length} cases, ${values.length} value checks`);
