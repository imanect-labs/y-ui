/** stat: 数値カード。`項目 | 値 | 補足` または `項目: 値`。 */

import type { StatFigure, StatItem } from "../ir.js";
import { parseNumber } from "../number.js";
import { clip, Diagnostics, hasPipe, isSeparatorRow, LIMITS, type Line, parseOption, splitCells, stripListMarker, takeRefs } from "../lines.js";

const OPTIONS = ["note", "src"] as const;
const TREND = /^(?:trend|推移)\s*[:：]?\s*(-?\d+(?:\.\d+)?(?:\s*[,、]\s*-?\d+(?:\.\d+)?)+)$/i;

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
    // `trend 100, 110, 120`（推移）のセルは小さな折れ線にする
    const rest = cells.slice(2).filter((c) => {
      const t = TREND.exec(c.trim());
      if (!t) return true;
      const nums = t[1]!.split(/\s*[,、]\s*/).map(Number);
      if (nums.length >= 2 && nums.every(Number.isFinite)) item.trend = nums.slice(0, 60);
      return false;
    });
    if (rest.length > 0 && rest[0] !== "") {
      const sub = takeRefs(rest.join(" / "));
      item.sub = clip(sub.text, line.no, diags);
      item.refs = [...new Set([...item.refs, ...sub.refs])];
    }
    fig.items.push(item);
  }
}
