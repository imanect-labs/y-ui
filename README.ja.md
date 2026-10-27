# Yui（結）

[English](README.md)

**文章と UI を結ぶ。** Markdown の中に ` ```ui ` ブロックで図を書くための小さな記法と、そのパーサ・SVG レンダラー・React 部品です。
チャットの回答やノートのエディタに、Markdown レンダラーと同じ感覚で組み込めます。

````md
```ui
bar 四半期ごとの売上と利益
unit: 百万円
四半期 | 売上 | 利益
Q1 | 120 | 30
Q2 | 150 | △5
```
````

- **LLM にはデータだけを書かせる。** 配置・配色・目盛りはレンダラーが決める。小さなモデルでも短い説明で正しく書ける。
- **モデルが書き慣れた形を受け付ける。** Markdown の表・箇条書き・Mermaid 風の矢印、日本語の数値表記（`1億2,000万円`・`△120`）をそのまま読む。
- **生成途中から描ける。** 1 行ずつ確定して描画し、途中で誤った値を見せない。
- **どんなテキストでも安全。** HTML・URL・スクリプトを持たない。画面に出るのは文字と数値だけ。

npm: [`@imanect/yui`](https://www.npmjs.com/package/@imanect/yui)

## 図の種類

### `bar`

棒グラフ。負の値は基線の下に伸びる。行が多い・項目名が長いときは横向きになる。

<img src="docs/images/ja-bar.png" width="640" alt="bar">

````md
```ui
bar 四半期ごとの売上と利益
unit: 百万円
四半期 | 売上 | 利益
Q1 | 120 | 30
Q2 | 150 | -5
Q3 | 135 | 12
Q4 | 210 | 44
```
````

### `line`

折れ線グラフ。系列が 2 つ以上なら凡例が付く。

<img src="docs/images/ja-line.png" width="640" alt="line">

````md
```ui
line 週次アクティブユーザー
週 | Web | アプリ
第1週 | 1200 | 800
第2週 | 1350 | 950
第3週 | 1280 | 1100
第4週 | 1500 | 1300
第5週 | 1620 | 1250
第6週 | 1580 | 1420
```
````

### `pie`

円グラフ（ドーナツ）。中央に合計、凡例に値と割合を出します。扇は書いた順に並びます。

<img src="docs/images/ja-pie.png" width="640" alt="pie">

````md
```ui
pie 事業別の売上構成
unit: 億円
事業 | 売上
クラウド | 145
保守サポート | 98
オンプレミス | 52
研修 | 31
コンサルティング | 24
```
````

### `scatter`

散布図。2 つの量の関係に使います。4 列目で色分けし、点が 15 個までなら名前を添えます。

<img src="docs/images/ja-scatter.png" width="640" alt="scatter">

````md
```ui
scatter 店舗別の広告費と売上
店舗 | 広告費（万円） | 売上（百万円） | 地域
新宿 | 120 | 48 | 東京
渋谷 | 95 | 41 | 東京
池袋 | 80 | 30 | 東京
梅田 | 110 | 39 | 大阪
難波 | 60 | 22 | 大阪
天神 | 45 | 19 | 福岡
博多 | 70 | 27 | 福岡
```
````

### `stat`

数値カード。値は書いたまま表示し、3 列目は補足。

<img src="docs/images/ja-stat.png" width="640" alt="stat">

````md
```ui
stat 今月の営業実績
売上 | 3,200万円 | 前年比 +18%
新規顧客数 | 165社
解約率 | 2.2% | 前月 2.6%
平均単価 | 19.4万円
```
````

### `flow`

流れ図。ラベル付きの分岐はひし形、ラベルは分かれた直後に置き、ループは脇を回す。`subgraph 名前` 〜 `end` で段階ごとに色付きの破線の枠で囲め（枠をまたぐ矢印は枠の間の通路を通る）、`**名前**` で箱を強調できる。

<img src="docs/images/ja-flow.png" width="640" alt="flow">

````md
```ui
flow 経費精算
精算書提出 -> 上長承認
上長承認 -承認-> 経理確認 -> 支払
上長承認 -差戻し-> 修正
修正 -> 精算書提出
```
````

### `stack`

層構成図。字下げした項目は層の中に入り、`|` で横に並ぶ。

<img src="docs/images/ja-stack.png" width="640" alt="stack">

````md
```ui
stack システム構成
- クライアント層: Web / Electron / 外部チャット
- Product API: タスク・会話・ユーザー・認証
- エージェント実行基盤: Elixir / Erlang OTP
  - Agent Process
  - Session / Journal
  - Scheduler / Loop
  - Lean Kernel
