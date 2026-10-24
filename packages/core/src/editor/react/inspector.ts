/**
 * 設定パネル（docs/editor.md §4.4 の右側）。選んだ部品・ボタン・機能・図の設定を直す。
 * 入力欄の下に、その設定の問題（チェッカーの結果）をそのまま出す。
 */

import { createElement as h, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { AppAction, AppField, AppFigure } from "../../ir.js";
import type { paint } from "../../render/theme.js";
import { problemsAt, type Problem, type ProblemPath, type WorkflowChoice } from "../check.js";
import { changeType, FIELD_TYPES, type FieldType } from "../model.js";

export type Selection = { kind: "app" } | { kind: "section"; section: number } | { kind: "field"; section: number; index: number } | { kind: "action"; section: number; index: number };

export type Paint = (t: Parameters<typeof paint>[0]) => string;

export interface InspectorProps {
  figure: AppFigure;
  sel: Selection;
  problems: Problem[];
  workflows: readonly WorkflowChoice[];
  allowChat: boolean;
  c: Paint;
  ja: boolean;
  /** その場所を書き換える（部品・ボタンなら patch、機能なら見出し・説明、図なら見出し・注記）。 */
  setField: (s: number, i: number, patch: Partial<AppField>) => void;
  setAction: (s: number, i: number, patch: Partial<Omit<AppAction, "id">>) => void;
  setSection: (s: number, patch: { title?: string; desc?: string }) => void;
  setApp: (patch: { title?: string; note?: string }) => void;
  remove: (sel: Selection) => void;
  move: (sel: Selection, delta: -1 | 1) => void;
  /** 入力欄に印を付ける（問題の一覧から飛ぶため）。 */
  focusProp?: string | null;
}

export const TYPE_LABEL: Record<FieldType, { ja: string; en: string }> = {
  text: { ja: "1 行の文字", en: "Text" },
  textarea: { ja: "複数行の文章", en: "Paragraph" },
  number: { ja: "数値", en: "Number" },
  choice: { ja: "選択", en: "Choice" },
  date: { ja: "日付", en: "Date" },
  month: { ja: "年月", en: "Month" },
  daterange: { ja: "期間", en: "Date range" },
  toggle: { ja: "オン・オフ", en: "Toggle" },
  slider: { ja: "スライダー", en: "Slider" },
  count: { ja: "数の増減", en: "Counter" },
  rating: { ja: "評価（★）", en: "Rating" },
};

export function Inspector(p: InspectorProps): ReactElement {
  const { sel, figure: f, ja } = p;
  const t = (j: string, e: string) => (ja ? j : e);
  if (sel.kind === "field") {
    const x = f.sections[sel.section]?.fields[sel.index];
    if (x) return h(FieldPanel, { ...p, x, s: sel.section, i: sel.index, t });
  }
  if (sel.kind === "action") {
    const a = f.sections[sel.section]?.actions[sel.index];
    if (a) return h(ActionPanel, { ...p, a, s: sel.section, i: sel.index, t });
  }
  if (sel.kind === "section") {
    const s = f.sections[sel.section];
    if (s) {
      const at: ProblemPath = { section: sel.section };
      return panel(p, t("機能", "Section"), [
        text(p, t("見出し", "Title"), s.title ?? "", (v) => p.setSection(sel.section, { title: v }), { ...at, prop: "title" }, { placeholder: t("例: 経費の申請", "e.g. Submit an expense") }),
        text(p, t("説明", "Description"), s.desc ?? "", (v) => p.setSection(sel.section, { desc: v }), { ...at, prop: "desc" }, { multiline: true, placeholder: t("入力の前に出す一言", "Shown above the inputs") }),
        issues(p, at, "own", true),
        footer(p, sel, f.sections.length, t),
      ]);
    }
  }
  return panel(p, t("画面", "Screen"), [
    text(p, t("見出し", "Title"), f.title, (v) => p.setApp({ title: v }), { prop: "title" }, { placeholder: t("例: 経費の処理", "e.g. Expenses") }),
    text(p, t("注記", "Note"), f.note ?? "", (v) => p.setApp({ note: v }), { prop: "note" }, { placeholder: t("画面の下に小さく出す一言", "Small note at the bottom") }),
    issues({ ...p, problems: p.problems.filter((x) => x.code !== "empty") }, {}, "own", true),
    h("p", { key: "hint", style: { margin: 0, fontSize: 12, lineHeight: 1.6, color: p.c("muted") } }, t("部品やボタンを押すと、ここで設定を直せます。", "Select an input or button to edit it here.")),
  ]);
}

type T = (j: string, e: string) => string;

function FieldPanel(p: InspectorProps & { x: AppField; s: number; i: number; t: T }): ReactElement {
  const { x, s, i, t, ja } = p;
  const at: ProblemPath = { section: s, field: i };
  const set = (patch: Partial<AppField>) => p.setField(s, i, patch);
  const numeric = x.type === "number" || x.type === "slider" || x.type === "count";
  const rows: ReactNode[] = [
    select(
      p,
      t("種類", "Type"),
      x.type,
      FIELD_TYPES.map((ty) => ({ value: ty, label: ja ? TYPE_LABEL[ty].ja : TYPE_LABEL[ty].en })),
      (v) => {
        const next = changeType(x, v as FieldType, ja);
        set(Object.fromEntries(Object.keys({ ...x, ...next }).map((k) => [k, (next as unknown as Record<string, unknown>)[k]])) as Partial<AppField>);
      },
      { ...at, prop: "type" },
    ),
    text(
      p,
      t("ラベル", "Label"),
      x.label,
      // key がラベルと同じなら、model の updateField が key も一緒に変える
      (v) => set({ label: v }),
      { ...at, prop: "label" },
      { normalize: true },
    ),
    text(p, t("送る名前（key）", "Key"), x.key === x.label ? "" : x.key, (v) => set({ key: v.trim() ? v.trim() : x.label }), { ...at, prop: "key" }, { placeholder: t("空ならラベルと同じ（英字で付けると実行先の入力名と合わせやすい）", "Empty = same as label"), mono: true }),
    check(p, t("必須にする", "Required"), x.required, (v) => set({ required: v }), { ...at, prop: "required" }),
  ];
  if (x.type === "text" || x.type === "textarea" || x.type === "number") rows.push(text(p, t("入力の例", "Placeholder"), x.placeholder ?? "", (v) => set({ placeholder: v || undefined }), { ...at, prop: "placeholder" }, { placeholder: x.type === "number" ? t("例: 1000", "e.g. 1000") : t("例: 4月 大阪出張の交通費", "e.g. Taxi to the airport") }));
  if (numeric)
    rows.push(
      h(
        "div",
        { key: "range", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } },
        num(p, t("最小", "Min"), x.min, (v) => set({ min: v }), { ...at, prop: "min" }),
        num(p, t("最大", "Max"), x.max, (v) => set({ max: v }), { ...at, prop: "max" }),
      ),
    );
  if (problemsAt(p.problems, { ...at, prop: "min" }).length + problemsAt(p.problems, { ...at, prop: "max" }).length) rows.push(issues(p, { ...at, prop: "min" }, "range-e1"), issues(p, { ...at, prop: "max" }, "range-e2"));
  if (x.type === "number" || x.type === "slider") rows.push(num(p, t("刻み", "Step"), x.step, (v) => set({ step: v }), { ...at, prop: "step" }));
  if (x.type === "number") rows.push(text(p, t("単位", "Unit"), x.unit ?? "", (v) => set({ unit: v || undefined }), { ...at, prop: "unit" }, { placeholder: t("例: 円", "e.g. USD") }));
  if (x.type === "rating")
    rows.push(
      select(
        p,
        t("段階", "Levels"),
        String(x.max ?? 5),
        Array.from({ length: 9 }, (_, k) => ({ value: String(k + 2), label: `${k + 2}` })),
        (v) => set({ max: Number(v), min: 1 }),
        { ...at, prop: "max" },
      ),
    );
  if (x.type === "choice") {
    rows.push(h(OptionsEditor, { key: "options", p, x, set, at, t }));
    rows.push(check(p, t("複数選べる", "Multiple"), x.multi === true, (v) => set({ multi: v || undefined, initial: undefined }), { ...at, prop: "multi" }));
    rows.push(check(p, t("「その他」の自由記述も受ける", "Accept “Other”"), x.other === true, (v) => set({ other: v || undefined }), { ...at, prop: "other" }));
  }
  rows.push(initialEditor(p, x, set, at, t));
  rows.push(footer(p, { kind: "field", section: s, index: i }, p.figure.sections[s]!.fields.length, t));
  return panel(p, ja ? `入力 · ${TYPE_LABEL[x.type].ja}` : `Input · ${TYPE_LABEL[x.type].en}`, rows);
}

