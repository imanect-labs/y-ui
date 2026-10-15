/**
 * radar（レーダーチャート）と treemap（ツリーマップ）。表の読み方は bar / line と同じ。
 *
 * - radar: 行が観点（3 つ以上）、列が系列（比べるもの）。値は 0 以上。
 * - treemap: `項目 | 値` を 1 系列。値は 0 より大きい。面積で構成を見せる（項目が多い構成比に）。
 */

import type { ChartFigure } from "../ir.js";
import { Diagnostics, LIMITS, type Line } from "../lines.js";
import { parseChart } from "./chart.js";

export function parseRadar(fig: ChartFigure, body: Line[], diags: Diagnostics): void {
  parseChart(fig, body, diags);
  delete fig.stacked;
  delete fig.horizontal;
  if (fig.rows.length > LIMITS.radarAxes) {
    diags.add(0, "warning", "limit_exceeded", `レーダーチャートの観点は ${LIMITS.radarAxes} 個までです。以降を省略しました`);
    fig.rows = fig.rows.slice(0, LIMITS.radarAxes);
  }
  for (const r of fig.rows) {
    if (r.values.some((v) => v !== null && v < 0)) {
      diags.add(0, "warning", "bad_number", `「${r.label}」の負の値は 0 として描きます`);
      r.values = r.values.map((v) => (v !== null && v < 0 ? 0 : v));
    }
  }
  if (fig.rows.length > 0 && fig.rows.length < 3) diags.add(0, "warning", "unrecognized_line", "レーダーチャートは観点が 3 つ以上必要です（2 つ以下なら棒グラフが向いています）");
}

export function parseTreemap(fig: ChartFigure, body: Line[], diags: Diagnostics): void {
  parseChart(fig, body, diags);
  delete fig.stacked;
  delete fig.horizontal;
  if (fig.columns.length > 2) {
    diags.add(0, "info", "extra_cells", `ツリーマップは 1 系列だけを描きます（「${fig.columns[1]}」）`);
    fig.columns = fig.columns.slice(0, 2);
    for (const r of fig.rows) r.values = r.values.slice(0, 1);
  }
  fig.rows = fig.rows.filter((r) => {
    const v = r.values[0];
    if (v === null || v === undefined || v <= 0) {
      diags.add(0, "warning", "bad_number", `「${r.label}」は値が 0 以下か無いため、ツリーマップに入れません`);
      return false;
    }
    return true;
  });
  if (fig.rows.length > LIMITS.treemapItems) {
    diags.add(0, "warning", "limit_exceeded", `ツリーマップは ${LIMITS.treemapItems} 項目までです。以降を省略しました`);
    fig.rows = fig.rows.slice(0, LIMITS.treemapItems);
  }
}
