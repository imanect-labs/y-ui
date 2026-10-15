/**
 * callout（注意書き）と map（地図）の静止画のレイアウト。
 *
 * - callout: 淡い面に、種類の印（i・✓・!・×）と見出し・本文・箇条書き。
 * - map: 背景の地図は描かず、地点の位置関係（緯度・経度をそのまま平面に）と道順だけを描く。
 *   画面ではホストが地図の部品で描く（React の renderMap）。
 */

import type { CalloutFigure, MapFigure } from "../ir.js";
import type { Ctx } from "./frame.js";
import { fit, wrap } from "./measure.js";
import { HEAD, HEAD_LH, META, PAD, RADIUS, TEXT, TEXT_LH } from "./style.js";
import type { Token } from "./theme.js";

const TONE: Record<CalloutFigure["tone"], { token: Token; mark: string }> = {
  info: { token: "s1", mark: "i" },
  success: { token: "s3", mark: "✓" },
  warning: { token: "s6", mark: "!" },
  danger: { token: "s5", mark: "×" },
};

export function layoutCallout(ctx: Ctx, f: CalloutFigure, top: number): number {
  const inner = ctx.width - ctx.pad * 2;
  const tone = TONE[f.tone];
  const tx = ctx.pad + PAD + 30;
  const tw = ctx.width - ctx.pad - PAD - tx;
  const paras = f.body ? f.body.split("\n").map((p) => wrap(p, tw, TEXT, ctx.measure, 8)) : [];
  const items = f.items.map((it) => wrap(it, tw - 16, TEXT, ctx.measure, 4));
  const title = f.title ? wrap(f.title, tw, HEAD, ctx.measure, 2, 600) : [];
  const bodyH = title.length * HEAD_LH + (title.length ? 4 : 0) + paras.reduce((a, p) => a + p.length * TEXT_LH + 4, 0) + items.reduce((a, l) => a + l.length * TEXT_LH + 2, 0);
  const h = PAD * 2 + Math.max(22, bodyH);
  const y0 = top + 2;
  ctx.items.push({ t: "rect", x: ctx.pad + 0.5, y: y0 + 0.5, w: inner - 1, h: h - 1, r: RADIUS, fill: "surface2", stroke: "border", strokeWidth: 1 });
  ctx.items.push({ t: "circle", cx: ctx.pad + PAD + 11, cy: y0 + PAD + 11, r: 11, fill: tone.token });
  ctx.items.push({ t: "text", x: ctx.pad + PAD + 11, y: y0 + PAD + 15.5, text: tone.mark, size: META + 1, weight: 700, fill: f.tone === "warning" ? "ink" : "surface", anchor: "middle" });
  let y = y0 + PAD;
  title.forEach((l, k) => ctx.items.push({ t: "text", x: tx, y: y + 15 + k * HEAD_LH, text: l, size: HEAD, weight: 600, fill: "ink" }));
  if (title.length) y += title.length * HEAD_LH + 4;
  paras.forEach((p) => {
    p.forEach((l, k) => ctx.items.push({ t: "text", x: tx, y: y + 15 + k * TEXT_LH, text: l, size: TEXT, fill: "ink" }));
    y += p.length * TEXT_LH + 4;
  });
  items.forEach((l) => {
    ctx.items.push({ t: "circle", cx: tx + 4, cy: y + 10, r: 2.5, fill: "muted" });
    l.forEach((t, k) => ctx.items.push({ t: "text", x: tx + 14, y: y + 15 + k * TEXT_LH, text: t, size: TEXT, fill: "ink" }));
    y += l.length * TEXT_LH + 2;
  });
  return y0 + h + 8;
}

// ---------------------------------------------------------------- map

export function layoutMap(ctx: Ctx, f: MapFigure, top: number): number {
  if (f.markers.length === 0) return top;
  const inner = ctx.width - ctx.pad * 2;
  const H = Math.round(Math.min(320, Math.max(180, inner * 0.5)));
  const box = { x: ctx.pad, y: top + 2, w: inner, h: H };
  ctx.items.push({ t: "rect", x: box.x + 0.5, y: box.y + 0.5, w: box.w - 1, h: box.h - 1, r: RADIUS, fill: "surface2", stroke: "border", strokeWidth: 1 });
  // 経度は緯度で縮める（同じ距離が同じ長さに見えるように）
  const lat0 = f.markers.reduce((a, m) => a + m.lat, 0) / f.markers.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = f.markers.map((m) => m.lng * k);
  const ys = f.markers.map((m) => m.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0, 1e-4);
  const m = 40;
  const scale = Math.min((box.w - m * 2) / Math.max(x1 - x0, span * 0.2), (box.h - m * 2) / Math.max(y1 - y0, span * 0.2));
  const px = (i: number) => box.x + box.w / 2 + (xs[i]! - (x0 + x1) / 2) * scale;
  const py = (i: number) => box.y + box.h / 2 - (ys[i]! - (y0 + y1) / 2) * scale;
  // 方角の目安（北）
  ctx.items.push({ t: "text", x: box.x + box.w - 14, y: box.y + 20, text: "N ↑", size: META, fill: "muted", anchor: "end" });
  if (f.route) {
    const idx = f.route.stops.map((s) => f.markers.findIndex((mm) => mm.label === s)).filter((i) => i >= 0);
    const d = idx.map((i, n) => `${n ? "L" : "M"}${px(i).toFixed(1)},${py(i).toFixed(1)}`).join("");
    ctx.items.push({ t: "path", d, stroke: "s1", strokeWidth: 2.5, dash: "6 5" });
  }
  f.markers.forEach((mk, i) => {
    const g = `m${i}`;
    const x = px(i);
    const y = py(i);
    ctx.items.push({ t: "circle", cx: x, cy: y, r: 11, fill: "s1", stroke: "surface", strokeWidth: 2, group: g });
    ctx.items.push({ t: "text", x, y: y + 4, text: String(i + 1), size: META - 1, weight: 700, fill: "surface", anchor: "middle", group: g });
    const right = x < box.x + box.w - 120;
    ctx.items.push({ t: "text", x: right ? x + 16 : x - 16, y: y + 4.5, text: fit(mk.label, 110, META + 1, ctx.measure, 600), size: META + 1, weight: 600, fill: "ink", anchor: right ? "start" : "end", group: g });
    ctx.targets.push({ hit: { x: x - 14, y: y - 14, w: 28, h: 28 }, keep: [g], tip: { title: `${i + 1}. ${mk.label}`, rows: [{ label: "緯度・経度", value: `${mk.lat}, ${mk.lng}` }], ...(mk.desc ? { footer: mk.desc } : {}), x, y: y - 11 } });
  });
  // 地点の一覧（番号・名前・説明）
  let y = box.y + box.h + 12;
  f.markers.forEach((mk, i) => {
    const line = fit(`${i + 1}. ${mk.label}${mk.desc ? `　${mk.desc}` : ""}`, inner, META + 1, ctx.measure);
    ctx.items.push({ t: "text", x: ctx.pad, y: y + 13, text: line, size: META + 1, fill: "ink2" });
    y += 19;
  });
  return y + 6;
}
