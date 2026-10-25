# 図の編集（ドラッグ＆ドロップ）

状態: Yui 側（§4）は実装済み（0.9.0・公開待ち）。Shiki への組み込み（§6）は実装済みで、0.9.0 の公開を待って取り込む。調査は 2026-10-24、y-ui main 468801f・shiki-platform main 5742f73。

## 1. 目的

Shiki のミニアプリの画面（Yui の ```ui を含む Markdown）を、記法を書かずにドラッグ＆ドロップで作り、直せるようにする。

- 今の Shiki の作成・編集ダイアログ（`web/src/components/artifacts/miniapp-editor.tsx`）は textarea に記法を書き、「プレビュー」タブで確かめる形だけ。
- Shiki の正本ドキュメントは、ミニアプリの作成手段を「コードエディタ・dnd（ワークフロー/UI）・チャット」の 3 つとし（`docs/miniapp-platform.md` §6）、AI が作ったものを人がそのまま dnd で直せることを原則にしている（同 §2.1）。ワークフローの dnd は実装済み（React Flow・Task 10.12）だが、UI の dnd はまだ無かった。
- 最初の対象は `app`（入力部品とボタン）と、Shiki 側の画面全体（文章と図の並び）。その他の種類は後で扱う（§8）。

## 2. 原則

1. **正本はソースのまま。** 保存するのは今と同じ Markdown（`MiniAppBody.screen`）。エディタは IR を直し、`toSource` で書いたソースでそのブロックの中身だけを置き換える。サーバー（`crates/gui/src/miniapp.rs` の検証、`miniapp_actions.rs` の実行）・版の固定・権限には手を入れない。
2. **見えている形 = 保存される形。** チェッカー（§4.2）がエラーなしと言った図は、`parseBlock(toSource(f))` が必ず `f` に戻る（乱数の課題 5000 通りで確かめている）。戻らない図はエラーになり、ホストは保存を止める。
3. **書けないものは書かせない。** 実行先はホストが渡したワークフロー名の閉じた集合からだけ選ぶ（ミニアプリなら束ねたワークフローの別名）。見た目（配置・色・幅）の設定は増やさない。並べ順と部品の設定だけを持つ。
4. **Yui は実行しない・依存を増やさない。** エディタも今の React 部品と同じく `createElement` と CSS の文字列で作り、DnD のライブラリを入れない（peer は react だけのまま）。
5. **マウス・タッチ・キーボードのどれでも同じことができる。** ドラッグは近道で、押して足す・設定パネルの ↑↓・キーボードでも同じ操作ができる。

決定（2026-10-24、human）: 範囲は app のエディタと画面の構成の両方。DnD は自前。正規化（§6.1）は受け入れる。記法は選択肢の縦棒の書き方と片側の範囲の警告だけ直し、他はエディタで拒む（§5）。

## 3. 全体の形

```
Shiki（ミニアプリの編集ダイアログ）
  ├─ 画面の構成（Shiki が作る）: splitMarkdown で文章と図の並びにし、並べ替え・追加・削除
  │    ├─ 文章の段落 … textarea（Markdown）
  │    └─ ```ui app … ↓ の AppEditor
  └─ タブ: 「組み立てる」（新規）/「書く」（今の textarea）/「プレビュー」

@imanect/yui/editor（React を使わない）
  ├─ model: app の IR を直す純粋関数（追加・移動・削除・設定の変更・上限の確認）
  └─ check: チェッカー（場所つきの問題）と、ソースを開けるかの確認（checkEditable）

@imanect/yui/editor/react
  ├─ useDnd: ポインタイベントによる並べ替え（ライブラリなし）
  └─ AppEditor: パレット＋キャンバス＋設定パネル＋問題の一覧＋元に戻す
```

画面全体（Markdown）の構成を Shiki 側に置くのは、文章の描画（`Markdown` 部品・テーマ）が Shiki の持ち物だから。Yui は図 1 つの編集までを持つ。

## 4. Yui 側

### 4.1 model（`packages/core/src/editor/model.ts`）

