/**
 * compare（比較表）と checklist（チェックリスト）のレイアウト。
 *
 * - compare: 左に項目、右に選択肢の列。✓ は緑の印、✗ は控えめな × 、△ は山吹の三角。
 *   推奨の選択肢は列全体を淡く塗り、見出しの上に札を付ける。行の間は細い線。
 * - checklist: 上に「n 項目中 m 項目が完了」と細い棒。項目は角丸の四角の印（済は塗って ✓、
 *   進行中は枠と短い線、未は枠だけ）と、見出し・補足。
 */

import type { ChecklistFigure, CompareCell, CompareFigure } from "../ir.js";
import type { Ctx } from "./frame.js";
import { fit, wrap } from "./measure.js";
import { HEAD, HEAD_LH, META, TEXT, TEXT_LH } from "./style.js";
import type { Token } from "./theme.js";

const refsOf = (r: number[]) => (r.length ? ` ${r.map((n) => `[${n}]`).join("")}` : "");

/** ✓（幅 11、高さ 8）。x は左端、cy は縦の中心。 */
export function check(ctx: Ctx, x: number, cy: number, stroke: Token, group?: string, width = 1.75): void {
  ctx.items.push({ t: "path", d: `M${x},${cy}l3.5,3.5l7,-8`, stroke, strokeWidth: width, ...(group ? { group } : {}) });
}

/** ×（幅 8）。 */
export function cross(ctx: Ctx, cx: number, cy: number, stroke: Token, group?: string, s = 4): void {
  ctx.items.push({ t: "path", d: `M${cx - s},${cy - s}L${cx + s},${cy + s}M${cx + s},${cy - s}L${cx - s},${cy + s}`, stroke, strokeWidth: 1.75, ...(group ? { group } : {}) });
}

// ---------------------------------------------------------------- compare

const ICON_W = 12;

export function layoutCompare(ctx: Ctx, f: CompareFigure, top: number): number {
  const n = f.columns.length - 1;
  if (n <= 0 || f.rows.length === 0) return top;
  const inner = ctx.width - ctx.pad * 2;
  const labelW = Math.max(72, Math.min(Math.max(...f.rows.map((r) => ctx.measure(r.label + refsOf(r.refs), TEXT, 500))) + 16, inner * 0.34));
  const colW = (inner - labelW) / n;
  const colX = (i: number) => ctx.pad + labelW + i * colW;
  const cellW = colW - 12;

  // 見出し（推奨の札の分だけ上を空ける）
  const badge = f.highlight !== undefined;
  // 見出し: 空白の無い英単語は途中で折らず、文字を小さくして収める（それでも入らなければ「…」）
  const heads = f.columns.slice(1).map((c) => {
    if (/[\s\u3000-\u9fff]/.test(c)) return { size: HEAD, lines: wrap(c, cellW, HEAD, ctx.measure, 2, 600) };
    const size = [HEAD, TEXT, META].find((z) => ctx.measure(c, z, 600) <= cellW) ?? META;
    return { size, lines: [fit(c, cellW, size, ctx.measure, 600)] };
  });
  const headLines = Math.max(...heads.map((h) => h.lines.length));
  const headTop = top + (badge ? 26 : 4);
  const headH = headLines * HEAD_LH + 12;

  // 行（項目名とセルの文字を折り返し、行の高さを揃える）
  const rows = f.rows.map((r) => {
    const label = wrap(r.label + refsOf(r.refs), labelW - 16, TEXT, ctx.measure, 3, 500);
    const cells = r.cells.map((c) => (c.text ? wrapCell(ctx, c.text, cellW - (c.mark ? ICON_W + 6 : 0)) : []));
    const lines = Math.max(label.length, 1, ...cells.map((c) => c.length));
    return { label, cells, h: lines * TEXT_LH + 20 };
  });
  const bodyTop = headTop + headH;
  const bottom = bodyTop + rows.reduce((a, r) => a + r.h, 0);

  if (f.highlight !== undefined) {
    const x = colX(f.highlight - 1);
    ctx.items.push({ t: "rect", x: x + 2.5, y: headTop - 6.5, w: colW - 5, h: bottom - headTop + 12, r: 12, fill: "accentWash", stroke: "accentLine", strokeWidth: 1 });
    const label = ctx.labels.recommended;
    const bw = ctx.measure(label, META, 600) + 24;
    ctx.items.push({ t: "rect", x: x + colW / 2 - bw / 2, y: headTop - 26, w: bw, h: 20, r: 10, fill: "accentWash", stroke: "accentLine", strokeWidth: 1 });
    ctx.items.push({ t: "text", x: x + colW / 2, y: headTop - 12, text: label, size: META, weight: 600, fill: "ink", anchor: "middle" });
  }
  if (f.columns[0]) ctx.items.push({ t: "text", x: ctx.pad, y: headTop + 15 + (headLines - 1) * HEAD_LH, text: fit(f.columns[0], labelW - 12, META, ctx.measure), size: META, fill: "muted" });
  heads.forEach((h, i) => {
    const cx = colX(i) + colW / 2;
    // 見出しは下に揃える（1 行の見出しと 2 行の見出しの下端を合わせる）
    const y0 = headTop + (headLines - h.lines.length) * HEAD_LH;
    h.lines.forEach((l, k) => ctx.items.push({ t: "text", x: cx, y: y0 + 15 + k * HEAD_LH, text: l, size: h.size, weight: 600, fill: "ink", anchor: "middle", group: `c${i}` }));
  });

  let y = bodyTop;
  f.rows.forEach((r, ri) => {
    const row = rows[ri]!;
    const g = `r${ri}`;
    ctx.items.push({ t: "path", d: `M${ctx.pad},${Math.round(y) + 0.5}H${ctx.width - ctx.pad}`, stroke: "grid", strokeWidth: 1 });
    const lines = Math.max(row.label.length, 1, ...row.cells.map((c) => c.length));
    const textTop = y + 10;
    const labelTop = textTop + ((lines - row.label.length) * TEXT_LH) / 2;
    row.label.forEach((l, k) => ctx.items.push({ t: "text", x: ctx.pad, y: labelTop + 14.5 + k * TEXT_LH, text: l, size: TEXT, weight: 500, fill: "ink", group: g }));
    r.cells.forEach((c, i) => {
      const cx = colX(i) + colW / 2;
      const ls = row.cells[i]!;
      // セルの中身は縦の中央に置く
      const cy0 = textTop + ((lines - Math.max(1, ls.length)) * TEXT_LH) / 2;
      drawCell(ctx, c, ls, cx, cy0, g);
    });
    const say = `${r.label}: ${r.cells.map((c, i) => `${f.columns[i + 1]} ${cellSay(ctx, c)}`).join("、")}`;
    const cut = [...row.label, ...row.cells.flat()].some((l) => l.endsWith("…"));
    ctx.targets.push({ hit: { x: ctx.pad, y, w: inner, h: row.h }, keep: [g], ...(cut ? { tip: { title: r.label, rows: r.cells.map((c, i) => ({ label: f.columns[i + 1]!, value: cellSay(ctx, c) })), x: ctx.pad + labelW / 2, y } } : { say }) });
    y += row.h;
  });
  return bottom + (f.highlight !== undefined ? 10 : 4);
}

