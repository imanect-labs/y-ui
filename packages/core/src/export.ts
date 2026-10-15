/**
 * `@imanect/yui/export`: 図を画像・クリップボード・ファイルへ書き出す（docs/export.md）。
 *
 * - SVG / HTML の組み立ては DOM に依存しない（サーバーでも同じ結果）。
 * - PNG・クリップボード・ダウンロードはブラウザだけで動く（Canvas・Clipboard API を使う）。
 *
 * 書き出しの図は色と寸法を焼き込む（theme: light / dark）。貼り付け先が CSS 変数を解釈しなくても
 * 同じ見た目になる。外部の画像・スクリプト・リンクは出さない。
 */

import { formatCalc, runCalc } from "./calc/run.js";
import { type CalcFigure, type ChartFigure, type Figure, type FlowFigure, isChart, type ListItem, type ScatterFigure, type StackBox, type StackFigure, type StatFigure, type TreeNode } from "./ir.js";
import { layout, type LayoutOptions } from "./render/layout.js";
import { sceneToSVG } from "./render/svg.js";
import { share, toSource, toText } from "./text.js";

export interface ExportOptions extends LayoutOptions {
  /** 書き出しの配色。既定は light（紙・文書に貼る前提）。 */
  theme?: "light" | "dark";
  /** PNG の倍率（既定 2。高解像度の画面や印刷でにじまないように）。 */
  scale?: number;
}

/** 独自形式のクリップボード型（Yui 対応アプリに編集できる状態で戻す・Chromium のみ）。 */
export const YUI_MIME = "web application/x-yui";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 書き出し用の SVG（色と寸法を焼き込む）と、その寸法。 */
export function exportSVG(figure: Figure, opts: ExportOptions = {}): { svg: string; width: number; height: number } {
  const scene = layout(figure, opts);
  return { svg: sceneToSVG(scene, opts.theme ?? "light"), width: scene.width, height: scene.height };
}

// ---------------------------------------------------------------- HTML（貼り付け用）

const nf = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 20 });
const refs = (r: number[]) => (r.length ? ` ${r.map((n) => `[${n}]`).join("")}` : "");

