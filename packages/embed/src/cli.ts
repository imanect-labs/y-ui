#!/usr/bin/env node
/**
 * yui-embed: Markdown の ```ui ブロックに画像のリンクを付ける。
 *
 *   yui-embed --base https://yui.example.workers.dev README.md docs/
 *   yui-embed --check README.md   # 付け忘れ・古いリンクがあれば終了コード 1（CI 向け）
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { embedMarkdown, type EmbedTheme, LONG_URL } from "./embed.js";

const USAGE = `使い方: yui-embed [オプション] <ファイルかディレクトリ...>

Markdown の \`\`\`ui ブロックに、図の画像のリンクを付けます（前回付けたものは作り直します）。
ディレクトリを渡すと、その下の .md をすべて対象にします（node_modules と . で始まるものは除く）。

  --base <URL>      画像を描く Worker の URL（環境変数 YUI_EMBED_BASE でも可）
  --theme <配色>    light（既定）・dark・auto（閲覧者の OS の明暗に従う）
  --no-fold         ソースを <details> に畳まず、画像の下にそのまま見せる
  --summary <文>    <details> の見出し（既定「図のソース」）
  --check           書き換えずに確かめるだけ。直すところがあれば終了コード 1
  -q, --quiet       書き換えたファイルと問題だけを出す
  -h, --help        この説明`;

function collect(path: string, out: string[]): void {
  const st = statSync(path);
  if (st.isFile()) {
    out.push(path);
    return;
  }
  for (const name of readdirSync(path).sort()) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const p = join(path, name);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (/\.(md|markdown|mdx)$/i.test(name)) out.push(p);
  }
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        base: { type: "string" },
        theme: { type: "string" },
        "no-fold": { type: "boolean" },
        summary: { type: "string" },
        check: { type: "boolean" },
        quiet: { type: "boolean", short: "q" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values: v, positionals } = args;
  if (v.help) {
    console.log(USAGE);
    return 0;
  }
  const base = v.base ?? process.env.YUI_EMBED_BASE;
  if (!base || positionals.length === 0) {
    console.error(USAGE);
    return 2;
  }
  const theme = (v.theme ?? "light") as EmbedTheme;
  if (!["light", "dark", "auto"].includes(theme)) {
    console.error(`--theme は light・dark・auto のどれかです: ${v.theme}`);
    return 2;
  }

  const files: string[] = [];
  try {
    for (const p of positionals) collect(p, files);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }

  let failed = false;
  let stale = 0;
  for (const file of files) {
    const name = relative(process.cwd(), file) || file;
    const input = readFileSync(file, "utf8");
    let res;
    try {
      res = await embedMarkdown(input, { base, theme, fold: !v["no-fold"], ...(v.summary !== undefined ? { summary: v.summary } : {}) });
    } catch (e) {
      console.error(`${name}: ${(e as Error).message}`);
      return 2;
    }
    for (const b of res.blocks) {
      const at = `${name}:${b.line}`;
      if (b.skipped === "unclosed") {
        console.error(`${at}: ui ブロックが閉じていないので飛ばしました`);
        failed = true;
      } else if (b.skipped === "unparsable") {
        const why = b.diagnostics.map((d) => d.message).join(" / ");
        console.error(`${at}: 図にできないので飛ばしました${why ? `（${why}）` : ""}`);
        failed = true;
      } else {
        for (const d of b.diagnostics) {
          if (d.severity === "info" && v.quiet) continue;
          const line = d.line > 0 ? b.line + d.line : b.line;
          console.error(`${name}:${line}: ${d.severity}: ${d.message}`);
        }
        if (b.longUrl) console.error(`${at}: 画像の URL が ${LONG_URL} 文字を超えました。表示できない場所があります（図を分けてください）`);
      }
    }
    if (!res.changed) {
      if (!v.quiet) console.log(`${name}: 変更なし（${res.blocks.length} ブロック）`);
      continue;
    }
    stale++;
    if (v.check) {
      console.error(`${name}: 画像のリンクが無いか古くなっています`);
    } else {
      writeFileSync(file, res.text);
      console.log(`${name}: 画像のリンクを更新しました（${res.blocks.filter((b) => b.url).length} ブロック）`);
    }
  }
  if (v.check && stale > 0) {
    console.error(`\n${stale} ファイルを直す必要があります: yui-embed --base ${base} ${positionals.join(" ")}`);
    return 1;
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(2);
  },
);
