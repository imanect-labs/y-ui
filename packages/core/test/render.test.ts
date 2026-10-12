import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseBlock, type Figure } from "../src/index.js";
import { YuiBlock, YuiFigure, isYuiLanguage } from "../src/react/index.js";
import { estimate } from "../src/render/measure.js";
import { layout, renderSVG } from "../src/svg.js";

// 評価の課題の正解（141 件中 121 件に図がある）をそのまま描画の検査に使う
const golds: [string, Figure][] = readFileSync(new URL("../../../eval/tasks/tasks.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l))
  .filter((t) => t.gold)
  .map((t) => [t.id, t.gold]);

const fig = (src: string) => parseBlock(src, { final: true }).figure!;

describe("レイアウト", () => {
  it.each([640, 360])("幅 %ipx: 全課題で数値が壊れず、文字が図の外にはみ出さない", (width) => {
    for (const [id, f] of golds) {
      const scene = layout(f, { width });
      expect(Number.isFinite(scene.height), id).toBe(true);
      for (const it of scene.items) {
        if (it.t !== "text") continue;
        expect(Number.isFinite(it.x) && Number.isFinite(it.y), `${id}: ${it.text}`).toBe(true);
        const w = estimate(it.text, it.size, it.weight);
        const left = it.anchor === "middle" ? it.x - w / 2 : it.anchor === "end" ? it.x - w : it.x;
        expect(left, `${id} (${width}px): 「${it.text}」が左にはみ出す`).toBeGreaterThanOrEqual(-1);
        expect(left + w, `${id} (${width}px): 「${it.text}」が右にはみ出す`).toBeLessThanOrEqual(scene.width + 1);
        expect(it.y, `${id}: 「${it.text}」が下にはみ出す`).toBeLessThanOrEqual(scene.height);
      }
    }
  });

  it("同じ入力なら同じ SVG（決定的）", () => {
    const f = fig("flow x\nA -> B -> C\nB -no-> D\n");
    expect(renderSVG(f)).toBe(renderSVG(f));
  });

  it("流れ図の分岐はひし形、ループは脇を回す", () => {
    const scene = layout(fig("flow x\n申請 -> 承認\n承認 -可-> 完了\n承認 -否-> 申請\n"));
    expect(scene.items.filter((i) => i.t === "path" && i.fill === "accentWash")).toHaveLength(1);
    expect(scene.items.filter((i) => i.t === "path" && i.arrow)).toHaveLength(3);
  });

  it("行が多い棒グラフは横向きにする", () => {
    const many = golds.find(([id]) => id === "long-001")![1];
    const scene = layout(many, { width: 640 });
    // 横向きなら、項目名は右揃え（anchor end）で棒の左に並ぶ
    expect(scene.items.filter((i) => i.t === "text" && i.anchor === "end" && i.text.endsWith("県")).length).toBeGreaterThan(40);
  });
});

describe("SVG", () => {
  const f = fig('bar <script>alert(1)</script> & "x"\n月 | 売上\n1月 | 120\n');

  it("文字はエスケープする", () => {
    const svg = renderSVG(f);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;");
  });

  it("画面用は CSS 変数、書き出し用は色を焼き込む", () => {
    expect(renderSVG(f)).toContain("var(--yui-s1, var(--yui-default-s1))");
    const baked = renderSVG(f, { theme: "light" });
    expect(baked).not.toContain("var(");
    expect(baked).toContain('fill="#2a78d6"');
    expect(baked).toMatch(/^<svg [^>]*width="\d+" height="\d+"/);
  });

  it("読み上げ用に、表にした内容を desc に入れる", () => {
    expect(renderSVG(f)).toMatch(/<desc id="[^"]+">[^<]*\| 1月 \| 120 \|/);
  });
});

describe("React", () => {
  it("YuiBlock はソースを解析して SVG を描く", () => {
    const html = renderToStaticMarkup(createElement(YuiBlock, { source: "bar 売上\n月 | 金額\n1月 | 120\n2月 | abc\n", width: 480 }));
    expect(html).toContain("<svg");
    expect(html).toContain("1 件の行を表示できませんでした");
    expect(html).toContain("data-yui-source");
  });

  it("ストリーミング中は確定した行だけ描き、図にできなければ何も出さない", () => {
    expect(renderToStaticMarkup(createElement(YuiBlock, { source: "bar 売", streaming: true }))).toBe("");
    const partial = renderToStaticMarkup(createElement(YuiBlock, { source: "bar 売上\n月 | 金額\n1月 | 120\n2月 | 15", streaming: true, width: 480 }));
    const svg = partial.slice(partial.indexOf("<svg"), partial.indexOf("</svg>"));
    expect(svg).toContain("1月: 120");
    expect(svg).not.toContain("2月");
  });

  it("図にできないソースはそのまま表示する", () => {
    expect(renderToStaticMarkup(createElement(YuiBlock, { source: "pie x\nA | 1\n" }))).toContain("<pre");
  });

  it("YuiFigure とコードブロックの言語名の判定", () => {
    expect(renderToStaticMarkup(createElement(YuiFigure, { figure: fig("stat x\n売上 | 3,200万円\n"), theme: "dark", width: 320 }))).toContain('fill:#262624');
    expect(isYuiLanguage("language-ui")).toBe(true);
    expect(isYuiLanguage("hljs language-yui")).toBe(true);
    expect(isYuiLanguage("language-uix")).toBe(false);
  });
});
