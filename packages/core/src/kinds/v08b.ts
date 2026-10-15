/**
 * quadrant（2×2 の位置づけ）と gantt（工程表）。
 *
 * - quadrant: `x: 効果`・`y: 実現しやすさ`（軸の名前）、`右上: すぐやる` など（象限の名前）、`名前 | x | y`（0〜100）。
 * - gantt: `タスク | 開始 | 終了`、マイルストーンは `名前 | 日付`。日付は `2024-04-01`・`2024/4/1`・`4/1`・`4月1日`・
 *   `2024年4月`・`4月`（月だけなら開始はその月の 1 日、終了は末日）。
 */

import type { GanttFigure, GanttTask, QuadrantFigure, QuadrantItem } from "../ir.js";
import { parseNumber } from "../number.js";
import { clip, Diagnostics, hasPipe, isSeparatorRow, LIMITS, type Line, parseOption, splitCells, stripListMarker, takeRefs } from "../lines.js";

// ---------------------------------------------------------------- quadrant

const AXIS = /^(x|y|横軸|縦軸|横|縦)\s*[:：]\s*(.+)$/i;
const QUAD = /^(右上|左上|左下|右下|第[1-4一二三四]象限)\s*[:：]\s*(.+)$/;
const QUAD_INDEX: Record<string, number> = { 右上: 0, 左上: 1, 左下: 2, 右下: 3, 第1象限: 0, 第2象限: 1, 第3象限: 2, 第4象限: 3, 第一象限: 0, 第二象限: 1, 第三象限: 2, 第四象限: 3 };

export function parseQuadrant(fig: QuadrantFigure, body: Line[], diags: Diagnostics): void {
  let first = true;
  for (const line of body) {
    const raw = stripListMarker(line.text.trim()).text;
    if (raw === "") continue;
    if (!hasPipe(raw) && !raw.includes("\t")) {
      const opt = parseOption(raw, ["note", "src"]);
      if (opt) {
        if (opt.key === "note") fig.note = opt.value;
        else fig.src = opt.value;
        continue;
      }
      const ax = AXIS.exec(raw);
      if (ax) {
        const name = clip(ax[2]!.trim(), line.no, diags);
        if (/^(x|横軸|横)$/i.test(ax[1]!)) fig.xLabel = name;
        else fig.yLabel = name;
        continue;
      }
      const q = QUAD.exec(raw);
      if (q) {
        fig.quadrants[QUAD_INDEX[q[1]!.normalize("NFKC")] ?? 0] = clip(q[2]!.trim(), line.no, diags);
        continue;
      }
      diags.add(line.no, "warning", "unrecognized_line", `解釈できない行を無視しました: ${raw}`);
      continue;
    }
    const cells = splitCells(raw);
    if (isSeparatorRow(cells)) continue;
    const label = takeRefs(cells[0] ?? "");
    const xc = takeRefs(cells[1] ?? "");
    const yc = takeRefs(cells[2] ?? "");
    const x = parseNumber(xc.text);
    const y = parseNumber(yc.text);
    if (!x || !y) {
      // 最初の行が見出し（`施策 | 効果 | 工数`）なら、軸の名前として使う
      if (first && cells.length >= 3) {
        if (!fig.xLabel) fig.xLabel = clip(cells[1]!, line.no, diags);
        if (!fig.yLabel) fig.yLabel = clip(cells[2]!, line.no, diags);
        first = false;
        continue;
      }
      diags.add(line.no, "warning", "bad_number", `「${label.text}」の位置が数値として読めないため、表示しません`);
      continue;
    }
    first = false;
    if (fig.items.length >= LIMITS.quadrantItems) {
      diags.addOnce(line.no, "warning", "limit_exceeded", `項目は ${LIMITS.quadrantItems} 個までです`);
      continue;
    }
    const clamp = (v: number) => Math.min(100, Math.max(0, v));
    if (x.value !== clamp(x.value) || y.value !== clamp(y.value)) diags.add(line.no, "warning", "bad_number", `「${label.text}」の位置は 0〜100 で書いてください（範囲に丸めました）`);
    const item: QuadrantItem = { label: clip(label.text, line.no, diags), x: clamp(x.value), y: clamp(y.value), refs: [...new Set([...label.refs, ...xc.refs, ...yc.refs])] };
    fig.items.push(item);
  }
}

// ---------------------------------------------------------------- gantt

/** 年の書かれていない日付に使う仮の年（うるう年でない）。 */
const NO_YEAR = 2001;
const DAY = 86_400_000;

interface ParsedDate {
  /** 開始として読んだ日（その日の 0 時、1970-01-01 からの日数）。 */
  start: number;
  /** 終了として読んだ日（月だけならその月の末日）。 */
  end: number;
  hasYear: boolean;
}