```ts
interface Place { section: number; index: number }   // 挿入なら「この前に置く」位置（末尾は length）
type EditResult = { ok: true; figure: AppFigure } | { ok: false; problem: EditProblem };

emptyApp(title?) / newField(f, type, label?, ja?) / changeType(field, type, ja?) / newAction(f, workflow | null, ja?)
insertField / updateField / removeField / moveField(f, from: Place, to: Place)   // 機能をまたいで動かせる
insertAction / updateAction / removeAction / moveAction
insertSection(f, index, title?, ja?) / updateSection / removeSection / moveSection
updateApp(f, { title?, note? }): AppFigure                                       // これだけは失敗しないので図を返す
```

- `newField` は種類ごとの既定値を入れる（choice は 2 つの選択肢、slider は 0..100、count は 0..10、rating は 5 段階）。ラベルは図の中で重ならない名前にする。
- 上限（機能 6・1 機能の入力 20・全体の入力 40・1 機能のボタン 3）を超える追加・移動は `ok: false`。
- 設定の中身（ラベルの文字など）の良し悪しは model では決めず、チェッカーが知らせる（打ちかけの文字を拒むと入力しづらいため）。
- `key`（`as キー`）: 英字の key はラベルを変えても残す（実行先の入力名がずれないように）。key がラベルと同じ（`as` なし）なら、`updateField` でラベルを変えると key も変わる。日本語の key は `as` で書けない（`as` は英字の名前だけ）ので、別に保てないため。
- 機能を足して 2 つ以上になるときは、見出しの無い機能に仮の見出し（「機能 2」）を付ける（見出しが機能の区切りのため）。
- ボタンの id（`a1`・`a2`…）は位置で決まるので、並べ替えるたびに振り直す。ミニアプリは版ごとに画面を読み直すので問題ない。
- workflow のボタンは必ず確認を挟む（記法に「確認なし」は無い）。`newAction`・`insertAction`・`updateAction` のどれも `confirm: true` にする。

### 4.2 チェッカー（`packages/core/src/editor/check.ts`）

型チェッカーのように、どの部品のどの設定がなぜ駄目かを場所つきの文で返す。

```ts
interface Problem { severity: "error" | "warning"; code: string; message: string; path: { section?; field?; action?; prop? } }
checkApp(figure, { workflows?: { name; inputs?: WorkflowInputHint[] }[]; allowChat?; locale? }): Problem[]
hasErrors(problems) / problemsAt(problems, path)
checkEditable(source, kindHint?: "app"): { ok: true; figure } | { ok: false; diagnostics; reason }
```

見るのは 3 つ。

既定は閉じた側に倒す: `workflows` を渡さなければどのワークフローも選べず（エラー）、`allowChat` の既定は false。

1. **記法で書けるか**: 改行になる文字（`\n` のほか `\r`・U+2028 など。Yui は `\n` だけで行を分けるが、Markdown は `\r` でも分けるので、混ざると両者の読み方がずれる）、ラベルの `=`・先頭の `-` `#` `>` `button`・全角英数（半角で保存される）、key の形、例・単位・初期値の中の設定の言葉（`必須` `multi` `as …` など）、範囲の片側だけ・最小 > 最大、単位が数字で始まる、選択肢の `=`・「その他」・重なり、機能の見出し、空の機能、上限、文字数、改行。
2. **実行先の約束**: 選べないワークフロー、会話に送れない場所の `-> chat`。ホストがワークフローの入力（`inputs`）を渡せば、足りない必須の入力・必須の付け忘れ・知らない名前・型の違いを警告する。
3. **書いて読み直す**: 1・2 でエラーが無ければ最後に `parseBlock(toSource(f))` と比べ、変わった場所と設定を言う（「保存すると『初期値』が変わります（z → なし）」）。1 で拾えない組み合わせもここで必ず捕まえる。

error は保存すると内容が変わる・実行できないもの（ホストは保存を止める）。warning は保存できるが意図と違うかもしれないもの。何も置いていない画面は error（`empty`）だが、エディタは失敗としてではなく始め方の案内として見せる。

`checkEditable` は、ソースに診断が 1 つでもあればエディタで開かない（黙って正規化すると、読めなかった行を落としてしまうため）。行の番号つきで理由を返す。

