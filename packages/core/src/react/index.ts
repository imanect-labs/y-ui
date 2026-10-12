/**
 * `@imanect/yui/react`: React で図を描く。
 *
 * - YuiFigure: 中間表現を描く（親の幅に合わせて描き直す）
 * - YuiBlock: ` ```ui ` の中身（ソース）を解析して描く。ストリーミング中でもよい
 * - isYuiLanguage: Markdown レンダラーのコードブロックの言語名が Yui か
 *
 * SVG はシーンから React 要素として組み立てる（HTML 文字列を差し込まない）。
 */

import { createElement as h, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from "react";
import type { Diagnostic, Figure, Kind } from "../ir.js";
import { parseBlock } from "../parse.js";
import { layout, type LayoutOptions } from "../render/layout.js";
import type { Item, Scene } from "../render/scene.js";
import { FONT, paint, themeCss, type ThemeMode, type Token } from "../render/theme.js";

export interface YuiFigureProps extends Omit<LayoutOptions, "width"> {
  figure: Figure;
  /** 既定は auto（CSS 変数・ページの明暗に追従）。 */
  theme?: ThemeMode;
  /** 幅を固定する場合（指定しなければ親の幅に合わせる）。 */
  width?: number;
  className?: string;
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

function renderItem(it: Item, i: number, mode: ThemeMode, arrowId: string): ReactElement {
  const title = it.hint ? h("title", null, it.hint) : null;
  const common = { key: i, opacity: it.opacity };
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

/** シーンを SVG の React 要素にする。 */
export function SceneSvg(props: { scene: Scene; theme?: ThemeMode; fluid?: boolean }): ReactElement {
  const mode = props.theme ?? "auto";
  const { scene } = props;
  const id = `yui${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const arrowId = `${id}-arrow`;
  const fluid = props.fluid ?? mode === "auto";
  return h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      className: id,
      viewBox: `0 0 ${scene.width} ${scene.height}`,
      width: fluid ? "100%" : scene.width,
      height: fluid ? undefined : scene.height,
      style: fluid ? { maxWidth: scene.width, height: "auto", display: "block" } : undefined,
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
    ...scene.items.map((it, i) => renderItem(it, i, mode, arrowId)),
  );
}

/** 図を描く。幅を指定しなければ親の幅に合わせて描き直す。 */
export function YuiFigure(props: YuiFigureProps): ReactElement {
  const { figure, theme, width, className, ...layoutOpts } = props;
  const [ref, w] = useContainerWidth(width);
  const scene = useMemo(() => layout(figure, { ...layoutOpts, width: w }), [figure, w, layoutOpts.locale, layoutOpts.measure]);
  return h("div", { ref, className, "data-yui": figure.kind }, h(SceneSvg, { scene, theme: theme ?? "auto" }));
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