function ActionPanel(p: InspectorProps & { a: AppAction; s: number; i: number; t: T }): ReactElement {
  const { a, s, i, t } = p;
  const at: ProblemPath = { section: s, action: i };
  const options = p.workflows.map((w) => ({ value: `w:${w.name}`, label: t(`ワークフロー「${w.name}」を起動`, `Run workflow “${w.name}”`) }));
  if (p.allowChat) options.push({ value: "chat", label: t("会話に送る", "Send to the chat") });
  const current = a.target.kind === "chat" ? "chat" : `w:${a.target.name}`;
  if (!options.some((o) => o.value === current)) options.unshift({ value: current, label: a.target.kind === "workflow" ? t(`「${a.target.name}」（選べない実行先）`, `“${a.target.name}” (unavailable)`) : t("会話に送る", "Send to the chat") });
  const rows: ReactNode[] = [
    text(p, t("ボタンの文言", "Button text"), a.label, (v) => p.setAction(s, i, { label: v }), { ...at, prop: "label" }, { normalize: false }),
    select(p, t("押したとき", "On press"), current, options, (v) => p.setAction(s, i, { target: v === "chat" ? { kind: "chat" } : { kind: "workflow", name: v.slice(2) }, confirm: v !== "chat" || a.confirm }), { ...at, prop: "target" }),
  ];
  if (a.target.kind === "chat") rows.push(check(p, t("送る前に確認する", "Confirm before sending"), a.confirm, (v) => p.setAction(s, i, { confirm: v }), { ...at, prop: "confirm" }));
  else rows.push(h("p", { key: "confirm", style: { margin: 0, fontSize: 12, lineHeight: 1.6, color: p.c("muted") } }, t("ワークフローは、押した後に実行先と送る値を確かめる画面を必ず挟みます。", "Workflows always ask for confirmation before running.")));
  rows.push(issues(p, at, "own", true));
  rows.push(footer(p, { kind: "action", section: s, index: i }, p.figure.sections[s]!.actions.length, t));
  return panel(p, t("ボタン", "Button"), rows);
}

