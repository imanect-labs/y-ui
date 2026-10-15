/**
 * `@imanect/yui/react`: React で図を描く。
 *
 * - YuiFigure: 中間表現を描く（親の幅に合わせて描き直す）
 * - YuiBlock: ` ```ui ` の中身（ソース）を解析して描く。ストリーミング中でもよい
 * - isYuiLanguage: Markdown レンダラーのコードブロックの言語名が Yui か
 *
 * SVG はシーンから React 要素として組み立てる（HTML 文字列を差し込まない）。
 */

import {
  createElement as h,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type RefObject,
} from "react";
import type { Diagnostic, Figure, Kind } from "../ir.js";
import { parseBlock } from "../parse.js";
import { layout, type LayoutOptions } from "../render/layout.js";
import type { Item, Scene, Target } from "../render/scene.js";
import { FONT, paint, themeCss, type ThemeMode, type Token } from "../render/theme.js";
import { AppView, type AppViewProps } from "./app.js";
import { CalcView } from "./calc.js";

export { CalcView, type CalcViewProps } from "./calc.js";
export { AppView, type AppViewProps, type AppActionEvent, type AppActionResult } from "./app.js";

export interface YuiFigureProps extends Omit<LayoutOptions, "width"> {
  figure: Figure;
  /** 既定は auto（CSS 変数・ページの明暗に追従）。 */
  theme?: ThemeMode;
  /** ホバー・キーボードで値を出し、該当部分を強調するか（既定 true）。 */
  interactive?: boolean;
  /** 幅を固定する場合（指定しなければ親の幅に合わせる）。 */
  width?: number;
  className?: string;
  /**
   * app のボタンが押されたとき（docs/app.md）。渡さなければボタンは無効（表示専用）。
   * ホストは action の実行先をサーバーで解決・検証してから実行する。
   */
  onAction?: AppViewProps["onAction"];
  /** app のボタンを無効にしている理由の文言。 */
  actionDisabledReason?: string;
}

/** 親要素の幅を測る（SSR では fallback）。 */
function useContainerWidth(fixed: number | undefined, fallback = 640): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fixed ?? fallback);
  useEffect(() => {
    if (fixed !== undefined || !ref.current || typeof ResizeObserver === "undefined") return;
    const el = ref.current;
    const update = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) >= 4 ? w : prev));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixed]);
  return [ref, fixed ?? width];
}

function colors(mode: ThemeMode, fill?: Token | "none", stroke?: Token): CSSProperties | Record<string, string> {
  const s: Record<string, string> = {};
  if (fill) s.fill = fill === "none" ? "none" : paint(fill, mode);
  if (stroke) s.stroke = paint(stroke, mode);
  return s;
}

/** ホバー中に薄くする要素の不透明度。 */
const DIMMED = 0.28;

function renderItem(it: Item, i: number, mode: ThemeMode, arrowId: string, keep: Set<string> | null): ReactElement {
  const title = it.hint ? h("title", null, it.hint) : null;
  const dimmed = keep !== null && it.group !== undefined && !keep.has(it.group);
  const common = { key: i, opacity: dimmed ? DIMMED * (it.opacity ?? 1) : it.opacity, "data-g": it.group === undefined ? undefined : "" };
  switch (it.t) {
    case "rect":
      return h("rect", { ...common, x: it.x, y: it.y, width: Math.max(0, it.w), height: Math.max(0, it.h), rx: it.r, style: colors(mode, it.fill, it.stroke), strokeWidth: it.stroke ? (it.strokeWidth ?? 1) : undefined }, title);
    case "circle":
      return h("circle", { ...common, cx: it.cx, cy: it.cy, r: it.r, style: colors(mode, it.fill, it.stroke), strokeWidth: it.stroke ? (it.strokeWidth ?? 1) : undefined }, title);
    case "path":
      return h(
        "path",
        {
          ...common,
          d: it.d,
          style: colors(mode, it.fill ?? "none", it.stroke),
          strokeWidth: it.stroke ? (it.strokeWidth ?? 1) : undefined,
          strokeLinecap: it.stroke ? "round" : undefined,
          strokeLinejoin: it.stroke ? "round" : undefined,
          strokeDasharray: it.dash,
          markerEnd: it.arrow ? `url(#${arrowId})` : undefined,
        },
        title,
      );
    case "text":
      return h(
        "text",
        {
          ...common,
          x: it.x,
          y: it.y,
          fontSize: it.size,
          fontWeight: it.weight,
          textAnchor: it.anchor && it.anchor !== "start" ? it.anchor : undefined,
          style: { ...colors(mode, it.fill), ...(it.tabular ? { fontVariantNumeric: "tabular-nums" } : {}) },
        },
        it.text,
        title,
      );
  }
}

