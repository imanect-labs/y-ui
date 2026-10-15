/**
 * app の入力値: 初期値と検証（docs/app.md §4）。
 *
 * 画面の検証は便宜で、ホストはサーバーで同じ規則（とワークフローの入力スキーマ）で検証し直す。
 * この関数はその規則の手本でもある（純粋関数・DOM に依存しない）。
 */

import type { AppAction, AppField, AppFigure, AppSection, AskQuestion, Figure } from "../ir.js";

export type AppValue = string | number | boolean | string[];
export type AppValues = Record<string, AppValue>;

/** 1 行の文字の上限と、複数行の文字の上限。 */
export const TEXT_MAX = 1000;
export const TEXTAREA_MAX = 10_000;
/** choice の「その他」の自由記述の上限。 */
export const OTHER_MAX = 200;

/** ボタンの id から、ボタンとその機能を探す。 */
export function findAction(f: AppFigure, actionId: string): { section: AppSection; action: AppAction } | null {
  for (const section of f.sections) {
    const action = section.actions.find((a) => a.id === actionId);
    if (action) return { section, action };
  }
  return null;
}

/** 部品の初期値（書かれていなければ空・最小値・オフ）。 */
export function initialValue(field: AppField): AppValue {
  if (field.initial !== undefined) return field.initial;
  switch (field.type) {
    case "slider":
    case "count":
      return field.min ?? 0;
    case "toggle":
      return false;
    case "choice":
      return field.multi ? [] : "";
    default:
      return "";
  }
}

export function initialValues(section: AppSection): AppValues {
  return Object.fromEntries(section.fields.map((f) => [f.key, initialValue(f)]));
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function validDate(v: string, month: boolean): boolean {
  const m = (month ? /^(\d{4})-(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})$/).exec(v);
  if (!m) return false;
  const [y, mo, d] = [+m[1]!, +m[2]!, m[3] ? +m[3] : 1];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** 1 つの部品の値を検証する。正しければ正規化した値、誤りなら文言を返す。 */
export function checkField(field: AppField, raw: unknown, ja = true): { value?: AppValue; error?: string } {
  if (isEmpty(raw)) {
    if (field.required) return { error: ja ? "入力してください" : "Required" };
    return {};
  }
  switch (field.type) {
    case "text":
    case "textarea": {
      if (typeof raw !== "string") return { error: ja ? "文字で入力してください" : "Must be text" };
      const max = field.type === "text" ? TEXT_MAX : TEXTAREA_MAX;
      if (raw.length > max) return { error: ja ? `${max} 文字までです` : `Up to ${max} characters` };
      if (field.type === "text" && /[\r\n]/.test(raw)) return { error: ja ? "改行は入れられません" : "No line breaks" };
      return { value: raw };
    }
    case "number":
    case "slider":
    case "count": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.normalize("NFKC").replace(/,/g, "")) : NaN;
      if (!Number.isFinite(n)) return { error: ja ? "数値で入力してください" : "Must be a number" };
      if (field.type === "count" && !Number.isInteger(n)) return { error: ja ? "整数で入力してください" : "Must be a whole number" };
      if (field.min !== undefined && n < field.min) return { error: ja ? `${field.min} 以上にしてください` : `Must be at least ${field.min}` };
      if (field.max !== undefined && n > field.max) return { error: ja ? `${field.max} 以下にしてください` : `Must be at most ${field.max}` };
      return { value: n };
    }
    case "choice": {
      const allowed = new Set(field.options!.map((o) => o.value));
      // 「その他」を受けるなら、選択肢に無い文（200 文字まで）を 1 つまで受ける
      const free = (v: unknown) => field.other === true && typeof v === "string" && v.trim() !== "" && v.length <= OTHER_MAX;
      if (field.multi) {
        if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string" && (allowed.has(v) || free(v)))) return { error: ja ? "選択肢から選んでください" : "Pick from the options" };
        if (raw.filter((v) => !allowed.has(v as string)).length > 1) return { error: ja ? "その他は 1 つまでです" : "Only one other answer" };
        return { value: [...new Set((raw as string[]).map((v) => (allowed.has(v) ? v : v.trim())))] };
      }
      if (typeof raw !== "string" || !(allowed.has(raw) || free(raw))) return { error: ja ? "選択肢から選んでください" : "Pick from the options" };
      return { value: allowed.has(raw) ? raw : raw.trim() };
    }
    case "rating": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > (field.max ?? 5)) return { error: ja ? `1〜${field.max ?? 5} で選んでください` : `Pick 1 to ${field.max ?? 5}` };
      return { value: n };
    }
    case "daterange": {
      const m = typeof raw === "string" ? /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/.exec(raw) : null;
      if (!m || !validDate(m[1]!, false) || !validDate(m[2]!, false)) return { error: ja ? "期間が正しくありません" : "Invalid date range" };
      if (m[1]! > m[2]!) return { error: ja ? "終わりの日を始まりの日以降にしてください" : "End must be on or after start" };
      return { value: raw as string };
    }
    case "date":
    case "month":
      if (typeof raw !== "string" || !validDate(raw, field.type === "month")) return { error: ja ? "日付が正しくありません" : "Invalid date" };
      return { value: raw };
    case "toggle":
      if (typeof raw !== "boolean") return { error: ja ? "オンかオフにしてください" : "Must be on or off" };
      return { value: raw };
  }
}

export interface AppCheck {
  ok: boolean;
  /** 実行先に渡す値（その機能の部品だけ。空の任意項目は含めない）。 */
  values: AppValues;
  /** 部品の key ごとの誤り。 */
  errors: Record<string, string>;
}