/** セルの文字を折り返す。列より長い英単語があれば、単語の途中で折らずに 1 行で「…」にする。 */
function wrapCell(ctx: Ctx, text: string, width: number): string[] {
  const longest = Math.max(...text.split(/\s+/).map((w) => (/[\u3000-\u9fff]/.test(w) ? 0 : ctx.measure(w, TEXT))));
  return longest > width ? [fit(text, width, TEXT, ctx.measure)] : wrap(text, width, TEXT, ctx.measure, 3);
}

function cellSay(ctx: Ctx, c: CompareCell): string {
  const m = c.mark ? ctx.labels[c.mark] : "";
  return [m, c.mark === "partial" && c.text === m ? "" : c.text].filter(Boolean).join(" ") || "—";
}

function drawCell(ctx: Ctx, c: CompareCell, lines: string[], cx: number, top: number, g: string): void {
  const cy = top + 10;
  const icon = (x: number) => {
    if (c.mark === "yes") check(ctx, x, cy, "s3", g, 2);
    else if (c.mark === "no") cross(ctx, x + 5.5, cy, "muted", g, 3.5);
    else if (c.mark === "partial") ctx.items.push({ t: "path", d: `M${x + 6},${cy - 5}L${x + 11.5},${cy + 4.5}H${x + 0.5}Z`, stroke: "s6", strokeWidth: 1.75, group: g });
  };
  if (lines.length === 0) {
    if (c.mark) icon(cx - 5.5);
    else ctx.items.push({ t: "path", d: `M${cx - 4},${cy}H${cx + 4}`, stroke: "axis", strokeWidth: 1.5, group: g });
    return;
  }
  const w = Math.max(...lines.map((l) => ctx.measure(l, TEXT)));
  if (c.mark) {
    // 印と文字を 1 つのまとまりとして中央に置く
    const total = ICON_W + 6 + w;
    const x0 = cx - total / 2;
    icon(x0);
    lines.forEach((l, k) => ctx.items.push({ t: "text", x: x0 + ICON_W + 6, y: top + 14.5 + k * TEXT_LH, text: l, size: TEXT, fill: "ink2", group: g }));
    return;
  }
  lines.forEach((l, k) => ctx.items.push({ t: "text", x: cx, y: top + 14.5 + k * TEXT_LH, text: l, size: TEXT, fill: "ink", anchor: "middle", tabular: true, group: g }));
}