/** シーンを SVG の React 要素にする。interactive なら、ホバー・キーボードで値を出して該当部分を強調する。 */
export function SceneSvg(props: { scene: Scene; theme?: ThemeMode; fluid?: boolean; interactive?: boolean }): ReactElement {
  const mode = props.theme ?? "auto";
  const { scene } = props;
  const id = `yui${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const arrowId = `${id}-arrow`;
  const fluid = props.fluid ?? mode === "auto";
  const interactive = (props.interactive ?? false) && scene.targets.length > 0;
  const [active, setActive] = useState<number | null>(null);
  // 直前に押したポインタの種類。タッチ・ペンはタップ（click）が確定してから出す
  // （押した瞬間に出すと、スクロールしようと指を置くたびに値が出てしまう）。
  const pointer = useRef<string>("mouse");
  const target = active === null ? null : (scene.targets[active] ?? null);
  const keep = target && target.keep.length ? new Set(target.keep) : null;

  const svg = h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      className: id,
      viewBox: `0 0 ${scene.width} ${scene.height}`,
      width: fluid ? "100%" : scene.width,
      height: fluid ? undefined : scene.height,
      style: fluid ? { maxWidth: scene.width, height: "auto", display: "block" } : { display: "block" },
      role: "img",
      "aria-labelledby": `${id}-t ${id}-d`,
      fontFamily: FONT,
    },
    h("title", { id: `${id}-t` }, scene.title),
    h("desc", { id: `${id}-d` }, scene.desc),
    mode === "auto" ? h("style", null, themeCss(`.${id}`)) : null,
    h(
      "defs",
      null,
      h("marker", { id: arrowId, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, h("path", { d: "M1,1L9,5L1,9Z", style: colors(mode, "muted") })),
    ),
    mode === "auto" ? null : h("rect", { width: "100%", height: "100%", style: colors(mode, "surface") }),
    ...scene.items.map((it, i) => renderItem(it, i, mode, arrowId, keep)),
    interactive && target ? emphasis(target, mode) : null,
    interactive
      ? h(
          "g",
          { key: "hits", "aria-hidden": true },
          ...scene.targets.flatMap((t, i) => {
            const handlers = {
              fill: "transparent",
              style: { cursor: t.tip ? "default" : "pointer" },
              onPointerEnter: (e: PointerEvent) => e.pointerType === "mouse" && setActive(i),
              onPointerLeave: (e: PointerEvent) => e.pointerType === "mouse" && setActive((cur) => (cur === i ? null : cur)),
              onPointerDown: (e: PointerEvent) => {
                pointer.current = e.pointerType;
              },
              onClick: () => pointer.current !== "mouse" && setActive((cur) => (cur === i ? null : i)),
            };
            const rect = h("rect", { key: `r${i}`, x: t.hit.x, y: t.hit.y, width: Math.max(0, t.hit.w), height: Math.max(0, t.hit.h), ...handlers });
            return t.hitPath ? [rect, h("path", { key: `p${i}`, d: t.hitPath, ...handlers })] : [rect];
          }),
        )
      : null,
  );
  if (!interactive) return svg;
  return h(Interactive, { id, scene, mode, target, active, setActive, svg });
}

/** 折れ線の縦線と、強調する点。 */
function emphasis(t: Target, mode: ThemeMode): ReactElement {
  return h(
    "g",
    { key: "emphasis", pointerEvents: "none" },
    t.guide ? h("path", { d: `M${t.guide.x},${t.guide.y1}V${t.guide.y2}`, style: colors(mode, undefined, "axis"), strokeWidth: 1 }) : null,
    ...(t.points ?? []).map((p, i) => h("circle", { key: i, cx: p.x, cy: p.y, r: 5.5, style: colors(mode, p.token, "surface"), strokeWidth: 2 })),
  );
}

/** ホバー・フォーカスの受け口とツールチップ（図の上に重ねる HTML）。 */
function Interactive(props: {
  id: string;
  scene: Scene;
  mode: ThemeMode;
  target: Target | null;
  active: number | null;
  setActive: (v: number | null | ((cur: number | null) => number | null)) => void;
  svg: ReactElement;
}): ReactElement {
  const { id, scene, mode, target, active, setActive } = props;
  const wrap = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const tip = target?.tip;

  // 指す位置（シーン座標）を画面の座標に直し、図の幅からはみ出さないように置く。上に入らなければ下に出す
  useLayoutEffect(() => {
    const el = wrap.current;
    const tipEl = tipRef.current;
    if (!tip || !el || !tipEl) return setPos(null);
    const svgEl = el.querySelector("svg");
    const scale = svgEl ? svgEl.getBoundingClientRect().width / scene.width : 1;
    const box = el.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    const th = tipEl.offsetHeight;
    const ax = tip.x * scale;
    const ay = tip.y * scale;
    const left = Math.min(Math.max(0, ax - w / 2), Math.max(0, box.width - w));
    const top = ay - th - 8 >= 0 ? ay - th - 8 : ay + 12;
    setPos({ left, top });
  }, [tip, scene.width]);

  const count = scene.targets.length;
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step) {
      e.preventDefault();
      setActive((cur) => (cur === null ? (step > 0 ? 0 : count - 1) : (cur + step + count) % count));
    } else if (e.key === "Escape") setActive(null);
  };

  const panel: CSSProperties = {
    position: "absolute",
    left: pos?.left ?? 0,
    top: pos?.top ?? 0,
    visibility: pos ? "visible" : "hidden",
    pointerEvents: "none",
    zIndex: 10,
    minWidth: 120,
    maxWidth: 280,
    padding: "8px 10px",
    borderRadius: 10,
    fontSize: 12,
    lineHeight: 1.45,
    fontFamily: FONT,
    background: paint("surface", mode),
    color: paint("ink", mode),
    border: `1px solid ${paint("border", mode)}`,
    boxShadow: "0 4px 12px -2px rgb(0 0 0 / 0.12), 0 2px 6px -3px rgb(0 0 0 / 0.1)",
  };
  const text = tip ? [tip.title, ...tip.rows.map((r) => `${r.label} ${r.value}`), tip.footer ?? ""].filter(Boolean).join("、") : (target?.say ?? "");

  return h(
    "div",
    {
      ref: wrap,
      className: id,
      style: { position: "relative" },
      tabIndex: 0,
      role: "group",
      "aria-label": `${scene.title}（矢印キーで値を順に表示）`,
      onKeyDown,
      // キーボードで入ったときだけ最初の値を出す（クリック・タップでのフォーカスでは出さない）
      onFocus: (e: { currentTarget: HTMLElement }) => {
        if (e.currentTarget.matches(":focus-visible")) setActive((cur) => cur ?? 0);
      },
      onBlur: () => setActive(null),
      onPointerLeave: (e: PointerEvent) => e.pointerType === "mouse" && setActive(null),
    },
    h("style", null, `.${id}:focus-visible{outline:2px solid var(--yui-focus,${paint("accentLine", mode)});outline-offset:4px;border-radius:8px}.${id} [data-g]{transition:opacity .12s}@media (prefers-reduced-motion:reduce){.${id} [data-g]{transition:none}}`),
    props.svg,
    tip
      ? h(
          "div",
          { ref: tipRef, style: panel, "data-yui-tip": "" },
          h("div", { style: { fontWeight: 600, marginBottom: tip.rows.length ? 4 : 0 } }, tip.title),
          ...tip.rows.map((r, i) =>
            h(
              "div",
              { key: i, style: { display: "flex", alignItems: "center", gap: 6 } },
              r.token ? h("span", { style: { width: 8, height: 8, borderRadius: 999, flex: "none", background: paint(r.token, mode) } }) : null,
              r.label ? h("span", { style: { color: paint("ink2", mode) } }, r.label) : null,
              h("span", { style: { marginLeft: "auto", paddingLeft: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums" } }, r.value),
            ),
          ),
          tip.footer ? h("div", { style: { marginTop: 4, color: paint("muted", mode), fontSize: 11 } }, tip.footer) : null,
        )
      : null,
    // 読み上げ: キーボードで動かした値を伝える
    h("div", { "aria-live": "polite", style: { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } }, active === null ? "" : text),
  );
}

/** 図を描く。幅を指定しなければ親の幅に合わせて描き直す。 */
export function YuiFigure(props: YuiFigureProps): ReactElement {
  // calc は操作できる HTML の部品で描く（静止画は SVG の書き出し）
  if (props.figure.kind === "calc") return h(CalcView, { figure: props.figure, theme: props.theme ?? "auto", locale: props.locale ?? "ja-JP", ...(props.className ? { className: props.className } : {}) });
  if (props.figure.kind === "app")
    return h(AppView, {
      figure: props.figure,
      theme: props.theme ?? "auto",
      locale: props.locale ?? "ja-JP",
      ...(props.className ? { className: props.className } : {}),
      ...(props.onAction ? { onAction: props.onAction } : {}),
      ...(props.actionDisabledReason ? { disabledReason: props.actionDisabledReason } : {}),
    });
  return h(SceneFigure, props);
}

function SceneFigure(props: YuiFigureProps): ReactElement {
  const { figure, theme, width, className, interactive, onAction: _onAction, actionDisabledReason: _reason, ...layoutOpts } = props;
  const [ref, w] = useContainerWidth(width);
  const scene = useMemo(() => layout(figure, { ...layoutOpts, width: w }), [figure, w, layoutOpts.locale, layoutOpts.measure, layoutOpts.labels]);
  return h("div", { ref, className, "data-yui": figure.kind }, h(SceneSvg, { scene, theme: theme ?? "auto", interactive: interactive ?? true }));
}

export interface YuiBlockProps extends Omit<YuiFigureProps, "figure"> {
  /** ` ```ui ` の中身。 */
  source: string;
  /** ストリーミング中か（true なら改行で終わっていない最終行を読まない）。 */
  streaming?: boolean;
  /** フェンスの情報文字列で種類が指定されている場合。 */
  kind?: Kind;
  /** 図にできないときの表示（既定はソースをそのまま表示）。 */
  fallback?: (source: string, diagnostics: Diagnostic[]) => ReactElement | null;
}

