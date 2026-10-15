/**
 * cards（要点のカード）・progress（目標に対する進捗）・funnel（段階ごとの数）。
 *
 * - cards: `- 見出し: 本文`、`見出し | 本文`。字下げした行は本文に足す。
 * - progress: `項目 | 実績 | 目標`、`項目: 75%`（% だけなら目標は 100）。
 * - funnel: `段階 | 数`、`段階: 数`。書かれた順が上から下。
 */

import type { Card, CardsFigure, FunnelFigure, FunnelStage, ProgressFigure, ProgressItem } from "../ir.js";
import { parseNumber } from "../number.js";
import { clip, Diagnostics, hasPipe, isSeparatorRow, LIMITS, type Line, parseOption, splitCells, stripListMarker, takeRefs } from "../lines.js";
import { entry, readEntries } from "./seq.js";
import { splitTitle } from "./stack.js";

const HEADER_WORDS = /^(項目|見出し|特徴|ポイント|名前|段階|ステップ|工程|指標|kpi|目標|実績|件数|人数|数|値|title|name|stage|item)$/i;

// ---------------------------------------------------------------- cards

export function parseCards(fig: CardsFigure, body: Line[], diags: Diagnostics): void {
  fig.cards = readEntries<Card>(fig, body, diags, LIMITS.cards, "カード", (text, line, first) => {
    if (hasPipe(text) || text.includes("\t")) {
      const cells = splitCells(text);
      if (isSeparatorRow(cells)) return "skip";
      if (first && HEADER_WORDS.test(cells[0]!.normalize("NFKC"))) return "skip";
      if (cells[0] === "") return null;
      const rest = cells.slice(1).filter((c) => c !== "");
      // `Starter | ¥4,800 | 月額相当`: 2 列目が数値なら大きく出す値
      const value = rest.length >= 1 && parseNumber(takeRefs(rest[0]!).text) ? takeRefs(rest.shift()!) : null;
      const e = entry(cells[0]!, rest.join(" / ") || undefined, line, diags);
      return { title: e.title, ...(value ? { value: clip(value.text, line, diags) } : {}), ...(e.desc !== undefined ? { body: e.desc } : {}), refs: [...new Set([...e.refs, ...(value?.refs ?? [])])] };
    }
    const t = splitTitle(text);
    const e = entry(t.title, t.desc, line, diags);
    return { title: e.title, ...(e.desc !== undefined ? { body: e.desc } : {}), refs: e.refs };
  }).map((c) => {
    // readEntries は字下げした段落を desc に、箇条書きを items に足すので、body・items に移す
    const { desc, items, ...rest } = c as Card & { desc?: string };
    const text = [rest.body, desc].filter((x): x is string => x !== undefined && x !== "").join("\n");
    const card: Card = { title: rest.title, refs: rest.refs };
    if (rest.value !== undefined) card.value = rest.value;
    if (text) card.body = text;
    if (items?.length) {
      if (items.length > LIMITS.cardItems) diags.addOnce(body[0]?.no ?? 0, "warning", "limit_exceeded", `カードの項目は ${LIMITS.cardItems} 個までです`);
      card.items = items.slice(0, LIMITS.cardItems);
    }
    return card;
  });
}

// ---------------------------------------------------------------- 共通: 項目と数値の行

const OPTIONS = ["note", "src", "unit"] as const;

/** `項目 | 値 [| 値]` か `項目: 値` を読む。オプション行・見出し行・区切り行は飛ばす。 */
function readRows(fig: { note?: string; src?: string; unit?: string }, body: Line[], diags: Diagnostics, onRow: (cells: string[], line: number) => void): void {
  let first = true;
  for (const line of body) {
    const raw = stripListMarker(line.text.trim()).text;
    if (raw === "") continue;
    let cells: string[];
    if (hasPipe(raw) || raw.includes("\t")) {
      cells = splitCells(raw);
      if (isSeparatorRow(cells)) continue;
    } else {
      const opt = parseOption(raw, OPTIONS);
      if (opt) {
        if (opt.key === "note") fig.note = opt.value;
        else if (opt.key === "src") fig.src = opt.value;
        else fig.unit = opt.value;
        continue;
      }
      const kv = /^(.+?)\s*[:：]\s*(.+)$/.exec(raw);
      if (!kv) {
        diags.add(line.no, "warning", "unrecognized_line", `解釈できない行を無視しました: ${raw}`);
        continue;
      }
      cells = [kv[1]!, kv[2]!];
    }
    // 見出し行（2 列目が数値でない最初の行）は読み飛ばす
    if (first && cells.length > 1 && !parseNumber(takeRefs(cells[1]!).text)) {
      first = false;
      if (HEADER_WORDS.test(cells[0]!.normalize("NFKC")) || cells.slice(1).every((c) => HEADER_WORDS.test(c.normalize("NFKC")))) continue;
    }
    first = false;
    onRow(cells, line.no);
  }
}

