# MiniUI

Markdown の中に ` ```ui ` ブロックで図を書くための、小さな記法とレンダラー。
チャットの回答やノートに、Markdown レンダラーと同じ感覚で組み込める Intelligent UI を目指します。

````
```ui
bar 月別売上 [1]
unit: 万円
月 | 売上 | 利益
1月 | 120 | 30
2月 | 150 | △10
```
````

- **LLM にはデータだけを書かせる。** 配置・配色・目盛りはレンダラーが決める。小さなモデルでも数行の説明で書ける。
- **モデルが書き慣れた形を受け付ける。** Markdown の表・箇条書き・Mermaid 風の矢印をそのまま読む。
- **生成途中から描ける。** 1 行ずつ確定して描画し、途中で誤った値を見せない。
- **どんなテキストでも安全。** HTML・URL・スクリプトを持たない。

状態: **v0.1 草案**。パーサと評価ハーネスまで。レンダラー（SVG / React）は未実装。

## 図の種類（v0.1）

| 種類 | 例 |
|---|---|
| `bar` / `line` | `月 \| 売上` の列名の行のあとに `1月 \| 120` |
| `stat` | `売上 \| 3,200万円 \| 前年比 +18%` |
| `flow` | `申請 -> 課長承認 -差戻し-> 申請` |
| `stack` | `- API サーバ: Node.js` と、字下げした `  - 認証` |

詳細は [docs/spec.md](docs/spec.md)。

## 構成

| パス | 内容 |
|---|---|
| `packages/core` | パーサ・中間表現・テキスト化（`@miniui/core`） |
| `eval` | 小さなモデルでの書きやすさの評価（課題・採点・実行・レポート） |
| `docs/spec.md` | 記法仕様 |
| `docs/export.md` | コピー・書き出しの設計 |
| `docs/eval-plan.md` | 評価計画（事前登録の採用基準） |

## 使い方

```ts
import { parseMarkdown, toText } from "@miniui/core";

for (const seg of parseMarkdown(streamingText)) {      // ストリーミング中でもよい
  if (seg.type === "ui" && seg.result.figure) {
    render(seg.result.figure, seg.result.diagnostics); // レンダラーは未実装
  }
}

toText(figure); // MiniUI 非対応の場所向けの表・箇条書き
```

## 開発

```bash
pnpm install
pnpm test              # vitest
pnpm typecheck
pnpm eval truncation   # 生成途中で切れたときの検証
pnpm eval run --mock --seeds 1
```

評価の実行方法は [docs/eval-plan.md](docs/eval-plan.md) §8。

## ライセンス

未定。
