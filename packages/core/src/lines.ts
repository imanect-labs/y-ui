/** 行単位の共通処理（セル分割・引用番号・オプション行）。 */

import type { Diagnostic, DiagnosticCode, Severity } from "./ir.js";

export interface Line {
  /** ブロック内の行番号（1 始まり）。 */
  no: number;
  text: string;
}

export const LIMITS = {
  textLength: 200,
  chartRows: 500,
  chartColumns: 13,
  pieSlices: 12,
  statItems: 24,
  flowNodes: 60,
  flowEdges: 100,
  stackTiers: 12,
  stackBoxesPerTier: 8,
  stackChildren: 16,
} as const;

export class Diagnostics {
  readonly list: Diagnostic[] = [];
  private readonly once = new Set<string>();

  add(line: number, severity: Severity, code: DiagnosticCode, message: string): void {
    this.list.push({ line, severity, code, message });
  }

  /** 同じ code を 1 度だけ報告する（上限超過など）。 */
  addOnce(line: number, severity: Severity, code: DiagnosticCode, message: string): void {
    if (this.once.has(code)) return;
    this.once.add(code);
    this.add(line, severity, code, message);
  }
}

const REFS_TAIL = /\s*((?:\[\d+\])+)\s*$/;

/** 末尾の引用番号 `[1][2]` を取り外す。 */
export function takeRefs(text: string): { text: string; refs: number[] } {
  const m = REFS_TAIL.exec(text);
  if (!m) return { text: text.trim(), refs: [] };
  const refs = [...m[1]!.matchAll(/\[(\d+)\]/g)].map((r) => Number(r[1]));
  return { text: text.slice(0, m.index).trim(), refs };
}

/** 長すぎるテキストを切り詰める。 */
export function clip(text: string, line: number, diags: Diagnostics): string {
  if (text.length <= LIMITS.textLength) return text;
  diags.add(line, "warning", "text_too_long", `${LIMITS.textLength} 文字を超える部分を省略しました`);
  return `${text.slice(0, LIMITS.textLength - 1)}…`;
}

/** 行頭の箇条書き記号を取り外す。 */
export function stripListMarker(text: string): { text: string; marked: boolean } {
  const m = /^(?:[-*+・•]|\d{1,3}[.)])\s+/.exec(text);
  if (!m) return { text, marked: false };
  return { text: text.slice(m[0].length), marked: true };
}

/** `|` で区切られているか（エスケープ `\|` は除く）。 */
export function hasPipe(text: string): boolean {
  return /(^|[^\\])\|/.test(text);
}

/**
 * セルに分割する。`|` 区切り（GFM の表の前後 `|` も可）、`|` が無ければタブ区切り。
 */
export function splitCells(text: string): string[] {
  let t = text.trim();
  if (hasPipe(t)) {
    if (t.startsWith("|")) t = t.slice(1);
    if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
    const cells: string[] = [];
    let cur = "";
    for (let i = 0; i < t.length; i++) {
      const ch = t[i]!;
      if (ch === "\\" && t[i + 1] === "|") {
        cur += "|";
        i++;
      } else if (ch === "|") {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  }
  if (t.includes("\t")) return t.split(/\t+/).map((c) => c.trim());
  return [t];
}

/** GFM の区切り行 `|---|:--:|` か。 */
export function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "");
}

const OPTION_LINE = /^([A-Za-z_]+|注記|注|単位|出典|方向|向き)\s*[:：]\s*(.*)$/;

const OPTION_ALIASES: Record<string, string> = {
  note: "note",
  注記: "note",
  注: "note",
  unit: "unit",
  単位: "unit",
  src: "src",
  source: "src",
  出典: "src",
  stacked: "stacked",
  stack: "stacked",
  horizontal: "horizontal",
  dir: "dir",
  direction: "dir",
  方向: "dir",
  向き: "dir",
};

/**
 * `key: value` 形式のオプション行なら、正規化したキーと値を返す。
 * allowed に含まれないキーは null（＝オプション行ではない）。
 */
export function parseOption(text: string, allowed: readonly string[]): { key: string; value: string } | null {
  const m = OPTION_LINE.exec(text.trim());
  if (!m) return null;
  const key = OPTION_ALIASES[m[1]!.toLowerCase()] ?? OPTION_ALIASES[m[1]!];
  if (!key || !allowed.includes(key)) return null;
  return { key, value: m[2]!.trim() };
}

export function truthy(value: string): boolean {
  return /^(true|yes|on|1|はい|する)$/i.test(value.trim()) || value.trim() === "";
}

/** テキストの比較用キー（ノード同一性の判定に使う）。 */
export function textKey(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}
