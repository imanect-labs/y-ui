/**
 * app のチェッカー（docs/editor.md §4.2・§5）。型チェッカーのように、どの部品のどの設定が
 * なぜ駄目かを、場所つきの文で返す。
 *
 * 見るのは 3 つ。
 * 1. 記法で書けるか（区切りの文字・予約語・範囲の片側だけ・見出しの無い機能など）。
 * 2. 実行先の約束（ホストが渡したワークフロー名だけ・会話に送れるか・入力の名前と型）。
 * 3. 最後に `parseBlock(toSource(f))` が f に戻るか。1 で拾えない組み合わせもここで必ず捕まえる。
 *
 * error は保存すると内容が変わる・実行できないもの（ホストは保存を止める）。warning は保存できるが
 * 意図と違うかもしれないもの。
 */

import type { AppAction, AppField, AppFigure, AppSection, Diagnostic } from "../ir.js";
import { LIMITS } from "../lines.js";
import { parseBlock } from "../parse.js";
import { toSource } from "../text.js";

/** 問題の場所。section だけなら機能、field / action があればその部品・ボタン。何も無ければ図全体。 */
export interface ProblemPath {
  section?: number;
  field?: number;
  action?: number;
  /** 設定の名前（"label"・"options" など）。入力欄の横に出すため。 */
  prop?: string;
}

export interface Problem {
  severity: "error" | "warning";
  code: string;
  message: string;
  path: ProblemPath;
}

/** ワークフローの入力の手がかり（ホストが入力のスキーマから作る）。 */
export interface WorkflowInputHint {
  key: string;
  label?: string;
  type?: AppField["type"];
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
}

export interface WorkflowChoice {
  name: string;
  inputs?: WorkflowInputHint[];
}

export interface CheckContext {
  /** ボタンの実行先に選べるワークフロー（閉じた集合）。既定は空で、どのワークフローも選べない（閉じた側に倒す）。 */
  workflows?: readonly WorkflowChoice[];
  /** `-> chat` を使えるか（既定 false）。 */
  allowChat?: boolean;
  locale?: string;
}

