# 画像として埋め込む（GitHub などの Markdown で図を見せる）

GitHub の README・Issue・Wiki など、コードを実行しない Markdown ビューアは ` ```ui ` ブロックを描けません。
そこで、ブロックのソースを URL に入れた画像のリンクを付け、Cloudflare Worker がその URL を受けて SVG を描きます。
ビューアからは、図が描かれているように見えます。

````md
<!-- yui-embed -->
![bar 四半期ごとの売上](https://yui.example.workers.dev/svg/S0osUn...)

<details><summary>図のソース</summary>

```ui
bar 四半期ごとの売上
四半期 | 売上
Q1 | 120
Q2 | 150
```

</details>
<!-- /yui-embed -->
````

| 部品 | 役割 |
|---|---|
| `packages/worker` | Cloudflare Worker。`/svg/<コード>` で SVG を返す。AI 向けに MCP（`/mcp`）と説明（`/llms.txt`）も出す |
| `packages/embed`（`@imanect/yui-embed`） | ソースをコードにする関数と、Markdown の ui ブロックに画像のリンクを付ける CLI `yui-embed` |

## しくみ

- **コード**: ソースを deflate-raw で圧縮し、base64url（詰め物なし）にしたもの（Kroki・mermaid.ink と同じ考え方）。
  Worker はソースを保存しない。同じソースは同じ URL・同じ画像になる。
- **画像**: SVG（PNG・JPEG ではない）。拡大してもにじまず、数 KB。文字は閲覧者の環境のフォントで描くが、
  配置は文字幅の見積もり（`render/measure.ts`）で決まっているので崩れない。
- **配色**: `?theme=light`（既定。色と背景を焼き込む）・`dark`・`auto`（背景は透明で、閲覧者の OS の明暗に従う）。
  GitHub のテーマではなく OS の設定に従うので、両者が違う人には合わない。迷ったら light。
- **種類**: ` ```ui bar ` のようにフェンスに種類を書いたときは `?kind=bar` で渡す（CLI が付ける）。
- **キャッシュ**: 描けた画像は 1 日（Cloudflare では 7 日）置く。描き方を直したときに追従できるよう、永久にはしない。
- **安全**: SVG は文字と図形だけ（スクリプト・リンク・外部の画像を出さない）。さらに
  `Content-Security-Policy: default-src 'none'` を付けて配信する。復元したソースは 64 KB まで（圧縮爆弾を止める）。
- **描けないとき**: 理由を書いた小さな画像を返す（壊れた画像のマークにしない）。

## Worker を出す

```bash
cd packages/worker
npx wrangler login
pnpm deploy          # https://yui.<アカウント>.workers.dev に出る
pnpm dev             # 手元で動かす（http://localhost:8787）
```

束ねた大きさは gzip で約 90 KB（無料プランの上限 3 MB に収まる）。ワークスペースのパッケージはビルドせずにソースから束ねる（`wrangler.toml` の `[alias]`）。

独自ドメインにするなら `wrangler.toml` の `routes` と `PUBLIC_BASE`（MCP や `/llms.txt` が返す URL の基点）を設定する。

## CLI で Markdown に画像を付ける

```bash
yui-embed --base https://yui.example.workers.dev README.md docs/
yui-embed --check --base https://yui.example.workers.dev README.md   # CI 向け。直すところがあれば終了コード 1
```

- ui ブロックを `<!-- yui-embed -->` 〜 `<!-- /yui-embed -->` で囲み、画像と（`<details>` に畳んだ）ソースにする。
  何度かけても同じ結果。ソースを直してもう一度かければ、画像の URL だけが変わる。
- `--no-fold` でソースを畳まずに画像の下に見せる。`--theme auto` で閲覧者の明暗に従う。
- 他の言語のコードブロック（` ````md ` の中の作例など）は触らない。字下げしたブロック（リストの中）は付ける行も下げる。CRLF は CRLF のまま。
- 閉じていないブロック・図にできないブロックは飛ばして、理由を出す（終了コード 1）。値が読めない行などの警告も行番号つきで出す。
- 環境変数 `YUI_EMBED_BASE` を `--base` の代わりに使える。

このリポジトリの中では `pnpm embed --base … <ファイル>` で動く（ビルド不要）。

### GitHub Actions で自動で付ける

push のたびに画像のリンクを付け直して commit する例:

```yaml
name: yui-embed
on:
  push:
    paths: ["**.md"]
permissions:
  contents: write
jobs:
  embed:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx -y @imanect/yui-embed --base https://yui.example.workers.dev .
      - run: |
          git diff --quiet && exit 0
          git config user.name "github-actions[bot]"
          git config user.email "41898283+github-actions[bot]@users.noreply.github.com"
          git commit -am "docs: Yui の図の画像を更新"
          git push
```

書き換えずに PR で確かめるだけなら、`--check` を付けて最後の commit の手順を外す。

## AI に書かせる

### MCP

Worker の `/mcp` が MCP サーバー（Streamable HTTP・状態なし・認証なし）。

```bash
claude mcp add --transport http yui https://yui.example.workers.dev/mcp   # Claude Code
```

Claude（claude.ai・デスクトップ）では「コネクタ」→「カスタムコネクタを追加」に同じ URL を入れる。

| ツール | 内容 |
|---|---|
| `list_kinds` | 種類の早見と共通の決まり（どの種類を使うかを決める） |
| `get_kind_guide` | 1 つの種類の書き方（用途・書き方・オプション・上限・使い分け・作例） |
| `render_ui` | ソース → 画像の URL・貼り付け用の Markdown・診断。診断が出たら直して呼び直す |
| `embed_markdown` | Markdown 文書の ui ブロックすべてに画像を付けた文書を返す（CLI と同じ処理） |

`initialize` の `instructions` に、手順・決まり・早見を入れている（`@imanect/yui/guide` と同じ文）。
種類ごとの書き方はリソース `yui://guide/<種類>` でも読める。
`calc`・`app`・`ask`・`plan` は操作して使う種類なので、画像向けの早見には載せない（描くことはできる）。

画像の URL は手では作れない（圧縮と符号化が要る）。AI には `render_ui` の結果をそのまま貼らせる。

### llms.txt

MCP を使えない AI には、説明の文を読ませる。

| URL | 内容 |
|---|---|
| `/llms.txt` | 手順・決まり・早見と、種類ごとの書き方へのリンク（[llmstxt.org](https://llmstxt.org) の形） |
| `/llms-full.txt` | 上に全種類の書き方を足したもの |
| `/guide/<種類>.md` | 1 つの種類の書き方 |

## 制約

- **ソースは URL に入る**: 画像の URL を見ればソースが分かる。GitHub は画像を自前のプロキシ（camo）経由で取りに行くので、
  非公開リポジトリの図でもソースが Worker に届く。社外秘の数値を載せる図には使わない。
- **URL の長さ**: 8,000 文字を超えると表示できない場所がある（CLI が警告する）。目安として、ソース 6〜8 KB くらいまで。大きい図は分ける。
- **GitHub のキャッシュ**: camo が画像をしばらく持つが、ソースを直せば URL が変わるので問題にならない。
- **操作できる図**: `calc` は初期値の静止画になる。`app`・`ask`・`plan` は画像では使えない。
- **PNG が要る場所**（Slack のリンク展開・OGP・メール）: 今は無い。Workers で作るなら resvg-wasm と日本語フォント
  （数 MB あるので R2 に置いて読み込む）が要る。
