/**
 * calc の画面用の部品。入力（スライダー・数の増減・選択・オンオフ）を動かすと、その場で結果を計算し直す。
 *
 * 状態（入力の現在値）はこの部品の中だけに持ち、保存しない（docs/calc.md §5）。
 * HTML の標準の部品（input type=range・button）で作り、キーボードと読み上げはブラウザの既定に任せる。
 */

import { createElement as h, useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from "react";
import { breakdownFormulas, formatCalc, runCalc, shownFormulas } from "../calc/run.js";
import type { CalcFigure, CalcInput } from "../ir.js";
import { withUnit } from "../render/frame.js";
import { inputText } from "../render/calc.js";
import { FONT, paint, themeCss, type ThemeMode } from "../render/theme.js";

export interface CalcViewProps {
  figure: CalcFigure;
  theme?: ThemeMode;
  locale?: string;
  className?: string;
  /** 入力が変わったとき（ホストが書き出しに今の値を使うため）。 */
  onInputsChange?: (inputs: ReadonlyMap<string, number>) => void;
}

const initialInputs = (f: CalcFigure) => new Map(f.defs.filter((d): d is CalcInput => d.type === "input").map((d) => [d.name, d.initial]));

export function CalcView(props: CalcViewProps): ReactElement {
  const { figure: f, className, onInputsChange } = props;
  const mode = props.theme ?? "auto";
  const locale = props.locale ?? "ja-JP";
  const ja = locale.toLowerCase().startsWith("ja");
  const id = `yui${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [inputs, setInputs] = useState<Map<string, number>>(() => initialInputs(f));
  const [showFormulas, setShowFormulas] = useState(false);
  // 定義が変わったら（ストリーミングで行が増えたら）、新しい入力だけ初期値を足す
  const current = useMemo(() => {
    const m = initialInputs(f);
    for (const [k, v] of inputs) if (m.has(k)) m.set(k, v);
    return m;
  }, [f, inputs]);
  const values = useMemo(() => runCalc(f, current), [f, current]);
  const set = (name: string, v: number) => {
    const next = new Map(current);
    next.set(name, v);
    setInputs(next);
    onInputsChange?.(next);
  };

  const c = (t: Parameters<typeof paint>[0]) => paint(t, mode);
  const shown = shownFormulas(f);
  const rest = breakdownFormulas(f);
  const fmt = (name: string, round: number | undefined, unit: string | undefined) => withUnit(formatCalc(values.get(name) ?? null, round, locale), unit);
  const announce = shown.map((r) => `${r.name} ${fmt(r.name, r.round, r.unit)}`).join("、");

  const row: CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 };
  const button = (active = false): CSSProperties => ({
    font: "inherit",
    fontSize: 13,
    padding: "4px 12px",
    minHeight: 32,
    borderRadius: 999,
    border: `1px solid ${c(active ? "accentLine" : "border")}`,
    background: c(active ? "accentWash" : "surface"),
    color: c(active ? "ink" : "ink2"),
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
  });

  const control = (d: CalcInput): ReactElement => {
    const v = current.get(d.name) ?? d.initial;
    const label = `${id}-${d.name}`;
    const valueText = inputText(d, v, locale);
    const head = h("div", { style: row }, h("label", { htmlFor: label, style: { fontSize: 13, color: c("ink2") } }, d.name), h("output", { htmlFor: label, style: { fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" } }, valueText));
    switch (d.control) {
      case "slider":
        return h(
          "div",
          { key: d.name, style: { display: "grid", gap: 6 } },
          head,
          h("input", {
            id: label,
            type: "range",
            min: d.min,
            max: d.max,
            step: d.step,
            value: v,
            "aria-valuetext": valueText,
            onChange: (e: { currentTarget: HTMLInputElement }) => set(d.name, Number(e.currentTarget.value)),
            style: { width: "100%", accentColor: c("s1"), margin: 0 },
          }),
        );
      case "count":
        return h(
          "div",
          { key: d.name, style: { ...row, alignItems: "center" } },
          h("span", { id: label, style: { fontSize: 13, color: c("ink2") } }, d.name),
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 8 }, role: "group", "aria-labelledby": label },
            h("button", { type: "button", style: button(), disabled: v <= d.min, "aria-label": ja ? `${d.name}を減らす` : `Decrease ${d.name}`, onClick: () => set(d.name, Math.max(d.min, v - 1)) }, "−"),
            h("span", { "aria-live": "polite", style: { minWidth: 48, textAlign: "center", fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" } }, valueText),
            h("button", { type: "button", style: button(), disabled: v >= d.max, "aria-label": ja ? `${d.name}を増やす` : `Increase ${d.name}`, onClick: () => set(d.name, Math.min(d.max, v + 1)) }, "＋"),
          ),
        );
      case "choice": {
        const opts = d.options!;
        const idx = Math.max(0, opts.findIndex((o) => o.value === v));
        // 矢印キーで選択を動かす（ラジオボタンの集まりの決まり）
        const onKeyDown = (e: KeyboardEvent) => {
          const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          set(d.name, opts[(idx + step + opts.length) % opts.length]!.value);
        };
        return h(
          "div",
          { key: d.name, style: { display: "grid", gap: 6 } },
          h("span", { id: label, style: { fontSize: 13, color: c("ink2") } }, d.name),
          h(
            "div",
            { role: "radiogroup", "aria-labelledby": label, onKeyDown, style: { display: "flex", flexWrap: "wrap", gap: 6 } },
            ...opts.map((o, i) => h("button", { key: i, type: "button", role: "radio", "aria-checked": i === idx, tabIndex: i === idx ? 0 : -1, style: button(i === idx), onClick: () => set(d.name, o.value) }, o.label)),
          ),
        );
      }
      case "toggle":
        return h(
          "div",
          { key: d.name, style: { ...row, alignItems: "center" } },
          h("span", { id: label, style: { fontSize: 13, color: c("ink2") } }, d.name),
          h("button", { type: "button", role: "switch", "aria-checked": v !== 0, "aria-labelledby": label, style: button(v !== 0), onClick: () => set(d.name, v ? 0 : 1) }, valueText),
        );
    }
  };

  return h(
    "div",
    {
      className: [id, className].filter(Boolean).join(" "),
      "data-yui": "calc",
      role: "group",
      "aria-label": f.title || (ja ? "計算" : "Calculator"),
      style: { fontFamily: FONT, color: c("ink"), display: "grid", gap: 14, maxWidth: 640 },
    },
    mode === "auto" ? h("style", null, themeCss(`.${id}`)) : null,
    h("style", null, `.${id} button:focus-visible,.${id} input:focus-visible{outline:2px solid ${c("accentLine")};outline-offset:2px}.${id} button:disabled{opacity:.4;cursor:default}`),
    f.title ? h("div", { style: { fontSize: 14, fontWeight: 600 } }, f.title) : null,
    ...f.defs.filter((d): d is CalcInput => d.type === "input").map(control),
    h("hr", { style: { border: 0, borderTop: `1px solid ${c("grid")}`, margin: 0 } }),
    ...shown.map((r) =>
      h(
        "div",
        { key: r.name },
        h("div", { style: { fontSize: 12, color: c("muted") } }, r.name),
        h("div", { style: { fontSize: 28, fontWeight: 600, fontVariantNumeric: "tabular-nums", lineHeight: 1.3 } }, fmt(r.name, r.round, r.unit)),
      ),
    ),
    rest.length
      ? h(
          "div",
          { style: { display: "grid", gap: 2 } },
          ...rest.map((r) => h("div", { key: r.name, style: { ...row, fontSize: 12, color: c("muted") } }, h("span", null, r.name), h("span", { style: { color: c("ink2"), fontVariantNumeric: "tabular-nums" } }, fmt(r.name, r.round, r.unit)))),
        )
      : null,
    h(
      "div",
      { style: { display: "grid", gap: 6 } },
      h("button", { type: "button", "aria-expanded": showFormulas, onClick: () => setShowFormulas((s) => !s), style: { ...button(), justifySelf: "start", fontSize: 12, minHeight: 28, padding: "2px 10px" } }, showFormulas ? (ja ? "式を隠す" : "Hide formulas") : ja ? "式を見る" : "Show formulas"),
      showFormulas
        ? h(
            "pre",
            { style: { margin: 0, padding: "8px 10px", borderRadius: 8, background: c("surface2"), color: c("ink2"), fontSize: 12, whiteSpace: "pre-wrap" } },
            f.defs
              .filter((d) => d.type === "formula")
              .map((d) => (d.type === "formula" ? `${d.name} = ${d.source}${d.unit ? ` [${d.unit}]` : ""}` : ""))
              .join("\n"),
          )
        : null,
      h("div", { style: { fontSize: 12, color: c("muted") } }, `※ ${f.note ?? (ja ? "計算結果は概算です。" : "Results are estimates.")}`),
    ),
    // 読み上げ: 入力を動かしたら結果を伝える
    h("div", { "aria-live": "polite", style: { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } }, announce),
  );
}