/** 部品の文字に紛れると、オプションとして読まれてしまう単語（空白で区切られたとき）。 */
const RESERVED = ["必須", "required", "multi", "複数", "other", "その他を受ける", "例", "e.g.", "placeholder", "初期", "初期値", "initial", "default", "step", "刻み"];
const RESERVED_RE = new RegExp(`(?:^|\\s)(${RESERVED.map((w) => w.replace(/\./g, "\\.")).join("|")})(?=\\s|$)`, "i");
/** パーサが送る名前の指定（`as キー`）として読む形（kinds/app.ts の KEY と同じ）。 */
const AS_RE = /(?:^|\s)as\s+[A-Za-z_][\w.-]{0,63}(?=\s|$)/;
const KEY_RE = /^[A-Za-z_][\w.-]{0,63}$/;
const BAD_TARGET = /[:/\\<>"'`{}]/;
const ARROW = /->|→|=>/;
/**
 * 改行になる文字。Yui は \n だけで行を分けるが、Markdown（CommonMark）は \r 単独でも行を分けるため、
 * \r などが混ざると Yui と Markdown の描画で読み方がずれる（ブロックの途中でフェンスが閉じたように見える）。
 */
const BREAK = /[\r\n\u2028\u2029\u0085]/;

export function checkApp(f: AppFigure, ctx: CheckContext = {}): Problem[] {
  const ja = (ctx.locale ?? "ja").toLowerCase().startsWith("ja");
  const t = (j: string, e: string) => (ja ? j : e);
  const out: Problem[] = [];
  const add = (severity: Problem["severity"], code: string, message: string, path: ProblemPath) => out.push({ severity, code, message, path });

  // ---- 図全体
  if (BREAK.test(f.title)) add("error", "newline", t("見出しに改行は入れられません", "The title can't contain a line break"), { prop: "title" });
  if (/\[\d+\]\s*$/.test(f.title)) add("error", "title_ref", t("見出しの末尾の [数字] は引用番号として読まれます", "A trailing [number] in the title is read as a citation"), { prop: "title" });
  if (f.note !== undefined && BREAK.test(f.note)) add("error", "newline", t("注記に改行は入れられません", "The note can't contain a line break"), { prop: "note" });
  if (f.sections.length > LIMITS.appSections) add("error", "limit", t(`機能は ${LIMITS.appSections} 個までです`, `Up to ${LIMITS.appSections} sections`), {});
  const total = f.sections.reduce((n, s) => n + s.fields.length, 0);
  if (total > LIMITS.appFields) add("error", "limit", t(`入力は全体で ${LIMITS.appFields} 個までです`, `Up to ${LIMITS.appFields} inputs in total`), {});
  // 何も置いていない画面は保存できない（ホストは保存を止める）。エディタはエラーでなく始め方の案内として見せる
  if (total === 0 && f.sections.every((s) => s.actions.length === 0)) {
    add("error", "empty", t("入力かボタンを 1 つ以上置いてください", "Add at least one input or button"), {});
    return out;
  }

  f.sections.forEach((s, si) => checkSection(f, s, si, ctx, t, add));

  // ---- 書いて読み直す（ここまでで拾えなかった組み合わせを必ず捕まえる）
  if (!out.some((p) => p.severity === "error")) roundTrip(f, t, add);
  return out;
}

type T = (j: string, e: string) => string;
type Add = (severity: Problem["severity"], code: string, message: string, path: ProblemPath) => void;

function checkSection(f: AppFigure, s: AppSection, si: number, ctx: CheckContext, t: T, add: Add): void {
  const at = { section: si };
  if (f.sections.length > 1 && !s.title?.trim()) add("error", "section_title", t("機能が 2 つ以上あるときは、それぞれに見出しが要ります（見出しが機能の区切りになるため）", "Each section needs a title when there are two or more (titles separate the sections)"), { ...at, prop: "title" });
  if (s.title && BREAK.test(s.title)) add("error", "newline", t("機能の見出しに改行は入れられません", "Section titles can't contain line breaks"), { ...at, prop: "title" });
  if (s.desc && /[\r\u2028\u2029\u0085]/.test(s.desc)) add("error", "newline", t("説明の改行は普通の改行だけにしてください", "Use plain line breaks in the description"), { ...at, prop: "desc" });
  if (s.title && s.title.length > LIMITS.appLabel) add("error", "too_long", t(`機能の見出しは ${LIMITS.appLabel} 文字までです`, `Up to ${LIMITS.appLabel} characters`), { ...at, prop: "title" });
  if (s.fields.length === 0 && s.actions.length === 0) add("error", "empty_section", t("入力もボタンも無い機能です。入力かボタンを置くか、この機能を消してください（このまま保存すると機能ごと消えます）", "This section has no inputs or buttons; add some or delete it (it would be dropped on save)"), at);
  if (s.fields.length > LIMITS.appSectionFields) add("error", "limit", t(`1 つの機能の入力は ${LIMITS.appSectionFields} 個までです`, `Up to ${LIMITS.appSectionFields} inputs per section`), at);
  if (s.actions.length > LIMITS.appSectionActions) add("error", "limit", t(`1 つの機能のボタンは ${LIMITS.appSectionActions} 個までです`, `Up to ${LIMITS.appSectionActions} buttons per section`), at);
  if (s.fields.length > 0 && s.actions.length === 0) add("warning", "no_action", t("ボタンがありません。入力した値を送る先が無い機能です", "No button: the values in this section aren't sent anywhere"), at);

  const keys = new Map<string, number>();
  s.fields.forEach((x, fi) => {
    const prev = keys.get(x.key);
    if (prev !== undefined) add("error", "duplicate_key", t(`「${x.key}」は同じ機能の ${prev + 1} 番目の入力と重なっています（名前は機能の中で 1 つずつ）`, `"${x.key}" is already used by input ${prev + 1} in this section`), { ...at, field: fi, prop: x.key === x.label ? "label" : "key" });
    else keys.set(x.key, fi);
    checkField(x, { ...at, field: fi }, t, add);
  });
  s.actions.forEach((a, ai) => checkAction(a, { ...at, action: ai }, ctx, t, add));
  checkInputs(s, si, ctx, t, add);
}

function checkField(x: AppField, at: ProblemPath, t: T, add: Add): void {
  const label = x.label;
  if (!label.trim()) add("error", "empty_label", t("ラベルを入れてください", "Enter a label"), { ...at, prop: "label" });
  else if (BREAK.test(label)) add("error", "newline", t("ラベルに改行は入れられません", "Labels can't contain line breaks"), { ...at, prop: "label" });
  else {
    if (label !== label.trim()) add("error", "spaces", t("ラベルの前後に空白は入れられません", "Remove spaces around the label"), { ...at, prop: "label" });
    if (label.length > LIMITS.appLabel) add("error", "too_long", t(`ラベルは ${LIMITS.appLabel} 文字までです（いま ${label.length} 文字）`, `Up to ${LIMITS.appLabel} characters (now ${label.length})`), { ...at, prop: "label" });
    if (/[=＝]/.test(label)) add("error", "label_char", t("ラベルに「=」は使えません（ラベルと種類の区切りのため）", 'Labels can\'t contain "=" (it separates the label from the type)'), { ...at, prop: "label" });
    if (/^(?:(?:[-*+・•]|\d{1,3}[.)])\s|#{1,6}(?:\s|$)|>)/.test(label)) add("error", "label_start", t("ラベルを「-」「#」「>」「1.」などで始めると、箇条書き・見出し・説明として読まれます", 'Labels starting with "-", "#", ">" or "1." are read as list, heading or description'), { ...at, prop: "label" });
    if (/^(?:note|注記|注|src|source|出典)\s*[:：]/i.test(label)) add("error", "label_start", t("ラベルを「note:」「注記:」などで始めると、注記・出典の行として読まれます", 'Labels starting with "note:" are read as the note line'), { ...at, prop: "label" });
    if (/^(?:button|ボタン)\s/i.test(label)) add("error", "label_start", t("ラベルを「button」で始めると、ボタンとして読まれます", 'Labels starting with "button" are read as a button'), { ...at, prop: "label" });
    if (label.normalize("NFKC") !== label) add("error", "label_width", t(`ラベルの全角の英数字・記号は半角で保存されます（「${label.normalize("NFKC")}」）`, `Full-width characters are saved as half-width ("${label.normalize("NFKC")}")`), { ...at, prop: "label" });
  }
  if (x.key !== x.label && !KEY_RE.test(x.key)) add("error", "key_format", t("送る名前（key）は英字か _ で始まる英数字・_・.・- の 64 文字までです。ラベルと同じにするなら空にしてください", "The key must start with a letter or _ and use letters, digits, _ . - (up to 64)"), { ...at, prop: "key" });

  if (x.placeholder !== undefined && !(x.type === "text" || x.type === "textarea" || x.type === "number")) add("error", "no_placeholder", t("この種類の部品には入力の例を付けられません", "This input type has no placeholder"), { ...at, prop: "placeholder" });
  for (const prop of ["placeholder", "unit"] as const) {
    const v = x[prop];
    if (v === undefined) continue;
    const name = prop === "placeholder" ? t("入力の例", "Placeholder") : t("単位", "Unit");
    if (v !== v.trim()) add("error", "spaces", t(`${name}の前後の空白は保存されません。外してください`, `Spaces around the ${name} aren't saved`), { ...at, prop });
    if (BREAK.test(v)) add("error", "newline", t(`${name}に改行は入れられません`, `${name} can't contain a line break`), { ...at, prop });
    const m = RESERVED_RE.exec(v);
    if (m) add("error", "reserved_word", t(`${name}の「${m[1]}」は設定の言葉として読まれます。言い換えるか、前後の空白を外してください`, `"${m[1]}" in ${name} is read as a setting word`), { ...at, prop });
    if (AS_RE.test(v)) add("error", "reserved_word", t(`${name}の「as …」は送る名前の指定として読まれます`, `"as …" in ${name} is read as the key`), { ...at, prop });
    if (v.length > LIMITS.textLength) add("error", "too_long", t(`${name}は ${LIMITS.textLength} 文字までです`, `Up to ${LIMITS.textLength} characters`), { ...at, prop });
  }
  if (x.unit !== undefined && /^\s*(?:-?\d|\.\.|[〜~～])/.test(x.unit)) add("error", "unit_number", t("単位を数字や「..」「〜」で始めると、範囲や値として読まれます", "A unit starting with a digit or \"..\" is read as a range or value"), { ...at, prop: "unit" });

  const numeric = x.type === "number" || x.type === "slider" || x.type === "count";
  if (numeric) {
    if ((x.min === undefined) !== (x.max === undefined)) add("error", "half_range", t("最小と最大は両方入れるか、両方空にしてください（片側だけは書けません）", "Set both min and max, or neither"), { ...at, prop: x.min === undefined ? "min" : "max" });
    if ((x.type === "slider" || x.type === "count") && (x.min === undefined || x.max === undefined)) add("error", "need_range", t("スライダー・数の増減には最小と最大が要ります", "Sliders and counters need min and max"), { ...at, prop: "min" });
    if (x.min !== undefined && x.max !== undefined && x.min > x.max) add("error", "range_order", t("最小が最大より大きくなっています", "Min is greater than max"), { ...at, prop: "min" });
    if (x.step !== undefined && !(x.step > 0)) add("error", "step", t("刻みは 0 より大きい数にしてください", "Step must be greater than 0"), { ...at, prop: "step" });
    if (typeof x.initial === "number" && x.min !== undefined && x.max !== undefined && (x.initial < x.min || x.initial > x.max)) add("warning", "initial_range", t("初期値が範囲の外です", "Initial value is outside the range"), { ...at, prop: "initial" });
  }
  if (x.type === "rating" && (x.max === undefined || x.max < 2 || x.max > 10)) add("error", "rating_max", t("評価の段階は 2〜10 です", "Rating must be 2–10"), { ...at, prop: "max" });
  if (x.type === "choice") checkOptions(x, at, t, add);
  if (typeof x.initial === "string" && x.initial !== x.initial.trim()) add("error", "spaces", t("初期値の前後の空白は保存されません。外してください", "Spaces around the initial value aren't saved"), { ...at, prop: "initial" });
  if (typeof x.initial === "string" && (BREAK.test(x.initial) || RESERVED_RE.test(x.initial))) add("error", "reserved_word", t("初期値に改行や設定の言葉（必須・例 など）は入れられません", "Initial value can't contain line breaks or setting words"), { ...at, prop: "initial" });
}

function checkOptions(x: AppField, at: ProblemPath, t: T, add: Add): void {
  const opts = x.options ?? [];
  const p = { ...at, prop: "options" };
  if (opts.length < 2) add("error", "options_few", t("選択肢は 2 つ以上要ります", "Add at least 2 options"), p);
  if (opts.length > 20) add("error", "limit", t("選択肢は 20 個までです", "Up to 20 options"), p);
  const seen = new Set<string>();
  opts.forEach((o, i) => {
    const n = t(`${i + 1} 番目の選択肢`, `Option ${i + 1}`);
    if (!o.label.trim() || !o.value.trim()) add("error", "option_empty", t(`${n}が空です`, `${n} is empty`), p);
    else if (BREAK.test(o.label) || BREAK.test(o.value)) add("error", "newline", t(`${n}に改行は入れられません`, `${n} can't contain line breaks`), p);
    else if (o.label !== o.label.trim() || o.value !== o.value.trim()) add("error", "spaces", t(`${n}の前後に空白は入れられません`, `Remove spaces around ${n}`), p);
    if (/[=＝]/.test(o.label) || /[=＝]/.test(o.value)) add("error", "option_char", t(`${n}に「=」は使えません（表示名と値の区切りのため）`, `${n} can't contain "="`), p);
    if (/[,、]/.test(o.value) && x.initial !== undefined) add("error", "option_char", t(`${n}に「,」「、」があると初期値に選べません`, `${n} with "," can't be the initial value`), p);
    if (/^(その他|other)$/i.test(o.value.trim())) add("error", "option_other", t(`「${o.value}」は選択肢でなく「その他も受ける」の設定になります。設定のほうを使ってください`, `"${o.value}" is read as the "Other" setting`), p);
    // 書いたときの形（表示名と値が同じなら値だけ、違えば `表示名=値`）で、設定の言葉として読まれるかを見る
    const written = o.label === o.value ? o.value : `${o.label}=${o.value}`;
    if (RESERVED_RE.test(written) || AS_RE.test(written)) add("error", "reserved_word", t(`${n}に設定の言葉（必須・multi など）は入れられません`, `${n} can't contain setting words`), p);
    if (o.label.length > LIMITS.appLabel) add("error", "too_long", t(`${n}は ${LIMITS.appLabel} 文字までです`, `${n}: up to ${LIMITS.appLabel} characters`), p);
    if (seen.has(o.value)) add("error", "option_dup", t(`${n}が前の選択肢と重なっています`, `${n} duplicates another option`), p);
    seen.add(o.value);
  });
}

function checkAction(a: AppAction, at: ProblemPath, ctx: CheckContext, t: T, add: Add): void {
  if (!a.label.trim()) add("error", "empty_label", t("ボタンの文言を入れてください", "Enter the button text"), { ...at, prop: "label" });
  else if (a.label !== a.label.trim()) add("error", "spaces", t("ボタンの文言の前後に空白は入れられません", "Remove spaces around the button text"), { ...at, prop: "label" });
  if (ARROW.test(a.label)) add("error", "label_char", t("ボタンの文言に「->」「→」「=>」は使えません（実行先の区切りのため）", 'Button text can\'t contain "->"'), { ...at, prop: "label" });
  if (a.label.length > LIMITS.appLabel) add("error", "too_long", t(`ボタンの文言は ${LIMITS.appLabel} 文字までです`, `Up to ${LIMITS.appLabel} characters`), { ...at, prop: "label" });
  if (BREAK.test(a.label)) add("error", "newline", t("ボタンの文言に改行は入れられません", "Button text can't contain line breaks"), { ...at, prop: "label" });
  const p = { ...at, prop: "target" };
  if (a.target.kind === "chat") {
    if (ctx.allowChat !== true) add("error", "chat_not_allowed", t("この場所では「会話に送る」ボタンは使えません。ワークフローを選んでください", "Sending to the chat isn't available here; pick a workflow"), p);
    return;
  }
  const name = a.target.name;
  if (!name.trim()) add("error", "no_target", t("実行するワークフローを選んでください", "Pick a workflow to run"), p);
  else if (BAD_TARGET.test(name) || name.length > 64 || name !== name.trim()) add("error", "target_char", t("ワークフローの名前に使えない文字があります", "The workflow name has characters that can't be used"), p);
  else if (!(ctx.workflows ?? []).some((w) => w.name === name)) add("error", "unknown_workflow", t(`「${name}」は選べるワークフローにありません`, `"${name}" isn't one of the available workflows`), p);
}

/** ボタンの実行先の入力（ホストが分かっているとき）と、その機能の部品の突き合わせ。 */
function checkInputs(s: AppSection, si: number, ctx: CheckContext, t: T, add: Add): void {
  if (!ctx.workflows?.length) return;
  const names = new Set(s.actions.flatMap((a) => (a.target.kind === "workflow" ? [a.target.name] : [])));
  for (const name of names) {
    const inputs = ctx.workflows.find((w) => w.name === name)?.inputs;
    if (!inputs) continue;
    const ai = s.actions.findIndex((a) => a.target.kind === "workflow" && a.target.name === name);
    for (const inp of inputs) {
      const fi = s.fields.findIndex((x) => x.key === inp.key);
      if (fi < 0) {
        if (inp.required) add("warning", "missing_input", t(`「${name}」の必須の入力「${inp.label ?? inp.key}」（${inp.key}）に当たる部品がありません`, `No input for the required "${inp.key}" of "${name}"`), { section: si, action: ai });
        continue;
      }
      const x = s.fields[fi]!;
      if (inp.type && !compatible(inp.type, x.type)) add("warning", "input_type", t(`「${name}」の「${inp.key}」は${typeName(inp.type, t)}を受けます（この部品は${typeName(x.type, t)}）`, `"${inp.key}" of "${name}" expects ${inp.type} (this is ${x.type})`), { section: si, field: fi, prop: "type" });
      if (inp.required && !x.required) add("warning", "input_required", t(`「${name}」では必須の入力です。「必須」にしてください`, `Required by "${name}"; mark it required`), { section: si, field: fi, prop: "required" });
    }
    for (const [fi, x] of s.fields.entries()) {
      if (!inputs.some((i) => i.key === x.key)) add("warning", "unknown_input", t(`「${name}」に「${x.key}」という入力はありません（送っても使われないか、断られます）`, `"${name}" has no input "${x.key}"`), { section: si, field: fi, prop: x.key === x.label ? "label" : "key" });
    }
  }
}

function compatible(want: AppField["type"], have: AppField["type"]): boolean {
  const group = (x: AppField["type"]) => (x === "number" || x === "slider" || x === "count" || x === "rating" ? "num" : x === "text" || x === "textarea" ? "text" : x);
  return group(want) === group(have);
}

function typeName(x: AppField["type"], t: T): string {
  const ja: Record<AppField["type"], string> = { text: "文字", textarea: "文章", number: "数値", slider: "数値", count: "数", choice: "選択", date: "日付", daterange: "期間", month: "年月", toggle: "オン・オフ", rating: "評価" };
  return t(ja[x], x);
}

/** 書いて読み直し、変わった場所を言う。 */
function roundTrip(f: AppFigure, t: T, add: Add): void {
  const back = parseBlock(toSource(f), { final: true }).figure;
  if (!back || back.kind !== "app") {
    add("error", "round_trip", t("この図はソースに書くと読めなくなります", "This figure can't be read back after saving"), {});
    return;
  }
  if (back.title !== f.title) add("error", "round_trip", t(`見出しが「${back.title}」として保存されます`, `The title is saved as "${back.title}"`), { prop: "title" });
  if ((back.note ?? "") !== (f.note ?? "")) add("error", "round_trip", t("注記が変わって保存されます", "The note changes when saved"), { prop: "note" });
  if (back.sections.length !== f.sections.length) {
    add("error", "round_trip", t(`機能が ${f.sections.length} 個から ${back.sections.length} 個に変わって保存されます`, `Sections change from ${f.sections.length} to ${back.sections.length} when saved`), {});
    return;
  }
  f.sections.forEach((s, si) => {
    const b = back.sections[si]!;
    if ((b.title ?? "") !== (s.title ?? "") || (b.desc ?? "") !== (s.desc ?? "")) add("error", "round_trip", t("機能の見出しか説明が変わって保存されます", "The section title or description changes when saved"), { section: si, prop: "title" });
    if (b.fields.length !== s.fields.length) add("error", "round_trip", t(`この機能の入力が ${s.fields.length} 個から ${b.fields.length} 個に変わって保存されます`, `Inputs change from ${s.fields.length} to ${b.fields.length} when saved`), { section: si });
    else
      s.fields.forEach((x, fi) => {
        const diff = firstDiff(x as unknown as Record<string, unknown>, b.fields[fi] as unknown as Record<string, unknown>);
        if (diff) add("error", "round_trip", t(`保存すると「${PROP_JA[diff] ?? diff}」が変わります（${show(x, diff)} → ${show(b.fields[fi]!, diff)}）`, `"${diff}" changes when saved`), { section: si, field: fi, prop: diff });
      });
    if (b.actions.length !== s.actions.length) add("error", "round_trip", t("この機能のボタンの数が変わって保存されます", "The number of buttons changes when saved"), { section: si });
    else
      s.actions.forEach((a, ai) => {
        const diff = firstDiff(a as unknown as Record<string, unknown>, b.actions[ai] as unknown as Record<string, unknown>);
        if (diff) add("error", "round_trip", t(`保存するとボタンの「${PROP_JA[diff] ?? diff}」が変わります`, `The button's "${diff}" changes when saved`), { section: si, action: ai, prop: diff === "label" ? "label" : "target" });
      });
  });
}

const PROP_JA: Record<string, string> = { key: "送る名前", label: "ラベル", type: "種類", required: "必須", placeholder: "入力の例", initial: "初期値", min: "最小", max: "最大", step: "刻み", unit: "単位", options: "選択肢", multi: "複数選択", other: "その他", target: "実行先", confirm: "確認" };

function firstDiff(a: Record<string, unknown>, b: Record<string, unknown>): string | null {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === "id") continue;
    if (!same(a[k], b[k])) return k;
  }
  return null;
}

