/**
 * ask（質問のカード）と plan（計画のカード）の画面用の部品。回答を検証してホストの onAction に渡す（会話に送る）。
 *
 * どちらも 1 回だけ送れる（ホストが送ったことを覚え、invoked で返す。画面の状態では覚えない）。
 * onAction が無い場所ではボタンを無効にする。
 */

import { createElement as h, useId, useState, type CSSProperties, type ReactElement } from "react";
import { checkAnswer, figureActions, type AppValue, type AppValues } from "../app/values.js";
import type { AppAction, AskFigure, AskQuestion, PlanFigure } from "../ir.js";
import { FONT, paint, themeCss, type ThemeMode } from "../render/theme.js";
import type { AppViewProps } from "./app.js";

export interface CardViewProps<F> {
  figure: F;
  theme?: ThemeMode;
  locale?: string;
  className?: string;
  onAction?: AppViewProps["onAction"];
  disabledReason?: string;
  /** 送り済みのボタンの id（ホストが覚えている状態）。 */
  invoked?: readonly string[];
}

type Paint = (t: Parameters<typeof paint>[0]) => string;
type Phase = { kind: "idle" | "pending" } | { kind: "done" | "error"; message: string };

function frame(id: string, mode: ThemeMode, c: Paint, className: string | undefined, kind: string, children: (ReactElement | null)[]): ReactElement {
  return h(
    "div",
    { className: [id, className].filter(Boolean).join(" "), "data-yui": kind, style: { fontFamily: FONT, color: c("ink"), display: "grid", gap: 14, maxWidth: 720 } },
    mode === "auto" ? h("style", null, themeCss(`.${id}`)) : null,
    h(
      "style",
      null,
      `.${id} input[type=text],.${id} textarea{font:inherit;font-size:14px;color:${c("ink")};background:${c("surface")};border:1px solid ${c("border")};border-radius:8px;box-sizing:border-box;width:100%;padding:8px 10px}` +
        `.${id} button:focus-visible,.${id} input:focus-visible,.${id} textarea:focus-visible{outline:2px solid ${c("accentLine")};outline-offset:1px}` +
        `.${id} button:disabled{opacity:.45;cursor:default}.${id} [aria-invalid=true]{border-color:${c("s5")}}`,
    ),
    ...children,
  );
}

