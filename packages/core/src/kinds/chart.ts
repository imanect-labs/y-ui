/** bar / line: 表形式のデータ。 */

import type { ChartFigure, ChartRow } from "../ir.js";
import { parseCell, parseNumber } from "../number.js";
import {
  clip,
  Diagnostics,
  hasPipe,
  isSeparatorRow,
  LIMITS,
  type Line,
  parseOption,
  splitCells,
  stripListMarker,
  takeRefs,
  truthy,
} from "../lines.js";

const OPTIONS = ["note", "unit", "src", "stacked", "horizontal"] as const;

export function parseChart(fig: ChartFigure, body: Line[], diags: Diagnostics): void {
  let header: string[] | null = null;

  for (const line of body) {
    const raw = stripListMarker(line.text.trim()).text;

    if (!hasPipe(raw) && !raw.includes("\t")) {
      const opt = parseOption(raw, OPTIONS);
      if (opt) {
        applyOption(fig, opt.key, opt.value);
        continue;
      }
      // `1月: 120` のような 1 系列の行も受ける。
      const kv = /^(.+?)\s*[:：]\s*(.+)$/.exec(raw);
      if (kv && parseNumber(kv[2]!)) {
        if (!header) header = synthesizeHeader(1, line.no, diags);
        pushRow(fig, header, [kv[1]!, kv[2]!], line.no, diags);
        continue;
      }
      diags.add(line.no, "warning", "unrecognized_line", `解釈できない行を無視しました: ${raw}`);
      continue;
    }

    const cells = splitCells(raw);
    if (isSeparatorRow(cells)) continue;

    if (!header) {
      if (looksLikeHeader(cells)) {
        header = cells.slice(0, LIMITS.chartColumns).map((c, i) => clip(takeRefs(c).text, line.no, diags) || (i === 0 ? "項目" : `系列${i}`));
        if (cells.length > LIMITS.chartColumns) {
          diags.add(line.no, "warning", "limit_exceeded", `列は ${LIMITS.chartColumns} 列までです`);
        }
        fig.columns = header;
        continue;
      }
      header = synthesizeHeader(cells.length - 1, line.no, diags);
      fig.columns = header;
    }
    pushRow(fig, header, cells, line.no, diags);
  }

  if (header) fig.columns = header;
}

function applyOption(fig: ChartFigure, key: string, value: string): void {
  switch (key) {
    case "note":
      fig.note = value;
      break;
    case "unit":
      fig.unit = value;
      break;
    case "src":
      fig.src = value;
      break;
    case "stacked":
      fig.stacked = truthy(value);
      break;
    case "horizontal":
      fig.horizontal = truthy(value);
      break;
  }
}

const PERIOD_LIKE = /^((19|20)\d{2}(年度|年)?|FY\s?\d{2,4}|\d{4}\/\d{1,2}|\d{1,2}月|Q[1-4]|第?\d+四半期|第?\d+期)$/i;

/**
 * 見出し行とみなす条件: 2 列目以降に数値として読めないセルがある、
 * または全部が年・月・期のような期間の表記（`2024` `2025年度` は数値としても読めてしまう）。
 */
function looksLikeHeader(cells: string[]): boolean {
  if (cells.length < 2) return true;
  const rest = cells.slice(1).map((c) => c.normalize("NFKC").trim());
  return rest.some((c) => parseCell(c).kind === "bad") || rest.every((c) => PERIOD_LIKE.test(c));
}

function synthesizeHeader(series: number, line: number, diags: Diagnostics): string[] {
  diags.add(line, "info", "missing_header", "列名の行が無いため、系列名を補いました");
  const n = Math.max(1, Math.min(series, LIMITS.chartColumns - 1));
  return ["項目", ...Array.from({ length: n }, (_, i) => (n === 1 ? "値" : `系列${i + 1}`))];
}

function pushRow(fig: ChartFigure, header: string[], cells: string[], line: number, diags: Diagnostics): void {
  if (fig.rows.length >= LIMITS.chartRows) {
    diags.addOnce(line, "warning", "limit_exceeded", `データ行は ${LIMITS.chartRows} 行までです。以降を省略しました`);
    return;
  }
  const label = takeRefs(cells[0] ?? "");
  const width = header.length - 1;
  if (cells.length - 1 > width) {
    diags.add(line, "warning", "extra_cells", `列名より多いセルを無視しました（${cells.length - 1} > ${width}）`);
  }
  const values: (number | null)[] = [];
  const refs = [...label.refs];
  for (let i = 1; i <= width; i++) {
    const cellText = cells[i] ?? "";
    const cellRefs = takeRefs(cellText);
    refs.push(...cellRefs.refs);
    const v = parseCell(cellRefs.text);
    if (v.kind === "bad") {
      diags.add(line, "warning", "bad_number", `「${label.text}」の「${cellText}」は数値として読めないため、この行を表示しません`);
      return;
    }
    values.push(v.kind === "number" ? v.value : null);
  }
  const row: ChartRow = { label: clip(label.text, line, diags), values, refs: dedupe(refs) };
  fig.rows.push(row);
}

function dedupe(xs: number[]): number[] {
  return [...new Set(xs)];
}
