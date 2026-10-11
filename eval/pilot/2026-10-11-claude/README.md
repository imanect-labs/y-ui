# 予備評価 2026-10-11（Claude のサブエージェント）

[docs/eval-plan.md](../../../docs/eval-plan.md) §10 の予備評価の記録。Haiku を Gemma の、Sonnet を Luna の代役とした。

- `report.md`: 集計結果
- `results.jsonl`: 1 回答 1 行の採点結果
- `prompts-<方式>.md`: エージェントに渡したプロンプト（方式 B〜E）
- `answers-<モデル>-<方式>.md`: エージェントの回答。`-A-repair` は方式 A の修正ターン（検証エラーを渡して答え直させたもの）

方式 A のプロンプトと修正ターンのプロンプトは、Shiki の `emit_ui` の説明文を含むためこのリポジトリには置かない。
shiki-platform を隣に置いて `pnpm eval pilot-export --dir <dir>` / `pnpm eval pilot-repair-export --dir <dir> --model <m>` で再生成できる。

再採点: `cp eval/pilot/2026-10-11-claude/* <dir>/ && pnpm eval pilot-ingest --dir <dir> --model haiku`（sonnet も同様。方式 A には Shiki のソースが必要）