- LLM: OpenAI / Anthropic | Tools: 外部API | Storage: DB / Object Store
note: 公開資料を基にした論理構成図。
```
````

### `timeline`

年表。沿革・予定・時刻順の出来事に使います。書いた順に並べ、少なく短ければ横に並べます。

<img src="docs/images/ja-timeline.png" width="640" alt="timeline">

````md
```ui
timeline 会社の沿革
- 2015年4月: 創業（東京・渋谷）
- 2017年10月: 初の製品を発売
- 2019年6月: 大阪支社を開設 [1]
- 2021年1月: 導入企業 100 社を突破
  クラウド版の提供を開始
- 2024年4月: 東証グロース市場に上場
```
````

### `steps`

分岐の無い手順。番号は書いた順に振ります（分岐やループがあれば `flow`）。

<img src="docs/images/ja-steps.png" width="640" alt="steps">

````md
```ui
steps 経費精算の手順
1. 申請: 領収書を添えて精算システムに入力する
2. 上長の承認: 目的と金額を確認する
3. 経理の確認: 勘定科目と証憑を確認する
4. 支払: 翌月の給与と一緒に振り込む
```
````

### `tree`

階層。組織図・分類・目次に使います。字下げが深さ（4 段まで）で、幅に収まれば組織図、収まらなければ字下げの一覧にします。

<img src="docs/images/ja-tree.png" width="640" alt="tree">

````md
```ui
tree 組織図
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
```
````

### `cards`

要点・特徴・選択肢のカード。数値を大きく見せるなら `stat`。

<img src="docs/images/ja-cards.png" width="640" alt="cards">

````md
```ui
cards 新プランの特徴
- 共有がかんたん: フォルダごとに閲覧・編集の権限を付けられます
- 検索が速い: 社内文書を横断して、根拠付きで答えます [1]
- 監査に強い: 誰がいつ何を見たかをすべて記録します
```
````

### `progress`

目標に対する進捗。100% 以上は色が変わり、達成率は自動で計算します。

<img src="docs/images/ja-progress.png" width="640" alt="progress">

````md
```ui
progress 今期の目標の達成状況
項目 | 実績 | 目標
売上 | 8,200万円 | 1億円
新規顧客 | 132社 | 120社
研修の受講率: 64%
```
````

### `funnel`

段階ごとに減っていく数（選考・商談・購入まで）。前の段階からの割合を自動で計算します。

<img src="docs/images/ja-funnel.png" width="640" alt="funnel">

````md
```ui
funnel 採用の選考状況
unit: 人
応募 | 1200
書類選考通過 | 420
一次面接通過 | 150
最終面接通過 | 48
内定承諾 | 30
```
````

### `quadrant`

2 軸の位置づけ（優先度・ポジショニング）。位置は 0〜100、象限の名前は任意。

<img src="docs/images/ja-quadrant.png" width="640" alt="quadrant">

````md
```ui
quadrant 改善施策の優先度
x: 効果
y: 実現しやすさ
右上: すぐやる
左下: 見送り
問い合わせフォームの改善 | 70 | 85
検索の高速化 | 85 | 40
多言語対応 | 60 | 20
社内報の電子化 | 25 | 75
```
````

### `gantt`

工程表。1 日だけのものはマイルストーン（ひし形）。期間に応じて月ごと・週ごとの目盛りにします。

<img src="docs/images/ja-gantt.png" width="640" alt="gantt">

````md
```ui
gantt 新システム導入の工程
タスク | 開始 | 終了
要件定義 | 2025/4/1 | 2025/4/30
設計 | 5/1 | 6/15
開発 | 6/1 | 8/31
総合テスト | 9/1 | 9/30
本番稼働 | 10/1
```
````

### `calc`

操作できる計算機（段階 2）。スライダー・増減・選択・オンオフの入力から、式で結果を計算します。式は Yui が自分で解釈し、JavaScript は実行しません。React では操作できる部品で描き、書き出しは今の状態の静止画です。詳しくは [docs/calc.md](docs/calc.md)。

<img src="docs/images/ja-calc.png" width="640" alt="calc">

````md
```ui
calc 住宅ローンの試算
借入額 = slider 500..10000 step 100 初期 3000 万円
金利 = slider 0.1..5 step 0.05 初期 1.5 %
期間 = slider 5..35 初期 35 年
月利 = 金利 / 100 / 12
毎月の返済額 = 借入額 * 10000 * 月利 / (1 - (1 + 月利) ^ -(期間 * 12)) 円
総返済額 = 毎月の返済額 * 期間 * 12 / 10000 万円
show 毎月の返済額 | 総返済額
hide: 月利
```
````


行の多い棒グラフは横向きに、流れ図の分岐はひし形に、ループは脇を回して描きます。どの図も幅に合わせて組み直し、ライト・ダークに追従します。記法の詳細は [docs/spec.md](docs/spec.md)。全種類の一覧（用途・使い分け・書き方・オプション・上限）は [docs/kinds.md](docs/kinds.md)。

## 使い方

```tsx
// React（react-markdown のコードブロックを差し替える例）
import { YuiBlock, isYuiLanguage } from "@imanect/yui/react";

