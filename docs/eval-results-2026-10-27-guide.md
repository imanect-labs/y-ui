# 評価結果: 説明をパッケージから作り、書き方を必要なときに読む（方式 I）

2026-10-27、Luna（OpenCode Go の `gpt-6-luna`、effort=low）。全課題 × 2 回。課題・採点は 2026-10-16 と同じ。

## 比べたもの

| 方式 | system に置くもの | 書き方 |
|---|---|---|
| F（出荷中） | Shiki の `yui_guide.md`（main の `a3a201f`。5 種類だけを説明） | system の中 |
| I | Shiki の決まり（使う場面・ツールで読むこと）＋共通の決まり＋27 種類のうち 25 種類の早見（ask・plan を除く） | `ui_reference` で種類を指定して読む（`@imanect/yui/guide` の `kindGuide`） |

F は Shiki の main で出荷中の説明で、5 種類以外を「描けない」と書いているため、v0.7 以降の種類は描けない（円グラフを断る）。

## 結果

| | F（出荷中） | I（1 回目） | I（直した後） |
|---|---:|---:|---:|
| 合格率 | 50.2%（282 / 562） | 92.8%（512 / 552） | **93.8%**（518 / 552） |
| 図を出した応答 | 357 | 509 | 510 |
| 書き方を読んだ応答 | — | 487 | 500 |
| 入力トークン（1 課題の平均・全ターン） | 1,107 | 3,426 | 3,520 |

種類ごと（I は直した後）:

| 種類 | F | I |
|---|---:|---:|
| pie | 4 / 36 | **36 / 36** |
| scatter・timeline・tree・gantt・funnel・progress・swot・map・radar | 0 | すべて合格 |
| calc | 0 / 16 | 16 / 16 |
| treemap | 2 / 4 | 4 / 4 |
| proscons | 0 / 10 | 10 / 10 |
| compare | 0 / 12 | 11 / 12 |
| checklist | 0 / 10 | 9 / 10 |
| cards | 0 / 16 | 14 / 16 |
| quadrant | 0 / 12 | 10 / 12 |
| app | 0 / 10 | 8 / 10 |
| callout | 0 / 4 | 1 / 4（用途を直して 4 / 8） |
| steps | 10 / 20 | 17 / 20 |
| bar・line・stat | 127 / 130 | 128 / 130 |
| flow | 33 / 40 | 33 / 40 |
| stack | 26 / 32 | 21 / 32 |
| 図が要らない課題（none-unneeded・none-nodata） | 40 / 40 | 40 / 40 |

- **書き方を読んでから書けば崩れない。** 1 回目は、読んだ応答の合格が 95.1%（461 / 485）、読まずに書いた応答は 50%（12 / 24）。読まずに書いたのは callout（重さの語を付けない）・cards・proscons（独自の形）が多い。
- **図が要らない応答で図を出しすぎない。** 「積極的に図を添える」と書いても、none-unneeded は 20 / 20（直した後）・40 / 40（callout の再実行と合わせて）。
- stack は 1 回目 25 / 32、直した後 21 / 32。stack の書き方は直していないので回ごとのぶれと見る。失敗は箱の粒度（層の中の要素を別の層にする・まとめる）と、通信経路を flow で書いたもので、構文の誤りは無い。

## 直したこと

1 回目の失敗から:

- **calc の書き方に、`docs/calc.md` の決まりを足した**（`KIND_GUIDE.calc`）: 名前に記号・括弧を含めない（`身長(m)` が構文の誤り）、比較は `==`、式の中の数は半角だけ、動かしたい値は入力にして範囲を広く取る。calc は 10 → 16 / 16。
- **Shiki の決まりで「早見には書き方が無い。どの種類も書く前に必ず読む」と強めた**。書き方を読んだ応答が 487 → 500。proscons は 7 → 10 / 10。
- **callout の用途に重さ（info・success・warning・danger）を書いた**（早見の 1 行に出る）。callout の課題だけ 4 回ずつ再実行して 1 / 4 → 4 / 8（`eval/runs/2026-10-27-luna-guide-I3-callout`）。callout は書き方を読まずに書かれやすく、まだ弱い。

## 実行

各実行の `shiki-yui_guide.md` が、その実行で読んだ Shiki の決まりの本文（`config.json` の `shiki.yuiGuideSha256` はその SHA-256）。Shiki のコミット（`a3a201f`）は早見を組み込む前の main で、I・I2 の決まりは組み込み中の作業ツリーから読んだ。早見と書き方はこのリポジトリの定義から作り、I は calc・callout を直す前、I2 は calc を直した後、I3 は callout も直した後の定義。

- F: `eval/runs/2026-10-27-luna-guide-F-main`（`--shiki-root` は shiki-platform の main `a3a201f`）
- I（1 回目）: `eval/runs/2026-10-27-luna-guide-I`
- I（直した後）: `eval/runs/2026-10-27-luna-guide-I2`、`eval/runs/2026-10-27-luna-guide-I3-callout`

```sh
NODE_USE_ENV_PROXY=1 LUNA_GO_API_KEY= pnpm eval run --models luna-go --arms I --seeds 2 --shiki-root ../shiki-platform
```
