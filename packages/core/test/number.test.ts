import { describe, expect, it } from "vitest";
import { parseCell, parseNumber } from "../src/index.js";

describe("parseNumber", () => {
  it.each([
    ["120", 120, undefined],
    ["1,200", 1200, undefined],
    ["-3.5", -3.5, undefined],
    ["+18%", 18, "%"],
    ["１２０", 120, undefined],
    ["１，２００円", 1200, "円"],
    ["120万", 1_200_000, undefined],
    ["320万円", 3_200_000, "円"],
    ["1.2億", 120_000_000, undefined],
    ["1億2,000万円", 120_000_000, "円"],
    ["△120", -120, undefined],
    ["▲3.2%", -3.2, "%"],
    ["−5", -5, undefined],
    ["¥1,200", 1200, "円"],
    ["$3.5", 3.5, "$"],
    ["1,240人", 1240, "人"],
    ["150 [2]", 150, undefined],
  ])("%s → %d", (raw, value, unit) => {
    const n = parseNumber(raw);
    expect(n?.value).toBeCloseTo(value);
    expect(n?.unit).toBe(unit);
  });

  it("概数の前置を受ける", () => {
    expect(parseNumber("約120件")).toEqual({ value: 120, unit: "件", approx: true });
  });

  it.each(["abc", "120-150", "1月2日", "", "これは長い説明文で数値ではない123"])("%s は数値ではない", (raw) => {
    expect(parseNumber(raw)).toBeNull();
  });
});

describe("parseCell", () => {
  it("欠損と不正を区別する", () => {
    expect(parseCell("-")).toEqual({ kind: "missing" });
    expect(parseCell("")).toEqual({ kind: "missing" });
    expect(parseCell("N/A")).toEqual({ kind: "missing" });
    expect(parseCell("abc")).toEqual({ kind: "bad" });
    expect(parseCell("12")).toEqual({ kind: "number", value: 12 });
  });
});
