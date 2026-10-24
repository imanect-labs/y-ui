import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkEditable, emptyApp } from "../src/editor/index.js";
import { AppEditor } from "../src/editor/react/index.js";

const src = "app 経費\n## 申請\n件名 = text 必須\n金額 = number 1.. 円\nbutton 申請する -> workflow 経費申請\n";

describe("AppEditor（サーバーでの描画）", () => {
  it("部品・ボタン・問題を描き、選べないワークフローをエラーとして出す", () => {
    const r = checkEditable("app 経費\n## 申請\n件名 = text 必須\nbutton 申請する -> workflow 経費申請\n");
    expect(r.ok).toBe(true);
    const html = renderToStaticMarkup(h(AppEditor, { figure: r.ok ? r.figure : emptyApp(), onChange: () => {}, workflows: [{ name: "別" }] }));
    expect(html).toContain('data-yui="app-editor"');
    expect(html).toContain("件名");
    expect(html).toContain("申請する");
    expect(html).toContain("「経費申請」は選べるワークフローにありません");
    // 入力の見た目は AppView と同じ部品で描く（操作はできない）
    expect(html).toMatch(/<input[^>]*disabled/);
  });

  it("空の画面は失敗ではなく始め方の案内を出す", () => {
    const html = renderToStaticMarkup(h(AppEditor, { figure: emptyApp(), onChange: () => {} }));
    expect(html).toContain("部品を置いて始めましょう");
    expect(html).not.toContain("保存できない問題");
  });

  it("ソースに診断があるブロックは開かない（読めない行を落とさない）", () => {
    expect(checkEditable(src)).toMatchObject({ ok: false, reason: "diagnostics" });
  });
});
