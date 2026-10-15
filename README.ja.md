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

流れ図。分岐はひし形、ラベルは分かれた直後に置き、ループは脇を回す。

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


行の多い棒グラフは横向きに、流れ図の分岐はひし形に、ループは脇を回して描きます。どの図も幅に合わせて組み直し、ライト・ダークに追従します。記法の詳細は [docs/spec.md](docs/spec.md)。

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
