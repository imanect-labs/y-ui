/**
 * エディタの見た目と操作を確かめるスクリーンショットを撮る（目で見て直すため）。
 *   pnpm tsx scripts/editor-demo.ts <dir> && pnpm tsx scripts/editor-shots.ts <dir> <出力ディレクトリ>
 * ドラッグ・キーボードでの移動・元に戻す・狭い幅のはみ出しの結果も出力する。
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
const [demoArg, out = "editor-shots"] = process.argv.slice(2);
const demo = resolve(demoArg ?? "editor-demo");
mkdirSync(out, { recursive: true });
// 手元の Chromium を使うなら CHROMIUM_PATH で渡す（playwright の版と揃ったブラウザが無い環境向け）
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors: string[] = [];
async function page(w: number, h: number, q: string) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.goto(`file://${demo}/index.html?${q}`);
  await p.waitForSelector("[data-yui=app-editor]");
  await p.waitForTimeout(150);
  return p;
}
const shots: [string, number, number, string][] = [
  ["wide-light", 1280, 900, "sample=expense"],
  ["wide-dark", 1280, 900, "sample=expense&theme=dark"],
  ["broken", 1280, 1000, "sample=broken"],
  ["mid", 760, 1000, "sample=expense"],
  ["narrow", 390, 1400, "sample=expense"],
  ["empty", 1280, 700, "sample=empty"],
];
for (const [name, w, h, q] of shots) {
  const p = await page(w, h, q);
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  await p.context().close();
}
// 選択して設定パネル
{
  const p = await page(1280, 900, "sample=expense");
  await p.locator(".ye-field").nth(1).click();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/select-field.png`, fullPage: true });
  await p.locator(".ye-field").nth(2).click();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/select-choice.png`, fullPage: true });
  await p.locator(".ye-chip").first().click();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/select-action.png`, fullPage: true });
  // 掴んでいる途中
  const a = (await p.locator(".ye-field").nth(0).boundingBox())!;
  const b = (await p.locator(".ye-field").nth(3).boundingBox())!;
  await p.mouse.move(a.x + 200, a.y + 20);
  await p.mouse.down();
  await p.mouse.move(a.x + 210, a.y + 40, { steps: 3 });
  await p.mouse.move(b.x + 200, b.y + b.height - 5, { steps: 8 });
  await p.screenshot({ path: `${out}/dragging.png`, fullPage: false });
  await p.mouse.up();
  await p.waitForTimeout(100);
  const labels = await p.locator(".ye-section").first().locator(".ye-field").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  console.log("after drag:", labels.join(" / "));
  await p.context().close();
}
// パレットから新しい部品を 2 つ目の機能へドラッグ
{
  const p = await page(1280, 900, "sample=expense");
  await p.locator(".ye-section").nth(1).scrollIntoViewIfNeeded();
  const src = (await p.locator(".ye-pal-item", { hasText: "数値" }).boundingBox())!;
  const dst = (await p.locator(".ye-section").nth(1).locator(".ye-field").first().boundingBox())!;
  await p.mouse.move(src.x + 20, src.y + 10); await p.mouse.down();
  await p.mouse.move(src.x + 40, src.y + 20, { steps: 3 });
  await p.mouse.move(dst.x + 300, dst.y + 5, { steps: 10 });
  await p.screenshot({ path: `${out}/palette-drag.png` });
  await p.mouse.up(); await p.waitForTimeout(300);
  console.log("section2 after palette drop:", (await p.locator(".ye-section").nth(1).locator(".ye-field").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).join(" / "));
  // キーボード: Space で掴み ↓↓ Space で置く
  await p.locator(".ye-section").first().locator(".ye-field").first().focus();
  await p.keyboard.press("Space"); await p.keyboard.press("ArrowDown"); await p.keyboard.press("ArrowDown"); await p.keyboard.press("Space");
  await p.waitForTimeout(100);
  console.log("section1 after keyboard:", (await p.locator(".ye-section").first().locator(".ye-field").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).join(" / "));
  await p.keyboard.press("Control+z"); await p.waitForTimeout(100);
  console.log("after undo:", (await p.locator(".ye-section").first().locator(".ye-field").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).join(" / "));
  await p.context().close();
}
// 狭い幅で部品を選ぶ（設定がその下に開く）・横にはみ出さない
{
  const p = await page(390, 900, "sample=broken");
  console.log("narrow scrollWidth:", await p.evaluate(() => document.documentElement.scrollWidth));
  await p.locator(".ye-field").nth(1).click(); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/narrow-select.png`, fullPage: true });
  // 問題の一覧を押すとその場所へ
  await p.locator(".ye-problems li button").first().click(); await p.waitForTimeout(300);
  console.log("after problem click, focused prop:", await p.evaluate(() => document.activeElement?.getAttribute("data-prop")));
  await p.context().close();
}
// レビューで見つかった不具合の確かめ
{
  const p = await page(1280, 900, "sample=expense");
  const fields = () => p.locator(".ye-section").first().locator(".ye-field").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? "").split("（")[0]).join("/"));
  // Alt+↓ を 2 回: 同じ項目が 2 つ下がる
  await p.locator(".ye-field").first().focus();
  await p.keyboard.press("Alt+ArrowDown");
  await p.keyboard.press("Alt+ArrowDown");
  console.log("alt x2:", await fields());
  // 掴んで ↓↓ → Escape: 並びも選択も元に戻る
  await p.locator(".ye-field").first().focus();
  await p.keyboard.press("Space"); await p.keyboard.press("ArrowDown"); await p.keyboard.press("Escape");
  await p.waitForTimeout(100);
  console.log("grab+esc:", await fields(), "selected:", await p.locator(".ye-field.is-sel").getAttribute("aria-label"));
  // 掴んだまま設定の欄で打つ: 打った文字が全部入り、Escape しても消えない
  await p.locator(".ye-field").nth(1).focus();
  await p.keyboard.press("Space");
  await p.locator("[data-yui-inspector] input[data-prop=label]").click();
  await p.keyboard.type("XYZ");
  await p.locator(".ye-field").nth(2).focus();
  await p.keyboard.press("Escape");
  console.log("grab+type:", await fields());
  // パレットから運んで同じ場所で離す・Escape で取り消す: 足されない
  const before = await p.locator(".ye-field").count();
  const pal = (await p.locator(".ye-pal-item", { hasText: "数値" }).boundingBox())!;
  await p.mouse.move(pal.x + 20, pal.y + 10); await p.mouse.down(); await p.mouse.move(pal.x + 40, pal.y + 14, { steps: 4 }); await p.mouse.up();
  await p.mouse.move(pal.x + 20, pal.y + 10); await p.mouse.down(); await p.mouse.move(pal.x + 40, pal.y + 14, { steps: 4 }); await p.keyboard.press("Escape"); await p.mouse.up();
  await p.waitForTimeout(100);
  console.log("palette cancel: added", (await p.locator(".ye-field").count()) - before);
  // 日本語の入力名の候補（件名）を 2 つ目の機能に足す: 名前は「件名」のまま、候補は消える
  await p.locator(".ye-section").nth(1).locator(".ye-chip").first().click();
  await p.locator("[data-yui-inspector] select[data-prop=target]").selectOption("w:経費申請");
  await p.waitForTimeout(100);
  await p.locator(".ye-pal-item", { hasText: "件名" }).click();
  await p.waitForTimeout(100);
  console.log("hint jp key:", await p.locator(".ye-section").nth(1).locator(".ye-field").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? "").split("（")[0]).join("/")), "hint still shown:", await p.locator(".ye-pal-item", { hasText: "件名" }).count());
  await p.context().close();
}
{
  // 狭い幅で部品を選んだまま、取っ手で動かす（開いた設定を置き場所に数えない）
  const p = await page(390, 1400, "sample=expense");
  await p.locator(".ye-field").nth(1).click(); await p.waitForTimeout(200);
  const g = (await p.locator(".ye-field").nth(0).locator(".ye-grip").boundingBox())!;
  const t = (await p.locator(".ye-section").first().locator(".ye-field").nth(2).boundingBox())!;
  await p.mouse.move(g.x + 5, g.y + 5); await p.mouse.down();
  await p.mouse.move(g.x + 10, g.y + 30, { steps: 3 }); await p.mouse.move(t.x + 100, t.y + 8, { steps: 10 }); await p.mouse.up();
  await p.waitForTimeout(200);
  console.log("narrow drag:", (await p.locator(".ye-section").first().locator(".ye-field").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? "").split("（")[0]))).join("/"));
  await p.context().close();
}
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
