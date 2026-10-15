/**
 * timeline（年表）と steps（手順）: 書かれた順に並ぶ項目の列。
 *
 * - timeline: `- 2024年4月: 出来事`、`2024年4月 | 出来事 | 補足`、`2024年4月 出来事`。
 * - steps: `1. 見出し: 説明`、`見出し | 説明`。
 * - どちらも、字下げした行は直前の項目の説明に足す。並べ替えはしない。
 */

import type { Step, StepsFigure, TimelineEvent, TimelineFigure } from "../ir.js";
import { clip, Diagnostics, hasPipe, isSeparatorRow, LIMITS, type Line, parseOption, splitCells, stripListMarker, takeRefs } from "../lines.js";
import { indentOf, splitTitle } from "./stack.js";

const OPTIONS = ["note", "src"] as const;

interface Entry {
  title: string;
  desc?: string;
  refs: number[];
}

/** 2 行目以降の共通処理。項目を 1 行読む関数 read を受け、字下げ・オプション・上限を扱う。 */
function readEntries<T extends Entry>(
  fig: { note?: string; src?: string },
  body: Line[],
  diags: Diagnostics,
  limit: number,
  noun: string,
  read: (text: string, line: number, first: boolean) => T | "skip" | null,
): T[] {
  const out: T[] = [];
  let base: number | null = null;
  for (const line of body) {
    const indent = indentOf(line.text);
    const { text, marked } = stripListMarker(line.text.trim());
    if (text === "") continue;
    if (!marked && !hasPipe(text)) {
      const opt = parseOption(text, OPTIONS);
      if (opt) {
        if (opt.key === "note") fig.note = opt.value;
        else fig.src = opt.value;
        continue;
      }
    }
    if (base === null) base = indent;
    const prev = out[out.length - 1];
    if (indent > base && prev) {
      // 字下げした行は直前の項目の説明に足す
      const r = takeRefs(text);
      prev.desc = clip(prev.desc ? `${prev.desc} ${r.text}` : r.text, line.no, diags);
      prev.refs = [...new Set([...prev.refs, ...r.refs])];
      continue;
    }
    const e = read(text, line.no, out.length === 0);
    if (e === "skip") continue;
    if (!e) {
      diags.add(line.no, "warning", "unrecognized_line", `解釈できない行を無視しました: ${text}`);
      continue;
    }
    if (out.length >= limit) {
      diags.addOnce(line.no, "warning", "limit_exceeded", `${noun}は ${limit} 個までです`);
      continue;
    }
    out.push(e);
  }
  return out;
}

function entry(titleText: string, descText: string | undefined, line: number, diags: Diagnostics): Entry {
  const t = takeRefs(titleText);
  const e: Entry = { title: clip(t.text, line, diags), refs: t.refs };
  if (descText !== undefined && descText.trim() !== "") {
    const d = takeRefs(descText);
    e.desc = clip(d.text, line, diags);
    e.refs = [...new Set([...e.refs, ...d.refs])];
  }
  return e;
}

// ---------------------------------------------------------------- timeline

const WHEN_HEADER = /^(時期|日付|日時|年|年月|年月日|年度|時間|時刻|いつ|期間|date|when|time|year|period)$/i;
/** 空白区切りの先頭が時期らしいか（数字を含む短い語）。 */
const WHEN_TOKEN = /^(\S{0,12}\d\S{0,12})\s+(.+)$/;
/** `10:00` のような時刻（`:` で分けない）。 */
const TIME_HEAD = /^(\d{1,2}[:：]\d{2}(?:\s*[-~〜]\s*\d{1,2}[:：]\d{2})?)\s*(?:[:：]\s*)?(.+)$/;

export function parseTimeline(fig: TimelineFigure, body: Line[], diags: Diagnostics): void {
  fig.events = readEntries<TimelineEvent>(fig, body, diags, LIMITS.timelineEvents, "出来事", (text, line, first) => {
    let when: string;
    let rest: string;
    let desc: string | undefined;
    if (hasPipe(text) || text.includes("\t")) {
      const cells = splitCells(text);
      if (isSeparatorRow(cells)) return "skip";
      if (first && WHEN_HEADER.test(cells[0]!.normalize("NFKC"))) return "skip";
      if (cells.length < 2 || cells[1] === "") return null;
      [when, rest] = [cells[0]!, cells[1]!];
      if (cells.length > 2) desc = cells.slice(2).filter((c) => c !== "").join(" / ");
    } else {
      const time = TIME_HEAD.exec(text);
      const kv = time ? null : splitTitle(text);
      const sp = time || kv?.desc !== undefined ? null : WHEN_TOKEN.exec(text);
      if (time) [when, rest] = [time[1]!, time[2]!];
      else if (kv?.desc !== undefined) [when, rest] = [kv.title, kv.desc];
      else if (sp) [when, rest] = [sp[1]!, sp[2]!];
      else return null;
      // `出来事: 補足` の形なら補足に分ける
      const inner = splitTitle(rest);
      if (inner.desc !== undefined && !TIME_HEAD.test(rest)) [rest, desc] = [inner.title, inner.desc];
    }
    const w = takeRefs(when);
    const e = entry(rest, desc, line, diags);
    return { when: clip(w.text, line, diags), title: e.title, ...(e.desc !== undefined ? { desc: e.desc } : {}), refs: [...new Set([...w.refs, ...e.refs])] };
  });
}

// ---------------------------------------------------------------- steps

const STEP_HEADER = /^(手順|ステップ|工程|段階|作業|内容|step|steps|no\.?|#|番号)$/i;
const STEP_PREFIX = /^(?:step|ステップ|手順|stage|段階)\s*\d+\s*[:：.、)）]?\s*/i;

export function parseSteps(fig: StepsFigure, body: Line[], diags: Diagnostics): void {
  fig.steps = readEntries<Step>(fig, body, diags, LIMITS.steps, "手順", (text, line, first) => {
    if (hasPipe(text) || text.includes("\t")) {
      let cells = splitCells(text);
      if (isSeparatorRow(cells)) return "skip";
      if (first && STEP_HEADER.test(cells[0]!.normalize("NFKC"))) return "skip";
      // `1 | 申請 | 説明` の番号の列は落とす
      if (cells.length > 1 && /^(?:#|no\.?\s*)?\d{1,3}[.)]?$/i.test(cells[0]!.normalize("NFKC"))) cells = cells.slice(1);
      if (cells[0] === "") return null;
      return entry(cells[0]!, cells.slice(1).filter((c) => c !== "").join(" / ") || undefined, line, diags);
    }
    // `STEP1: 申請` の番号は落とす（`手順1` だけの行は見出しとして残す）
    const t = splitTitle(text.replace(STEP_PREFIX, "") || text);
    if (t.title === "") return null;
    return entry(t.title, t.desc, line, diags);
  });
}