/** 除外した行などの診断を、図の下に一言で示す。 */
export function diagnosticsSummary(diags: Diagnostic[]): string | null {
  const dropped = diags.filter((d) => d.severity === "warning").length;
  return dropped > 0 ? `${dropped} 件の行を表示できませんでした` : null;
}

export function YuiBlock(props: YuiBlockProps): ReactElement | null {
  const { source, streaming, kind, fallback, ...rest } = props;
  const result = useMemo(() => parseBlock(source, kind ? { final: !streaming, kind } : { final: !streaming }), [source, streaming, kind]);
  if (!result.figure) {
    if (streaming) return null;
    return fallback ? fallback(source, result.diagnostics) : h("pre", { "data-yui-error": "" }, h("code", null, source));
  }
  const note = streaming ? null : diagnosticsSummary(result.diagnostics);
  return h(
    "figure",
    { style: { margin: 0 }, "data-yui-source": source },
    h(YuiFigure, { ...rest, figure: result.figure }),
    note ? h("figcaption", { style: { fontSize: 12, opacity: 0.7, marginTop: 4 } }, note) : null,
  );
}

/** Markdown レンダラーのコードブロックの className（`language-ui` など）が Yui か。 */
export function isYuiLanguage(className: string | undefined): boolean {
  return /(?:^|\s)language-(?:ui|yui)(?:$|[\s:])/.test(className ?? "");
}
