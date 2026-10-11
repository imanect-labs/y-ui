/**
 * 数値の正規化。日本語の業務文書で使われる表記を受け付ける。
 *
 * - 全角数字・全角記号（NFKC で半角化）
 * - 桁区切り `1,200`
 * - 漢数字の単位 `120万` `1.2億` `1億2,000万`
 * - 会計のマイナス `△120` `▲120`、Unicode のマイナス `−120`
 * - 通貨の前置 `¥1,200` `$3.5`
 * - 後置の単位 `320万円` `18%` `1,240人`
 * - 概数の前置 `約120`
 */

export interface ParsedNumber {
  value: number;
  /** 後置（または通貨前置）の単位。無ければ undefined。 */
  unit?: string;
  approx?: boolean;
}

const MULTIPLIERS: Record<string, number> = {
  千: 1e3,
  万: 1e4,
  億: 1e8,
  兆: 1e12,
};

const MISSING = new Set(["", "-", "–", "—", "―", "ー", "n/a", "na", "null", "なし", "不明"]);

const NUMBER_AT = /^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)/;
const REFS = /\s*(?:\[\d+\])+\s*$/;
const MAX_UNIT_LENGTH = 8;

/** セル文字列の分類。欠損と不正を区別する。 */
export type CellValue =
  | { kind: "number"; value: number; unit?: string }
  | { kind: "missing" }
  | { kind: "bad" };

export function parseCell(raw: string): CellValue {
  const s = normalize(raw).replace(REFS, "").trim();
  if (MISSING.has(s.toLowerCase())) return { kind: "missing" };
  const n = parseNumber(s);
  if (!n) return { kind: "bad" };
  return n.unit === undefined
    ? { kind: "number", value: n.value }
    : { kind: "number", value: n.value, unit: n.unit };
}

export function parseNumber(raw: string): ParsedNumber | null {
  let s = normalize(raw).replace(REFS, "").trim();
  if (s.length === 0) return null;

  let approx = false;
  const approxMatch = /^(約|およそ|~|〜|≒|≈)\s*/.exec(s);
  if (approxMatch) {
    approx = true;
    s = s.slice(approxMatch[0].length);
  }

  let sign = 1;
  const signMatch = /^([+\-△▲])\s*/.exec(s);
  if (signMatch) {
    if (signMatch[1] !== "+") sign = -1;
    s = s.slice(signMatch[0].length);
  }

  let unit: string | undefined;
  const currencyMatch = /^([¥$€£])\s*/.exec(s);
  if (currencyMatch) {
    unit = currencyMatch[1] === "¥" ? "円" : currencyMatch[1];
    s = s.slice(currencyMatch[0].length);
  }

  // 数値 [単位倍率] を繰り返し読む（`1億2,000万`）。倍率が付いたときだけ続きを読む。
  let total = 0;
  let consumedAny = false;
  for (;;) {
    const m = NUMBER_AT.exec(s);
    if (!m) break;
    const n = Number(m[1]!.replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    s = s.slice(m[0].length);
    consumedAny = true;
    const mult = MULTIPLIERS[s[0] ?? ""];
    if (mult !== undefined) {
      total += n * mult;
      s = s.slice(1);
      continue;
    }
    total += n;
    break;
  }
  if (!consumedAny) return null;

  const rest = s.trim();
  if (rest.length > 0) {
    if (rest.length > MAX_UNIT_LENGTH || /[0-9]/.test(rest)) return null;
    unit = rest;
  }

  const value = sign * total;
  if (!Number.isFinite(value)) return null;
  const out: ParsedNumber = { value };
  if (unit !== undefined) out.unit = unit;
  if (approx) out.approx = true;
  return out;
}

/** NFKC 正規化と、NFKC で揃わない記号の置き換え。 */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[−‒–﹣－]/g, "-");
}