// ---------------------------------------------------------------- 選択肢

function OptionsEditor({ p, x, set, at, t }: { p: InspectorProps; x: AppField; set: (patch: Partial<AppField>) => void; at: ProblemPath; t: T }): ReactElement {
  const opts = x.options ?? [];
  // 初期値は、まだ選択肢にある値だけ残す（並べ替え・ほかの選択肢の名前を変えただけでは消さない）
  const put = (next: { label: string; value: string }[]) => {
    const values = new Set(next.map((o) => o.value));
    const init = x.initial;
    const keep = Array.isArray(init) ? init.filter((v) => values.has(v)) : typeof init === "string" && values.has(init) ? init : undefined;
    set({ options: next, initial: Array.isArray(keep) && keep.length === 0 ? undefined : keep });
  };
  // 値が表示名に付いてくるのは、打ち始めたときに両方が同じだった選択肢だけ（`表示名=値` の値を、打つ途中で書き換えない）
  const linked = useRef<Map<number, boolean>>(new Map());
  return h(
    "div",
    { style: { display: "grid", gap: 6 } },
    h("div", { className: "ye-label" }, t("選択肢", "Options")),
    ...opts.map((o, k) =>
      h(
        "div",
        { key: k, style: { display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 4, alignItems: "center" } },
        h("input", {
          className: "ye-input",
          value: o.label,
          "aria-label": t(`${k + 1} 番目の選択肢`, `Option ${k + 1}`),
          onFocus: () => linked.current.set(k, o.label === o.value),
          onBlur: () => linked.current.delete(k),
          onChange: (e: { currentTarget: HTMLInputElement }) => {
            const v = e.currentTarget.value;
            const follow = linked.current.get(k) ?? o.label === o.value;
            put(opts.map((y, j) => (j === k ? { label: v, value: follow ? v : y.value } : y)));
          },
        }),
        h("button", { type: "button", className: "ye-icon-btn", disabled: k === 0, "aria-label": t("上へ", "Move up"), onClick: () => put(swap(opts, k, k - 1)) }, "↑"),
        h("button", { type: "button", className: "ye-icon-btn", disabled: k === opts.length - 1, "aria-label": t("下へ", "Move down"), onClick: () => put(swap(opts, k, k + 1)) }, "↓"),
        h("button", { type: "button", className: "ye-icon-btn", "aria-label": t(`「${o.label}」を消す`, `Remove “${o.label}”`), onClick: () => put(opts.filter((_, j) => j !== k)) }, "×"),
      ),
    ),
    h(
      "button",
      {
        type: "button",
        className: "ye-ghost",
        onClick: () => {
          const taken = new Set(opts.map((o) => o.value));
          let n = opts.length + 1;
          while (taken.has(t(`選択肢 ${n}`, `Option ${n}`))) n++;
          const v = t(`選択肢 ${n}`, `Option ${n}`);
          put([...opts, { label: v, value: v }]);
        },
      },
      t("＋ 選択肢を足す", "+ Add option"),
    ),
    issues(p, { ...at, prop: "options" }, "opts"),
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const out = list.slice();
  [out[a], out[b]] = [out[b]!, out[a]!];
  return out;
}

function initialEditor(p: InspectorProps, x: AppField, set: (patch: Partial<AppField>) => void, at: ProblemPath, t: T): ReactNode {
  const pa = { ...at, prop: "initial" };
  const label = t("初期値", "Initial value");
  switch (x.type) {
    case "number":
    case "slider":
    case "count":
      return num(p, label, typeof x.initial === "number" ? x.initial : undefined, (v) => set({ initial: v }), pa);
    case "toggle":
      return select(p, label, x.initial === true ? "on" : x.initial === false ? "off" : "", [{ value: "", label: t("指定しない（オフ）", "None (off)") }, { value: "on", label: t("オン", "On") }, { value: "off", label: t("オフ", "Off") }], (v) => set({ initial: v === "" ? undefined : v === "on" }), pa);
    case "rating":
      return select(p, label, typeof x.initial === "number" ? String(x.initial) : "", [{ value: "", label: t("指定しない", "None") }, ...Array.from({ length: x.max ?? 5 }, (_, k) => ({ value: String(k + 1), label: "★".repeat(k + 1) }))], (v) => set({ initial: v ? Number(v) : undefined }), pa);
    case "choice":
      if (x.multi) return null;
      return select(p, label, typeof x.initial === "string" ? x.initial : "", [{ value: "", label: t("指定しない", "None") }, ...(x.options ?? []).map((o) => ({ value: o.value, label: o.label }))], (v) => set({ initial: v || undefined }), pa);
    case "date":
    case "month":
      return text(p, label, typeof x.initial === "string" ? x.initial : "", (v) => set({ initial: v || undefined }), pa, { type: x.type });
    case "daterange":
      return null;
    default:
      return text(p, label, typeof x.initial === "string" ? x.initial : "", (v) => set({ initial: v || undefined }), pa, {});
  }
}

// ---------------------------------------------------------------- 部品

function panel(p: InspectorProps, title: string, rows: ReactNode[]): ReactElement {
  return h("div", { className: "ye-panel", "data-yui-inspector": "" }, h("div", { className: "ye-panel-title" }, title), ...rows.filter(Boolean));
}

function footer(p: InspectorProps, sel: Selection, count: number, t: T): ReactElement {
  const index = sel.kind === "section" ? sel.section : sel.kind === "app" ? 0 : sel.index;
  const what = sel.kind === "section" ? t("機能", "section") : sel.kind === "action" ? t("ボタン", "button") : t("入力", "input");
  return h(
    "div",
    { key: "footer", className: "ye-footer" },
    h("button", { type: "button", className: "ye-icon-btn", disabled: index === 0, title: t("前へ（Alt+↑）", "Earlier (Alt+↑)"), "aria-label": t("前へ", "Earlier"), onClick: () => p.move(sel, -1) }, "↑"),
    h("button", { type: "button", className: "ye-icon-btn", disabled: index >= count - 1, title: t("後へ（Alt+↓）", "Later (Alt+↓)"), "aria-label": t("後へ", "Later"), onClick: () => p.move(sel, 1) }, "↓"),
    h("span", { style: { flex: 1 } }),
    h("button", { type: "button", className: "ye-ghost ye-danger", onClick: () => p.remove(sel) }, t(`この${what}を消す`, `Delete ${what}`)),
  );
}

/** その場所の問題（設定の下に出す）。 */
export function issues(p: { problems: Problem[]; c: Paint }, at: ProblemPath, key: string, exact = false): ReactNode {
  const list = exact ? p.problems.filter((x) => x.path.section === at.section && x.path.field === at.field && x.path.action === at.action && x.path.prop === at.prop) : problemsAt(p.problems, at);
  if (!list.length) return null;
  return h(
    "ul",
    { key: `issues-${key}`, className: "ye-issues", role: "list" },
    ...list.map((x, k) => h("li", { key: k, className: x.severity === "error" ? "ye-err" : "ye-warn" }, h("span", { "aria-hidden": true, className: "ye-dot" }), h("span", { className: "ye-sr" }, x.severity === "error" ? "エラー: " : "注意: "), x.message)),
  );
}

interface TextOpts {
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
  type?: string;
  /** 欄を離れたとき全角英数を半角にする（パーサが読む形に揃える）。 */
  normalize?: boolean;
}

function text(p: InspectorProps, label: string, value: string, onChange: (v: string) => void, at: ProblemPath, o: TextOpts = {}): ReactElement {
  return h(TextRow, { key: `t-${at.prop}`, p, label, value, onChange, at, o });
}

function TextRow({ p, label, value, onChange, at, o }: { p: InspectorProps; label: string; value: string; onChange: (v: string) => void; at: ProblemPath; o: TextOpts }): ReactElement {
  const id = useId();
  const list = problemsAt(p.problems, at);
  const err = list.some((x) => x.severity === "error");
  const props = {
    id,
    className: `ye-input${o.mono ? " ye-mono" : ""}`,
    value,
    placeholder: o.placeholder,
    "aria-invalid": err || undefined,
    "data-prop": at.prop,
    autoFocus: p.focusProp === at.prop || undefined,
    onChange: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => onChange(e.currentTarget.value),
    onBlur: o.normalize ? (e: { currentTarget: HTMLInputElement }) => {
      const v = e.currentTarget.value;
      const n = v.normalize("NFKC").trim();
      if (n !== v) onChange(n);
    } : undefined,
  };
  return h("div", { className: "ye-row" }, h("label", { htmlFor: id, className: "ye-label" }, label), o.multiline ? h("textarea", { ...props, rows: 2 }) : h("input", { ...props, type: o.type ?? "text" }), issues(p, at, "own"));
}

function num(p: InspectorProps, label: string, value: number | undefined, onChange: (v: number | undefined) => void, at: ProblemPath): ReactElement {
  return h(NumRow, { key: `n-${at.prop}`, p, label, value, onChange, at });
}

/** 数の欄。打ちかけ（「-」「1.」）を残すため、文字は手元に持ち、数として読めたときだけ渡す。 */
function NumRow({ p, label, value, onChange, at }: { p: InspectorProps; label: string; value: number | undefined; onChange: (v: number | undefined) => void; at: ProblemPath }): ReactElement {
  const id = useId();
  const [raw, setRaw] = useState(value === undefined ? "" : String(value));
  useEffect(() => {
    if ((raw.trim() === "" ? undefined : Number(raw)) !== value) setRaw(value === undefined ? "" : String(value));
  }, [value]);
  const err = problemsAt(p.problems, at).some((x) => x.severity === "error");
  return h(
    "div",
    { className: "ye-row" },
    h("label", { htmlFor: id, className: "ye-label" }, label),
    h("input", {
      id,
      className: "ye-input ye-num",
      inputMode: "decimal",
      value: raw,
      "aria-invalid": err || undefined,
      "data-prop": at.prop,
      onChange: (e: { currentTarget: HTMLInputElement }) => {
        const v = e.currentTarget.value.normalize("NFKC");
        setRaw(v);
        if (v.trim() === "") onChange(undefined);
        else if (Number.isFinite(Number(v))) onChange(Number(v));
      },
    }),
    at.prop === "min" || at.prop === "max" ? null : issues(p, at, "own"),
  );
}

function select(p: InspectorProps, label: string, value: string, options: { value: string; label: string }[], onChange: (v: string) => void, at: ProblemPath): ReactElement {
  return h(SelectRow, { key: `s-${at.prop}`, p, label, value, options, onChange, at });
}

function SelectRow({ p, label, value, options, onChange, at }: { p: InspectorProps; label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; at: ProblemPath }): ReactElement {
  // 同じページに複数のエディタがあっても重ならない id（label の for が別のエディタを指さないように）
  const id = useId();
  return h(
    "div",
    { className: "ye-row" },
    h("label", { htmlFor: id, className: "ye-label" }, label),
    h("select", { id, className: "ye-input", value, "data-prop": at.prop, onChange: (e: { currentTarget: HTMLSelectElement }) => onChange(e.currentTarget.value) }, ...options.map((o) => h("option", { key: o.value, value: o.value }, o.label))),
    issues(p, at, "own"),
  );
}

function check(p: InspectorProps, label: string, value: boolean, onChange: (v: boolean) => void, at: ProblemPath): ReactElement {
  return h(
    "div",
    { key: `c-${at.prop}`, className: "ye-row" },
    h("label", { className: "ye-check" }, h("input", { type: "checkbox", checked: value, "data-prop": at.prop, onChange: (e: { currentTarget: HTMLInputElement }) => onChange(e.currentTarget.checked) }), label),
    issues(p, at, "own"),
  );
}
