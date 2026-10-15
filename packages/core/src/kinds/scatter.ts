/**
 * scatter: 散布図。2 つの量の関係。
 *
 * - 列名の行 `ラベル | X の名前 | Y の名前 [| まとまり]`、以降 `A社 | 12 | 30 [| 製造]`。
 * - X・Y は §6 の数値。読めない行・欠損の行は除外する。
 */

import type { ScatterFigure, ScatterPoint } from "../ir.js";
import { parseCell } from "../number.js";
import { clip, Diagnostics, hasPipe, isSeparatorRow, LIMITS, type Line, parseOption, splitCells, stripListMarker, takeRefs } from "../lines.js";

const OPTIONS = ["note", "src"] as const;

export function parseScatter(fig: ScatterFigure, body: Line[], diags: Diagnostics): void {
  let header: string[] | null = null;
  for (const line of body) {
    const raw = stripListMarker(line.text.trim()).text;
    if (!hasPipe(raw) && !raw.includes("\t")) {
      const opt = parseOption(raw, OPTIONS);
      if (opt) {
        if (opt.key === "note") fig.note = opt.value;
        else fig.src = opt.value;
        continue;
      }
      diags.add(line.no, "warning", "unrecognized_line", `解釈できない行を無視しました: ${raw}`);
      continue;
    }
    const cells = splitCells(raw);
    if (isSeparatorRow(cells)) continue;
    if (!header) {
      const numeric = (c: string | undefined) => c !== undefined && parseCell(c).kind === "number";
      if (!(numeric(cells[1]) && numeric(cells[2]))) {
        header = [cells[0] || "項目", cells[1] || "X", cells[2] || "Y", ...(cells[3] ? [cells[3]] : [])].map((c) => clip(takeRefs(c).text, line.no, diags));
        fig.columns = header;
        continue;
      }
      diags.add(line.no, "info", "missing_header", "列名の行が無いため、軸の名前を補いました");
      header = ["項目", "X", "Y", ...(cells.length > 3 ? ["まとまり"] : [])];
      fig.columns = header;
    }
    if (cells.length < 3) {
      diags.add(line.no, "warning", "unrecognized_line", `X と Y の 2 つの値が要ります: ${raw}`);
      continue;
    }
    const label = takeRefs(cells[0]!);
    const xs = takeRefs(cells[1]!);
    const ys = takeRefs(cells[2]!);
    const x = parseCell(xs.text);
    const y = parseCell(ys.text);
    if (x.kind !== "number" || y.kind !== "number") {
      diags.add(line.no, "warning", "bad_number", `「${label.text}」の値が数値として読めないため、この点を表示しません`);
      continue;
    }
    if (fig.points.length >= LIMITS.scatterPoints) {
      diags.addOnce(line.no, "warning", "limit_exceeded", `点は ${LIMITS.scatterPoints} 個までです`);
      continue;
    }
    const p: ScatterPoint = { label: clip(label.text, line.no, diags), x: x.value, y: y.value, refs: [...new Set([...label.refs, ...xs.refs, ...ys.refs])] };
    if (header.length > 3 && cells[3]) p.group = clip(takeRefs(cells[3]).text, line.no, diags);
    else if (cells.length > Math.max(3, header.length)) diags.addOnce(line.no, "warning", "extra_cells", "4 列目以降は、列名の行に名前がある場合だけ色分けに使います");
    fig.points.push(p);
  }
}