const code = ({ className, children }) =>
  isYuiLanguage(className)
    ? <YuiBlock source={String(children)} streaming={isStreaming} />
    : <code className={className}>{children}</code>;
```

```ts
// SVG（ブラウザでもサーバーでも同じ結果）
import { parseBlock, toText } from "@imanect/yui";
import { renderSVG } from "@imanect/yui/svg";

const { figure } = parseBlock(source, { final: true });
renderSVG(figure);                                 // 画面用: CSS 変数で明暗に追従、幅は親に合わせる
renderSVG(figure, { theme: "light", width: 720 }); // 書き出し用: 色と寸法を焼き込む
toText(figure);                                    // Yui 非対応の場所向けの表・箇条書き
```

```ts
// 書き出し（画像としてコピー・SVG / PNG で保存。ブラウザ）
import { copyFigure, downloadFigure } from "@imanect/yui/export";

button.onclick = () => copyFigure(figure);         // PNG・HTML（画像とデータの表）・テキスト・Yui のソースを一度に
downloadFigure(figure, "png", { scale: 2 });       // "svg" も可。色は焼き込み（既定は theme: "light"）
```

`copyFigure` は複数の形式をまとめてクリップボードに入れます。Word・Google ドキュメント・Gmail・Notion には画像として、Slack やテキストエディタには Markdown の表として、Yui 対応のアプリには編集できるソースとして貼れます。クリック操作の中で呼んでください（Safari は操作の中でしか書き込めません）。

描画は 1 本のレイアウトから SVG と React の両方を作るので、画面と書き出しの見た目がずれません。画面では、グラフにカーソルを載せる（または矢印キーで動かす）と値が出てその項目が強調され、流れ図は載せた箱とつながりが強調されます。既定の見た目は控えめで（枠線のカード・破線の目盛り・彩度を抑えた四季の色）、系列の色は色覚多様性のシミュレーションで明暗それぞれ検証しています。ダークモードは `<html class="dark">` か `data-theme` に、無ければ OS の設定に従います。`--yui-s1`〜`--yui-s8`・`--yui-ink`・`--yui-font` などの CSS 変数で差し替えられます。

## 画面の組み立て（ドラッグ＆ドロップ）

`app`（入力とボタンの画面）は、記法を書かずに組み立てられます。チェッカーが、保存すると内容が変わってしまう設定や選べない実行先を、部品の場所つきで知らせます。設計: [docs/editor.md](docs/editor.md)。

```tsx
import { toSource } from "@imanect/yui";
import { checkEditable, hasErrors } from "@imanect/yui/editor";
import { AppEditor } from "@imanect/yui/editor/react";

const r = checkEditable(source); // 読めない行のあるソースは開かない
if (r.ok) setFigure(r.figure);
// workflows は選べる実行先（閉じた集合）。渡さなければどのワークフローも選べない
<AppEditor figure={figure} onChange={setFigure} workflows={workflows} onProblems={(p) => setCanSave(!hasErrors(p))} />;
const saved = toSource(figure);
```

## 小さなモデルで書けるか

Gemma 4 31B（141 課題）で、JSON をツール呼び出しで出す方式と比べました。Yui は 92〜99%（JSON 方式は 72〜91%）で、トークンは 4 分の 1〜3 分の 1、応答時間は約半分でした。JSON 方式ではほぼ描けなかった流れ図・構成図も 70〜80% 描けています。詳細は [docs/eval-results-2026-10-12-gemma.md](docs/eval-results-2026-10-12-gemma.md)、評価計画は [docs/eval-plan.md](docs/eval-plan.md)。

## リポジトリ

| パス | 内容 |
|---|---|
| `packages/core` | `@imanect/yui`: パーサ・中間表現・テキスト化、`/svg` レンダラー、`/react` 部品 |
| `eval` | モデルがどれだけ正しく書けるかの評価（課題・採点・実行・レポート） |
| `scripts` | 描画の確認用ギャラリーと README の画像 |
| `docs` | 仕様・書き出しの設計・評価計画と結果 |

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm eval truncation        # 生成途中で切れたときの検証（モデル不要）
pnpm tsx scripts/readme-images.ts
```

`v*` のタグを push すると、GitHub Actions が npm に仮公開し（npm の Trusted Publishing。リポジトリにトークンは置かない）、メンテナーが 2 段階認証付きで承認して公開します。

## ライセンス

[MIT](LICENSE-MIT) または [Apache-2.0](LICENSE-APACHE) のどちらかを選んで使えます（`MIT OR Apache-2.0`）。Copyright (c) 2026 Imanect Labs.