### 4.3 useDnd（`packages/core/src/editor/react/dnd.ts`）

- 置き場所の一覧は DOM の印で見つける: `data-yui-list="<id>"`（並ぶ向きは `data-yui-axis`）と直下の `data-yui-item`。入れ子の一覧（機能の一覧の中の部品の一覧）は、指の下で一番内側のものを選ぶ。置ける一覧は `accepts(item, list)` で決める。
- マウスは 4px 動いたら掴む。取っ手（`touch-action: none`）からは押した時点で掴む（タッチでスクロールと取り合わない。長押しは使わない）。
- 掴んでいる間は札と挿入位置の線を出し、スクロール領域の端で自動でスクロールする。Escape で取り消す。離した直後の click は 1 回飲み込む。
- HTML5 の Drag and Drop API は使わない（タッチで動かず、見た目も選べないため）。

### 4.4 AppEditor（`packages/core/src/editor/react/editor.ts`）

```ts
interface AppEditorProps {
  figure: AppFigure;
  onChange: (next: AppFigure) => void;
  workflows?: readonly WorkflowChoice[];                           // 実行先の閉じた集合（中身で比べるので、その場で作った配列でもよい）
  allowChat?: boolean;                                               // 既定 false（ミニアプリでは使えない）
  onProblems?: (problems: Problem[]) => void;                        // ホストは error があれば保存を止める
  theme?: ThemeMode;
  locale?: string;
  className?: string;
}
```

- `onProblems` は問題の中身が変わったときだけ呼ぶ（ホストが状態に持っても描き直しが続かない）。
- パレット: 入力 11 種類・ボタン（ワークフローごと・会話に送る）・機能。ドラッグで置くか、押して選んでいる機能の末尾に足す。選んでいる機能のボタンの実行先に足りない入力があれば、key・必須・選択肢が埋まった部品として一覧の最後に出す。
- キャンバス: 部品は `AppView` と同じ `FieldView` で描き（操作はできない）、取っ手・選択の枠・問題の印（左の線・数のバッジ・設定の下の文）を重ねる。空の機能には始め方と、よく使う部品を押して足すボタンを出す。
- 設定パネル: 種類・ラベル・送る名前（key）・必須・例・範囲・刻み・単位・段階・選択肢（足す・並べ替え・消す）・複数・その他・初期値。ボタンは文言と実行先。各欄の下にその設定の問題を出す。
- 問題の一覧: キャンバスの上。押すとその場所を選び、該当する欄にフォーカスを移す。
- 元に戻す・やり直す（Ctrl/⌘+Z・Ctrl+Shift+Z・Ctrl+Y、100 回まで）。
- キーボード: 項目にフォーカスして Space で掴み、↑↓（ボタンは ←→ も）で動かし、Space か Enter で置く。Escape で並びと選択を掴む前に戻す。掴んだまま別の場所へフォーカスを移すと、そこで置いたことになる。掴んでからの動きは 1 回の操作として記録する（動かさなければ記録しない）。掴んでいないときの Enter は選ぶだけ。Alt+↑↓ は掴まずに 1 つ動かす（フォーカスは動かした項目に付いていく）。Delete・Backspace で消す。結果は `aria-live` で読み上げる。
- 幅は自分の幅で決める（ダイアログに埋め込むため）: 880px 以上は 3 列、600px 以上はパレットを上の帯にして 2 列、それより狭いと 1 列で、設定は選んだ項目の直下に開く。
- 見た目の確かめ方: `pnpm tsx scripts/editor-demo.ts <dir>` で確認用のページを作り、`pnpm tsx scripts/editor-shots.ts <dir> <out>` で明暗・3 つの幅・選択・ドラッグ途中を撮る（ドラッグ・キーボード・元に戻す・はみ出しの結果も出力する）。手元のブラウザを使うときは `CHROMIUM_PATH`。

## 5. 往復で値が落ちる場合と扱い

IR では表せるが、ソースに書くと戻らない状態がある。調査で確かめたものと、その扱い。

