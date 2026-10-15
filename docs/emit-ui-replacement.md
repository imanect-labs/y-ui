# Shiki の emit_ui を Yui に置き換える計画

状態: 方針決定（2026-10-15、human）。この順で実装する。

## 決定

- Shiki の生成 UI（`emit_ui`・`UiSpecDoc`・`crates/gui` の部品の一覧と web の `components/genui`）を、回答の本文の ```ui ブロック（Yui）に置き換え、`emit_ui` を消す。
- 本文の ```ui ブロックのうち、操作を持つ種類（app・ask・plan）は押せる（`docs/design.md` §4.7 の「表示専用」を改める）。押せる人は **会話の編集者 ∧ 実行先の権限**。
- 既存の emit_ui のデータ（会話の `generative_ui`・ミニアプリの `ui_spec`・ノートの埋め込み）は本番に無いので移行しない（消す）。
- ミニアプリの画面は **Yui を含む Markdown 文書**（説明文と ```ui ブロック）。ボタンの実行先は、そのアプリに固定したワークフローの中からだけ選べる。
- Markdown で書けるものは Markdown に任せ、部品を減らす。

## 部品の対応

| emit_ui | Yui / Markdown |
|---|---|
| form・button | `app`（文字・数値・選択・日付・期間・評価・オンオフ・スライダー、「その他」の自由記述） |
| question_card | `ask`（新規。質問ごとの選択肢と説明・複数選択・その他・自由記述。回答は会話に送る） |
| plan_card | `plan`（新規。手順と「この計画で進める」「修正を依頼」） |
| chart（bar・line・area・pie・donut・scatter・funnel） | bar・line（`stacked`）・pie・scatter・funnel |
| chart（radar・treemap） | `radar`・`treemap`（新規） |
| chart（radial_bar・combo） | progress・別々のグラフ（2 軸は使わない） |
| stat | `stat`（前期比と推移の小さな折れ線を足す） |
| comparison | `compare` |
| timeline・itinerary | `timeline` |
| stepper | `checklist` |
| callout | `callout`（新規。info・success・warning・danger） |
| map | `map`（新規。データは Yui、描画はホストの地図部品） |
| table・key_value・code_block・text・link・container | Markdown（表・リスト・コード・本文・リンク） |
| tabs・accordion・badge_list・weather・source_card | 無くす（見出しと本文・stat・cards・既存の引用で書く） |

## 安全性（今の emit_ui の穴を塞ぐ）

1. **押せる人**: ボタンの実行は、会話の **編集者** の確認を先に通す（閲覧者は押せない）。実行は押した人の権限（ワークフローは本人 ReBAC ∩ declared_scopes）。
2. **値の検証**: サーバーで、部品の定義（Yui の `validateAppValues` と同じ規則・Rust 版）と、ワークフローの `input_schema`（型・必須・enum・範囲）の両方で検証する。
3. **二重起動**: 会話に送るボタン（ask・plan・`-> chat`）は 1 回だけ（今の `ui_action_invocation`）。ワークフローは押すたびに冪等キーを付け、同じキーは 1 回だけ起動する（新しい表）。
4. **結果を会話に残す**: 起動・完了・失敗を会話に記録する。モデルは次の回答でそれを読める（履歴に入れる）。完了は run の終端を見張って記録する。
5. **束縛の解決**: 回答が確定したとき、サーバーが本文の操作を持つブロックを読み、`-> workflow 名前` を **回答した主体の権限** で解決して版を固定し、メッセージに表示しない宣言として保存する。ボタンの id は `{ブロックのソースの SHA-256 の先頭 16 桁}:{a1}`。宣言の無いボタンは押せない。
6. **ブロックの改ざん**: 宣言は回答の確定時の本文から作る。画面から送られるのは id と値と冪等キーだけで、束縛は送れない（今と同じ）。

## 実装の順

Yui（このリポジトリ）:

1. 新しい種類 `ask`・`plan`・`map`・`radar`・`treemap`・`callout`、`stat` の前期比と推移、`app` の評価・期間・その他。React の `onAction` を ask・plan にも。地図はホストの描画を差し込む口（`renderMap`）。
2. 評価の課題と説明。0.8.0 として公開（公開の workflow の起動と npm の承認は human）。

Shiki:

1. Rust 版のパーサ（操作を持つ種類と値の検証。`spec-tests/` の課題集で TS 版と一致させる）。
2. 回答の確定時の宣言の作成・保存、ui-actions の経路（編集者・値の検証・入力スキーマ・冪等キー・結果の記録・完了の見張り）。
3. web: 本文の ```ui の操作を ui-actions につなぐ。run の状態を図の中に出す。
4. 確認・計画の段階（gate）を ask・plan に置き換える。
5. ミニアプリの画面を Yui を含む Markdown にし、「アプリとして保存」・アプリの画面・編集画面を置き換える。
6. ノートの埋め込み（`document.embed` の genui）を ```ui に置き換える。
7. emit_ui・`crates/gui` の部品の一覧と検証・web の genui・スタブ・スキルの許可ツール・参照ページを消し、既存の generative_ui・ui_spec のデータを消す移行。
8. 文書（design.md §4.7・miniapp-platform.md・roadmap・design-caveats の PIT）と yui_guide.md。