// ---------------------------------------------------------------- checklist

const BOX = 18;

export function layoutChecklist(ctx: Ctx, f: ChecklistFigure, top: number): number {
  if (f.items.length === 0) return top;
  const inner = ctx.width - ctx.pad * 2;
  const done = f.items.filter((it) => it.state === "done").length;
  const total = f.items.length;

  // 完了の数と細い棒
  const summary = ctx.labels.completed(done, total);
  const pct = `${Math.round((done / total) * 100)}%`;
  ctx.items.push({ t: "text", x: ctx.pad, y: top + 15, text: fit(summary, inner - 60, TEXT, ctx.measure), size: TEXT, fill: "ink2" });
  ctx.items.push({ t: "text", x: ctx.width - ctx.pad, y: top + 15, text: pct, size: HEAD, weight: 600, fill: "ink", anchor: "end", tabular: true });
  const barY = top + 26;
  ctx.items.push({ t: "rect", x: ctx.pad, y: barY, w: inner, h: 6, r: 3, fill: "grid" });
  if (done > 0) ctx.items.push({ t: "rect", x: ctx.pad, y: barY, w: Math.max(6, (done / total) * inner), h: 6, r: 3, fill: done === total ? "s3" : "s1" });

  let y = barY + 6 + 18;
  const textX = ctx.pad + BOX + 12;
  const textW = ctx.width - ctx.pad - textX;
  f.items.forEach((it, i) => {
    const g = `k${i}`;
    const tag = it.state === "doing" ? ctx.labels.doing : "";
    const tagW = tag ? ctx.measure(tag, META, 600) + 14 : 0;
    const title = wrap(it.text + refsOf(it.refs), textW - (tag ? tagW + 8 : 0), TEXT + 1, ctx.measure, 2, 500);
    const desc = it.desc ? it.desc.split("\n").flatMap((p) => wrap(p, textW, META, ctx.measure, 3)) : [];
    const h = title.length * TEXT_LH + (desc.length ? 2 + desc.length * 18 : 0);
    // 印
    const bx = ctx.pad;
    const by = y + 1;
    if (it.state === "done") {
      ctx.items.push({ t: "rect", x: bx, y: by, w: BOX, h: BOX, r: 5, fill: "s3", group: g });
      check(ctx, bx + 3.5, by + BOX / 2, "surface", g, 2);
    } else {
      ctx.items.push({ t: "rect", x: bx + 0.75, y: by + 0.75, w: BOX - 1.5, h: BOX - 1.5, r: 5, fill: "surface", stroke: it.state === "doing" ? "s1" : "axis", strokeWidth: 1.5, group: g });
      if (it.state === "doing") ctx.items.push({ t: "path", d: `M${bx + 5.5},${by + BOX / 2}H${bx + BOX - 5.5}`, stroke: "s1", strokeWidth: 2, group: g });
    }
    title.forEach((l, k) => ctx.items.push({ t: "text", x: textX, y: y + 15 + k * TEXT_LH, text: l, size: TEXT + 1, weight: 500, fill: it.state === "done" ? "ink2" : "ink", group: g }));
    if (tag) {
      const tx = textX + ctx.measure(title[0]!, TEXT + 1, 500) + 8;
      ctx.items.push({ t: "rect", x: tx, y: y + 1, w: tagW, h: 18, r: 9, fill: "accentWash", stroke: "accentLine", strokeWidth: 1, group: g });
      ctx.items.push({ t: "text", x: tx + tagW / 2, y: y + 14, text: tag, size: META - 1, weight: 600, fill: "ink2", anchor: "middle", group: g });
    }
    desc.forEach((l, k) => ctx.items.push({ t: "text", x: textX, y: y + title.length * TEXT_LH + 2 + 13 + k * 18, text: l, size: META, fill: "muted", group: g }));
    const state = it.state === "done" ? ctx.labels.done : it.state === "doing" ? ctx.labels.doing : "";
    const full = [it.text, it.desc?.replace(/\n/g, " ")].filter(Boolean).join("、");
    const cut = [...title, ...desc].some((l) => l.endsWith("…"));
    ctx.targets.push({ hit: { x: ctx.pad, y: y - 6, w: inner, h: h + 12 }, keep: [g], ...(cut ? { tip: { title: it.text, rows: [], ...(it.desc ? { footer: it.desc.replace(/\n/g, " ") } : {}), x: textX + 40, y } } : { say: state ? `${full}（${state}）` : full }) });
    y += h + 14;
  });
  return y - 14 + 8;
}