const days = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / DAY);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 日付を読む。年が無ければ year（直前に出た年、無ければ仮の年）を使う。 */
export function parseDate(text: string, year: number | null): ParsedDate | null {
  const t = text.normalize("NFKC").replace(/\s+/g, "").replace(/[(（][^)）]*[)）]$/, "");
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(t);
  if (m) {
    const v = days(+m[1]!, +m[2]!, +m[3]!);
    return valid(+m[2]!, +m[3]!) ? { start: v, end: v, hasYear: true } : null;
  }
  m = /^(\d{4})[-/.年](\d{1,2})月?$/.exec(t);
  if (m) return valid(+m[2]!, 1) ? { start: days(+m[1]!, +m[2]!, 1), end: days(+m[1]!, +m[2]!, lastDay(+m[1]!, +m[2]!)), hasYear: true } : null;
  const y = year ?? NO_YEAR;
  m = /^(\d{1,2})[/月](\d{1,2})日?$/.exec(t);
  if (m) {
    const v = days(y, +m[1]!, +m[2]!);
    return valid(+m[1]!, +m[2]!) ? { start: v, end: v, hasYear: false } : null;
  }
  m = /^(\d{1,2})月$/.exec(t);
  if (m) return valid(+m[1]!, 1) ? { start: days(y, +m[1]!, 1), end: days(y, +m[1]!, lastDay(y, +m[1]!)), hasYear: false } : null;
  return null;
}

function valid(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

export function parseGantt(fig: GanttFigure, body: Line[], diags: Diagnostics): void {
  let year: number | null = null;
  let anyYear = false;
  for (const line of body) {
    const raw = stripListMarker(line.text.trim()).text;
    if (raw === "") continue;
    let cells: string[];
    if (hasPipe(raw) || raw.includes("\t")) {
      cells = splitCells(raw);
      if (isSeparatorRow(cells)) continue;
    } else {
      const opt = parseOption(raw, ["note", "src"]);
      if (opt) {
        if (opt.key === "note") fig.note = opt.value;
        else fig.src = opt.value;
        continue;
      }
      // `設計: 4/1 〜 4/30` も受ける
      const kv = /^(.+?)\s*[:：]\s*(.+?)(?:\s*(?:〜|~|～|–|→|から|\s-\s)\s*(.+))?$/.exec(raw);
      if (!kv) {
        diags.add(line.no, "warning", "unrecognized_line", `解釈できない行を無視しました: ${raw}`);
        continue;
      }
      cells = [kv[1]!, kv[2]!, ...(kv[3] ? [kv[3]] : [])];
    }
    // 1 セルに `4/1〜4/30` と書いた場合
    if (cells.length === 2) {
      const range = /^(.+?)\s*(?:〜|~|～|–|→|から)\s*(.+)$/.exec(cells[1]!);
      if (range) cells = [cells[0]!, range[1]!, range[2]!];
    }
    const label = takeRefs(cells[0] ?? "");
    const s = parseDate(takeRefs(cells[1] ?? "").text, year);
    if (!s) {
      // 見出し行（`タスク | 開始 | 終了`）は黙って飛ばす
      if (fig.tasks.length === 0 && /^(タスク|作業|工程|項目|名前|task|name)$/i.test(label.text.normalize("NFKC"))) continue;
      diags.add(line.no, "warning", "bad_number", `「${label.text}」の開始「${cells[1] ?? ""}」を日付として読めないため、表示しません`);
      continue;
    }
    if (s.hasYear) year = new Date(s.start * DAY).getUTCFullYear();
    // 行末の引用番号は、終了（無ければ開始）のセルに付く
    const endCell = takeRefs((cells[2] ?? "").trim());
    const startCell = takeRefs(cells[1]!);
    const endText = endCell.text;
    let e = endText ? parseDate(takeRefs(endText).text, year ?? (s.hasYear ? new Date(s.start * DAY).getUTCFullYear() : null)) : null;
    if (endText && !e) {
      diags.add(line.no, "warning", "bad_number", `「${label.text}」の終了「${endText}」を日付として読めないため、表示しません`);
      continue;
    }
    // 年をまたぐ（12月 → 1月）は翌年とみなす
    if (e && !e.hasYear && e.end < s.start) e = { ...e, start: e.start + 365, end: e.end + 365 };
    if (e && e.end < s.start) {
      diags.add(line.no, "warning", "bad_number", `「${label.text}」の終了が開始より前のため、表示しません`);
      continue;
    }
    if (fig.tasks.length >= LIMITS.ganttTasks) {
      diags.addOnce(line.no, "warning", "limit_exceeded", `タスクは ${LIMITS.ganttTasks} 個までです`);
      continue;
    }
    const task: GanttTask = {
      label: clip(label.text, line.no, diags),
      start: s.start,
      end: e ? e.end : s.end,
      startText: clip(startCell.text, line.no, diags),
      endText: clip(endText, line.no, diags),
      refs: [...new Set([...label.refs, ...startCell.refs, ...endCell.refs])],
    };
    if (s.hasYear || e?.hasYear) anyYear = true;
    if (!e && s.start === s.end) task.milestone = true;
    fig.tasks.push(task);
  }
  fig.noYear = !anyYear;
}
