import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBlock, type Figure } from "@imanect/yui";
import { generatedTasks } from "./generate.js";
import { FLOW_TASKS, STACK_TASKS, type Handwritten } from "./handwritten.js";
import type { EvalTask } from "./types.js";

export const TASKS_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../tasks/tasks.jsonl");

function fromHandwritten(h: Handwritten, category: "flow" | "stack"): EvalTask {
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
    acceptKinds: [category],
    gold: r.figure as Figure,
  };
}

export function buildTasks(): EvalTask[] {
  return [...generatedTasks(), ...FLOW_TASKS.map((h) => fromHandwritten(h, "flow")), ...STACK_TASKS.map((h) => fromHandwritten(h, "stack"))];
}

export function loadTasks(path = TASKS_PATH): EvalTask[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as EvalTask);
}
