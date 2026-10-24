# 図の編集（ドラッグ＆ドロップ）設計草案

状態: 提案（human の確認待ち。§9）。調査は 2026-10-24、y-ui main 468801f・shiki-platform main 5742f73。

## 1. 目的

Shiki のミニアプリの画面（Yui の ```ui を含む Markdown）を、記法を書かずにドラッグ＆ドロップで作り、直せるようにする。

- 今の Shiki の作成・編集ダイアログ（`web/src/components/artifacts/miniapp-editor.tsx`）は textarea に記法を書き、「プレビュー」タブで確かめる形だけ。
- Shiki の正本ドキュメントは、ミニアプリの作成手段を「コードエディタ・dnd（ワークフロー/UI）・チャット」の 3 つとし（`docs/miniapp-platform.md` §6）、AI が作ったものを人がそのまま dnd で直せることを原則にしている（同 §2.1）。ワークフローの dnd は実装済み（React Flow・Task 10.12）だが、UI の dnd はまだ無い。
- 最初の対象は `app`（入力部品とボタン）。次に画面全体（文章と図の並び）。その他の種類（cards・steps・checklist・tree など、項目を並べる図）は後で扱う（§8）。

## 2. 原則

1. **正本はソースのまま。** 保存するのは今と同じ Markdown（`MiniAppBody.screen`）。エディタは IR を直し、`toSource` で書いたソースでそのブロックの中身だけを置き換える。サーバー（`crates/gui/src/miniapp.rs` の検証、`miniapp_actions.rs` の実行）・Rust 版パーサ・版の固定・権限には手を入れない。
2. **見えている形 = 保存される形。** 編集のたびに `parseBlock(toSource(next))` が `next` に戻ることを確かめ、戻らない編集は受け付けない（§5）。エディタの状態は、記法で書ける状態だけに限る。
3. **書けないものは書かせない。** 実行先はホストが渡したワークフロー名の閉じた集合からだけ選ぶ（ミニアプリなら束ねたワークフローの別名）。見た目（配置・色・幅）の設定は増やさない。並べ順と部品の設定だけを持つ。
4. **Yui は実行しない・依存を増やさない。** エディタも今の React 部品と同じく `createElement` と inline style で作り、DnD のライブラリを入れない（peer は react だけのまま）。
5. **マウス・タッチ・キーボードのどれでも同じことができる。** ドラッグは近道で、メニュー（追加・上下に移動・削除）でも同じ操作ができる。

## 3. 全体の形

```
Shiki（ミニアプリの編集ダイアログ）
  ├─ 画面の構成（Shiki が作る）: splitMarkdown で文章と図の並びにし、並べ替え・追加・削除
  │    ├─ 文章の段落 … textarea（Markdown）
  │    └─ ```ui app … ↓ の AppEditor
  └─ タブ: 「組み立てる」（新規）/「書く」（今の textarea）/「プレビュー」

@imanect/yui/editor（Yui が作る・新しい入口）
  ├─ model: app の IR を直す純粋関数（追加・移動・削除・設定の変更・上限の確認・往復の確認）
  ├─ dnd:   ポインタイベントによる並べ替え（ライブラリなし。タッチの長押し・キーボード・自動スクロール）
  └─ AppEditor: 部品の一覧（パレット）＋キャンバス＋選んだ部品の設定パネル
```

画面全体（Markdown）の構成を Shiki 側に置くのは、文章の描画（`Markdown` 部品・テーマ）が Shiki の持ち物だから。Yui は図 1 つの編集までを持つ。

## 4. Yui 側（`@imanect/yui/editor`）

### 4.1 model（純粋関数・React を使わない）

```ts
type FieldPath = { section: number; field: number };
type ActionPath = { section: number; action: number };

function newField(type: AppField["type"], label: string): AppField;           // 種類ごとの既定値（choice は 2 択など）
function insertField(f: AppFigure, to: FieldPath, field: AppField): EditResult;
function moveField(f: AppFigure, from: FieldPath, to: FieldPath): EditResult;  // 機能をまたいで動かせる
function updateField(f: AppFigure, at: FieldPath, patch: Partial<AppField>): EditResult;
function removeField(f: AppFigure, at: FieldPath): EditResult;
// 機能（section）とボタン（action）にも同じ組（insert / move / update / remove）
function checkEditable(source: string): { ok: true; figure: AppFigure } | { ok: false; reasons: Diagnostic[] };

type EditResult = { ok: true; figure: AppFigure } | { ok: false; reason: EditError };
```

- 上限（機能 6・1 機能の入力 20・全体の入力 40・1 機能のボタン 3・ラベル 40 文字）は `LIMITS` から読み、超える編集は `ok: false`（パレットはそもそも置けない場所を示さない）。
- `key`（`as キー`）はラベルと別に持つ。ラベルを変えても key は変えない（実行先の入力名がずれないように）。key がラベルと同じなら `as` は書かれない（今の `toSource` のまま）。
- 機能が 2 つ以上なら見出しを必須にする（見出しの無い機能が並ぶと、ソースでは 1 つの機能に戻るため。§5）。
- ボタンの id（`a1`・`a2`…）は位置で決まるので、並べ替えると変わる。ミニアプリは版ごとに画面を読み直すので問題ないが、エディタは id を表に出さない。
- 各関数の最後で往復を確かめる（§5）。テストは vitest で、全関数 × 全種類の部品の往復を回す。

