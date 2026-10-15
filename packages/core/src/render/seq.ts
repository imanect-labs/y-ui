/**
 * timeline（年表）と steps（手順）のレイアウト。
 *
 * 手順は縦に並べる。番号は控えめな太字、番号の下から次の手順まで細い線を引き、見出しと説明（段落ごと）を右に置く。
 * 年表は、項目が少なく見出しが短ければ横に（軸の上に時期・下に出来事）、そうでなければ縦に
 * （左に時期、細い線の上の点、右に出来事）並べる。項目は書かれた順のまま。
 * 文字は折り返し、収まらない分は「…」にして、ホバー・キーボードで全文を出す。
 */

import type { StepsFigure, TimelineFigure } from "../ir.js";
import type { Ctx } from "./frame.js";
import { fit, wrap } from "./measure.js";
import { HEAD, HEAD_LH, ITEM_GAP, META, PARA_GAP, TEXT, TEXT_LH } from "./style.js";

/** 横並びにする上限の数と、1 列の最小幅（年表）。 */
const ROW_MAX = 6;
const COL_MIN = 112;

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

/** 説明を段落ごとに折り返す（段落は改行で区切られている）。 */
function paragraphs(ctx: Ctx, desc: string | undefined, width: number, maxLines: number): string[][] {
  if (!desc) return [];
  return desc.split("\n").map((p) => wrap(p, width, TEXT, ctx.measure, maxLines));
}

const parasHeight = (ps: string[][]) => (ps.length === 0 ? 0 : ps.reduce((a, p) => a + p.length * TEXT_LH, 0) + (ps.length - 1) * PARA_GAP);

/** 段落を描き、描いた高さを返す。 */
function drawParas(ctx: Ctx, ps: string[][], x: number, y: number, group: string): number {
  let yy = y;
  ps.forEach((p, i) => {
    if (i > 0) yy += PARA_GAP;
    for (const l of p) {
      ctx.items.push({ t: "text", x, y: yy + 14, text: l, size: TEXT, fill: "muted", group });
      yy += TEXT_LH;
    }
  });
  return yy - y;
}

export function layoutSeq(ctx: Ctx, f: TimelineFigure | StepsFigure, top: number): number {
  const list = items(f);
  if (list.length === 0) return top;
  if (f.kind === "steps") return vertical(ctx, "steps", list, top);
  const inner = ctx.width - ctx.pad * 2;
  const n = list.length;
  const colW = (inner - 16 * (n - 1)) / n;
  // 横並びは、出来事の見出しが列の幅の 1 行に収まるときだけ
  const row = n <= ROW_MAX && colW >= COL_MIN && list.every((it) => wrap(it.title + refsOf(it.refs), colW - 4, HEAD, ctx.measure, 9, 600).length <= 1);
  return row ? horizontal(ctx, list, top) : vertical(ctx, "timeline", list, top);
}

/**
 * 項目のホバー・キーボードの中身。文字を「…」で省いたときだけツールチップで全文を出し、
 * 省いていなければ強調と読み上げだけにする（見えている文字をツールチップで隠さないため）。
 */
function focusOf(kind: "timeline" | "steps", it: SeqItem, lines: string[][], x: number, y: number) {
  const title = kind === "timeline" ? `${it.head}　${it.title}` : `${it.head}. ${it.title}`;
  const desc = it.desc?.replace(/\n/g, " ");
  const cut = lines.some((ls) => ls.some((l) => l.endsWith("…")));
  if (cut) return { tip: { title, rows: [], ...(desc ? { footer: desc } : {}), x, y } };
  return { say: desc ? `${title}、${desc}` : title };
}

// ---------------------------------------------------------------- 年表の横並び

