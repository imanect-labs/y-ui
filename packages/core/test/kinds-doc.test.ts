import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KINDS_DOC_PATH, renderKindsDoc } from "../../../scripts/kinds-doc.js";

describe("図の種類の一覧（docs/kinds.md）", () => {
  it("コードから生成し直した内容と一致する（変わったら pnpm docs:kinds）", () => {
    expect(readFileSync(KINDS_DOC_PATH, "utf8")).toBe(renderKindsDoc());
  });
});
