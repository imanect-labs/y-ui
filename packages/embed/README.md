# @imanect/yui-embed

Markdown の ` ```ui ` ブロックに、図の画像（[Yui](https://github.com/imanect-labs/y-ui) の Worker が描く SVG）のリンクを付けます。
GitHub の README など、コードを実行しない Markdown でも図が見えるようになります。

```bash
npx @imanect/yui-embed --base https://yui.example.workers.dev README.md docs/
npx @imanect/yui-embed --check --base https://yui.example.workers.dev README.md   # CI 向け
```

```ts
import { embedMarkdown, imageUrl } from "@imanect/yui-embed";

const { text, changed, blocks } = await embedMarkdown(markdown, { base: "https://yui.example.workers.dev" });
const url = await imageUrl("bar 売上\n月 | 売上\n1月 | 120\n", { base: "https://yui.example.workers.dev" });
```

何度かけても同じ結果になります（付けた部分を `<!-- yui-embed -->` 〜 `<!-- /yui-embed -->` で囲み、次は作り直す）。
Worker の出し方・MCP・制約は [docs/embed.md](https://github.com/imanect-labs/y-ui/blob/main/docs/embed.md)。
