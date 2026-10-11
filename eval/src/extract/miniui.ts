/** 方式 B / C: 本文中の ` ```ui ` ブロックを読む。 */

import { parseMarkdown, type Figure } from "@miniui/core";
import type { Extraction } from "../score.js";

export function extractMiniui(text: string): Extraction {
  const figures: Figure[] = [];
  const errors: string[] = [];
  let attempted = false;
  let syntaxOk = true;
  let warnings = 0;
  for (const seg of parseMarkdown(text, { final: true })) {
    if (seg.type !== "ui") continue;
    attempted = true;
    const r = seg.result;
    for (const d of r.diagnostics) {
      if (d.severity === "error") {
        syntaxOk = false;
        errors.push(`${d.code}: ${d.message}`);
      } else if (d.severity === "warning") {
        warnings++;
        errors.push(`${d.code}: ${d.message}`);
      }
    }
    if (r.figure) figures.push(r.figure);
    else syntaxOk = false;
  }
  return { figures, attempted, syntaxOk, errors, warnings };
}