function chartTable(f: ChartFigure): string {
  const pie = f.kind === "pie";
  const total = pie ? f.rows.reduce((a, r) => a + (r.values[0] ?? 0), 0) : 0;
  const head = [f.columns[0] || "項目", ...f.columns.slice(1), ...(pie ? ["割合"] : [])];
  const cell = (s: string) => `<td style="text-align:right">${esc(s)}</td>`;
  const rows = f.rows
    .map((r) => {
      const values = r.values.map((v) => cell(v === null ? "-" : nf.format(v))).join("");
      const ratio = pie ? cell(share(r.values[0] ?? 0, total)) : "";
      return `<tr><th scope="row">${esc(r.label + refs(r.refs))}</th>${values}${ratio}</tr>`;
    })
    .join("");
  const unit = f.unit === undefined ? "" : `<caption style="caption-side:bottom;text-align:left">単位: ${esc(f.unit)}</caption>`;
  return `<table>${unit}<thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
}

function statTable(f: StatFigure): string {
  const rows = f.items.map((it) => `<tr><th scope="row">${esc(it.label)}</th><td>${esc(it.value + refs(it.refs))}</td><td>${esc(it.sub ?? "")}</td></tr>`).join("");
  return `<table><tbody>${rows}</tbody></table>`;
}

function flowList(f: FlowFigure): string {
  const label = new Map(f.nodes.map((n) => [n.id, n.label]));
  const used = new Set<string>();
  const items = f.edges.map((e) => {
    used.add(e.from);
    used.add(e.to);
    const arrow = e.label === undefined ? "→" : `→（${e.label}）`;
    return `<li>${esc(`${label.get(e.from)} ${arrow} ${label.get(e.to)}`)}</li>`;
  });
  for (const n of f.nodes) if (!used.has(n.id)) items.push(`<li>${esc(n.label)}</li>`);
  return `<ul>${items.join("")}</ul>`;
}

function boxText(b: StackBox): string {
  return esc((b.desc === undefined ? b.title : `${b.title}（${b.desc}）`) + refs(b.refs));
}

function stackList(f: StackFigure): string {
  const tiers = f.tiers.map((t) => {
    const boxes = t.boxes
      .map((b) => (b.children.length ? `${boxText(b)}<ul>${b.children.map((c) => `<li>${boxText(c)}</li>`).join("")}</ul>` : boxText(b)))
      .join(" ／ ");
    return `<li>${t.arrowLabel === undefined ? "" : `<small>↓ ${esc(t.arrowLabel)}</small><br>`}${boxes}</li>`;
  });
  return `<ol>${tiers.join("")}</ol>`;
}

function scatterTable(f: ScatterFigure): string {
  const head = `<thead><tr>${f.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>`;
  const num = (v: number) => `<td style="text-align:right">${esc(nf.format(v))}</td>`;
  const rows = f.points.map((p) => `<tr><th scope="row">${esc(p.label + refs(p.refs))}</th>${num(p.x)}${num(p.y)}${f.columns.length > 3 ? `<td>${esc(p.group ?? "")}</td>` : ""}</tr>`).join("");
  return `<table>${head}<tbody>${rows}</tbody></table>`;
}

const withDesc = (title: string, desc: string | undefined, r: number[]) => esc((desc === undefined ? title : `${title}（${desc.replace(/\n/g, " ")}）`) + refs(r));

function treeList(nodes: TreeNode[]): string {
  return `<ul>${nodes.map((n) => `<li>${withDesc(n.title, n.desc, n.refs)}${n.children.length ? treeList(n.children) : ""}</li>`).join("")}</ul>`;
}

function calcHTML(f: CalcFigure): string {
  const v = runCalc(f);
  const rows = f.defs
    .filter((d) => !(d.type === "formula" && f.hide.includes(d.name)))
    .map((d) => {
      const value = d.type === "formula" ? formatCalc(v.get(d.name) ?? null, d.round, "ja-JP") : d.control === "choice" ? (d.options!.find((o) => o.value === d.initial)?.label ?? "") : d.control === "toggle" ? (d.initial ? "オン" : "オフ") : nf.format(d.initial);
      const how = d.type === "formula" ? `= ${d.source}` : "入力（初期値）";
      return `<tr><th scope="row">${esc(d.name)}</th><td style="text-align:right">${esc(value + (d.unit ?? ""))}</td><td>${esc(how)}</td></tr>`;
    })
    .join("");
  return `<table><tbody>${rows}</tbody></table>`;
}

function listHTML(label: string, items: ListItem[]): string {
  if (items.length === 0) return "";
  return `<p><strong>${esc(label)}</strong></p><ul>${items.map((it) => `<li>${withDesc(it.text, it.desc, it.refs)}</li>`).join("")}</ul>`;
}

function otherHTML(f: Exclude<Figure, ChartFigure>): string {
  switch (f.kind) {
    case "stat":
      return statTable(f);
    case "flow":
      return flowList(f);
    case "stack":
      return stackList(f);
    case "scatter":
      return scatterTable(f);
    case "timeline":
      return `<ul>${f.events.map((e) => `<li><strong>${esc(e.when)}</strong> ${withDesc(e.title, e.desc, e.refs)}</li>`).join("")}</ul>`;
    case "steps":
      return `<ol>${f.steps.map((s) => `<li>${withDesc(s.title, s.desc, s.refs)}</li>`).join("")}</ol>`;
    case "tree":
      return treeList(f.roots);
    case "cards":
      return `<ul>${f.cards.map((c) => `<li><strong>${esc(c.title + refs(c.refs))}</strong>${c.value ? ` ${esc(c.value)}` : ""}${c.body ? ` ${esc(c.body.replace(/\n/g, " "))}` : ""}${c.items?.length ? `<ul>${c.items.map((it) => `<li>${esc(it)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>`;
    case "progress":
      return `<table><tbody>${f.items.map((it) => `<tr><th scope="row">${esc(it.label + refs(it.refs))}</th><td style="text-align:right">${esc(it.valueText)}</td><td style="text-align:right">${esc(it.targetText)}</td><td style="text-align:right">${esc(share(it.value, it.target))}</td></tr>`).join("")}</tbody></table>`;
    case "quadrant":
      return `<table><thead><tr><th scope="col"></th><th scope="col">${esc(f.xLabel || "横")}</th><th scope="col">${esc(f.yLabel || "縦")}</th></tr></thead><tbody>${f.items.map((it) => `<tr><th scope="row">${esc(it.label + refs(it.refs))}</th><td style="text-align:right">${it.x}</td><td style="text-align:right">${it.y}</td></tr>`).join("")}</tbody></table>`;
    case "calc":
      return calcHTML(f);
    case "gantt":
      return `<ul>${f.tasks.map((t) => `<li>${esc(t.label + refs(t.refs))}: ${esc(t.endText ? `${t.startText} 〜 ${t.endText}` : t.startText)}</li>`).join("")}</ul>`;
    case "funnel":
      return `<table><tbody>${f.stages.map((s) => `<tr><th scope="row">${esc(s.label + refs(s.refs))}</th><td style="text-align:right">${esc(nf.format(s.value))}${f.unit ? esc(f.unit) : ""}</td></tr>`).join("")}</tbody></table>`;
    case "compare": {
      const mark = { yes: "✓", no: "✗", partial: "△" } as const;
      const head = f.columns.map((c, i) => `<th scope="col">${esc(c)}${f.highlight === i && i > 0 ? "（推奨）" : ""}</th>`).join("");
      const body = f.rows.map((r) => `<tr><th scope="row">${esc(r.label + refs(r.refs))}</th>${r.cells.map((c) => `<td style="text-align:center">${esc([c.mark ? mark[c.mark] : "", c.text].filter(Boolean).join(" "))}</td>`).join("")}</tr>`).join("");
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    case "proscons":
      return [listHTML(f.labels[0] || "メリット", f.pros), listHTML(f.labels[1] || "デメリット", f.cons)].join("");
    case "swot":
      return ["強み", "弱み", "機会", "脅威"].map((n, i) => listHTML(f.labels[i] || n, f.sections[i]!)).join("");
    case "checklist":
      return `<ul>${f.items.map((it) => `<li>${it.state === "done" ? "☑" : "☐"} ${withDesc(it.text, it.desc, it.refs)}${it.state === "doing" ? "（進行中）" : ""}</li>`).join("")}</ul>`;
  }
}

/** 図のデータを HTML の表・リストにする（画像を読めない人・貼り付け先のための代替）。 */
export function toHTML(f: Figure): string {
  const body = isChart(f) ? chartTable(f) : otherHTML(f);
  const note = f.note === undefined ? "" : `<p>※ ${esc(f.note)}</p>`;
  return body + note;
}

/**
 * クリップボードの `text/html`。画像（data URI）＋見出し＋データの表。Word・Google ドキュメント・
 * Gmail・Notion では画像として取り込まれる。ソースは `data-yui-source` に入れ、Yui 対応の貼り付け先が
 * 図を編集できる状態で戻せるようにする（他のアプリは無視する）。
 */
export function clipboardHTML(figure: Figure, png: { dataUrl: string; width: number; height: number }): string {
  const alt = figure.title || toText(figure).split("\n")[0] || "図";
  const caption = figure.title ? `<figcaption><strong>${esc(figure.title + refs(figure.refs))}</strong></figcaption>` : "";
  return `<figure data-yui-source="${esc(toSource(figure))}">${caption}<img src="${png.dataUrl}" width="${png.width}" height="${png.height}" alt="${esc(alt)}">${toHTML(figure)}</figure>`;
}

// ---------------------------------------------------------------- ブラウザ

/** 図を PNG にする（ブラウザのみ）。SVG を画像として読み、Canvas に描く。 */
export async function renderPNG(figure: Figure, opts: ExportOptions = {}): Promise<{ blob: Blob; width: number; height: number }> {
  const { svg, width, height } = exportSVG(figure, opts);
  const scale = Math.max(1, opts.scale ?? 2);
  const img = new Image();
  img.decoding = "async";
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas の 2D 描画が使えません");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG を作れませんでした"))), "image/png"));
  return { blob, width, height };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("読み込みに失敗しました"));
    r.readAsDataURL(blob);
  });
}

