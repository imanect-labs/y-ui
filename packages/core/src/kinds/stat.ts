/** stat: 数値カード。`項目 | 値 | 補足` または `項目: 値`。 */

import type { StatFigure, StatItem } from "../ir.js";
import { parseNumber } from "../number.js";
import { clip, Diagnostics, hasPipe, isSeparatorRow, LIMITS, type Line, parseOption, splitCells, stripListMarker, takeRefs } from "../lines.js";

const OPTIONS = ["note", "src"] as const;

export function parseStat(fig: StatFigure, body: Line[], diags: Diagnostics): void {
  for (const line of body) {
    const raw = stripListMarker(line.text.trim()).text;
    let cells: string[];
    if (hasPipe(raw) || raw.includes("\t")) {
      cells = splitCells(raw);
      if (isSeparatorRow(cells)) continue;
    } else {
      const opt = parseOption(raw, OPTIONS);
      if (opt) {
        if (opt.key === "note") fig.note = opt.value;
        else fig.src = opt.value;
        continue;
      }
      const kv = /^(.+?)\s*[:：]\s*(.+)$/.exec(raw);
      if (!kv) {
        diags.add(line.no, "warning", "unrecognized_line", `解釈できない行を無視しました: ${raw}`);
        continue;
      }
      cells = [kv[1]!, kv[2]!];
    }
    if (cells.length < 2 || cells[1] === "") {
      diags.add(line.no, "warning", "unrecognized_line", `値が無い項目を無視しました: ${raw}`);
      continue;
    }
    if (fig.items.length >= LIMITS.statItems) {
      diags.addOnce(line.no, "warning", "limit_exceeded", `項目は ${LIMITS.statItems} 個までです`);
      continue;
    }
    const label = takeRefs(cells[0]!);
    const value = takeRefs(cells[1]!);
    const item: StatItem = {
      label: clip(label.text, line.no, diags),
      value: clip(value.text, line.no, diags),
      refs: [...new Set([...label.refs, ...value.refs])],
    };
    const num = parseNumber(value.text);
    if (num) item.num = num.value;
    if (cells.length > 2 && cells[2] !== "") {
      const sub = takeRefs(cells.slice(2).join(" / "));
      item.sub = clip(sub.text, line.no, diags);
      item.refs = [...new Set([...item.refs, ...sub.refs])];
    }
    fig.items.push(item);
  }
}
