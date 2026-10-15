import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { figureActions, parseBlock, validateActionValues, type Figure } from "../src/index.js";

// spec-tests/app.json は Rust 版（Shiki）と共有する課題集。TS 版を変えたら pnpm tsx scripts/app-fixtures.ts で作り直す
const data = JSON.parse(readFileSync(join(import.meta.dirname, "../../../spec-tests/app.json"), "utf8"));

describe("操作を持つ種類の共通課題集", () => {
  for (const c of data.cases) {
    it(c.name, () => {
      const r = parseBlock(c.source, { final: true, ...(c.kind ? { kind: c.kind } : {}) });
      expect(r.figure).toEqual(c.figure);
      expect(figureActions(r.figure!)).toEqual(c.actions);
      expect(r.diagnostics.map((d) => ({ line: d.line, code: d.code }))).toEqual(c.diagnostics);
    });
  }
  it("値の検証", () => {
    for (const v of data.values) {
      const f = data.cases.find((c: { name: string }) => c.name === v.source).figure as Figure;
      expect(validateActionValues(f, v.action, v.input)).toEqual(v.expect);
    }
  });
});
