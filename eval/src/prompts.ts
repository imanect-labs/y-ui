/** 方式ごとのプロンプトの組み立て。 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatMessage, ToolDef } from "./client.js";
import { rng } from "./tasks/generate.js";
import type { EvalTask } from "./tasks/types.js";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../prompts");
const read = (name: string) => readFileSync(join(PROMPTS_DIR, name), "utf8").trim();

export const ARMS = ["A", "A2", "B", "C", "D", "E", "F", "G", "H"] as const;
export type ArmId = (typeof ARMS)[number];

export const ARM_LABELS: Record<ArmId, string> = {
  A: "現行 emit_ui（ツール＋JSON）",
  A2: "emit_ui をツール指定で強制",
  B: "Yui 本文中（簡易版の説明）",
  C: "Yui 本文中（完全版の説明）",
  D: "短い JSON を本文中のフェンスに",
  E: "Mermaid（flow / stack のみ）",
  F: "Yui 本文中（Shiki の yui_guide.md）",
  G: "Yui 本文中（説明は必要なときにツールで読む）",
  H: "Yui 本文中（必要なときに読む＋種類の早見）",
};

/** その方式で評価する課題か。 */
export function armApplies(arm: ArmId, task: EvalTask): boolean {
  if (arm === "A2") return task.expect === "figure";
  if (arm === "E") return task.category === "flow" || task.category === "stack";
  return true;
}

// ------------------------------------------------------------ Shiki の emit_ui

/**
 * Rust の文字列リテラルを読む（`\` + 改行 + 字下げの継続、`\"` `\n` `\\`）。
 * Shiki のプロンプトを Yui リポジトリに複製しないため、評価のたびに Shiki のソースから読む。
 */
export function readRustString(src: string, from: number): string {
  const start = src.indexOf('"', from);
  let out = "";
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '"') return out;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = src[i + 1];
    if (next === "\n") {
      i++;
      while (src[i + 1] === " " || src[i + 1] === "\t") i++;
    } else if (next === "n") {
      out += "\n";
      i++;
    } else {
      out += next ?? "";
      i++;
    }
  }
  throw new Error("文字列リテラルが閉じていません");
}

export interface ShikiTool {
  tool: ToolDef;
  /** 読み込んだ Shiki のコミット。 */
  commit: string;
  /** Shiki がチャットの system に足す Yui の説明（`crates/chat/src/worker/yui_guide.md`）。方式 F で使う。 */
  yuiGuide?: string;
}

export function loadShikiTool(shikiRoot: string): ShikiTool {
  const path = join(shikiRoot, "crates/gui/src/emit_tool.rs");
  const src = readFileSync(path, "utf8");
  const desc = readRustString(src, src.indexOf("fn description"));
  const schemaAt = src.indexOf("fn input_schema");
  const specDesc = readRustString(src, src.indexOf('"description"', schemaAt) + '"description"'.length);
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["-C", shikiRoot, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // git が無い環境でも評価は続ける
  }
  const guidePath = join(shikiRoot, "crates/chat/src/worker/yui_guide.md");
  const yuiGuide = existsSync(guidePath) ? readFileSync(guidePath, "utf8").trim() : undefined;
  return {
    commit,
    ...(yuiGuide ? { yuiGuide } : {}),
    tool: {
      type: "function",
      function: {
        name: "emit_ui",
        description: desc,
        parameters: { type: "object", properties: { spec: { type: "object", description: specDesc } }, required: ["spec"] },
      },
    },
  };
}

// ------------------------------------------------------------ 文脈の水増し（長い文脈の下での劣化を見る）

export interface Padding {
  dir: string;
  /** 追加する文字数の目安。日本語はおよそ 1 文字 ≒ 1 トークン。 */
  chars: number;
}

let padCorpus: string[] | null = null;

function loadCorpus(dir: string): string[] {
  if (padCorpus) return padCorpus;
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".md")) files.push(p);
    }
  };
  walk(dir);
  // 段落単位に切る（数字を多く含む段落は、捏造の判定を乱すので避ける）。
  padCorpus = files
    .flatMap((f) => readFileSync(f, "utf8").split(/\n{2,}/))
    .map((p) => p.trim())
    .filter((p) => p.length >= 80 && p.length <= 1500 && (p.match(/[0-9０-９]/g)?.length ?? 0) < 8);
  return padCorpus;
}

function paddingDocs(task: EvalTask, pad: Padding): string[] {
  const corpus = loadCorpus(pad.dir);
  if (corpus.length === 0) return [];
  const r = rng([...task.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
  const docs: string[] = [];
  let total = 0;
  while (total < pad.chars) {
    const p = corpus[Math.floor(r() * corpus.length)]!;
    docs.push(p);
    total += p.length;
  }
  return docs;
}

// ------------------------------------------------------------ メッセージ

export function userMessage(task: EvalTask, pad?: Padding): string {
  const docs = [task.context, ...(pad ? paddingDocs(task, pad) : [])];
  const refs = docs.map((d, i) => `[${i + 1}]\n${d}`).join("\n\n");
  return `# 参考資料\n\n${refs}\n\n# 質問\n${task.question}`;
}

export function systemPrompt(arm: ArmId, task: EvalTask, shiki?: ShikiTool | null): string {
  const base = read("base.md");
  switch (arm) {
    case "A":
    case "A2":
      return base;
    case "B":
      return `${base}\n\n${read("miniui-lite.md")}`;
    case "C":
      return `${base}\n\n${read("miniui-full.md")}`;
    case "D":
      return `${base}\n\n${read("jsonui.md")}`;
    case "E":
      return `${base}\n\n${read("mermaid.md")}`;
    case "F":
      // Shiki が実際に使う説明をそのまま読む（説明を直した効果を、出荷する文面で測る）。
      if (!shiki?.yuiGuide) throw new Error("方式 F には Shiki のソース（--shiki-root）の yui_guide.md が必要です");
      return `${base}\n\n${shiki.yuiGuide}`;
    case "G":
      return `${base}\n\n${read("yui-ondemand.md")}`;
    case "H":
      return `${base}\n\n${read("yui-ondemand-kinds.md")}`;
  }
  void task;
}

export function buildMessages(arm: ArmId, task: EvalTask, pad?: Padding, shiki?: ShikiTool | null): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt(arm, task, shiki) },
    { role: "user", content: userMessage(task, pad) },
  ];
}