/** 値が同じか（キーの順は問わない。undefined は無いのと同じ）。 */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((v, i) => same(v, (b as unknown[])[i]));
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) if (!same(ra[k], rb[k])) return false;
  return true;
}

function show(x: AppField, k: string): string {
  const v = (x as unknown as Record<string, unknown>)[k];
  if (v === undefined) return "なし";
  if (Array.isArray(v)) return v.map((o) => (typeof o === "object" && o ? (o as { label: string }).label : String(o))).join(" | ");
  return String(v);
}

/** エラーがあるか（ホストは保存を止める）。 */
export function hasErrors(problems: readonly Problem[]): boolean {
  return problems.some((p) => p.severity === "error");
}

/** ある場所（部品・ボタン・機能）の問題だけ。prop を渡すとその設定の問題だけ。 */
export function problemsAt(problems: readonly Problem[], at: ProblemPath): Problem[] {
  return problems.filter((p) => p.path.section === at.section && p.path.field === at.field && p.path.action === at.action && (at.prop === undefined || p.path.prop === at.prop));
}

// ---------------------------------------------------------------- ソースから開く

export type Editable = { ok: true; figure: AppFigure } | { ok: false; diagnostics: Diagnostic[]; reason: "not_app" | "diagnostics" | "round_trip" };

/**
 * ソース（```ui の中身）をエディタで開けるか。診断が 1 つでもあれば開かない
 * （黙って正規化すると、読めなかった行を落としてしまうため）。行の番号つきで理由を返す。
 */
export function checkEditable(source: string, kindHint?: "app"): Editable {
  const r = parseBlock(source, { final: true, ...(kindHint ? { kind: kindHint } : {}) });
  if (!r.figure || r.figure.kind !== "app") return { ok: false, diagnostics: r.diagnostics, reason: "not_app" };
  if (r.diagnostics.length) return { ok: false, diagnostics: r.diagnostics, reason: "diagnostics" };
  const again = parseBlock(toSource(r.figure), { final: true }).figure;
  if (!same(again, r.figure)) return { ok: false, diagnostics: [], reason: "round_trip" };
  return { ok: true, figure: r.figure };
}
