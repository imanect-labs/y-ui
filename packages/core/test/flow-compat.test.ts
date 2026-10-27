import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toHTML } from "../src/export.js";
import { parseBlock, toSource, toText, type Figure } from "../src/index.js";
import { renderSVG } from "../src/svg.js";

// 評価でモデルが実際に書いた流れ図などの解析・描画の結果を固定する（後方互換）。
// 描画を意図して変えたときだけ pnpm spec:flow で作り直し、差分で変わった図を確かめる
interface Case {
  source: string;
  figure: Figure;
  diagnostics: { line: number; code: string }[];
  text: string;
  hashes: Record<string, string>;
}
const data: { cases: Case[] } = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/flow-compat.json"), "utf8"));
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

describe("流れ図の後方互換", () => {
  it("課題集がある", () => {
    expect(data.cases.length).toBeGreaterThan(100);
  });

  it.each(data.cases.map((c, i) => ({ i, title: c.source.split("\n")[0], c })))("$i: $title", ({ c }) => {
    const r = parseBlock(c.source, { final: true });
    expect(r.figure).toEqual(c.figure);
    expect(r.diagnostics.map((d) => ({ line: d.line, code: d.code }))).toEqual(c.diagnostics);
    const f = r.figure!;
    expect(toText(f)).toBe(c.text);
    expect({
      source: hash(toSource(f)),
      html: hash(toHTML(f)),
      svg640: hash(renderSVG(f, { width: 640, theme: "light" })),
      svg360: hash(renderSVG(f, { width: 360, theme: "light" })),
    }).toEqual(c.hashes);
  });
});
