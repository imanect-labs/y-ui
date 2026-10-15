/**
 * app: 入力部品とボタンを並べた画面（docs/app.md）。
 *
 * - `## 見出し` で機能（入力のまとまりとボタン）を分ける。`> 説明` は機能の説明。
 * - `ラベル = 種類 [オプション]` が入力部品。`button ラベル -> workflow 名前`（`-> chat`）がボタン。
 * - Yui は実行しない。ボタンの実行先は名前の文字列として持ち、解決と実行はホストが行う。
 */

import type { AppAction, AppField, AppFigure, AppSection } from "../ir.js";
import { clip, Diagnostics, LIMITS, type Line, parseOption, stripListMarker } from "../lines.js";

const FIELD = /^([^=＝]+?)\s*[=＝]\s*(\S+)\s*(.*)$/;
const BUTTON = /^(?:button|ボタン)\s+(.+?)\s*(?:->|→|=>)\s*(.+)$/i;
const TYPES: Record<string, AppField["type"]> = {
  text: "text",
  文字: "text",
  テキスト: "text",
  textarea: "textarea",
  longtext: "textarea",
  文章: "textarea",
  number: "number",
  数値: "number",
  slider: "slider",
  スライダー: "slider",
  count: "count",
  stepper: "count",
  choice: "choice",
  select: "choice",
  選択: "choice",
  date: "date",
  日付: "date",
  month: "month",
  年月: "month",
  toggle: "toggle",
  switch: "toggle",
  checkbox: "toggle",
  オンオフ: "toggle",
};
const NUM = "(-?\\d+(?:\\.\\d+)?)";
const RANGE = new RegExp(`^${NUM}\\s*(?:\\.\\.|〜|~|～)\\s*${NUM}\\s*`);
const KEY = /(?:^|\s)as\s+([A-Za-z_][\w.-]{0,63})(?=\s|$)/;
const REQUIRED = /(?:^|\s)(?:必須|required)(?=\s|$)/i;
const MULTI = /(?:^|\s)(?:multi|複数)(?=\s|$)/i;
/** 値を取るオプション（後ろに値が続く）。 */
const VALUED = /(?:^|\s)(例|e\.g\.|placeholder|初期値?|initial|default|step|刻み)\s+/gi;

export function parseApp(fig: AppFigure, body: Line[], diags: Diagnostics): void {
  let current: AppSection | null = null;
  let fieldCount = 0;
  let actionCount = 0;
  /** 機能の上限を超えた見出しの下にいる（その行は読み飛ばす）。 */
  let skipping = false;
  const section = (): AppSection => {
    if (!current) {
      current = { fields: [], actions: [] };
      fig.sections.push(current);
    }
    return current;
  };
  for (const line of body) {
    const trimmed = line.text.trim();
    if (trimmed === "") continue;
    const opt = parseOption(trimmed, ["note", "src"]);
    if (opt) {
      if (opt.key === "note") fig.note = opt.value;
      else fig.src = opt.value;
      continue;
    }
    const head = /^#{1,6}\s+(.+)$/.exec(trimmed);
    if (head) {
      const prev: AppSection | null = current;
      // 中身の無い（見出しだけの）機能は見出しを付け替える
      if (prev && prev.fields.length === 0 && prev.actions.length === 0 && !prev.desc) {
        prev.title = label(head[1]!, line.no, diags);
        continue;
      }
      if (fig.sections.length >= LIMITS.appSections) {
        diags.addOnce(line.no, "warning", "limit_exceeded", `機能は ${LIMITS.appSections} 個までです`);
        skipping = true;
        continue;
      }
      skipping = false;
      current = { title: label(head[1]!, line.no, diags), fields: [], actions: [] };
      fig.sections.push(current);
      continue;
    }
    if (skipping) continue;
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      const s = section();
      s.desc = clip(s.desc ? `${s.desc}\n${quote[1]!.trim()}` : quote[1]!.trim(), line.no, diags);
      continue;
    }
    const raw = stripListMarker(trimmed).text;
    const b = BUTTON.exec(raw);
    if (b) {
      const s = section();
      if (s.actions.length >= LIMITS.appSectionActions) {
        diags.add(line.no, "warning", "limit_exceeded", `1 つの機能のボタンは ${LIMITS.appSectionActions} 個までです`);
        continue;
      }
      const a = readAction(b[1]!, b[2]!, ++actionCount, line.no, diags);
      if (a) s.actions.push(a);
      else actionCount--;
      continue;
    }
    const f = FIELD.exec(raw);
    if (f) {
      const s = section();
      if (fieldCount >= LIMITS.appFields || s.fields.length >= LIMITS.appSectionFields) {
        diags.addOnce(line.no, "warning", "limit_exceeded", `入力は 1 つの機能に ${LIMITS.appSectionFields} 個、全体で ${LIMITS.appFields} 個までです`);
        continue;
      }
      const field = readField(f[1]!.normalize("NFKC").trim(), f[2]!, f[3]!, line.no, diags);
      if (!field) continue;
      if (s.fields.some((x) => x.key === field.key)) {
        diags.add(line.no, "warning", "unrecognized_line", `「${field.key}」は同じ機能に既にあります`);
        continue;
      }
      s.fields.push(field);
      fieldCount++;
      continue;
    }
    diags.add(line.no, "warning", "unrecognized_line", `解釈できない行を無視しました: ${trimmed}`);
  }
  // 入力もボタンも無い機能は落とす
  fig.sections = fig.sections.filter((s) => s.fields.length > 0 || s.actions.length > 0);
}

function label(text: string, line: number, diags: Diagnostics): string {
  const t = text.trim();
  if (t.length <= LIMITS.appLabel) return t;
  diags.add(line, "warning", "text_too_long", `ラベルは ${LIMITS.appLabel} 文字までです`);
  return `${t.slice(0, LIMITS.appLabel - 1)}…`;
}