// ---------------------------------------------------------------- progress

/** セルの前に付いた「目標」「実績」のような語（`目標 40画面`・`目標: 40`）を外す。 */
const ROLE_PREFIX = /^(?:目標|実績|現在|達成|計画|予定|target|goal|actual|current)\s*[:：]?\s*/i;
/** 後ろの括弧書き（`660人（達成率 108%）`）も外す。達成率はレンダラーが計算する。 */
const stripRole = (s: string) => s.replace(ROLE_PREFIX, "").replace(/\s*[（(][^)）]*[)）]\s*$/, "").trim();

export function parseProgress(fig: ProgressFigure, body: Line[], diags: Diagnostics): void {
  readRows(fig, body, diags, (cells, line) => {
    const label = takeRefs(cells[0] ?? "");
    const v = takeRefs(cells[1] ?? "");
    // `75 / 100` や `75/100` の 1 セルも受ける
    const slash = cells.length === 2 ? /^(.+?)\s*[/／]\s*(.+)$/.exec(v.text) : null;
    const valueText = stripRole(slash ? slash[1]! : v.text);
    const tgRaw = takeRefs(slash ? slash[2]! : (cells[2] ?? ""));
    const tg = { ...tgRaw, text: stripRole(tgRaw.text) };
    const value = parseNumber(valueText);
    if (!value) {
      diags.add(line, "warning", "bad_number", `「${label.text}」の実績「${valueText}」は数値として読めないため、この行を表示しません`);
      return;
    }
    let target = tg.text ? parseNumber(tg.text) : null;
    if (tg.text && !target) {
      diags.add(line, "warning", "bad_number", `「${label.text}」の目標「${tg.text}」は数値として読めないため、この行を表示しません`);
      return;
    }
    if (!target) {
      if (value.unit !== "%") {
        diags.add(line, "warning", "unrecognized_line", `「${label.text}」に目標がありません（「項目 | 実績 | 目標」か「項目: 75%」で書いてください）`);
        return;
      }
      target = { value: 100, unit: "%" };
    }
    if (fig.items.length >= LIMITS.progressItems) {
      diags.addOnce(line, "warning", "limit_exceeded", `項目は ${LIMITS.progressItems} 個までです`);
      return;
    }
    const item: ProgressItem = {
      label: clip(label.text, line, diags),
      value: value.value,
      valueText: clip(valueText.trim(), line, diags),
      target: target.value,
      targetText: clip(tg.text || "100%", line, diags),
      refs: [...new Set([...label.refs, ...v.refs, ...tg.refs])],
    };
    fig.items.push(item);
  });
}

// ---------------------------------------------------------------- funnel

export function parseFunnel(fig: FunnelFigure, body: Line[], diags: Diagnostics): void {
  readRows(fig, body, diags, (cells, line) => {
    const label = takeRefs(cells[0] ?? "");
    const v = takeRefs(cells[1] ?? "");
    const n = parseNumber(v.text);
    if (!n || n.value < 0) {
      diags.add(line, "warning", "bad_number", `「${label.text}」の「${v.text}」は 0 以上の数値として読めないため、この段階を表示しません`);
      return;
    }
    if (cells.length > 2) diags.addOnce(line, "info", "extra_cells", "段階ごとの数は 1 列だけを使います");
    if (fig.stages.length >= LIMITS.funnelStages) {
      diags.addOnce(line, "warning", "limit_exceeded", `段階は ${LIMITS.funnelStages} までです`);
      return;
    }
    if (fig.unit === undefined && n.unit && n.unit !== "%") fig.unit = n.unit;
    const stage: FunnelStage = { label: clip(label.text, line, diags), value: n.value, refs: [...new Set([...label.refs, ...v.refs])] };
    fig.stages.push(stage);
  });
}
