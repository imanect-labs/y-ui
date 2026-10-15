/**
 * timeline（年表）と steps（手順）のレイアウト。
 *
 * 幅に余裕があり項目が少なければ横に並べ（年表は軸の上に時期、手順は番号の丸を線でつなぐ）、
 * そうでなければ縦に並べる。項目は書かれた順のまま。文字は折り返し、収まらない分は「…」にして
 * ホバー・キーボードで全文を出す。
 */

import type { StepsFigure, TimelineFigure } from "../ir.js";
import { BODY_SIZE, type Ctx } from "./frame.js";
import { fit, wrap } from "./measure.js";

const TITLE = 13;
const TITLE_LH = 18;
const DESC_LH = 17;
/** 横並びにする上限の数と、1 列の最小幅。 */
const ROW_MAX = { timeline: 6, steps: 5 };
const COL_MIN = { timeline: 112, steps: 124 };

interface SeqItem {
  /** 年表の時期。手順は番号。 */
  head: string;
  title: string;
  desc?: string;
  refs: number[];
}

const refsOf = (r: number[]) => (r.length ? ` ${r.map((n) => `[${n}]`).join("")}` : "");

function items(f: TimelineFigure | StepsFigure): SeqItem[] {
  return f.kind === "timeline" ? f.events.map((e) => ({ head: e.when, title: e.title, desc: e.desc, refs: e.refs })) : f.steps.map((s, i) => ({ head: String(i + 1), title: s.title, desc: s.desc, refs: s.refs }));
}

export function layoutSeq(ctx: Ctx, f: TimelineFigure | StepsFigure, top: number): number {
  const list = items(f);
  if (list.length === 0) return top;
  const inner = ctx.width - ctx.pad * 2;
  // 横並びは、出来事・手順の見出しが列の幅に収まる（年表は 1 行、手順は 2 行）ときだけ
  const n = list.length;
  const colW = (inner - 14 * (n - 1)) / n - 4;
  const maxLines = f.kind === "timeline" ? 1 : 2;
  const row = n <= ROW_MAX[f.kind] && colW + 4 >= COL_MIN[f.kind] && list.every((it) => wrap(it.title + refsOf(it.refs), colW, TITLE, ctx.measure, 9, 600).length <= maxLines);
  return row ? horizontal(ctx, f.kind, list, top) : vertical(ctx, f.kind, list, top);
}

/** 全文（ツールチップと読み上げ用）。 */
function tipOf(kind: "timeline" | "steps", it: SeqItem, x: number, y: number) {
  return { title: kind === "timeline" ? `${it.head}　${it.title}` : `${it.head}. ${it.title}`, rows: [], ...(it.desc ? { footer: it.desc } : {}), x, y };
}

// ---------------------------------------------------------------- 横並び

function horizontal(ctx: Ctx, kind: "timeline" | "steps", list: SeqItem[], top: number): number {
  const n = list.length;
  const inner = ctx.width - ctx.pad * 2;
  const gap = 14;
  const colW = (inner - gap * (n - 1)) / n;
  const textW = colW - 4;
  const titles = list.map((it) => wrap(it.title + refsOf(it.refs), textW, TITLE, ctx.measure, 3, 600));
  const descs = list.map((it) => (it.desc ? wrap(it.desc, textW, BODY_SIZE, ctx.measure, 5) : []));
  const titleH = Math.max(...titles.map((l) => l.length)) * TITLE_LH;
  const descH = Math.max(...descs.map((l) => l.length)) * DESC_LH;

  let axisY: number;
  let textTop: number;
  if (kind === "timeline") {
    // 時期（上）・軸と点・出来事（下）
    const heads = list.map((it) => fit(it.head, textW, BODY_SIZE, ctx.measure, 600));
    axisY = top + 30;
    ctx.items.push({ t: "path", d: `M${ctx.pad},${axisY}H${ctx.width - ctx.pad}`, stroke: "axis", strokeWidth: 2 });
    list.forEach((_, i) => {
      const x = ctx.pad + i * (colW + gap);
      ctx.items.push({ t: "text", x, y: axisY - 12, text: heads[i]!, size: BODY_SIZE, weight: 600, fill: "s1", tabular: true, group: `e${i}` });
      ctx.items.push({ t: "circle", cx: x + 6, cy: axisY, r: 6, fill: "s1", stroke: "surface", strokeWidth: 2, group: `e${i}` });
    });
    textTop = axisY + 16;
  } else {
    // 番号の丸を線でつなぐ
    axisY = top + 18;
    const R = 13;
    const first = ctx.pad + R;
    const last = ctx.pad + (n - 1) * (colW + gap) + R;
    if (n > 1) ctx.items.push({ t: "path", d: `M${first},${axisY}H${last}`, stroke: "axis", strokeWidth: 2 });
    list.forEach((it, i) => {
      const cx = ctx.pad + i * (colW + gap) + R;
      ctx.items.push({ t: "circle", cx, cy: axisY, r: R, fill: "s1", stroke: "surface", strokeWidth: 3, group: `e${i}` });
      ctx.items.push({ t: "text", x: cx, y: axisY + 4.5, text: it.head, size: BODY_SIZE + 1, weight: 600, fill: "surface", anchor: "middle", tabular: true, group: `e${i}` });
    });
    textTop = axisY + R + 12;
  }

  list.forEach((it, i) => {
    const x = ctx.pad + i * (colW + gap);
    titles[i]!.forEach((l, k) => ctx.items.push({ t: "text", x, y: textTop + 13 + k * TITLE_LH, text: l, size: TITLE, weight: 600, fill: "ink", group: `e${i}` }));
    const dy = textTop + titles[i]!.length * TITLE_LH + 4;
    descs[i]!.forEach((l, k) => ctx.items.push({ t: "text", x, y: dy + 12 + k * DESC_LH, text: l, size: BODY_SIZE, fill: "ink2", group: `e${i}` }));
    ctx.targets.push({ hit: { x: x - gap / 2, y: top, w: colW + gap, h: textTop - top + titleH + descH + 8 }, keep: [`e${i}`], tip: tipOf(kind, it, x + 6, axisY - (kind === "timeline" ? 26 : 14)) });
  });
  return textTop + titleH + (descH ? descH + 4 : 0) + 8;
}

