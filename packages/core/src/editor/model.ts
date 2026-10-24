/**
 * app の IR を直す純粋関数（docs/editor.md §4.1）。React を使わない。
 *
 * - どの関数も元の図を書き換えず、新しい図を返す。
 * - 並べ替え・追加は上限（LIMITS）を超えるなら `ok: false` で断る（ドラッグの置き場所を出さないため）。
 * - 設定の中身（ラベルの文字など）の良し悪しはここでは決めず、check.ts のチェッカーが部品ごとに知らせる。
 *   打ちかけの文字を拒むと入力しづらいため、保存の前に直してもらう。
 */

import type { AppAction, AppField, AppFigure, AppSection } from "../ir.js";
import { LIMITS } from "../lines.js";

/** 機能の中の位置（部品かボタン）。挿入なら index は「この前に置く」位置（末尾は length）。 */
export interface Place {
  section: number;
  index: number;
}

export type EditProblem = "limit_sections" | "limit_fields" | "limit_section_fields" | "limit_actions" | "out_of_range";

export type EditResult = { ok: true; figure: AppFigure } | { ok: false; problem: EditProblem };

export type FieldType = AppField["type"];

/** パレットに並べる順（よく使うものから）。 */
export const FIELD_TYPES: readonly FieldType[] = ["text", "textarea", "number", "choice", "date", "month", "daterange", "toggle", "slider", "count", "rating"];

const ok = (figure: AppFigure): EditResult => ({ ok: true, figure });
const fail = (problem: EditProblem): EditResult => ({ ok: false, problem });

function withSection(f: AppFigure, s: number, fn: (sec: AppSection) => AppSection): AppFigure {
  return { ...f, sections: f.sections.map((x, i) => (i === s ? fn(x) : x)) };
}

function insertAt<T>(list: readonly T[], index: number, item: T): T[] {
  const out = list.slice();
  out.splice(Math.max(0, Math.min(index, out.length)), 0, item);
  return out;
}

function fieldCount(f: AppFigure): number {
  return f.sections.reduce((n, s) => n + s.fields.length, 0);
}

/** ボタンの id をソースの順（a1・a2…）に振り直す（パーサと同じ規則。並べ替えると変わる）。 */
function renumber(f: AppFigure): AppFigure {
  let n = 0;
  return { ...f, sections: f.sections.map((s) => ({ ...s, actions: s.actions.map((a) => ({ ...a, id: `a${++n}` })) })) };
}

// ---------------------------------------------------------------- 新しく作る

/** 空の app（機能 1 つ）。 */
export function emptyApp(title = ""): AppFigure {
  return { kind: "app", title, refs: [], sections: [{ fields: [], actions: [] }] };
}

/** 種類ごとの既定値を入れた部品。ラベルは図の中で重ならない名前にする。 */
export function newField(f: AppFigure, type: FieldType, label?: string, ja = true): AppField {
  const taken = new Set(f.sections.flatMap((s) => s.fields.flatMap((x) => [x.key, x.label])));
  const base = label ?? (ja ? DEFAULT_LABEL_JA[type] : DEFAULT_LABEL_EN[type]);
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
  const field: AppField = { key: name, label: name, type, required: false };
  if (type === "choice") field.options = ja ? [opt("選択肢 1"), opt("選択肢 2")] : [opt("Option 1"), opt("Option 2")];
  if (type === "slider") Object.assign(field, { min: 0, max: 100 });
  if (type === "count") Object.assign(field, { min: 0, max: 10, step: 1 });
  if (type === "rating") Object.assign(field, { min: 1, max: 5 });
  return field;
}

const opt = (v: string) => ({ label: v, value: v });

