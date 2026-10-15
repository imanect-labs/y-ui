/**
 * app の記法の共通課題集（spec-tests/app.json）を作る。Rust 版のパーサ（Shiki）が同じ結果を出すかを確かめるため。
 *   pnpm tsx scripts/app-fixtures.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBlock, validateAppValues, type AppFigure } from "@imanect/yui";

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
};

const VALUES: { source: string; action: string; input: Record<string, unknown> }[] = [
  { source: "full", action: "a1", input: { 件名: "", amount: "0", 区分: "家賃", 日付: "2025-02-30", 立替: "yes" } },
  { source: "full", action: "a1", input: { 件名: "出張", amount: "12,300", 区分: "交通費", 日付: "2025-04-01", 内容: "", 立替: false, 余計: "x" } },
  { source: "full", action: "a2", input: { 対象月: "2025-13", 部署: ["hr"], 人数: 2.5 } },
  { source: "full", action: "a2", input: { 対象月: "2025-04", 部署: ["sales", "dev", "dev"], 人数: 3 } },
  { source: "slider", action: "a1", input: { 上限: 105 } },
];

const cases = Object.entries(SOURCES).map(([name, source]) => {
  const r = parseBlock(source, { final: true });
  return { name, source, figure: r.figure as AppFigure, diagnostics: r.diagnostics.map((d) => ({ line: d.line, code: d.code })) };
});
const values = VALUES.map((v) => ({ ...v, expect: validateAppValues(cases.find((c) => c.name === v.source)!.figure, v.action, v.input) }));
writeFileSync(join(import.meta.dirname, "../spec-tests/app.json"), `${JSON.stringify({ note: "scripts/app-fixtures.ts で生成。TS 版と Rust 版の app のパーサ・検証が同じ結果を出すかを確かめる。", cases, values }, null, 2)}\n`);
console.log(`wrote ${cases.length} cases, ${values.length} value checks`);