function horizontal(ctx: Ctx, list: SeqItem[], top: number): number {
  const n = list.length;
  const inner = ctx.width - ctx.pad * 2;
  const gap = 16;
  const colW = (inner - gap * (n - 1)) / n;
  const textW = colW - 4;
  const heads = list.map((it) => fit(it.head, textW, META, ctx.measure, 600));
  const titles = list.map((it) => [fit(it.title + refsOf(it.refs), textW, HEAD, ctx.measure, 600)]);
  const descs = list.map((it) => paragraphs(ctx, it.desc, textW, 4));
  const descH = Math.max(0, ...descs.map(parasHeight));

  const axisY = top + 30;
  // 軸は最初の点から右端まで（先へ続く時間の流れ）
  ctx.items.push({ t: "path", d: `M${ctx.pad + 4},${axisY}H${ctx.width - ctx.pad}`, stroke: "grid", strokeWidth: 2 });
  const textTop = axisY + 16;
  list.forEach((it, i) => {
    const x = ctx.pad + i * (colW + gap);
    const g = `e${i}`;
    ctx.items.push({ t: "text", x, y: axisY - 12, text: heads[i]!, size: META, weight: 600, fill: "muted", tabular: true, group: g });
    ctx.items.push({ t: "circle", cx: x + 5, cy: axisY, r: 5, fill: "s1", stroke: "surface", strokeWidth: 2, group: g });
    ctx.items.push({ t: "text", x, y: textTop + 14, text: titles[i]![0]!, size: HEAD, weight: 600, fill: "ink", group: g });
    drawParas(ctx, descs[i]!, x, textTop + HEAD_LH + 2, g);
    ctx.targets.push({ hit: { x: x - gap / 2, y: top, w: colW + gap, h: textTop - top + HEAD_LH + descH + 8 }, keep: [g], ...focusOf("timeline", it, [titles[i]!, ...descs[i]!, [heads[i]!]], x + 6, axisY - 22) });
  });
  return textTop + HEAD_LH + (descH ? descH + 2 : 0) + 8;
}

// ---------------------------------------------------------------- 縦並び

function vertical(ctx: Ctx, kind: "timeline" | "steps", list: SeqItem[], top: number): number {
  const inner = ctx.width - ctx.pad * 2;
  // 手順: 番号の列。年表: 時期の列（幅は時期の文字に合わせ、図の 3 割まで）
  const headW = kind === "steps" ? Math.max(...list.map((it) => ctx.measure(it.head, HEAD + 1, 600))) : Math.min(Math.max(...list.map((it) => ctx.measure(it.head, META, 600))), inner * 0.3, 150);
  const railX = kind === "steps" ? ctx.pad + headW / 2 : ctx.pad + headW + 16;
  const textX = kind === "steps" ? ctx.pad + Math.max(headW, 12) + 18 : railX + 18;
  const textW = ctx.width - ctx.pad - textX;

  const rows = list.map((it) => {
    const title = wrap(it.title + refsOf(it.refs), textW, HEAD, ctx.measure, 2, 600);
    const desc = paragraphs(ctx, it.desc, textW, 4);
    const dh = parasHeight(desc);
    return { title, desc, h: title.length * HEAD_LH + (dh ? 4 + dh : 0) };
  });
  const ys: number[] = [];
  let y = top + 2;
  for (const r of rows) {
    ys.push(y);
    y += r.h + ITEM_GAP;
  }

  // 年表: 点から点へ 1 本の線。手順: 番号の下から次の番号の手前まで、項目ごとの線（ChatGPT などの番号付きの段取りの見た目）
  if (kind === "timeline" && list.length > 1) ctx.items.push({ t: "path", d: `M${railX},${ys[0]! + 10}V${ys[list.length - 1]! + 10}`, stroke: "grid", strokeWidth: 2 });

  list.forEach((it, i) => {
    const r = rows[i]!;
    const y0 = ys[i]!;
    const g = `e${i}`;
    let head: string[] = [];
    if (kind === "timeline") {
      const h = fit(it.head, headW, META, ctx.measure, 600);
      head = [h];
      ctx.items.push({ t: "text", x: railX - 16, y: y0 + 14, text: h, size: META, weight: 600, fill: "muted", anchor: "end", tabular: true, group: g });
      ctx.items.push({ t: "circle", cx: railX, cy: y0 + 10, r: 5, fill: "s1", stroke: "surface", strokeWidth: 2, group: g });
    } else {
      ctx.items.push({ t: "text", x: railX, y: y0 + 15, text: it.head, size: HEAD + 1, weight: 600, fill: "ink2", anchor: "middle", tabular: true, group: g });
      if (i < list.length - 1) ctx.items.push({ t: "path", d: `M${railX},${y0 + 26}V${y0 + r.h + ITEM_GAP - 8}`, stroke: "grid", strokeWidth: 2, group: g });
    }
    r.title.forEach((l, k) => ctx.items.push({ t: "text", x: textX, y: y0 + 15 + k * HEAD_LH, text: l, size: HEAD, weight: 600, fill: "ink", group: g }));
    drawParas(ctx, r.desc, textX, y0 + r.title.length * HEAD_LH + 4, g);
    ctx.targets.push({ hit: { x: ctx.pad, y: y0 - ITEM_GAP / 2, w: inner, h: r.h + ITEM_GAP }, keep: [g], ...focusOf(kind, it, [r.title, ...r.desc, head], textX + 40, y0) });
  });
  return y - ITEM_GAP + 10;
}
