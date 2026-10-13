import { describe, expect, it } from "vitest";
import { parseBlock } from "../src/parse.js";
import { clipboardHTML, exportSVG, fileBaseName, toHTML } from "../src/export.js";
import type { Figure } from "../src/ir.js";

const fig = (src: string): Figure => {
  const r = parseBlock(src, { final: true });
  if (!r.figure) throw new Error("parse failed");
  return r.figure;
};

const bar = fig("bar 売上 <比較> [1]\nunit: 百万円\n四半期 | 売上\nQ1 | 1200\nQ2 | -\nnote: 速報値");

describe("書き出し", () => {
  it("SVG は色と寸法を焼き込み、CSS 変数を使わない", () => {
    const { svg, width, height } = exportSVG(bar);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(svg).toContain(`width="${width}" height="${height}"`);
    expect(svg).not.toContain("var(--");
    expect(svg).toContain("&lt;比較&gt;");
    expect(exportSVG(bar, { theme: "dark" }).svg).not.toBe(svg);
  });

  it("HTML の表: 見出し・数値の書式・欠損・単位・注記、文字はエスケープ", () => {
    const html = toHTML(bar);
    expect(html).toContain('<th scope="col">四半期</th><th scope="col">売上</th>');
    expect(html).toContain('<th scope="row">Q1</th><td style="text-align:right">1,200</td>');
    expect(html).toContain('<td style="text-align:right">-</td>');
    expect(html).toContain("単位: 百万円");
    expect(html).toContain("<p>※ 速報値</p>");
  });

  it("流れ図・構成図・数値カードもリストや表で読める", () => {
    expect(toHTML(fig("flow 承認\n申請 -> 承認\n承認 -差戻し-> 申請"))).toBe("<ul><li>申請 → 承認</li><li>承認 →（差戻し） 申請</li></ul>");
    const stack = toHTML(fig("stack 構成\n- 画面: Web\n- API\n  - 認証\n- DB | ファイル"));
    expect(stack).toContain("<li>画面（Web）</li>");
    expect(stack).toContain("API<ul><li>認証</li></ul>");
    expect(stack).toContain("DB ／ ファイル");
    expect(toHTML(fig("stat 実績\n売上 | 3,200万円 | 前年比 +18%"))).toContain("<td>3,200万円</td><td>前年比 +18%</td>");
  });

  it("貼り付け用の HTML は画像・見出し・ソースを持ち、ソースから図に戻せる", () => {
    const html = clipboardHTML(bar, { dataUrl: "data:image/png;base64,AAAA", width: 10, height: 20 });
    expect(html).toContain('<img src="data:image/png;base64,AAAA" width="10" height="20" alt="売上 &lt;比較&gt;">');
    expect(html).toContain("<figcaption><strong>売上 &lt;比較&gt; [1]</strong></figcaption>");
    const source = /data-yui-source="([^"]*)"/.exec(html)![1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    expect(parseBlock(source, { final: true }).figure).toEqual(bar);
  });

  it("ファイル名はタイトルから、使えない文字を落として作る", () => {
    expect(fileBaseName(fig('bar 売上/利益: "Q1"\n四半期 | 売上\nQ1 | 1'))).toBe("売上 利益 Q1");
    expect(fileBaseName(fig("bar\n四半期 | 売上\nQ1 | 1"))).toBe("bar");
  });
});
