/**
 * README の「図の種類」に載せるスクリーンショットを作る（英語版・日本語版）。
 *   pnpm tsx scripts/readme-images.ts
 * docs/images/{en,ja}-<種類>.png に書き出す。Playwright の Chromium を使う。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { parseBlock } from "@imanect/yui";
import { renderSVG } from "@imanect/yui/svg";

export const SAMPLES: Record<"en" | "ja", Record<string, string>> = {
  en: {
    bar: `bar Revenue and profit by quarter
unit: $M
Quarter | Revenue | Profit
Q1 | 120 | 30
Q2 | 150 | -5
Q3 | 135 | 12
Q4 | 210 | 44
`,
    line: `line Weekly active users
Week | Web | App
W1 | 1200 | 800
W2 | 1350 | 950
W3 | 1280 | 1100
W4 | 1500 | 1300
W5 | 1620 | 1250
W6 | 1580 | 1420
`,
    pie: `pie Revenue by segment
unit: $M
Segment | Revenue
Cloud | 145
Support | 98
On-premises | 52
Training | 31
Consulting | 24
`,
    scatter: `scatter Ad spend and revenue by store
Store | Ad spend ($K) | Revenue ($M) | Region
Downtown | 120 | 48 | East
Midtown | 95 | 41 | East
Harbor | 80 | 30 | East
Airport | 110 | 39 | West
Hillside | 60 | 22 | West
Lakeside | 45 | 19 | South
Riverside | 70 | 27 | South
`,
    stat: `stat This month
Revenue | $3.2M | +18% YoY
New customers | 165
Churn | 2.2% | 2.6% last month
ARPU | $19.4K
`,
    flow: `flow Expense approval
Submit report -> Manager review
Manager review -approve-> Finance check -> Payment
Manager review -reject-> Revise
Revise -> Submit report
`,
    stack: `stack System architecture
- Clients: Web / Electron / external chat
- Product API: tasks, conversations, users, auth
- Agent runtime: Elixir / Erlang OTP
  - Agent process
  - Session / journal
  - Scheduler / loop
  - Lean kernel
- LLM: OpenAI / Anthropic | Tools: external APIs | Storage: DB / object store
note: Logical view based on public material.
`,
    timeline: `timeline Company history
- Apr 2015: Founded in Tokyo
- Oct 2017: First product launched
- Jun 2019: Osaka office opened [1]
- Jan 2021: 100 customers
  Cloud edition released
- Apr 2024: IPO
`,
    steps: `steps Expense reimbursement
1. Submit: enter the receipt in the expense system
2. Manager approval: check the purpose and amount
3. Finance review: check the account and receipt
4. Payment: paid with the next salary
`,
    tree: `tree Organization
- CEO
  - Sales: 120 people
    - East sales
    - West sales
  - Engineering: 80 people
    - Product
    - Platform
    - QA
  - Corporate
    - HR
    - Finance
`,
    cards: `cards New plan highlights
- Easy sharing: set view and edit permissions per folder
- Fast search: answers across internal documents with sources [1]
- Audit ready: records who saw what and when
`,
    progress: `progress Quarterly targets
Item | Actual | Target
Revenue | $8.2M | $10M
New customers | 132 | 120
Training completion: 64%
`,
    funnel: `funnel Hiring pipeline
unit: people
Applied | 1200
Passed screening | 420
Passed first interview | 150
Passed final interview | 48
Accepted | 30
`,
    quadrant: `quadrant Initiative priorities
x: Impact
y: Ease
右上: Do now
Contact form revamp | 70 | 85
Faster search | 85 | 40
Multilingual support | 60 | 20
Digital newsletter | 25 | 75
`,
    gantt: `gantt Rollout plan
Task | Start | End
Requirements | 2025/4/1 | 2025/4/30
Design | 5/1 | 6/15
Build | 6/1 | 8/31
System test | 9/1 | 9/30
Go-live | 10/1
`,
    calc: `calc Mortgage estimate
Loan = slider 50..1000 step 5 initial 300 $K
Rate = slider 0.5..10 step 0.05 initial 6.5 %
Years = slider 5..40 initial 30 years
MonthlyRate = Rate / 100 / 12
Payment = Loan * 1000 * MonthlyRate / (1 - (1 + MonthlyRate) ^ -(Years * 12)) $
hide: MonthlyRate
`,
  },
  ja: {
    bar: `bar 四半期ごとの売上と利益
unit: 百万円
四半期 | 売上 | 利益
Q1 | 120 | 30
Q2 | 150 | -5
Q3 | 135 | 12
Q4 | 210 | 44
`,
    line: `line 週次アクティブユーザー
週 | Web | アプリ
第1週 | 1200 | 800
第2週 | 1350 | 950
第3週 | 1280 | 1100
第4週 | 1500 | 1300
第5週 | 1620 | 1250
第6週 | 1580 | 1420
`,
    pie: `pie 事業別の売上構成
unit: 億円
事業 | 売上
クラウド | 145
保守サポート | 98
オンプレミス | 52
研修 | 31
コンサルティング | 24
`,
    scatter: `scatter 店舗別の広告費と売上
店舗 | 広告費（万円） | 売上（百万円） | 地域
新宿 | 120 | 48 | 東京
渋谷 | 95 | 41 | 東京
池袋 | 80 | 30 | 東京
梅田 | 110 | 39 | 大阪
難波 | 60 | 22 | 大阪
天神 | 45 | 19 | 福岡
博多 | 70 | 27 | 福岡
`,
    stat: `stat 今月の営業実績
売上 | 3,200万円 | 前年比 +18%
新規顧客数 | 165社
解約率 | 2.2% | 前月 2.6%
平均単価 | 19.4万円
`,
    flow: `flow 経費精算
精算書提出 -> 上長承認
上長承認 -承認-> 経理確認 -> 支払
上長承認 -差戻し-> 修正
修正 -> 精算書提出
`,
    stack: `stack システム構成
- クライアント層: Web / Electron / 外部チャット
- Product API: タスク・会話・ユーザー・認証
- エージェント実行基盤: Elixir / Erlang OTP
  - Agent Process
  - Session / Journal
  - Scheduler / Loop
  - Lean Kernel
- LLM: OpenAI / Anthropic | Tools: 外部API | Storage: DB / Object Store
note: 公開資料を基にした論理構成図。
`,
    timeline: `timeline 会社の沿革
- 2015年4月: 創業（東京・渋谷）
- 2017年10月: 初の製品を発売
- 2019年6月: 大阪支社を開設 [1]
- 2021年1月: 導入企業 100 社を突破
  クラウド版の提供を開始
- 2024年4月: 東証グロース市場に上場
`,
    steps: `steps 経費精算の手順
1. 申請: 領収書を添えて精算システムに入力する
2. 上長の承認: 目的と金額を確認する
3. 経理の確認: 勘定科目と証憑を確認する
4. 支払: 翌月の給与と一緒に振り込む
`,
    tree: `tree 組織図
- 社長
  - 営業本部: 120名
    - 東日本営業部
    - 西日本営業部
  - 開発本部: 80名
    - プロダクト開発部
    - 基盤開発部
    - 品質保証部
  - 管理本部
    - 人事部
    - 経理部
`,
    cards: `cards 新プランの特徴
- 共有がかんたん: フォルダごとに閲覧・編集の権限を付けられます
- 検索が速い: 社内文書を横断して、根拠付きで答えます [1]
- 監査に強い: 誰がいつ何を見たかをすべて記録します
`,
    progress: `progress 今期の目標の達成状況
項目 | 実績 | 目標
売上 | 8,200万円 | 1億円
新規顧客 | 132社 | 120社
研修の受講率: 64%
`,
    funnel: `funnel 採用の選考状況
unit: 人
応募 | 1200
書類選考通過 | 420
一次面接通過 | 150
最終面接通過 | 48
内定承諾 | 30
`,
    quadrant: `quadrant 改善施策の優先度
x: 効果
y: 実現しやすさ
右上: すぐやる
左下: 見送り
問い合わせフォームの改善 | 70 | 85
検索の高速化 | 85 | 40
多言語対応 | 60 | 20
社内報の電子化 | 25 | 75
`,
    gantt: `gantt 新システム導入の工程
タスク | 開始 | 終了
要件定義 | 2025/4/1 | 2025/4/30
設計 | 5/1 | 6/15
開発 | 6/1 | 8/31
総合テスト | 9/1 | 9/30
本番稼働 | 10/1
`,
    calc: `calc 住宅ローンの試算
借入額 = slider 500..10000 step 100 初期 3000 万円
金利 = slider 0.1..5 step 0.05 初期 1.5 %
期間 = slider 5..35 初期 35 年
月利 = 金利 / 100 / 12
毎月の返済額 = 借入額 * 10000 * 月利 / (1 - (1 + 月利) ^ -(期間 * 12)) 円
総返済額 = 毎月の返済額 * 期間 * 12 / 10000 万円
show 毎月の返済額 | 総返済額
hide: 月利
`,
  },
};

const out = join(import.meta.dirname, "../docs/images");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 600 }, deviceScaleFactor: 2, colorScheme: "light" });
for (const lang of ["en", "ja"] as const) {
  for (const [kind, src] of Object.entries(SAMPLES[lang])) {
    const r = parseBlock(src, { final: true });
    if (!r.figure) throw new Error(`${lang}/${kind}: ${JSON.stringify(r.diagnostics)}`);
    const svg = renderSVG(r.figure, { width: 640, locale: lang === "ja" ? "ja-JP" : "en-US" });
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;background:#fff"><div id="f" style="width:640px;background:#fcfcfc;border-radius:12px">${svg}</div>`);
    await page.locator("#f").screenshot({ path: join(out, `${lang}-${kind}.png`) });
  }
}
await browser.close();
writeFileSync(join(out, ".gitattributes"), "*.png binary\n");
console.log(`written to ${out}`);
