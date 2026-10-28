import { describe, expect, it } from "vitest";
import { KINDS, parseBlock } from "@imanect/yui";
import { GUIDE_RULES, KIND_GROUPS, KIND_GUIDE, SAMPLES, guideIndex, kindGuide } from "@imanect/yui/guide";

describe("LLM 向けの書き方（@imanect/yui/guide）", () => {
  it("すべての種類が用途のまとまりにちょうど 1 回ずつ現れる", () => {
    const listed = KIND_GROUPS.flatMap((g) => g.kinds);
    expect([...listed].sort()).toEqual([...KINDS].sort());
  });

  it("早見はすべての種類を 1 行ずつ載せ、まとまりの見出しを付ける", () => {
    const index = guideIndex();
    for (const k of KINDS) {
      expect(index).toContain(`- \`${k}\` ${KIND_GUIDE[k].name}: `);
    }
    for (const g of KIND_GROUPS) expect(index).toContain(`${g.title}:`);
    // 用途は最初の 1 文だけ（句点で切る）。
    expect(index).toContain("- `pie` 円グラフ（ドーナツ）: 全体に占める割合・内訳\n");
  });

  it("早見に載せる種類を選べる（空になったまとまりは見出しごと消える）", () => {
    const index = guideIndex({ kinds: ["bar", "pie", "calc"] });
    expect(index).toBe(
      ["グラフ:", "- `bar` 棒グラフ: 項目や時期ごとの数値の比較", "- `pie` 円グラフ（ドーナツ）: 全体に占める割合・内訳", "操作できる図:", "- `calc` 計算機: 利用者が値を動かすと結果が変わる計算（ローン・料金の試算・割り勘）"].join("\n"),
    );
    expect(index).not.toContain("数値:");
  });

  it.each(KINDS.map((k) => [k]))("%s の書き方は作例を含み、作例はエラー無く読める", (kind) => {
    const guide = kindGuide(kind);
    expect(guide.startsWith(`## ${kind} ${KIND_GUIDE[kind].name}\n`)).toBe(true);
    expect(guide).toContain("```ui\n" + SAMPLES.ja[kind].trimEnd() + "\n```");
    // ホストが解決する src: はモデルに書かせない。注記は書ける。
    expect(guide).not.toContain("`src:`");
    expect(guide).toContain("`note:` 注記");

    const { figure, diagnostics } = parseBlock(SAMPLES.ja[kind], { final: true });
    expect(figure?.kind).toBe(kind);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("共通の決まりは 1 行目の形と、見た目を書かないことを伝える", () => {
    expect(GUIDE_RULES).toContain("1 行目は「種類 タイトル」");
    expect(GUIDE_RULES).toContain("`note: 注記`");
  });
});