### 4.2 dnd（ライブラリなし）

- `pointerdown` → しきい値（マウス 4px・タッチは 250ms の長押し）で掴む → `setPointerCapture` で追う → 挿入位置の線を出す → `pointerup` で確定、`Escape` で取り消す。HTML5 の Drag and Drop API は使わない（タッチで動かず、見た目も選べないため）。
- 掴んでいる間はスクロール領域の端で自動スクロールする（スマホの縦長の画面で必要）。
- キーボード: 部品にフォーカスして `Space` で掴み、`↑` `↓` で移動（機能の境目では隣の機能へ）、`Space` で置く、`Escape` で戻す。結果は `aria-live` で読み上げる（「金額を 経費の申請 の 2 番目に移しました」）。
- 型: `useSortable({ items, onMove })` 程度の小さなフックにし、AppEditor 以外（§8 の項目を並べる図・Shiki の画面の構成）でも使えるようにする（`@imanect/yui/editor` から出す）。

### 4.3 AppEditor（React）

```ts
interface AppEditorProps {
  figure: AppFigure;
  onChange: (next: AppFigure) => void;
  /** ボタンの実行先に選べるワークフロー（閉じた集合）。inputs があれば、その入力から部品を作れる。 */
  workflows: { name: string; inputs?: WorkflowInputHint[] }[];
  /** `-> chat` を選べるか（ミニアプリでは false。会話の中で使うなら true）。 */
  allowChat?: boolean;
  theme?: ThemeMode;
  locale?: string;
}
interface WorkflowInputHint { key: string; label?: string; type: AppField["type"]; required: boolean; options?: string[]; min?: number; max?: number }
```

- 左: パレット（部品の種類 11・機能・ボタン）。ドラッグで置くか、押して選んでいる機能の末尾に足す。ワークフローを選ぶと「このワークフローの入力」から、key・必須・選択肢が埋まった部品を置ける。
- 中: キャンバス。今の `AppView` と同じ見た目で描き（入力は操作できない状態）、部品ごとに掴む印・選択の枠・挿入位置の線を重ねる。画面に出る形と編集中の形を揃えるため、`AppView` の部品の描画を共有の関数に切り出す。
- 右: 選んだ部品の設定（ラベル・key・必須・例・初期値・範囲・刻み・単位・選択肢と並べ替え・multi・other）。ボタンは文言と実行先（ワークフロー名の選択か chat）。
- 幅 640px 未満では 1 列にし、パレットは下のシート、設定は部品の下に開く。
- ライブの確認: ワークフローの必須の入力に対応する部品が無い、どの入力にも当たらない key がある、などを部品の横に出す（保存は止めない。止めるのは Shiki のサーバーの検証）。

## 5. 往復で値が落ちる場合（調査で確かめたもの）

IR では表せるが、ソースに書くと戻らない状態がある。エディタはこれらを作らない（入力で拒むか、設定を出さない）。

| IR の状態 | `toSource` の出力 | 読み直した結果 | エディタの扱い |
|---|---|---|---|
| number に最小だけ（`min: 1`） | `金額 = number` | 最小が消える | 最小と最大は両方か、どちらも無しにする |
| ラベルに `=` | `A = B = text` | 部品ごと消える | ラベルに `=` を使えなくする |
| 選択肢に `\|` | `choice a\|b \| c` | 選択肢が 3 つになる | 選択肢に `\|` `=` を使えなくする |
| 例に `必須` などのオプション語 | `例 必須 の例` | 必須になり、例が「の例」になる | 例・初期値は、オプション語を含むなら拒む（§9 の 4 で記法側を直すかを決める） |
| 見出しの無い機能が 2 つ以上 | 区切りが出ない | 1 つの機能にまとまる | 機能が 2 つ以上なら見出しを必須にする |
| workflow のボタンで確認なし | 確認は書かれない | 確認ありに戻る | 仕様どおり（workflow は必ず確認する）。設定を出さない |

確かめ方は model の各関数の最後に置く `parseBlock(toSource(next)).figure` と `next` の比較で、上の表はその検査で全部拾える。表に無い組み合わせが見つかったら、エディタで拒んでから記法側の直しを検討する。

## 6. Shiki への組み込み

### 6.1 ミニアプリの編集ダイアログ

