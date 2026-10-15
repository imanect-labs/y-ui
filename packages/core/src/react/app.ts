/**
 * app の画面用の部品（docs/app.md）。入力部品を並べ、ボタンが押されたら値を検証してホストの onAction に渡す。
 *
 * Yui はサーバーを呼ばない。onAction が無い場所（本文の ```ui など表示専用の場所）ではボタンを無効にする。
 * 押してから結果が返るまでその機能のボタンを無効にし（二重押しを防ぐ）、結果の文言を機能の下に出す。
 * HTML の標準の部品で作り、キーボードと読み上げはブラウザの既定に任せる。
 */

import { createElement as h, useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from "react";
import { checkField, displayValue, initialValues, type AppValue, type AppValues } from "../app/values.js";
import type { AppAction, AppField, AppFigure, AppSection } from "../ir.js";
import { FONT, paint, themeCss, type ThemeMode } from "../render/theme.js";

export interface AppActionEvent {
  actionId: string;
  action: AppAction;
  section: AppSection;
  /** 検証済みの値（その機能の部品だけ）。 */
  values: AppValues;
}

export interface AppActionResult {
  ok: boolean;
  /** 結果の文言（無ければ既定の文言）。 */
  message?: string;
}

export interface AppViewProps {
  figure: AppFigure;
  theme?: ThemeMode;
  locale?: string;
  className?: string;
  /** ボタンが押され、値が検証を通ったとき。無ければボタンは無効（表示専用）。 */
  onAction?: (e: AppActionEvent) => Promise<AppActionResult | void> | AppActionResult | void;
  /** ボタンを無効にしている理由（onAction が無いときの説明を差し替える）。 */
  disabledReason?: string;
}

type Phase = { kind: "idle" } | { kind: "confirm"; action: AppAction; values: AppValues } | { kind: "pending"; action: AppAction } | { kind: "done" | "error"; message: string };

export function AppView(props: AppViewProps): ReactElement {
  const { figure: f, className, onAction } = props;
  const mode = props.theme ?? "auto";
  const locale = props.locale ?? "ja-JP";
  const ja = locale.toLowerCase().startsWith("ja");
  const id = `yui${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const c = (t: Parameters<typeof paint>[0]) => paint(t, mode);
  const enabled = typeof onAction === "function";

  return h(
    "div",
    { className: [id, className].filter(Boolean).join(" "), "data-yui": "app", style: { fontFamily: FONT, color: c("ink"), display: "grid", gap: 12, maxWidth: 720 } },
    mode === "auto" ? h("style", null, themeCss(`.${id}`)) : null,
    h(
      "style",
      null,
      `.${id} input,.${id} textarea,.${id} select{font:inherit;font-size:14px;color:${c("ink")};background:${c("surface")};border:1px solid ${c("border")};border-radius:8px;box-sizing:border-box;width:100%}` +
        `.${id} input[type=range]{border:0;padding:0;accent-color:${c("s1")}}` +
        `.${id} button:focus-visible,.${id} input:focus-visible,.${id} textarea:focus-visible,.${id} select:focus-visible{outline:2px solid ${c("accentLine")};outline-offset:1px}` +
        `.${id} [aria-invalid=true]{border-color:${c("s5")}}.${id} button:disabled{opacity:.45;cursor:default}`,
    ),
    f.title ? h("div", { style: { fontSize: 15, fontWeight: 600 } }, f.title) : null,
    ...f.sections.map((s, i) => h(SectionView, { key: i, section: s, sectionId: `${id}-s${i}`, c, ja, enabled, onAction })),
    !enabled ? h("div", { style: { fontSize: 12, color: c("muted") } }, props.disabledReason ?? (ja ? "この場所ではボタンを実行できません。" : "Buttons can't be run here.")) : null,
    f.note ? h("div", { style: { fontSize: 12, color: c("muted") } }, `※ ${f.note}`) : null,
  );
}

interface SectionProps {
  section: AppSection;
  sectionId: string;
  c: (t: Parameters<typeof paint>[0]) => string;
  ja: boolean;
  enabled: boolean;
  onAction: AppViewProps["onAction"];
}

function SectionView(p: SectionProps): ReactElement {
  const { section: s, c, ja } = p;
  const initial = useMemo(() => initialValues(s), [s]);
  const [values, setValues] = useState<Record<string, AppValue>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // ストリーミングで部品が増えたら、新しい部品の初期値を足す
  const current = useMemo(() => ({ ...initial, ...Object.fromEntries(Object.entries(values).filter(([k]) => k in initial)) }), [initial, values]);
  const set = (key: string, v: AppValue) => {
    setValues({ ...current, [key]: v });
    if (errors[key]) setErrors(Object.fromEntries(Object.entries(errors).filter(([k]) => k !== key)));
  };

  const validate = (): AppValues | null => {
    const out: AppValues = {};
    const errs: Record<string, string> = {};
    for (const x of s.fields) {
      const r = checkField(x, current[x.key], ja);
      if (r.error) errs[x.key] = r.error;
      else if (r.value !== undefined) out[x.key] = r.value;
    }
    setErrors(errs);
    return Object.keys(errs).length ? null : out;
  };

  const run = async (action: AppAction, vals: AppValues) => {
    if (!p.onAction) return;
    setPhase({ kind: "pending", action });
    try {
      const r = await p.onAction({ actionId: action.id, action, section: s, values: vals });
      const ok = r ? r.ok : true;
      const fallback = ok ? (action.target.kind === "workflow" ? (ja ? `「${action.target.name}」を起動しました。` : `Started "${action.target.name}".`) : ja ? "送信しました。" : "Sent.") : ja ? "実行できませんでした。" : "Couldn't run.";
      setPhase({ kind: ok ? "done" : "error", message: r?.message ?? fallback });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error && e.message ? e.message : ja ? "実行できませんでした。" : "Couldn't run." });
    }
  };

  const press = (action: AppAction) => {
    const vals = validate();
    if (!vals) return;
    if (action.confirm) setPhase({ kind: "confirm", action, values: vals });
    else void run(action, vals);
  };

  const busy = phase.kind === "pending";
  const button = (primary: boolean): CSSProperties => ({
    font: "inherit",
    fontSize: 14,
    fontWeight: 600,
    padding: "0 16px",
    minHeight: 36,
    borderRadius: 10,
    border: `1px solid ${c(primary ? "ink" : "border")}`,
    background: c(primary ? "ink" : "surface"),
    color: c(primary ? "surface" : "ink"),
    cursor: "pointer",
  });

  return h(
    "section",
    { "aria-labelledby": s.title ? `${p.sectionId}-t` : undefined, "aria-busy": busy, style: { border: `1px solid ${c("border")}`, borderRadius: 14, padding: 16, display: "grid", gap: 14, background: c("surface") } },
    s.title || s.desc
      ? h(
          "div",
          { style: { display: "grid", gap: 4 } },
          s.title ? h("div", { id: `${p.sectionId}-t`, style: { fontSize: 15, fontWeight: 600 } }, s.title) : null,
          s.desc ? h("div", { style: { fontSize: 13, color: c("muted"), whiteSpace: "pre-line" } }, s.desc) : null,
        )
      : null,
    s.fields.length
      ? h(
          "div",
          { style: { display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" } },
          ...s.fields.map((x) => h(FieldView, { key: x.key, field: x, id: `${p.sectionId}-${x.key.replace(/[^A-Za-z0-9_-]/g, "") || "f"}-${s.fields.indexOf(x)}`, value: current[x.key]!, error: errors[x.key], set: (v: AppValue) => set(x.key, v), c, ja, disabled: busy })),
        )
      : null,
    phase.kind === "confirm"
      ? h(
          "div",
          { role: "group", "aria-label": ja ? "実行の確認" : "Confirm", style: { display: "grid", gap: 10, padding: 12, borderRadius: 10, background: c("surface2") } },
          h("div", { style: { fontSize: 14, fontWeight: 600 } }, phase.action.target.kind === "workflow" ? (ja ? `「${phase.action.target.name}」をこの内容で起動します。` : `Start "${phase.action.target.name}" with these values.`) : ja ? "この内容を会話に送ります。" : "Send these values to the conversation."),
          h(
            "dl",
            { style: { margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 } },
            ...s.fields.flatMap((x) => [h("dt", { key: `${x.key}-k`, style: { color: c("muted") } }, x.label), h("dd", { key: `${x.key}-v`, style: { margin: 0, overflowWrap: "anywhere" } }, displayValue(x, phase.values[x.key], ja))]),
          ),
          h(
            "div",
            { style: { display: "flex", gap: 8 } },
            h("button", { type: "button", style: button(true), onClick: () => void run(phase.action, phase.values) }, ja ? "実行する" : "Run"),
            h("button", { type: "button", style: button(false), onClick: () => setPhase({ kind: "idle" }) }, ja ? "戻る" : "Back"),
          ),
        )
      : s.actions.length
        ? h(
            "div",
            { style: { display: "flex", flexWrap: "wrap", gap: 8 } },
            ...s.actions.map((a, i) =>
              h(
                "button",
                { key: a.id, type: "button", disabled: !p.enabled || busy, title: a.target.kind === "workflow" ? (ja ? `ワークフロー「${a.target.name}」` : `Workflow "${a.target.name}"`) : undefined, style: button(i === 0), onClick: () => press(a) },
                busy && phase.action.id === a.id ? (ja ? "実行中…" : "Running…") : a.label,
              ),
            ),
          )
        : null,
    phase.kind === "done" || phase.kind === "error"
      ? h("div", { role: "status", style: { fontSize: 13, color: c(phase.kind === "done" ? "ink2" : "s5") } }, `${phase.kind === "done" ? "✓ " : ""}${phase.message}`)
      : h("div", { role: "status", style: { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" } }, busy ? (ja ? "実行中" : "Running") : ""),
  );
}

interface FieldProps {
  field: AppField;
  id: string;
  value: AppValue;
  error?: string;
  set: (v: AppValue) => void;
  c: SectionProps["c"];
  ja: boolean;
  disabled: boolean;
}

function FieldView(p: FieldProps): ReactElement {
  const { field: x, id, value, c, ja } = p;
  const errId = `${id}-e`;
  const common = { id, disabled: p.disabled, "aria-invalid": p.error ? true : undefined, "aria-describedby": p.error ? errId : undefined, "aria-required": x.required || undefined };
  const box: CSSProperties = { minHeight: 36, padding: "0 10px" };
  const label = h(
    "label",
    { htmlFor: id, style: { fontSize: 13, fontWeight: 500, color: c("ink2"), display: "flex", gap: 6, alignItems: "baseline" } },
    x.label,
    x.required ? h("span", { style: { fontSize: 11, color: c("muted"), fontWeight: 400 } }, ja ? "必須" : "Required") : null,
  );
  let control: ReactElement;
  switch (x.type) {
    case "text":
      control = h("input", { ...common, type: "text", value: String(value), placeholder: x.placeholder, style: box, onChange: (e: { currentTarget: HTMLInputElement }) => p.set(e.currentTarget.value) });
      break;
    case "textarea":
      control = h("textarea", { ...common, value: String(value), placeholder: x.placeholder, rows: 3, style: { padding: "8px 10px", resize: "vertical" }, onChange: (e: { currentTarget: HTMLTextAreaElement }) => p.set(e.currentTarget.value) });
      break;
    case "number":
      control = h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 8 } },
        h("input", { ...common, type: "text", inputMode: "decimal", value: String(value), placeholder: x.placeholder, style: { ...box, fontVariantNumeric: "tabular-nums" }, onChange: (e: { currentTarget: HTMLInputElement }) => p.set(e.currentTarget.value) }),
        x.unit ? h("span", { style: { fontSize: 13, color: c("muted"), whiteSpace: "nowrap" } }, x.unit) : null,
      );
      break;
    case "slider":
      control = h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 10 } },
        h("input", { ...common, type: "range", min: x.min, max: x.max, step: x.step ?? 1, value: Number(value), onChange: (e: { currentTarget: HTMLInputElement }) => p.set(Number(e.currentTarget.value)) }),
        h("output", { htmlFor: id, style: { fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" } }, displayValue(x, value, ja)),
      );
      break;
    case "count": {
      const n = Number(value);
      const btn: CSSProperties = { font: "inherit", minWidth: 36, minHeight: 36, borderRadius: 8, border: `1px solid ${c("border")}`, background: c("surface"), color: c("ink"), cursor: "pointer" };
      control = h(
        "div",
        { role: "group", "aria-labelledby": `${id}-l`, style: { display: "flex", alignItems: "center", gap: 8 } },
        h("button", { type: "button", style: btn, disabled: p.disabled || n <= (x.min ?? -Infinity), "aria-label": ja ? `${x.label}を減らす` : `Decrease ${x.label}`, onClick: () => p.set(n - 1) }, "−"),
        h("span", { id, "aria-live": "polite", style: { minWidth: 48, textAlign: "center", fontWeight: 600, fontVariantNumeric: "tabular-nums" } }, displayValue(x, n, ja)),
        h("button", { type: "button", style: btn, disabled: p.disabled || n >= (x.max ?? Infinity), "aria-label": ja ? `${x.label}を増やす` : `Increase ${x.label}`, onClick: () => p.set(n + 1) }, "＋"),
      );
      break;
    }
    case "choice":
      control = x.multi ? multiChoice(p) : x.options!.length <= 4 ? segmented(p) : h("select", { ...common, value: String(value), style: box, onChange: (e: { currentTarget: HTMLSelectElement }) => p.set(e.currentTarget.value) }, h("option", { value: "" }, ja ? "選択してください" : "Select"), ...x.options!.map((o) => h("option", { key: o.value, value: o.value }, o.label)));
      break;
    case "date":
    case "month":
      control = h("input", { ...common, type: x.type, value: String(value), style: box, onChange: (e: { currentTarget: HTMLInputElement }) => p.set(e.currentTarget.value) });
      break;
    case "toggle": {
      const on = value === true;
      return h(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 36, alignSelf: "end" } },
        h("span", { id: `${id}-l`, style: { fontSize: 13, fontWeight: 500, color: c("ink2") } }, x.label),
        h(
          "button",
          { type: "button", role: "switch", "aria-checked": on, "aria-labelledby": `${id}-l`, disabled: p.disabled, onClick: () => p.set(!on), style: { width: 44, height: 24, borderRadius: 12, border: 0, padding: 2, background: c(on ? "s1" : "axis"), cursor: "pointer", display: "flex", justifyContent: on ? "flex-end" : "flex-start" } },
          h("span", { style: { width: 20, height: 20, borderRadius: 10, background: c("surface"), display: "block" } }),
        ),
      );
    }
  }
  return h(
    "div",
    { style: { display: "grid", gap: 6, gridColumn: x.type === "textarea" ? "1 / -1" : undefined, alignContent: "start" } },
    x.type === "count" || x.type === "choice" ? h("span", { id: `${id}-l`, style: { fontSize: 13, fontWeight: 500, color: c("ink2"), display: "flex", gap: 6, alignItems: "baseline" } }, x.label, x.required ? h("span", { style: { fontSize: 11, color: c("muted"), fontWeight: 400 } }, ja ? "必須" : "Required") : null) : label,
    control,
    p.error ? h("div", { id: errId, style: { fontSize: 12, color: c("s5") } }, p.error) : null,
  );
}

/** 4 つまでの選択肢は、区切りの付いた切り替え（ラジオボタンの集まり）にする。 */
function segmented(p: FieldProps): ReactElement {
  const { field: x, c } = p;
  const opts = x.options!;
  const idx = opts.findIndex((o) => o.value === p.value);
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    p.set(opts[(Math.max(0, idx) + step + opts.length) % opts.length]!.value);
  };
  return h(
    "div",
    { role: "radiogroup", "aria-labelledby": `${p.id}-l`, "aria-invalid": p.error ? true : undefined, onKeyDown, style: { display: "flex", gap: 2, padding: 3, borderRadius: 10, border: `1px solid ${c(p.error ? "s5" : "border")}`, background: c("surface2") } },
    ...opts.map((o, i) =>
      h(
        "button",
        { key: o.value, type: "button", role: "radio", "aria-checked": i === idx, tabIndex: i === Math.max(0, idx) ? 0 : -1, disabled: p.disabled, onClick: () => p.set(o.value), style: { font: "inherit", fontSize: 13, flex: "1 1 auto", minWidth: 0, minHeight: 30, padding: "0 10px", borderRadius: 8, border: `1px solid ${i === idx ? c("border") : "transparent"}`, background: i === idx ? c("surface") : "transparent", color: c(i === idx ? "ink" : "muted"), fontWeight: i === idx ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
        o.label,
      ),
    ),
  );
}

/** 複数選択は、押すたびに選ぶ・外す札の並び。 */
function multiChoice(p: FieldProps): ReactElement {
  const { field: x, c } = p;
  const picked = new Set(Array.isArray(p.value) ? p.value : []);
  return h(
    "div",
    { role: "group", "aria-labelledby": `${p.id}-l`, style: { display: "flex", flexWrap: "wrap", gap: 6 } },
    ...x.options!.map((o) => {
      const on = picked.has(o.value);
      return h(
        "button",
        {
          key: o.value,
          type: "button",
          "aria-pressed": on,
          disabled: p.disabled,
          onClick: () => p.set(on ? [...picked].filter((v) => v !== o.value) : [...picked, o.value]),
          style: { font: "inherit", fontSize: 13, minHeight: 32, padding: "0 12px", borderRadius: 999, border: `1px solid ${c(on ? "accentLine" : "border")}`, background: c(on ? "accentWash" : "surface"), color: c(on ? "ink" : "ink2"), fontWeight: on ? 600 : 400, cursor: "pointer" },
        },
        on ? `✓ ${o.label}` : o.label,
      );
    }),
  );
}