/** ボタンが送る値を検証する（その機能の部品だけを見て、他の key は捨てる）。 */
export function validateAppValues(f: AppFigure, actionId: string, input: Record<string, unknown>, locale = "ja-JP"): AppCheck {
  const ja = locale.toLowerCase().startsWith("ja");
  const found = findAction(f, actionId);
  if (!found) return { ok: false, values: {}, errors: { "": ja ? "ボタンが見つかりません" : "Unknown action" } };
  const values: AppValues = {};
  const errors: Record<string, string> = {};
  for (const field of found.section.fields) {
    const r = checkField(field, input[field.key], ja);
    if (r.error) errors[field.key] = r.error;
    else if (r.value !== undefined) values[field.key] = r.value;
  }
  return { ok: Object.keys(errors).length === 0, values, errors };
}

/** 確認の画面・会話に送る文に出す、値の表示（選択肢は表示名、オンオフは文字）。 */
export function displayValue(field: AppField, v: AppValue | undefined, ja = true): string {
  if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return "—";
  if (field.type === "choice") {
    const name = (x: string) => field.options!.find((o) => o.value === x)?.label ?? x;
    return Array.isArray(v) ? v.map(name).join("、") : name(String(v));
  }
  if (field.type === "toggle") return v ? (ja ? "オン" : "On") : ja ? "オフ" : "Off";
  if (field.type === "rating") return `${"★".repeat(Number(v))}${"☆".repeat(Math.max(0, (field.max ?? 5) - Number(v)))}`;
  if (field.type === "daterange") return String(v).replace("/", " 〜 ");
  if (typeof v === "number") return `${new Intl.NumberFormat(ja ? "ja-JP" : "en-US", { maximumFractionDigits: 6 }).format(v)}${field.unit ? (/^[A-Za-z]/.test(field.unit) ? ` ${field.unit}` : field.unit) : ""}`;
  return String(v);
}

// ---------------------------------------------------------------- 操作を持つ種類に共通（app・ask・plan）

/** 自由記述（ask の自由記述・plan の修正の依頼）の上限。 */
export const FREE_MAX = 2000;

/** 図のボタン（ホストが束縛を作る対象）。ask・plan は会話に送るボタンだけ。 */
export function figureActions(f: Figure): AppAction[] {
  switch (f.kind) {
    case "app":
      return f.sections.flatMap((s) => s.actions);
    case "ask":
      return f.questions.length ? [{ id: "a1", label: f.submitLabel ?? "回答する", target: { kind: "chat" }, confirm: false }] : [];
    case "plan":
      return [
        { id: "approve", label: f.approveLabel ?? "この計画で進める", target: { kind: "chat" }, confirm: false },
        ...(f.revise ? [{ id: "revise", label: "修正を依頼", target: { kind: "chat" as const }, confirm: false }] : []),
      ];
    default:
      return [];
  }
}

/** ask の回答の検証。選択肢のある質問は選択肢から（その他を受けるなら自由記述も）、無い質問は自由記述。 */
export function checkAnswer(q: AskQuestion, raw: unknown, ja = true): { value?: AppValue; error?: string } {
  if (isEmpty(raw)) return q.required ? { error: ja ? "回答してください" : "Required" } : {};
  const labels = new Set(q.options.map((o) => o.label));
  const okText = (v: unknown) => typeof v === "string" && v.trim() !== "" && v.length <= FREE_MAX && (labels.has(v) || q.other || q.options.length === 0);
  if (q.options.length === 0) return okText(raw) ? { value: (raw as string).trim() } : { error: ja ? `${FREE_MAX} 文字までの文字で回答してください` : "Invalid answer" };
  if (q.multi) {
    if (!Array.isArray(raw) || !raw.every(okText)) return { error: ja ? "選択肢から選んでください" : "Pick from the options" };
    // その他の自由記述は 1 つまで
    if (raw.filter((v) => !labels.has(v as string)).length > 1) return { error: ja ? "その他は 1 つまでです" : "Only one other answer" };
    return { value: [...new Set((raw as string[]).map((v) => v.trim()))] };
  }
  return okText(raw) ? { value: (raw as string).trim() } : { error: ja ? "選択肢から選んでください" : "Pick from the options" };
}

/**
 * 図のボタンが送る値を検証する（app・ask・plan）。ホストのサーバーは同じ規則で検証し直す。
 * - app: そのボタンの機能の部品
 * - ask: 質問ごとの回答（key は q1・q2…）
 * - plan: approve は値なし、revise は comment（必須・2000 文字まで）
 */
export function validateActionValues(f: Figure, actionId: string, input: Record<string, unknown>, locale = "ja-JP"): AppCheck {
  const ja = locale.toLowerCase().startsWith("ja");
  const unknown: AppCheck = { ok: false, values: {}, errors: { "": ja ? "ボタンが見つかりません" : "Unknown action" } };
  if (!figureActions(f).some((a) => a.id === actionId)) return unknown;
  if (f.kind === "app") return validateAppValues(f, actionId, input, locale);
  const values: AppValues = {};
  const errors: Record<string, string> = {};
  if (f.kind === "ask") {
    for (const q of f.questions) {
      const r = checkAnswer(q, input[q.id], ja);
      if (r.error) errors[q.id] = r.error;
      else if (r.value !== undefined) values[q.id] = r.value;
    }
  } else if (f.kind === "plan" && actionId === "revise") {
    const c = input.comment;
    if (typeof c !== "string" || c.trim() === "") errors.comment = ja ? "修正してほしい点を書いてください" : "Describe the change";
    else if (c.length > FREE_MAX) errors.comment = ja ? `${FREE_MAX} 文字までです` : `Up to ${FREE_MAX} characters`;
    else values.comment = c.trim();
  }
  return { ok: Object.keys(errors).length === 0, values, errors };
}
