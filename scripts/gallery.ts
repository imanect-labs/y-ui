/**
 * 描画の確認用ギャラリーを作る（目で見て確かめるため）。
 *   pnpm tsx scripts/gallery.ts <出力ディレクトリ>
 * gallery.html（画面用: CSS 変数・明暗追従）と、書き出し用の焼き込み SVG を書き出す。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBlock, type Figure } from "@imanect/yui";
import { renderSVG } from "@imanect/yui/svg";
import { SAMPLES } from "./samples.js";

const out = process.argv[2] ?? "gallery";
mkdirSync(out, { recursive: true });

const samples: Record<string, string> = {
  "stack-attached": `stack システム構成
- クライアント層: Web / Electron / 外部チャット
- Comma Product API: Task・Conversation・User・認証
- Salix — Agent Runtime: Elixir / Erlang OTP
  - Agent Process
  - Session / Journal
  - Scheduler / Loop
  - Lean Kernel
- LLM: OpenAI / Anthropic | Tools: 外部API / Device | Storage: DB / Object Store
note: 公開資料を基にした論理構成図。実際のプロセス・Pod 分割を表すものではありません。
`,
  "bar-basic": `bar 月別売上 [1]
unit: 万円
月 | 売上
1月 | 120
2月 | 150
3月 | 135
4月 | 210
5月 | 260
`,
  "bar-grouped-negative": `bar 四半期ごとの売上と利益
unit: 百万円
四半期 | 売上 | 利益
Q1 | 120 | 30
Q2 | 150 | -5
Q3 | 135 | 12
Q4 | 210 | 44
`,
  "bar-stacked": `bar チャネル別の問い合わせ
stacked: true
月 | 電話 | メール | チャット
4月 | 120 | 80 | 40
5月 | 100 | 95 | 70
6月 | 90 | 110 | 120
`,
  "line-multi": `line 週次アクティブユーザー
週 | Web | アプリ
第1週 | 1200 | 800
第2週 | 1350 | 950
第3週 | 1280 | 1100
第4週 | 1500 | 1300
第5週 | 1620 | 1250
第6週 | 1580 | 1420
`,
  "pie-basic": `pie 事業別の売上構成 [1]
unit: 億円
事業 | 売上
クラウド | 182
オンプレ | 96
保守 | 54
研修 | 18
`,
  "pie-many": `pie 問い合わせの内訳
区分 | 件数
ログイン | 412
請求 | 288
権限 | 201
検索 | 166
ファイル共有 | 120
通知 | 64
連携（外部サービス・API・Webhook の設定） | 41
その他 | 22
退会 | 9
`,
  "scatter": `scatter 広告費と売上（店舗別）
店舗 | 広告費（万円） | 売上（百万円） | 地域
新宿 | 120 | 48 | 東京
渋谷 | 95 | 41 | 東京
池袋 | 80 | 30 | 東京
梅田 | 110 | 39 | 大阪
難波 | 60 | 22 | 大阪
天神 | 45 | 19 | 福岡
博多 | 70 | 27 | 福岡
`,
  "timeline": `timeline 会社の沿革
- 2015年4月: 創業（東京・渋谷）
- 2017年10月: 初の製品「Shiki」を発売
- 2019年6月: 大阪支社を開設 [1]
- 2021年1月: 導入企業 100 社を突破
  クラウド版の提供を開始
- 2024年4月: 東証グロース市場に上場
`,
  "timeline-row": `timeline 導入までの予定
- 4月: 要件の確認
- 5月: 試験導入
- 6月: 社内研修
- 7月: 本番開始
`,
  "steps": `steps 経費精算の手順
1. 申請: 領収書を添えて精算システムに入力する
2. 上長の承認: 内容と金額を確認する
3. 経理の確認: 勘定科目と証憑を確認する
4. 支払: 翌月 25 日に給与と一緒に振り込む
`,
  "steps-long": `steps 新しいPCの初期設定
1. 電源を入れ、言語と地域を選ぶ
2. 社内 Wi-Fi に接続する: SSID は「corp」、パスワードは情報システム部から届いたメールを参照
3. 会社のアカウントでサインインする
4. 多要素認証を設定する: 認証アプリで QR コードを読み取る
5. ウイルス対策ソフトの更新を待つ
6. 必要なアプリを社内ポータルからインストールする
`,
  "tree": `tree 組織図
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
  "tree-deep": `tree ドキュメントの構成
- 導入ガイド
  - はじめに
  - インストール
    - Windows
    - macOS
    - Linux: Ubuntu 22.04 以降
  - 初期設定
- 管理者ガイド
  - ユーザー管理
    - 招待
    - 権限: ロールと共有の関係
      - 組織の管理者
  - 監査ログ
- API リファレンス
`,
  "cards": `cards 新プランの特徴
- 共有がかんたん: フォルダごとに閲覧・編集の権限を付けられます
- 検索が速い: 社内文書を横断して、根拠付きで答えます [1]
- 監査に強い: 誰がいつ何を見たかをすべて記録します
`,
  "cards-4": `cards 選択肢の比較
- A 案: 既存システムを改修する。費用は小さいが、保守の負担が残る
- B 案: SaaS に移行する
- C 案: 内製で作り直す。自由度は高いが、開発期間が 1 年以上かかる見込み
- 現状維持
`,
  "progress": `progress 今期の目標の達成状況
項目 | 実績 | 目標
売上 | 8,200万円 | 1億円
新規顧客 | 132社 | 120社
解約率の改善 | 1.8% | 2.0%
研修の受講率: 64%
`,
  "funnel": `funnel 採用の選考状況
unit: 人
応募 | 1200
書類選考通過 | 420
一次面接通過 | 150
最終面接通過 | 48
内定承諾 | 30
`,
  "quadrant": `quadrant 改善施策の優先度
x: 効果
y: 実現しやすさ
右上: すぐやる
左上: 余力があれば
左下: 見送り
右下: 計画して取り組む
問い合わせフォームの改善 | 70 | 85
検索の高速化 | 85 | 40
多言語対応 | 60 | 20
社内報の電子化 | 25 | 75
旧システムの廃止 | 40 | 30
`,
  "gantt": `gantt 新システム導入の工程
タスク | 開始 | 終了
要件定義 | 2025/4/1 | 2025/4/30
設計 | 5/1 | 6/15
開発 | 6/1 | 8/31
総合テスト | 9/1 | 9/30
本番稼働 | 10/1
旧システム停止 | 10月 | 11月
`,
  "gantt-short": `gantt 研修の準備
資料作成: 4/1 〜 4/12
会場の手配: 4/3 〜 4/5
リハーサル: 4/15 〜 4/16
研修当日: 4/18
`,
  "steps-paras": `steps TCP/IP スタック自作の進め方
1. 準備段階: Rust とネットワークの最低限の基礎
  Rust: 所有権、借用、構造体、enum、Result、Vec、スライス
  ネットワーク: IP アドレス、MAC アドレス、パケット、OSI 参照モデルと TCP/IP の階層
2. Step 1〜3: ネットワークスタックの土台
  ネットワークデバイス、ドライバ、プロトコル管理
  Rust: trait、struct、impl、モジュール、Box
3. Step 4〜9: IPv4 と ICMP
  IP ヘッダの解析、チェックサム、ICMP Echo
`,
  "cards-plan": `cards 料金プラン
- Starter | ¥4,800 | 月額相当
  - 基本分析
  - メールサポート
- Pro | ¥11,200 | 月額相当
  - 高度な分析
  - API アクセス
  - 優先サポート
- Business | ¥22,000 | 月額相当
  - SSO
  - 監査ログ
  - 専任サポート
note: 架空のサービス・料金です。
`,
  "stat": `stat 今月の営業実績 [2]
売上 | 3,200万円 | 前年比 +18%
新規顧客数 | 165社
解約率 | 2.2% | 前月 2.6%
平均単価 | 19.4万円
`,
  "flow-branch": `flow 経費精算
精算書提出 -> 上長承認
上長承認 -承認-> 経理確認
上長承認 -差戻し-> 修正
修正 -> 精算書提出
経理確認 -> 支払
`,
  "flow-mermaid-lr": `flow 承認ルート
flowchart LR
A[申請] --> B{金額 100万円以上?}
B -->|はい| C[部長承認]
B -->|いいえ| D[課長承認]
C --> E([決裁])
D --> E
`,
  "flow-hiring": `flow 採用選考
書類選考 -合格-> 一次面接 -合格-> 二次面接 -合格-> 最終面接 -合格-> 内定
書類選考 -不合格-> 不採用通知
一次面接 -不合格-> 不採用通知
二次面接 -不合格-> 不採用通知
最終面接 -不合格-> 不採用通知
`,
};
// 評価の課題から、行の多いグラフも加える
const tasks = readFileSync(join(import.meta.dirname, "../eval/tasks/tasks.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const extra: Record<string, Figure> = {
  "long-prefectures": tasks.find((t: { id: string }) => t.id === "long-001").gold,
  "long-daily-line": { ...tasks.find((t: { id: string }) => t.id === "long-002").gold, kind: "line" },
  "stack-eval-012": tasks.find((t: { id: string }) => t.id === "stack-012").gold,
};

const figures: [string, Figure][] = [
  ...Object.entries({
    ...samples,
    // v0.9 の種類は README の見本をそのまま使う
    ...Object.fromEntries(["compare", "proscons", "swot", "checklist", "app"].flatMap((k) => [[k, SAMPLES.ja[k]!], [`${k}-en`, SAMPLES.en[k]!]])),
  }).map(([k, src]) => {
    const r = parseBlock(src, { final: true });
    if (!r.figure) throw new Error(`${k}: ${JSON.stringify(r.diagnostics)}`);
    return [k, r.figure] as [string, Figure];
  }),
  ...Object.entries(extra),
];

const cells = figures
  .map(([k, f]) => `<section><h2>${k}</h2><div class="row"><div class="w640">${renderSVG(f, { width: 640 })}</div><div class="w360">${renderSVG(f, { width: 360 })}</div></div></section>`)
  .join("\n");
writeFileSync(
  join(out, "gallery.html"),
  `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:16px;font-family:system-ui;background:#f9f9f7;color:#0b0b0b}
:root[data-theme="dark"] body{background:#0d0d0d;color:#f0efec}
h2{font-size:12px;font-weight:500;opacity:.6;margin:16px 0 6px}
.row{display:flex;gap:16px;align-items:flex-start}
.w640{width:640px;background:var(--bg,#fcfcfb);border-radius:12px}
.w360{width:360px;background:var(--bg,#fcfcfb);border-radius:12px}
:root[data-theme="dark"] .w640,:root[data-theme="dark"] .w360{--bg:#1a1a19}
</style></head><body>${cells}</body></html>`,
);
for (const [k, f] of figures) writeFileSync(join(out, `${k}.light.svg`), renderSVG(f, { width: 640, theme: "light" }));
console.log(`${figures.length} figures -> ${out}`);
