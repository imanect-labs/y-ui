import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBlock, type Figure } from "@imanect/yui";
import { generatedTasks } from "./generate.js";
import { FLOW_TASKS, STACK_TASKS, type Handwritten } from "./handwritten.js";
import { STEPS_TASKS, TIMELINE_TASKS, TREE_TASKS } from "./handwritten-v07.js";
import type { EvalTask } from "./types.js";

export const TASKS_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../tasks/tasks.jsonl");

/** 分岐も合流も無い流れ図か（手順の図で答えても正しい）。 */
function linearFlow(f: Figure): boolean {
  if (f.kind !== "flow") return false;
  const from = new Set(f.edges.map((e) => e.from));
  const to = new Set(f.edges.map((e) => e.to));
  return from.size === f.edges.length && to.size === f.edges.length;
}

function fromHandwritten(h: Handwritten, category: "flow" | "stack" | "timeline" | "steps" | "tree"): EvalTask {
  const r = parseBlock(h.gold, { final: true });
  const problems = r.diagnostics.filter((d) => d.severity !== "info");
  if (!r.figure || problems.length > 0) {
    throw new Error(`${h.id}: 正解のソースが解析できません: ${JSON.stringify(r.diagnostics)}`);
  }
  return {
    id: h.id,
    category,
    question: h.question,
    context: h.context,
    expect: "figure",
    // 手順は一本道の流れ図でも、一本道の流れ図は手順でも正しい
    acceptKinds: category === "steps" ? ["steps", "flow"] : linearFlow(r.figure) ? ["flow", "steps"] : [category],
    gold: r.figure as Figure,
  };
}

export function buildTasks(): EvalTask[] {
  return [
    ...generatedTasks(),
    ...FLOW_TASKS.map((h) => fromHandwritten(h, "flow")),
    ...STACK_TASKS.map((h) => fromHandwritten(h, "stack")),
    ...TIMELINE_TASKS.map((h) => fromHandwritten(h, "timeline")),
    ...STEPS_TASKS.map((h) => fromHandwritten(h, "steps")),
    ...TREE_TASKS.map((h) => fromHandwritten(h, "tree")),
  ];
}

export function loadTasks(path = TASKS_PATH): EvalTask[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as EvalTask);
}
