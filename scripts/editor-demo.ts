/**
 * エディタの確認用ページを作る（目で見て確かめるため）。
 *   pnpm tsx scripts/editor-demo.ts <出力ディレクトリ>
 * index.html と demo.js を書き出す。file:// で開ける。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const out = process.argv[2] ?? "editor-demo";
mkdirSync(out, { recursive: true });
const src = (p: string) => join(import.meta.dirname, "../packages/core/src", p);
await build({
  entryPoints: [join(import.meta.dirname, "editor-demo/entry.ts")],
  bundle: true,
  format: "iife",
  outfile: join(out, "demo.js"),
  alias: {
    "@imanect/yui/editor/react": src("editor/react/index.ts"),
    "@imanect/yui/editor": src("editor/index.ts"),
    "@imanect/yui/react": src("react/index.ts"),
    "@imanect/yui": src("index.ts"),
  },
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
});
writeFileSync(
  join(out, "index.html"),
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yui editor</title>
<style>:root{--bg:#fcfcfc;--fg:#18181b;--line:#dddde1;color-scheme:light}:root[data-theme=dark]{--bg:#0d0d0f;--fg:#f2f2f2;--line:#2b2b2e;color-scheme:dark}body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,"Noto Sans JP",sans-serif}</style>
</head><body><div id="root"></div><script src="demo.js"></script></body></html>`,
);
console.log(`wrote ${out}/index.html`);