// ---------------------------------------------------------------- 縦並び

function vertical(ctx: Ctx, kind: "timeline" | "steps", list: SeqItem[], top: number): number {
  const inner = ctx.width - ctx.pad * 2;
  let railX: number;
  let textX: number;
  let headW = 0;
  if (kind === "timeline") {
    headW = Math.min(Math.max(...list.map((it) => ctx.measure(it.head, BODY_SIZE, 600))), inner * 0.28, 150);
    railX = ctx.pad + headW + 16;
    textX = railX + 18;
  } else {
    railX = ctx.pad + 13;
    textX = ctx.pad + 38;
  }
  const textW = ctx.width - ctx.pad - textX;
  const gap = 14;

  // 各項目の高さを先に決める（線を点から点へ引くため）
  const rows = list.map((it) => {
    const title = wrap(it.title + refsOf(it.refs), textW, TITLE, ctx.measure, 2, 600);
    const desc = it.desc ? wrap(it.desc, textW, BODY_SIZE, ctx.measure, 4) : [];
    const h = title.length * TITLE_LH + (desc.length ? 2 + desc.length * DESC_LH : 0);
    return { title, desc, h: Math.max(h, kind === "steps" ? 28 : TITLE_LH) };
  });
  const ys: number[] = [];
  let y = top + 4;
  for (const r of rows) {
    ys.push(y);
    y += r.h + gap;
  }
  const markY = (i: number) => ys[i]! + (kind === "steps" ? 13 : 9);
  if (list.length > 1) ctx.items.push({ t: "path", d: `M${railX},${markY(0)}V${markY(list.length - 1)}`, stroke: "axis", strokeWidth: 2 });

  list.forEach((it, i) => {
    const r = rows[i]!;
    const y0 = ys[i]!;
    const g = `e${i}`;
    if (kind === "timeline") {
      ctx.items.push({ t: "text", x: railX - 16, y: y0 + 13, text: fit(it.head, headW, BODY_SIZE, ctx.measure, 600), size: BODY_SIZE, weight: 600, fill: "s1", anchor: "end", tabular: true, group: g });
      ctx.items.push({ t: "circle", cx: railX, cy: markY(i), r: 5.5, fill: "s1", stroke: "surface", strokeWidth: 2, group: g });
    } else {
      ctx.items.push({ t: "circle", cx: railX, cy: markY(i), r: 13, fill: "s1", stroke: "surface", strokeWidth: 3, group: g });
      ctx.items.push({ t: "text", x: railX, y: markY(i) + 4.5, text: it.head, size: BODY_SIZE + 1, weight: 600, fill: "surface", anchor: "middle", tabular: true, group: g });
    }
    const ty = y0 + (kind === "steps" ? 4 : 0);
    r.title.forEach((l, k) => ctx.items.push({ t: "text", x: textX, y: ty + 13 + k * TITLE_LH, text: l, size: TITLE, weight: 600, fill: "ink", group: g }));
    const dy = ty + r.title.length * TITLE_LH + 2;
    r.desc.forEach((l, k) => ctx.items.push({ t: "text", x: textX, y: dy + 12 + k * DESC_LH, text: l, size: BODY_SIZE, fill: "ink2", group: g }));
    ctx.targets.push({ hit: { x: ctx.pad, y: y0 - gap / 2, w: inner, h: r.h + gap }, keep: [g], tip: tipOf(kind, it, textX + 40, y0) });
  });
  return y - gap + 10;
}
