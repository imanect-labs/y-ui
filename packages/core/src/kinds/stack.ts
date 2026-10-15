/**
 * stack: 層構成図。
 *
 * - 1 段目の `- 名前: 説明` が層（上から下へ積み、層の間に矢印）。
 * - 字下げした `- 名前` は層の中の要素。
 * - 1 行の中の `|` は横並び。
 * - 層の間の `↓ ラベル` は矢印のラベル。
 */

import type { StackBox, StackFigure, StackTier } from "../ir.js";
import { clip, Diagnostics, hasPipe, LIMITS, type Line, parseOption, splitCells, stripListMarker, takeRefs } from "../lines.js";

const OPTIONS = ["note", "src"] as const;
const ARROW_LINE = /^(?:↓|⬇|↕|⇩|->|→)\s+(.*)$|^(?:↓|⬇|↕|⇩)$/;

export function indentOf(raw: string): number {
  let n = 0;
  for (const ch of raw) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 4;
    else if (ch === "　") n += 2;
    else break;
  }
  return n;
}

/** `名前: 説明` を見出しと説明に分ける（`10:00` のような時刻は分けない）。 */
export function splitTitle(text: string): { title: string; desc?: string } {
  const m = /^(.+?)(?:：|:\s+)(.+)$/.exec(text.trim());
  if (!m) return { title: text.trim() };
  return { title: m[1]!.trim(), desc: m[2]!.trim() };
}

function makeBoxes(text: string, line: number, diags: Diagnostics): StackBox[] {
  const parts = hasPipe(text) ? splitCells(text).filter((c) => c !== "") : [text];
  return parts.map((p) => {
    const r = takeRefs(p);
    const { title, desc } = splitTitle(r.text);
    const box: StackBox = { title: clip(title, line, diags), children: [], refs: r.refs };
    if (desc !== undefined) box.desc = clip(desc, line, diags);
    return box;
  });
}

export function parseStack(fig: StackFigure, body: Line[], diags: Diagnostics): void {
  let baseIndent: number | null = null;
  let childIndent: number | null = null;
  let pendingArrow: string | undefined;
  let current: StackTier | null = null;

  for (const line of body) {
    const indent = indentOf(line.text);
    const { text, marked } = stripListMarker(line.text.trim());
    if (text === "") continue;

    if (!marked) {
      const opt = parseOption(text, OPTIONS);
      if (opt) {
        if (opt.key === "note") fig.note = opt.value;
        else fig.src = opt.value;
        continue;
      }
      const arrow = ARROW_LINE.exec(text);
      if (arrow) {
        pendingArrow = arrow[1]?.trim() || undefined;
        continue;
      }
    }

    if (baseIndent === null) baseIndent = indent;
    const isChild = indent > baseIndent && current !== null;

    if (!isChild) {
      if (fig.tiers.length >= LIMITS.stackTiers) {
        diags.addOnce(line.no, "warning", "limit_exceeded", `層は ${LIMITS.stackTiers} 段までです`);
        current = null;
        continue;
      }
      let boxes = makeBoxes(text, line.no, diags);
      if (boxes.length > LIMITS.stackBoxesPerTier) {
        diags.add(line.no, "warning", "limit_exceeded", `横並びは ${LIMITS.stackBoxesPerTier} 個までです`);
        boxes = boxes.slice(0, LIMITS.stackBoxesPerTier);
      }
      current = { boxes };
      if (pendingArrow !== undefined) current.arrowLabel = pendingArrow;
      pendingArrow = undefined;
      fig.tiers.push(current);
      childIndent = null;
      continue;
    }

    if (childIndent === null) childIndent = indent;
    if (indent > childIndent) {
      diags.addOnce(line.no, "info", "nested_too_deep", "3 段目以降の字下げは 2 段目として表示します");
    }
    const parent = current!.boxes[current!.boxes.length - 1]!;
    for (const child of makeBoxes(text, line.no, diags)) {
      if (parent.children.length >= LIMITS.stackChildren) {
        diags.addOnce(line.no, "warning", "limit_exceeded", `層の中の要素は ${LIMITS.stackChildren} 個までです`);
        break;
      }
      parent.children.push(child);
    }
  }
}
