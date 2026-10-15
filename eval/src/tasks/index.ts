import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBlock, type Figure } from "@imanect/yui";
import { generatedTasks } from "./generate.js";
import { FLOW_TASKS, STACK_TASKS, type Handwritten } from "./handwritten.js";
import { STEPS_TASKS, TIMELINE_TASKS, TREE_TASKS } from "./handwritten-v07.js";
import { CARDS_TASKS } from "./handwritten-v08.js";
import type { EvalTask } from "./types.js";

export const TASKS_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../tasks/tasks.jsonl");

/** 分岐も合流も無い流れ図か（手順の図で答えても正しい）。 */
function linearFlow(f: Figure): boolean {
  if (f.kind !== "flow") return false;
  const from = new Set(f.edges.map((e) => e.from));
  const to = new Set(f.edges.map((e) => e.to));
  return from.size === f.edges.length && to.size === f.edges.length;
}

function parseGold(id: string, src: string): Figure {
  const r = parseBlock(src, { final: true });
  if (!r.figure || r.diagnostics.some((d) => d.severity !== "info")) throw new Error(`${id}: 正解のソースが解析できません: ${JSON.stringify(r.diagnostics)}`);
  return r.figure;
}

function fromHandwritten(h: Handwritten, category: "flow" | "stack" | "timeline" | "steps" | "tree" | "cards"): EvalTask {
  const alt = (h.alt ?? []).map((s) => parseGold(h.id, s));
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
    acceptKinds: [...new Set([...(category === "steps" ? ["steps", "flow"] as const : linearFlow(r.figure) ? ["flow", "steps"] as const : [category]), ...alt.map((a) => a.kind)])],
    gold: r.figure as Figure,
    ...(alt.length ? { altGolds: alt } : {}),
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
    ...CARDS_TASKS.map((h) => fromHandwritten(h, "cards")),
  ];
}

export function loadTasks(path = TASKS_PATH): EvalTask[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as EvalTask);
}
