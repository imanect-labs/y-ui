/**
 * README の「図の種類」に載せるスクリーンショットを作る（英語版・日本語版）。
 *   pnpm tsx scripts/readme-images.ts
 * docs/images/{en,ja}-<種類>.png に書き出す。Playwright の Chromium を使う。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { parseBlock } from "@imanect/yui";
import { renderSVG } from "@imanect/yui/svg";
import { SAMPLES } from "@imanect/yui/guide";


const out = join(import.meta.dirname, "../docs/images");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 600 }, deviceScaleFactor: 2, colorScheme: "light" });
for (const lang of ["en", "ja"] as const) {
  for (const [kind, src] of Object.entries(SAMPLES[lang])) {
    const r = parseBlock(src, { final: true });
    if (!r.figure) throw new Error(`${lang}/${kind}: ${JSON.stringify(r.diagnostics)}`);
    const svg = renderSVG(r.figure, { width: 640, locale: lang === "ja" ? "ja-JP" : "en-US" });
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;background:#fff"><div id="f" style="width:640px;background:#fcfcfc;border-radius:12px">${svg}</div>`);
    await page.locator("#f").screenshot({ path: join(out, `${lang}-${kind}.png`) });
  }
}
await browser.close();
writeFileSync(join(out, ".gitattributes"), "*.png binary\n");
console.log(`written to ${out}`);