function readAction(text: string, target: string, n: number, line: number, diags: Diagnostics): AppAction | null {
  let t = target.trim();
  let confirm: boolean | undefined;
  const c = /\s+(confirm|確認)$/i.exec(t);
  if (c) {
    confirm = true;
    t = t.slice(0, c.index).trim();
  }
  const id = `a${n}`;
  if (/^(chat|会話|チャット)$/i.test(t)) return { id, label: label(text, line, diags), target: { kind: "chat" }, confirm: confirm ?? false };
  const w = /^(?:workflow|ワークフロー)\s*[:：]?\s*(.+)$/i.exec(t);
  const name = (w ? w[1]! : t).trim();
  // 名前だけを受ける（URL・パス・記号は実行先にしない。解決はホストが行う）
  if (!name || /[:/\\<>"'`{}]/.test(name) || name.length > 64) {
    diags.add(line, "warning", "unrecognized_line", `ボタンの実行先が読めません（「-> workflow 名前」か「-> chat」）: ${target}`);
    return null;
  }
  return { id, label: label(text, line, diags), target: { kind: "workflow", name }, confirm: true };
}

/** オプションの文字列から、値を取るオプション（例・初期・step）を取り出し、残りを返す。 */
function takeValued(s: string): { rest: string; values: Record<string, string> } {
  const marks: { key: string; at: number; start: number }[] = [];
  for (const m of s.matchAll(VALUED)) marks.push({ key: m[1]!.toLowerCase(), at: m.index!, start: m.index! + m[0].length });
  if (marks.length === 0) return { rest: s, values: {} };
  const values: Record<string, string> = {};
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1]!.at : s.length;
    const key = m.key === "placeholder" || m.key === "例" || m.key === "e.g." ? "例" : m.key === "刻み" || m.key === "step" ? "step" : "初期";
    values[key] = s.slice(m.start, end).trim();
  });
  return { rest: s.slice(0, marks[0]!.at), values };
}

function readField(name: string, typeWord: string, opts: string, line: number, diags: Diagnostics): AppField | null {
  const type = TYPES[typeWord.normalize("NFKC").toLowerCase()] ?? TYPES[typeWord];
  if (!type) {
    diags.add(line, "warning", "unrecognized_line", `入力の種類が分かりません: ${typeWord}（text / textarea / number / choice / date / month / toggle / slider / count）`);
    return null;
  }
  let s = ` ${opts} `;
  const key = KEY.exec(s);
  if (key) s = s.replace(KEY, " ");
  const required = REQUIRED.test(s);
  s = s.replace(REQUIRED, " ");
  const multi = MULTI.test(s);
  s = s.replace(MULTI, " ");
  const field: AppField = { key: key ? key[1]! : label(name, line, diags), label: label(name, line, diags), type, required };

  if (type === "choice") {
    // 選択肢は `a | b | c`（`表示名=値` も可）。例・初期は後ろに書く
    const { rest, values } = takeValued(s);
    const options = rest
      .split(/\s*[|｜]\s*/)
      .map((o) => o.trim())
      .filter(Boolean)
      .map((o) => {
        const kv = /^(.+?)\s*[=＝]\s*(.+)$/.exec(o);
        return kv ? { label: label(kv[1]!, line, diags), value: kv[2]!.trim() } : { label: label(o, line, diags), value: o };
      });
    if (options.length < 2) {
      diags.add(line, "warning", "unrecognized_line", `選択肢は「a | b」のように 2 つ以上書いてください: ${name}`);
      return null;
    }
    field.options = options.slice(0, 20);
    if (multi) field.multi = true;
    const init = values["初期"];
    if (init) {
      const picked = init.split(/\s*[,、|]\s*/).filter((v) => field.options!.some((o) => o.value === v || o.label === v)).map((v) => field.options!.find((o) => o.value === v || o.label === v)!.value);
      if (picked.length) field.initial = multi ? picked : picked[0]!;
    }
    return field;
  }

  const { rest, values } = takeValued(s);
  if (values["例"]) field.placeholder = clip(values["例"], line, diags);
  let tail = rest.trim();
  if (type === "number" || type === "slider" || type === "count") {
    const r = RANGE.exec(tail);
    if (r) {
      const [a, b] = [+r[1]!, +r[2]!];
      [field.min, field.max] = a <= b ? [a, b] : [b, a];
      tail = tail.slice(r[0].length).trim();
    } else if (type !== "number") {
      diags.add(line, "warning", "unrecognized_line", `${type} には範囲（最小..最大）が要ります: ${name}`);
      return null;
    }
    if (values["step"] && Number.isFinite(+values["step"])) field.step = Math.abs(+values["step"]) || 1;
    if (type === "count") field.step = 1;
    if (values["初期"] !== undefined && Number.isFinite(Number(values["初期"]))) field.initial = Number(values["初期"]);
    if (tail) field.unit = label(tail, line, diags);
    return field;
  }
  if (type === "toggle") {
    if (values["初期"]) field.initial = /^(オン|on|1|true|はい)$/i.test(values["初期"]);
    return field;
  }
  if (type === "date" || type === "month") {
    const init = values["初期"];
    if (init) {
      const v = init.replace(/\//g, "-");
      if ((type === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/).test(v)) field.initial = v;
    }
    return field;
  }
  // text / textarea: オプション以外の残りは例として扱う（`件名 = text 4月の交通費` のような書き方）
  if (values["初期"]) field.initial = clip(values["初期"], line, diags);
  if (!field.placeholder && tail) field.placeholder = clip(tail, line, diags);
  return field;
}