const btn = (c: Paint, primary: boolean): CSSProperties => ({
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

async function send(onAction: AppViewProps["onAction"], action: AppAction, values: AppValues, ja: boolean, set: (p: Phase) => void): Promise<void> {
  if (!onAction) return;
  set({ kind: "pending" });
  try {
    const r = await onAction({ actionId: action.id, action, values });
    const ok = r ? r.ok : true;
    set({ kind: ok ? "done" : "error", message: r?.message ?? (ok ? (ja ? "送信しました。" : "Sent.") : ja ? "送れませんでした。" : "Couldn't send.") });
  } catch (e) {
    set({ kind: "error", message: e instanceof Error && e.message ? e.message : ja ? "送れませんでした。" : "Couldn't send." });
  }
}

function statusLine(c: Paint, phase: Phase, answered: boolean, ja: boolean): ReactElement {
  if (phase.kind === "done" || phase.kind === "error") return h("div", { role: "status", style: { fontSize: 13, color: c(phase.kind === "done" ? "ink2" : "s5") } }, `${phase.kind === "done" ? "✓ " : ""}${phase.message}`);
  if (answered) return h("div", { role: "status", style: { fontSize: 13, color: c("ink2") } }, ja ? "✓ 回答済みです。" : "✓ Already answered.");
  return h("div", { role: "status", style: { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" } }, phase.kind === "pending" ? (ja ? "送信中" : "Sending") : "");
}

// ---------------------------------------------------------------- ask

export function AskView(props: CardViewProps<AskFigure>): ReactElement {
  const { figure: f } = props;
  const mode = props.theme ?? "auto";
  const ja = (props.locale ?? "ja-JP").toLowerCase().startsWith("ja");
  const id = `yui${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const c: Paint = (t) => paint(t, mode);
  const [values, setValues] = useState<Record<string, AppValue>>({});
  const [others, setOthers] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const action = figureActions(f)[0];
  const answered = !!action && (props.invoked?.includes(action.id) ?? false);
  const locked = answered || phase.kind === "pending" || phase.kind === "done";
  const enabled = typeof props.onAction === "function" && !!action;

  /** 「その他」を選んだ質問は、自由記述の文を回答にする。 */
  const answerOf = (q: AskQuestion): unknown => {
    const v = values[q.id];
    const other = (others[q.id] ?? "").trim();
    const OTHER = "\u0000other";
    if (Array.isArray(v)) return v.flatMap((x) => (x === OTHER ? (other ? [other] : []) : [x]));
    return v === OTHER ? other : v;
  };
  const submit = () => {
    const out: AppValues = {};
    const errs: Record<string, string> = {};
    for (const q of f.questions) {
      const r = checkAnswer(q, answerOf(q), ja);
      if (r.error) errs[q.id] = r.error;
      else if (r.value !== undefined) out[q.id] = r.value;
    }
    setErrors(errs);
    if (Object.keys(errs).length === 0 && action) void send(props.onAction, action, out, ja, setPhase);
  };

  const question = (q: AskQuestion, qi: number): ReactElement => {
    const qid = `${id}-${q.id}`;
    const err = errors[q.id];
    const OTHER = "\u0000other";
    const opts = [...q.options.map((o) => ({ value: o.label, label: o.label, desc: o.desc })), ...(q.other ? [{ value: OTHER, label: ja ? "その他" : "Other", desc: undefined }] : [])];
    const picked = (v: string) => (q.multi ? Array.isArray(values[q.id]) && (values[q.id] as string[]).includes(v) : values[q.id] === v);
    const toggle = (v: string) => {
      if (q.multi) {
        const cur = Array.isArray(values[q.id]) ? (values[q.id] as string[]) : [];
        setValues({ ...values, [q.id]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
      } else setValues({ ...values, [q.id]: v });
      if (err) setErrors({ ...errors, [q.id]: "" });
    };
    return h(
      "fieldset",
      { key: q.id, "aria-invalid": err ? true : undefined, "aria-describedby": err ? `${qid}-e` : undefined, disabled: locked, style: { border: 0, margin: 0, padding: 0, display: "grid", gap: 8, minWidth: 0 } },
      h(
        "legend",
        { style: { padding: 0, marginBottom: 8, fontSize: 14, fontWeight: 600, display: "flex", gap: 8, alignItems: "baseline", width: "100%" } },
        `${qi + 1}. ${q.text}`,
        q.multi || !q.required ? h("span", { style: { fontSize: 12, fontWeight: 400, color: c("muted"), marginLeft: "auto" } }, [q.multi ? (ja ? "複数選択可" : "Multiple") : "", q.required ? "" : ja ? "任意" : "Optional"].filter(Boolean).join("・")) : null,
      ),
      q.options.length === 0
        ? h("textarea", { id: qid, rows: 2, value: typeof values[q.id] === "string" ? (values[q.id] as string) : "", placeholder: q.placeholder, "aria-invalid": err ? true : undefined, onChange: (e: { currentTarget: HTMLTextAreaElement }) => setValues({ ...values, [q.id]: e.currentTarget.value }) })
        : null,
      ...opts.map((o, oi) => {
        const on = picked(o.value);
        return h(
          "label",
          { key: oi, style: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", alignItems: "start", padding: "10px 12px", borderRadius: 10, border: `1px solid ${c(on ? "accentLine" : "border")}`, background: c(on ? "accentWash" : "surface"), cursor: locked ? "default" : "pointer" } },
          h("input", { type: q.multi ? "checkbox" : "radio", name: qid, checked: on, onChange: () => toggle(o.value), style: { margin: "3px 0 0", accentColor: c("s1") } }),
          h("span", { style: { fontSize: 14, fontWeight: 500 } }, o.label),
          o.desc ? h("span", { style: { gridColumn: 2, fontSize: 12, color: c("muted") } }, o.desc) : null,
          o.value === OTHER && on ? h("input", { type: "text", "aria-label": ja ? "その他の回答" : "Other answer", value: others[q.id] ?? "", onChange: (e: { currentTarget: HTMLInputElement }) => setOthers({ ...others, [q.id]: e.currentTarget.value }), style: { gridColumn: 2, marginTop: 6 } }) : null,
        );
      }),
      err ? h("div", { id: `${qid}-e`, style: { fontSize: 12, color: c("s5") } }, err) : null,
    );
  };

  return frame(id, mode, c, props.className, "ask", [
    f.title ? h("div", { key: "t", style: { fontSize: 15, fontWeight: 600 } }, f.title) : null,
    f.intro ? h("div", { key: "i", style: { fontSize: 14, color: c("ink2"), whiteSpace: "pre-line" } }, f.intro) : null,
    ...f.questions.map(question),
    h(
      "div",
      { key: "b", style: { display: "flex", gap: 8, alignItems: "center" } },
      h("button", { type: "button", style: btn(c, true), disabled: !enabled || locked, onClick: submit }, phase.kind === "pending" ? (ja ? "送信中…" : "Sending…") : (action?.label ?? (ja ? "回答する" : "Submit"))),
    ),
    statusLine(c, phase, answered, ja),
    !enabled && !answered ? h("div", { key: "d", style: { fontSize: 12, color: c("muted") } }, props.disabledReason ?? (ja ? "この場所では回答を送れません。" : "Answers can't be sent here.")) : null,
  ]);
}

// ---------------------------------------------------------------- plan

export function PlanView(props: CardViewProps<PlanFigure>): ReactElement {
  const { figure: f } = props;
  const mode = props.theme ?? "auto";
  const ja = (props.locale ?? "ja-JP").toLowerCase().startsWith("ja");
  const id = `yui${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const c: Paint = (t) => paint(t, mode);
  const [revising, setRevising] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const actions = figureActions(f);
  const approve = actions.find((a) => a.id === "approve")!;
  const revise = actions.find((a) => a.id === "revise");
  const answered = actions.some((a) => props.invoked?.includes(a.id));
  const locked = answered || phase.kind === "pending" || phase.kind === "done";
  const enabled = typeof props.onAction === "function";

  const sendRevise = () => {
    if (!revise) return;
    if (comment.trim() === "") {
      setError(ja ? "修正してほしい点を書いてください" : "Describe the change");
      return;
    }
    setError("");
    void send(props.onAction, revise, { comment: comment.trim() }, ja, setPhase);
  };

  return frame(id, mode, c, props.className, "plan", [
    f.title ? h("div", { key: "t", style: { fontSize: 15, fontWeight: 600 } }, f.title) : null,
    f.intro ? h("div", { key: "i", style: { fontSize: 14, color: c("ink2"), whiteSpace: "pre-line" } }, f.intro) : null,
    h(
      "ol",
      { key: "s", style: { margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 14 } },
      ...f.steps.map((s, i) =>
        h(
          "li",
          { key: i, style: { display: "grid", gridTemplateColumns: "24px 1fr", gap: "2px 12px" } },
          h("span", { "aria-hidden": true, style: { fontSize: 15, fontWeight: 600, color: c("ink2"), fontVariantNumeric: "tabular-nums" } }, String(i + 1)),
          h("span", { style: { fontSize: 14, fontWeight: 600 } }, s.title),
          s.desc ? h("span", { style: { gridColumn: 2, fontSize: 13, color: c("muted"), whiteSpace: "pre-line" } }, s.desc) : null,
        ),
      ),
    ),
    revising && !locked
      ? h(
          "div",
          { key: "r", style: { display: "grid", gap: 8 } },
          h("textarea", { "aria-label": ja ? "修正してほしい点" : "Requested changes", rows: 3, value: comment, "aria-invalid": error ? true : undefined, placeholder: ja ? "例: 手順 2 の前に、関係者への確認を入れてください" : "e.g. Add a review step before step 2", onChange: (e: { currentTarget: HTMLTextAreaElement }) => setComment(e.currentTarget.value) }),
          error ? h("div", { style: { fontSize: 12, color: c("s5") } }, error) : null,
          h("div", { style: { display: "flex", gap: 8 } }, h("button", { type: "button", style: btn(c, true), disabled: !enabled, onClick: sendRevise }, ja ? "修正を依頼する" : "Send"), h("button", { type: "button", style: btn(c, false), onClick: () => setRevising(false) }, ja ? "戻る" : "Back")),
        )
      : h(
          "div",
          { key: "b", style: { display: "flex", gap: 8, flexWrap: "wrap" } },
          h("button", { type: "button", style: btn(c, true), disabled: !enabled || locked, onClick: () => void send(props.onAction, approve, {}, ja, setPhase) }, phase.kind === "pending" ? (ja ? "送信中…" : "Sending…") : approve.label),
          revise ? h("button", { type: "button", style: btn(c, false), disabled: !enabled || locked, onClick: () => setRevising(true) }, revise.label) : null,
        ),
    statusLine(c, phase, answered, ja),
    !enabled && !answered ? h("div", { key: "d", style: { fontSize: 12, color: c("muted") } }, props.disabledReason ?? (ja ? "この場所では送れません。" : "Can't be sent here.")) : null,
  ]);
}
