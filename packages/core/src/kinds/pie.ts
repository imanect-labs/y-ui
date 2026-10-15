/** pie: 構成比（円グラフ）。`項目 | 値` を並べる。表の読み方は bar / line と同じ。 */

import type { ChartFigure } from "../ir.js";
import { Diagnostics, LIMITS, type Line } from "../lines.js";
import { parseChart } from "./chart.js";

export function parsePie(fig: ChartFigure, body: Line[], diags: Diagnostics): void {
  parseChart(fig, body, diags);
  // 円グラフは 1 系列。2 系列目以降は描かない（黙って捨てずに知らせる）。
  if (fig.columns.length > 2) {
    diags.add(0, "info", "extra_cells", `円グラフは 1 系列だけを描きます（「${fig.columns[1]}」）。他の系列は棒グラフで描いてください`);
    fig.columns = fig.columns.slice(0, 2);
    for (const r of fig.rows) r.values = r.values.slice(0, 1);
  }
  // 割合にできない値（欠損・負の値）の行は描かない。
  const kept = [];
  for (const r of fig.rows) {
    const v = r.values[0];
    if (v === null || v === undefined) {
      diags.add(0, "warning", "bad_number", `「${r.label}」は値が無いため、円グラフに入れません`);
      continue;
    }
    if (v < 0) {
      diags.add(0, "warning", "bad_number", `「${r.label}」は負の値のため、円グラフに入れません`);
      continue;
    }
    kept.push(r);
  }
  if (kept.length > LIMITS.pieSlices) {
    diags.add(0, "warning", "limit_exceeded", `円グラフは ${LIMITS.pieSlices} 項目までです。以降を省略しました（多い場合は棒グラフが向いています）`);
    kept.length = LIMITS.pieSlices;
  }
  if (kept.length > 8) {
    diags.add(0, "info", "limit_exceeded", "9 項目以上は色で見分けにくいため、9 項目目以降は灰色で描きます（項目が多い場合は棒グラフが向いています）");
  }
  fig.rows = kept;
  delete fig.stacked;
  delete fig.horizontal;
}