/**
 * 図をクリップボードにコピーする（ブラウザのみ）。画像として貼れる先には画像、文字だけの先には
 * テキスト化した Markdown が入る。戻り値は実際に書いた形（画像が使えなければ "text"）。
 *
 * クリック操作の中で呼ぶ（Safari は操作の中でしか書き込めない）。画像は Promise で渡して非同期に作る。
 */
export async function copyFigure(figure: Figure, opts: ExportOptions = {}): Promise<"image" | "text"> {
  const text = toText(figure);
  const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clip) throw new Error("クリップボードが使えません");
  if (typeof ClipboardItem === "undefined" || typeof clip.write !== "function") {
    await clip.writeText(text);
    return "text";
  }
  const png = renderPNG(figure, opts);
  const html = png.then(async (p) => new Blob([clipboardHTML(figure, { dataUrl: await blobToDataUrl(p.blob), width: p.width, height: p.height })], { type: "text/html" }));
  const items: Record<string, Promise<Blob> | Blob> = {
    "image/png": png.then((p) => p.blob),
    "text/html": html,
    "text/plain": new Blob([text], { type: "text/plain" }),
  };
  const supports = (ClipboardItem as unknown as { supports?: (t: string) => boolean }).supports;
  if (supports?.(YUI_MIME)) items[YUI_MIME] = new Blob([toSource(figure)], { type: YUI_MIME });
  try {
    await clip.write([new ClipboardItem(items)]);
    return "image";
  } catch {
    // 画像を受け付けない環境（権限・形式の制限）。文字だけでも残す。
    await clip.writeText(text);
    return "text";
  }
}

/** ファイル名に使えない文字を落とした名前（拡張子なし）。 */
export function fileBaseName(figure: Figure): string {
  const base = (figure.title || figure.kind)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return base || figure.kind;
}

/** 図を SVG / PNG のファイルとして保存する（ブラウザのみ）。 */
export async function downloadFigure(figure: Figure, format: "svg" | "png", opts: ExportOptions = {}): Promise<void> {
  const blob = format === "svg" ? new Blob([exportSVG(figure, opts).svg], { type: "image/svg+xml" }) : (await renderPNG(figure, opts)).blob;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBaseName(figure)}.${format}`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // クリックの処理が終わってから解放する（同期に解放すると保存が始まらないブラウザがある）。
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
