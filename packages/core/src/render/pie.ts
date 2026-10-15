/**
 * pie のレイアウト。ドーナツにして、中央に合計、横（狭い幅では下）に凡例（値と割合）を置く。
 *
 * 扇は書かれた順に、12 時から時計回りに並べる（並べ替えない）。扇の間は地の色で 2px 空ける。
 * 値の数字は扇の上に載せず、凡例にまとめる（色の上の文字は読みにくく、細い扇には入らないため）。
 */

import type { ChartFigure } from "../ir.js";
import { share } from "../text.js";
import { type Ctx, formatValue, withUnit } from "./frame.js";
import { fit } from "./measure.js";
import { META, TEXT } from "./style.js";
import { SERIES, type Token } from "./theme.js";

const MAX_DIAMETER = 200;
const ROW = 28;
const DOT = 5;
/** 凡例を横に置く最小の幅。これより狭ければ下に置く。 */
const SIDE_LEGEND_MIN = 460;
/** 凡例の幅の上限（値が項目名から離れすぎないように）。 */
const LEGEND_MAX = 340;

/** 扇の色。系列の 8 色を超えたら、同じ色を繰り返さず控えめな灰色にする（凡例と順番で区別する）。 */
function sliceColor(i: number): Token {
  return i < SERIES.length ? SERIES[i]! : "muted";
}

const f2 = (n: number) => +n.toFixed(2);

/** 外径 R・内径 r の扇（a0 → a1、ラジアン、12 時が -π/2）。 */
function sector(cx: number, cy: number, R: number, r: number, a0: number, a1: number): string {
  const full = a1 - a0 >= Math.PI * 2 - 1e-6;
  if (full) {
    // 一周は 2 つの半円に分ける（始点と終点が同じ弧は描けない）。
    const m = a0 + Math.PI;
    return [sector(cx, cy, R, r, a0, m), sector(cx, cy, R, r, m, a0 + Math.PI * 2)].join("");
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad: number, a: number) => `${f2(cx + rad * Math.cos(a))},${f2(cy + rad * Math.sin(a))}`;
  return `M${p(R, a0)}A${f2(R)},${f2(R)} 0 ${large} 1 ${p(R, a1)}L${p(r, a1)}A${f2(r)},${f2(r)} 0 ${large} 0 ${p(r, a0)}Z`;
}

export function layoutPie(ctx: Ctx, f: ChartFigure, top: number): number {
  const values = f.rows.map((r) => r.values[0] ?? 0);
  const total = values.reduce((a, v) => a + v, 0);
  if (f.rows.length === 0) return top;

  const inner = ctx.width - ctx.pad * 2;
  const side = inner >= SIDE_LEGEND_MIN;
  const D = side ? Math.min(MAX_DIAMETER, inner * 0.4) : Math.min(MAX_DIAMETER, inner * 0.7);
  const R = D / 2;
  const r = R * 0.7;
  const cx = side ? ctx.pad + R : ctx.pad + inner / 2;
  const cy = top + 8 + R;
  const valueName = f.columns[1] || "値";
  const unit = f.unit ?? "";

  // 扇
  let a = -Math.PI / 2;
  const wedges: { path: string; mid: number }[] = [];
  values.forEach((v, i) => {
    const sweep = total > 0 ? (v / total) * Math.PI * 2 : 0;
    const path = sweep > 0 ? sector(cx, cy, R, r, a, a + sweep) : "";
    wedges.push({ path, mid: a + sweep / 2 });
    if (path) {
      const label = f.rows[i]!.label;
      ctx.items.push({ t: "path", d: path, fill: sliceColor(i), stroke: "surface", strokeWidth: 2, group: `s${i}`, hint: `${label}: ${withUnit(formatValue(v, ctx.locale), unit)}（${share(v, total)}）` });
    }
    a += sweep;
  });

  // 中央の合計
  ctx.items.push({ t: "text", x: cx, y: cy - 8, text: ctx.labels.total, size: META, fill: "muted", anchor: "middle" });
  const totalText = withUnit(formatValue(total, ctx.locale), unit);
  let totalSize = 22;
  while (totalSize > 12 && ctx.measure(totalText, totalSize, 600) > r * 1.7) totalSize -= 1;
  ctx.items.push({ t: "text", x: cx, y: cy + totalSize * 0.75, text: fit(totalText, r * 1.8, totalSize, ctx.measure, 600), size: totalSize, weight: 600, fill: "ink", anchor: "middle", tabular: true });

  // 凡例（色の印・項目・値・割合）
  const lx = side ? ctx.pad + D + 36 : ctx.pad;
  const lw = Math.min(LEGEND_MAX, side ? ctx.width - ctx.pad - lx : inner);
  let ly = side ? top + 8 + Math.max(0, R - (f.rows.length * ROW) / 2) : cy + R + 20;
  const valueTexts = values.map((v) => formatValue(v, ctx.locale));
  const shareTexts = values.map((v) => share(v, total));
  const valueW = Math.max(...valueTexts.map((t) => ctx.measure(t, META)));
  const shareW = Math.max(...shareTexts.map((t) => ctx.measure(t, TEXT, 600)));
  const labelW = Math.max(40, lw - 18 - valueW - shareW - 28);
  const legendTop = ly;
  f.rows.forEach((row, i) => {
    const y = ly + ROW / 2;
    const group = `s${i}`;
    const refs = row.refs.length ? ` ${row.refs.map((n) => `[${n}]`).join("")}` : "";
    ctx.items.push({ t: "circle", cx: lx + DOT + 1, cy: y, r: DOT, fill: sliceColor(i), group });
    ctx.items.push({ t: "text", x: lx + 18, y: y + 4.5, text: fit(row.label + refs, labelW, TEXT, ctx.measure), size: TEXT, fill: "ink", group });
    ctx.items.push({ t: "text", x: lx + lw - shareW - 14, y: y + 4.5, text: valueTexts[i]!, size: META, fill: "muted", anchor: "end", tabular: true, group });
    ctx.items.push({ t: "text", x: lx + lw, y: y + 4.5, text: shareTexts[i]!, size: TEXT, weight: 600, fill: "ink", anchor: "end", tabular: true, group });

    // ホバー・フォーカス: 凡例の行と扇のどちらでも、その項目だけを残して強調する。
    const w = wedges[i]!;
    const tipX = w.path ? cx + R * Math.cos(w.mid) : lx + lw / 2;
    const tipY = w.path ? cy + R * Math.sin(w.mid) : ly;
    ctx.targets.push({
      hit: { x: lx, y: ly, w: lw, h: ROW },
      ...(w.path ? { hitPath: w.path } : {}),
      keep: [group],
      tip: {
        title: row.label,
        rows: [
          { label: valueName, value: withUnit(valueTexts[i]!, unit), token: sliceColor(i) },
          { label: ctx.labels.share, value: shareTexts[i]! },
        ],
        x: tipX,
        y: tipY,
      },
    });
    ly += ROW;
  });

  const legendBottom = legendTop + f.rows.length * ROW;
  return Math.max(cy + R, legendBottom) + 12;
}