| IR の状態 | 読み直した結果 | 扱い |
|---|---|---|
| choice の選択肢に縦棒（`|`・`｜`） | 選択肢が分かれる | **記法を直した**: choice の選択肢・初期値の中の縦棒は前にバックスラッシュを付けて書き（`A\|B`）、`toSource` もそう書く |
| number に最小だけ（`1..`・`1..円`） | 単位が「1..」になっていた | **パーサに警告を足した**（片側だけの範囲は読まずに警告し、単位に紛れ込ませない）。エディタは両方か無しに限る |
| ラベルに `=` | 部品ごと消える | エディタで拒む |
| 例・初期値に `必須` `multi` などの単語 | オプションとして読まれる | エディタで拒む（どこに書いても読む寛容さは LLM のために残す） |
| 見出しの無い機能が 2 つ以上 | 1 つにまとまる | エディタで見出しを必須にする |
| workflow のボタンで確認なし | 確認ありに戻る | 仕様どおり。設定を出さない |

記法を直したもの（縦棒の書き方・片側の範囲の警告）は Rust 版（shiki-platform `crates/yui`）も同じ規則にし、`spec-tests/app.json` に課題を足した（`escapedChoice`・`halfRange`）。

## 6. Shiki への組み込み

### 6.1 ミニアプリの編集ダイアログ

- `miniapp-editor.tsx` の「書く / プレビュー」に「組み立てる」を足す。保存（`createMiniApp` / `updateMiniApp`）・ワークフローの束ね方・スキルの選択は今のまま。チェッカーに error がある間は保存を止める。
- 画面の構成: `splitMarkdown(screen)` で文章と図の並びにし、行を並べ替え・追加（文章・app）・削除できるようにする。文章の行は textarea、app の行は AppEditor、その他の図はソースのまま。
- 書き戻し: 変わったブロックの中身だけを置き換えて Markdown をつなぎ直す。fence の info とほかの文章は 1 文字も変えない。
- 編集に入れないブロック: `checkEditable` が拒むものは「この図は記述に直せない行があります。書くタブで直してください」と行の番号を出し、ソースのまま表示する。
- 正規化: 組み立てるで直したブロックは正規形（`必須`・`as`・順序が揃った形）に書き直される。意味は変わらない。直したブロックだけで、最初に一度知らせる。
- `workflows` には束ねたワークフローの別名（`pins[].alias`）を渡す。`inputs` は各ワークフローの IR の `input_schema`（JSON Schema のサブセット）から Shiki 側で作る。

### 6.2 変えないもの

- サーバー: 画面の検証、押されたときの読み直しと値の検証、冪等キー、押した本人の権限での起動は、どれもソースを見るので、エディタが作った画面にもそのまま効く。認可の境界は変わらない。
- 保存の形式（`MiniAppBody`）と migration は増えない。

### 6.3 後で

- ノート（TipTap）の ```ui ブロックに「図を編集」を足し、同じ AppEditor をダイアログで開く。
- 会話の回答の app を「アプリとして保存」したあとに組み立てるで開く導線。

## 7. 進め方

| 段階 | リポジトリ | 内容 | 状態 |
|---|---|---|---|
| 1 | y-ui | 記法の直し（§5）・model・チェッカー | 実装済み |
| 2 | y-ui | useDnd・AppEditor | 実装済み（0.9.0） |
| 3 | shiki-platform | Rust 版の追従（縦棒の書き方・片側の範囲の警告） | 実装済み |
| 4 | shiki-platform | `@imanect/yui` を上げ、編集ダイアログに組み立てると画面の構成 | 実装済み。0.9.0 の公開を待って取り込む |

## 8. 対象を広げるとき

- 項目を並べる図（cards・steps・checklist・timeline・tree・stack・proscons・swot）: 並べ替えと項目の追加・削除だけの共通エディタ（useDnd を使う）。tree・stack は字下げ（入れ子）の移動が要る。
- 表の図（bar・line・pie・compare など）: DnD より表の編集（行・列の追加と並べ替え）が合う。別に検討する。
- flow: Yui は配置を自分で決めるので、位置の編集は持たない。