const DEFAULT_LABEL_JA: Record<FieldType, string> = { text: "件名", textarea: "内容", number: "金額", choice: "区分", date: "日付", month: "対象月", daterange: "期間", toggle: "通知する", slider: "割合", count: "人数", rating: "評価" };
const DEFAULT_LABEL_EN: Record<FieldType, string> = { text: "Subject", textarea: "Details", number: "Amount", choice: "Category", date: "Date", month: "Month", daterange: "Period", toggle: "Notify", slider: "Ratio", count: "People", rating: "Rating" };

/** 種類を変える。ラベル・key・必須は残し、新しい種類で意味の無い設定は落とす。 */
export function changeType(x: AppField, type: FieldType, ja = true): AppField {
  const fresh = newField(emptyApp(), type, x.label, ja);
  const keep: AppField = { ...fresh, key: x.key, label: x.label, required: x.required };
  if (x.placeholder !== undefined && (type === "text" || type === "textarea" || type === "number")) keep.placeholder = x.placeholder;
  if (type === "number" && x.unit !== undefined) keep.unit = x.unit;
  if (type === "choice" && x.options) keep.options = x.options;
  return keep;
}

// ---------------------------------------------------------------- 部品

export function insertField(f: AppFigure, at: Place, field: AppField): EditResult {
  const s = f.sections[at.section];
  if (!s) return fail("out_of_range");
  if (fieldCount(f) >= LIMITS.appFields) return fail("limit_fields");
  if (s.fields.length >= LIMITS.appSectionFields) return fail("limit_section_fields");
  return ok(withSection(f, at.section, (sec) => ({ ...sec, fields: insertAt(sec.fields, at.index, field) })));
}

export function updateField(f: AppFigure, at: Place, patch: Partial<AppField>): EditResult {
  const x = f.sections[at.section]?.fields[at.index];
  if (!x) return fail("out_of_range");
  const next: AppField = { ...x, ...patch };
  // key がラベルと同じ（`as` なし）なら、ラベルを変えると key も変わる（日本語の key は `as` で書けず、別に保てない）。
  // 英字の key（`as amount`）はラベルを変えても残す（実行先の入力名がずれないように）
  if (patch.label !== undefined && patch.key === undefined && x.key === x.label) next.key = patch.label;
  // undefined を渡した設定は消す（IR に undefined のキーを残さない）
  for (const k of Object.keys(next) as (keyof AppField)[]) if (next[k] === undefined) delete next[k];
  return ok(withSection(f, at.section, (sec) => ({ ...sec, fields: sec.fields.map((y, i) => (i === at.index ? next : y)) })));
}

export function removeField(f: AppFigure, at: Place): EditResult {
  if (!f.sections[at.section]?.fields[at.index]) return fail("out_of_range");
  return ok(withSection(f, at.section, (sec) => ({ ...sec, fields: sec.fields.filter((_, i) => i !== at.index) })));
}

/** 部品を動かす（機能をまたいでもよい）。to は動かす前の並びでの挿入位置。 */
export function moveField(f: AppFigure, from: Place, to: Place): EditResult {
  const x = f.sections[from.section]?.fields[from.index];
  const dest = f.sections[to.section];
  if (!x || !dest) return fail("out_of_range");
  if (from.section !== to.section && dest.fields.length >= LIMITS.appSectionFields) return fail("limit_section_fields");
  let index = to.index;
  if (from.section === to.section && from.index < to.index) index--;
  const removed = withSection(f, from.section, (sec) => ({ ...sec, fields: sec.fields.filter((_, i) => i !== from.index) }));
  return ok(withSection(removed, to.section, (sec) => ({ ...sec, fields: insertAt(sec.fields, index, x) })));
}

// ---------------------------------------------------------------- ボタン

export function newAction(f: AppFigure, workflow: string | null, ja = true): AppAction {
  return { id: "", label: ja ? "実行する" : "Run", target: workflow === null ? { kind: "chat" } : { kind: "workflow", name: workflow }, confirm: workflow !== null };
}

