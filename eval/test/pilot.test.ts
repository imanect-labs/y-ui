import { describe, expect, it } from "vitest";
import { parseToolCalls, sampleTasks, splitAnswers } from "../src/pilot.js";
import { loadTasks } from "../src/tasks/index.js";

describe("予備評価", () => {
  it("種類ごとに等間隔で選ぶ", () => {
    const s = sampleTasks(loadTasks(), 3);
    expect(s).toHaveLength(42);
    expect(s.filter((t) => t.category === "flow").map((t) => t.id)).toEqual(["flow-001", "flow-007", "flow-014"]);
  });

  it("回答ファイルを課題ごとに分ける", () => {
    const m = splitAnswers("前置き\n=== TASK bar-001 ===\n回答1\n```ui\nbar x\n```\n\n=== TASK flow-001 ===\n回答2\n");
    expect([...m.entries()]).toEqual([
      ["bar-001", "回答1\n```ui\nbar x\n```"],
      ["flow-001", "回答2"],
    ]);
  });

  it("本文中のツール呼び出しを取り出す", () => {
    const r = parseToolCalls('グラフです。\n<tool_call name="emit_ui">{"spec":{"version":1}}</tool_call>\n以上');
    expect(r.toolCalls).toEqual([{ id: "p0", name: "emit_ui", arguments: '{"spec":{"version":1}}' }]);
    expect(r.text).toBe("グラフです。\n\n以上");
  });
});
