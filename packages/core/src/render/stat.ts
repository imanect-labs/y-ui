/** stat: 数値カードを格子に並べる。枠線と淡い地のカードに、値は大きく、項目名と補足は控えめに。 */

import type { StatFigure } from "../ir.js";
import { BODY_SIZE, type Ctx } from "./frame.js";
import { fit, wrap } from "./measure.js";

const MIN_CARD = 150;
const GAP = 10;

export function layoutStat(ctx: Ctx, f: StatFigure, top: number): number {
  const n = f.items.length;
  if (n === 0) return top;
  const inner = ctx.width - ctx.pad * 2;
  const cols = Math.max(1, Math.min(n, Math.floor((inner + GAP) / (MIN_CARD + GAP)), n === 4 && inner < 4 * MIN_CARD + 3 * GAP ? 2 : 6));
  const cardW = (inner - GAP * (cols - 1)) / cols;
  const pad = 12;

  // 値の文字の大きさは、全カードで揃える（いちばん長い値が収まる大きさ）
  let valueSize = 24;
  while (valueSize > 16 && f.items.some((it) => ctx.measure(it.value, valueSize, 600) > cardW - pad * 2)) valueSize -= 2;

  const subLines = f.items.map((it) => (it.sub ? wrap(it.sub, cardW - pad * 2, BODY_SIZE, ctx.measure, 2) : []));
  const maxSub = Math.max(0, ...subLines.map((l) => l.length));
  // 推移があれば、値の下に小さな折れ線の段を足す
  const spark = f.items.some((it) => it.trend && it.trend.length >= 2) ? 30 : 0;
  const cardH = pad + 14 + 8 + valueSize + spark + (maxSub ? 6 + maxSub * 16 : 0) + pad;

  f.items.forEach((it, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = ctx.pad + c * (cardW + GAP);
    const y = top + r * (cardH + GAP);
    const refs = it.refs.length ? ` ${it.refs.map((n) => `[${n}]`).join("")}` : "";
    ctx.items.push({ t: "rect", x: x + 0.5, y: y + 0.5, w: cardW - 1, h: cardH - 1, r: 12, fill: "surface2", stroke: "border", strokeWidth: 1, hint: `${it.label}: ${it.value}${it.sub ? `（${it.sub}）` : ""}` });
    ctx.items.push({ t: "text", x: x + pad, y: y + pad + 12, text: fit(it.label + refs, cardW - pad * 2, BODY_SIZE, ctx.measure, 600), size: BODY_SIZE, weight: 600, fill: "muted" });
    const vy = y + pad + 14 + 8 + valueSize * 0.85;
    ctx.items.push({ t: "text", x: x + pad, y: vy, text: fit(it.value, cardW - pad * 2, valueSize, ctx.measure, 600), size: valueSize, weight: 600, fill: "ink" });
    if (it.trend && it.trend.length >= 2) {
      const t = it.trend;
      const [mn, mx] = [Math.min(...t), Math.max(...t)];
      const sw = cardW - pad * 2;
      const sy = vy + valueSize * 0.15 + 6;
      const pts = t.map((v, k) => [x + pad + (k / (t.length - 1)) * sw, sy + 20 - (mx > mn ? ((v - mn) / (mx - mn)) * 18 : 9)] as const);
      ctx.items.push({ t: "path", d: pts.map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(""), stroke: "s1", strokeWidth: 1.75 });
      const [lx, ly] = pts[pts.length - 1]!;
      ctx.items.push({ t: "circle", cx: lx, cy: ly, r: 3, fill: "s1", stroke: "surface2", strokeWidth: 1.5 });
    }
    subLines[i]!.forEach((l, k) => ctx.items.push({ t: "text", x: x + pad, y: vy + spark + valueSize * 0.15 + 6 + 12 + k * 16, text: l, size: BODY_SIZE, fill: "muted" }));
  });
  const rows = Math.ceil(n / cols);
  return top + rows * cardH + (rows - 1) * GAP + 8;
}