- `miniapp-editor.tsx` の「書く / プレビュー」に「組み立てる」を足し、新規作成では既定にする。保存（`createMiniApp` / `updateMiniApp`）・ワークフローの束ね方・スキルの選択は今のまま。
- 画面の構成: `splitMarkdown(screen)` で文章と図の並びにし、行を並べ替え・追加（文章・app・その他の図）・削除できるようにする。ドラッグは 4.2 の `useSortable` を使う。文章の行は textarea、app の行は AppEditor、その他の図は今のままソースの textarea と図のプレビュー。
- 書き戻し: 変わったブロックの中身だけを置き換えて Markdown をつなぎ直す。fence の info（```ui・```ui:app）とほかの文章は 1 文字も変えない。
- 編集に入れないブロック: `checkEditable` が拒むもの（エラー・警告がある、上限を超えた、読めない行がある）は、組み立てるタブでは「この図は記述に直せない行があります。書くタブで直してください」と行の番号を出し、ソースのまま表示する（黙って正規化して行を落とさない）。
- 最初に組み立てるで直したとき、そのブロックは正規形（`必須`・`as`・順序が揃った形）に書き直される。書くタブに戻ると見た目が変わるので、一度だけ知らせる。
- `workflows` には束ねたワークフローの別名（`pins[].alias`）を渡す。`inputs` は各ワークフローの IR の対話トリガの `input_schema`（`crates/workflow-engine/src/ir/input_schema.rs` が受ける JSON Schema のサブセット）から Shiki 側で作る。部品の key と入力名を揃えられるので、`as` の書き間違いが減る。
- 部品の画面は Shiki の見た目に合わせる必要がある（`globals.css` のトークン）。Yui の theme が受ける色で合わせ、合わない部分（パレットとシート）は Shiki 側で描いてもよい。

### 6.2 変えないもの

- サーバー: 画面の検証（実行先は束ねた別名だけ・`-> chat` と ask・plan は不可）、押されたときの読み直しと値の検証、冪等キー、押した本人の権限での起動は、どれもソースを見るので、エディタが作った画面にもそのまま効く。認可の境界（OpenFGA の relation・スコープ）は変わらない。
- 保存の形式（`MiniAppBody`）と migration は増えない。

### 6.3 後で（この提案には含めない）

- ノート（TipTap）の ```ui ブロックに「図を編集」を足し、同じ AppEditor をダイアログで開く（Yui の roadmap「ノートと文書の中でも ```ui を図として描き、編集できるようにする」）。共同編集では、ブロックの中身の置き換えを 1 つのトランザクションにする。
- 会話の回答の app を「アプリとして保存」したあとに組み立てるで開く導線（保存のダイアログ `save-as-app-dialog.tsx` から）。

## 7. 進め方

| 段階 | リポジトリ | 内容 | 確かめ方 |
|---|---|---|---|
| 1 | y-ui | model（§4.1）と往復の検査、§5 の拒み方 | vitest（全部品 × 全操作の往復）・`pnpm typecheck` |
| 2 | y-ui | `useSortable`（§4.2）。マウス・タッチ・キーボード | Playwright（ドラッグ・長押し・キーボードでの移動、幅 390px） |
| 3 | y-ui | AppEditor（§4.3）。`AppView` の部品の描画を共有に切り出す | Playwright のスクショ（明暗・390px・選択・挿入線・上限）。0.9.0 として公開 |
| 4 | shiki-platform | `@imanect/yui` を上げ、編集ダイアログに「組み立てる」と画面の構成（§6.1）、`input_schema` からの部品の候補 | `pnpm lint && pnpm build`、`e2e/mini-apps.spec.ts` に組み立てる → 保存 → 実行の E2E を足す、compose で目で確かめる |

段階 1〜3 は y-ui だけで閉じる。Shiki 側は段階 4 だけで、サーバーの変更は無い。

## 8. 対象を広げるとき

- 項目を並べる図（cards・steps・checklist・timeline・tree・stack・proscons・swot）: 並べ替えと項目の追加・削除だけの共通エディタ。tree・stack は字下げ（入れ子）の移動が要る。
- 表の図（bar・line・pie・compare など）: DnD より表の編集（行・列の追加と並べ替え）が合う。別に検討する。
- flow: ノードと矢印の編集は Shiki のワークフローエディタ（React Flow）に近いが、Yui は配置を自分で決めるので、位置の編集は持たない。

## 9. 決めてほしいこと

1. **最初の範囲**: app のエディタ（Yui）と画面の構成（Shiki）の両方を最初に入れるか、app のエディタだけを先に入れるか。提案は両方（画面に文章と app を並べるのが今の作り方の基本のため）。
2. **DnD の実装**: ライブラリを入れずに自前で書くか（提案。Yui は peer の react 以外に依存を持たない）、dnd-kit などを peer に足すか。
3. **正規化**: 組み立てるで直したブロックが正規形に書き直されること（書いた記法の言い回しが揃う）を受け入れるか。
4. **記法側の直し**: §5 のうち、エディタで拒むだけでなく記法を直すもの（選択肢の `\|` の書き方、例の中のオプション語の扱い、最小だけ・最大だけの範囲）。記法を変えると Rust 版（shiki-platform `crates/yui`）と `spec-tests` も合わせて直す必要がある。