export function insertAction(f: AppFigure, at: Place, action: AppAction): EditResult {
  const s = f.sections[at.section];
  if (!s) return fail("out_of_range");
  if (s.actions.length >= LIMITS.appSectionActions) return fail("limit_actions");
  // workflow は必ず確認を挟む（記法に「確認なし」は無い）
  const a = action.target.kind === "workflow" ? { ...action, confirm: true } : action;
  return ok(renumber(withSection(f, at.section, (sec) => ({ ...sec, actions: insertAt(sec.actions, at.index, a) }))));
}

export function updateAction(f: AppFigure, at: Place, patch: Partial<Omit<AppAction, "id">>): EditResult {
  const a = f.sections[at.section]?.actions[at.index];
  if (!a) return fail("out_of_range");
  const next: AppAction = { ...a, ...patch };
  // workflow は必ず確認を挟む（記法に「確認なし」は無い）
  if (next.target.kind === "workflow") next.confirm = true;
  return ok(withSection(f, at.section, (sec) => ({ ...sec, actions: sec.actions.map((y, i) => (i === at.index ? next : y)) })));
}

export function removeAction(f: AppFigure, at: Place): EditResult {
  if (!f.sections[at.section]?.actions[at.index]) return fail("out_of_range");
  return ok(renumber(withSection(f, at.section, (sec) => ({ ...sec, actions: sec.actions.filter((_, i) => i !== at.index) }))));
}

export function moveAction(f: AppFigure, from: Place, to: Place): EditResult {
  const a = f.sections[from.section]?.actions[from.index];
  const dest = f.sections[to.section];
  if (!a || !dest) return fail("out_of_range");
  if (from.section !== to.section && dest.actions.length >= LIMITS.appSectionActions) return fail("limit_actions");
  let index = to.index;
  if (from.section === to.section && from.index < to.index) index--;
  const removed = withSection(f, from.section, (sec) => ({ ...sec, actions: sec.actions.filter((_, i) => i !== from.index) }));
  return ok(renumber(withSection(removed, to.section, (sec) => ({ ...sec, actions: insertAt(sec.actions, index, a) }))));
}

// ---------------------------------------------------------------- 機能

/** 機能を足す。機能が 2 つ以上になるなら、見出しの無い機能に仮の見出しを付ける（見出しが区切りのため）。 */
export function insertSection(f: AppFigure, index: number, title?: string, ja = true): EditResult {
  if (f.sections.length >= LIMITS.appSections) return fail("limit_sections");
  const name = (n: number) => (ja ? `機能 ${n}` : `Section ${n}`);
  const sections = insertAt(f.sections, index, { title: title ?? "", fields: [], actions: [] } as AppSection);
  return ok(renumber({ ...f, sections: sections.map((s, i) => (s.title ? s : { ...s, title: name(i + 1) })) }));
}

export function updateSection(f: AppFigure, index: number, patch: { title?: string; desc?: string }): EditResult {
  if (!f.sections[index]) return fail("out_of_range");
  return ok(
    withSection(f, index, (s) => {
      const next: AppSection = { ...s, ...patch };
      if (!next.title) delete next.title;
      if (!next.desc) delete next.desc;
      return next;
    }),
  );
}

export function removeSection(f: AppFigure, index: number): EditResult {
  if (!f.sections[index]) return fail("out_of_range");
  const sections = f.sections.filter((_, i) => i !== index);
  return ok(renumber({ ...f, sections: sections.length ? sections : [{ fields: [], actions: [] }] }));
}

export function moveSection(f: AppFigure, from: number, to: number): EditResult {
  const s = f.sections[from];
  if (!s || to < 0 || to > f.sections.length) return fail("out_of_range");
  const index = from < to ? to - 1 : to;
  return ok(renumber({ ...f, sections: insertAt(f.sections.filter((_, i) => i !== from), index, s) }));
}

/** 図の見出し・注記。 */
export function updateApp(f: AppFigure, patch: { title?: string; note?: string }): AppFigure {
  const next: AppFigure = { ...f, ...patch };
  if (!next.note) delete next.note;
  return next;
}
