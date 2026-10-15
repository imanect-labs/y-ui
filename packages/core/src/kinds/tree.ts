/**
 * tree: 階層（組織図・分類・目次）。字下げした箇条書きの深さがそのまま階層になる。
 *
 * - `- 親` → `  - 子` → `    - 孫`。深さは 4 段まで（それより深いものは 4 段目に置く）。
 * - `名前: 説明` は見出しと説明。1 行の中の `|` は兄弟の並び。
 * - 最上位が複数あってもよい。
 */

import type { TreeFigure, TreeNode } from "../ir.js";
import { clip, Diagnostics, hasPipe, LIMITS, type Line, parseOption, splitCells, stripListMarker, takeRefs } from "../lines.js";
import { indentOf, splitTitle } from "./stack.js";

const OPTIONS = ["note", "src"] as const;

export function parseTree(fig: TreeFigure, body: Line[], diags: Diagnostics): void {
  /** 祖先の列（字下げ幅と節）。 */
  const path: { indent: number; node: TreeNode }[] = [];
  let count = 0;
  for (const line of body) {
    const indent = indentOf(line.text);
    const { text, marked } = stripListMarker(line.text.trim());
    if (text === "") continue;
    if (!marked && !hasPipe(text)) {
      const opt = parseOption(text, OPTIONS);
      if (opt) {
        if (opt.key === "note") fig.note = opt.value;
        else fig.src = opt.value;
        continue;
      }
    }
    while (path.length > 0 && path[path.length - 1]!.indent >= indent) path.pop();
    if (path.length >= LIMITS.treeDepth) {
      diags.addOnce(line.no, "info", "nested_too_deep", `${LIMITS.treeDepth + 1} 段目以降は ${LIMITS.treeDepth} 段目として表示します`);
      path.length = LIMITS.treeDepth - 1;
    }
    const parent = path[path.length - 1]?.node;
    const siblings = parent ? parent.children : fig.roots;
    const parts = hasPipe(text) ? splitCells(text).filter((c) => c !== "") : [text];
    let last: TreeNode | undefined;
    for (const p of parts) {
      if (count >= LIMITS.treeNodes) {
        diags.addOnce(line.no, "warning", "limit_exceeded", `項目は ${LIMITS.treeNodes} 個までです`);
        break;
      }
      const r = takeRefs(p);
      const { title, desc } = splitTitle(r.text);
      const node: TreeNode = { title: clip(title, line.no, diags), children: [], refs: r.refs };
      if (desc !== undefined) node.desc = clip(desc, line.no, diags);
      siblings.push(node);
      count++;
      last = node;
    }
    if (last) path.push({ indent, node: last });
  }
}
