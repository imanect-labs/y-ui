/**
 * proscons（メリット・デメリット）と swot のレイアウト。
 *
 * どちらも、見出しの付いた淡い面に箇条書きを入れて並べる（幅が狭ければ縦に積む）。
 * - proscons: 左がメリット（緑の ✓）、右がデメリット（赤の −）。
 * - swot: 2 × 2。見出しの左に S・W・O・T の札。
 */

import type { ListItem, ProsConsFigure, SwotFigure } from "../ir.js";
import type { Ctx } from "./frame.js";
import { fit, wrap } from "./measure.js";
import { HEAD, HEAD_LH, META, PAD, RADIUS, TEXT, TEXT_LH } from "./style.js";
import type { Token } from "./theme.js";
import { check } from "./v09.js";

const refsOf = (r: number[]) => (r.length ? ` ${r.map((n) => `[${n}]`).join("")}` : "");
/** 横に並べる最小の幅（1 枚あたり）。 */
const PANEL_MIN = 200;
const GAP = 12;
const ITEM_GAP = 10;
const DESC_LH = 18;

interface Panel {
  label: string;
  items: ListItem[];
  /** 見出しの印の色と形。 */
  token: Token;
  icon: "check" | "minus" | "letter";
  letter?: string;
}

interface Measured {
  head: string;
  items: { text: string[]; desc: string[] }[];
  h: number;
}

const BULLET_W = 20;

function measure(ctx: Ctx, p: Panel, w: number): Measured {
  const tw = w - PAD * 2 - BULLET_W;
  const items = p.items.map((it) => ({
    text: wrap(it.text + refsOf(it.refs), tw, TEXT, ctx.measure, 3),
    desc: it.desc ? it.desc.split("\n").flatMap((d) => wrap(d, tw, META, ctx.measure, 3)) : [],
  }));
  const body = items.reduce((a, it) => a + it.text.length * TEXT_LH + it.desc.length * DESC_LH, 0) + Math.max(0, items.length - 1) * ITEM_GAP;
  return { head: fit(p.label, w - PAD * 2 - 34, HEAD, ctx.measure, 600), items, h: PAD + 26 + (items.length ? 12 + body : 0) + PAD };
}

function drawPanel(ctx: Ctx, p: Panel, m: Measured, x: number, y: number, w: number, h: number, g: string): void {
  ctx.items.push({ t: "rect", x, y, w, h, r: RADIUS, fill: "surface2", group: g });
  // 見出しの印（円か角丸の札）と見出し
  const ix = x + PAD;
  const iy = y + PAD;
  if (p.icon === "letter") {
    ctx.items.push({ t: "rect", x: ix, y: iy, w: 26, h: 26, r: 7, fill: p.token, group: g });
    ctx.items.push({ t: "text", x: ix + 13, y: iy + 18, text: p.letter!, size: HEAD, weight: 700, fill: "surface", anchor: "middle", group: g });
  } else {
    ctx.items.push({ t: "circle", cx: ix + 13, cy: iy + 13, r: 13, fill: p.token, group: g });
    if (p.icon === "check") check(ctx, ix + 7.5, iy + 13.5, "surface", g, 2.25);
    else ctx.items.push({ t: "path", d: `M${ix + 8},${iy + 13}H${ix + 18}`, stroke: "surface", strokeWidth: 2.5, group: g });
  }
  ctx.items.push({ t: "text", x: ix + 36, y: iy + 18, text: m.head, size: HEAD, weight: 600, fill: "ink", group: g });

  let yy = iy + 26 + 12;
  m.items.forEach((it, i) => {
    if (i > 0) yy += ITEM_GAP;
    const bx = x + PAD;
    // 項目の行頭: メリットは ✓、デメリットは −、swot は点
    if (p.icon === "check") check(ctx, bx, yy + 10, p.token, g);
    else if (p.icon === "minus") ctx.items.push({ t: "path", d: `M${bx + 1},${yy + 10}H${bx + 10}`, stroke: p.token, strokeWidth: 2, group: g });
    else ctx.items.push({ t: "circle", cx: bx + 5, cy: yy + 10, r: 2.75, fill: "muted", group: g });
    it.text.forEach((l, k) => ctx.items.push({ t: "text", x: bx + BULLET_W, y: yy + 14.5 + k * TEXT_LH, text: l, size: TEXT, fill: "ink", group: g }));
    yy += it.text.length * TEXT_LH;
    it.desc.forEach((l, k) => ctx.items.push({ t: "text", x: bx + BULLET_W, y: yy + 13 + k * DESC_LH, text: l, size: META, fill: "muted", group: g }));
    yy += it.desc.length * DESC_LH;
  });
  const cut = [m.head, ...m.items.flatMap((it) => [...it.text, ...it.desc])].some((l) => l.endsWith("…"));
  const list = p.items.map((it) => (it.desc ? `${it.text}（${it.desc.replace(/\n/g, " ")}）` : it.text)).join("、");
  ctx.targets.push({ hit: { x, y, w, h }, keep: [g], ...(cut ? { tip: { title: p.label, rows: [], footer: list, x: x + w / 2, y } } : { say: `${p.label}: ${list}` }) });
}

/** パネルを cols 列の格子に並べる（行ごとに高さを揃える）。 */
function grid(ctx: Ctx, panels: Panel[], cols: number, top: number): number {
  const inner = ctx.width - ctx.pad * 2;
  const w = (inner - GAP * (cols - 1)) / cols;
  const ms = panels.map((p) => measure(ctx, p, w));
  let y = top + 2;
  for (let r = 0; r * cols < panels.length; r++) {
    const idx = Array.from({ length: Math.min(cols, panels.length - r * cols) }, (_, k) => r * cols + k);
    const h = Math.max(...idx.map((i) => ms[i]!.h));
    idx.forEach((i, k) => drawPanel(ctx, panels[i]!, ms[i]!, ctx.pad + k * (w + GAP), y, w, h, `p${i}`));
    y += h + GAP;
  }
  return y - GAP + 8;
}

export function layoutProsCons(ctx: Ctx, f: ProsConsFigure, top: number): number {
  const panels: Panel[] = [
    { label: f.labels[0] || ctx.labels.pros, items: f.pros, token: "s3", icon: "check" },
    { label: f.labels[1] || ctx.labels.cons, items: f.cons, token: "s5", icon: "minus" },
  ];
  const inner = ctx.width - ctx.pad * 2;
  return grid(ctx, panels, inner >= PANEL_MIN * 2 + GAP ? 2 : 1, top);
}

const SWOT_TOKENS: Token[] = ["s3", "s5", "s1", "s2"];
const SWOT_LETTERS = ["S", "W", "O", "T"];

export function layoutSwot(ctx: Ctx, f: SwotFigure, top: number): number {
  const panels: Panel[] = f.sections.map((items, i) => ({ label: f.labels[i] || ctx.labels.swot[i]!, items, token: SWOT_TOKENS[i]!, icon: "letter" as const, letter: SWOT_LETTERS[i]! }));
  const inner = ctx.width - ctx.pad * 2;
  return grid(ctx, panels, inner >= PANEL_MIN * 2 + GAP ? 2 : 1, top);
}
