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
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;background:#fff"><div id="f" style="width:640px;background:#fcfcfb;border-radius:12px">${svg}</div>`);
    await page.locator("#f").screenshot({ path: join(out, `${lang}-${kind}.png`) });
  }
}
await browser.close();
writeFileSync(join(out, ".gitattributes"), "*.png binary\n");
console.log(`written to ${out}`);
