/**
 * AppEditor: app の画面をドラッグ＆ドロップで組み立てる（docs/editor.md §4.4）。
 *
 * - 左: 部品の一覧（パレット）。ドラッグで置くか、押して選んでいる機能の末尾に足す。
 * - 中: キャンバス。AppView と同じ部品の見た目で、並べ替え・選択・問題の印を重ねる。
 * - 右: 選んだものの設定（inspector.ts）。
 * - 上: 問題の一覧（チェッカーの結果。押すとその場所へ飛ぶ）と、元に戻す・やり直す。
 *
 * 幅は親の幅で決める（ダイアログに埋め込むため、画面の幅ではなく自分の幅を測る）。
 * キーボード: 項目にフォーカスして Space で掴み、↑↓（ボタンは ←→ も）で動かし、Space で置く。Escape で戻す。
 * Alt+↑↓ は掴まずに 1 つ動かす。Delete で消す。Ctrl/⌘+Z で元に戻す。
 */

import { createElement as h, Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { initialValue } from "../../app/values.js";
import type { AppAction, AppField, AppFigure } from "../../ir.js";
import { FieldView } from "../../react/app.js";
import { FONT, paint, themeCss, type ThemeMode } from "../../render/theme.js";
import { checkApp, hasErrors, problemsAt, type Problem, type ProblemPath, type WorkflowChoice, type WorkflowInputHint } from "../check.js";
import {
  emptyApp,
  FIELD_TYPES,
  insertAction,
  insertField,
  insertSection,
  moveAction,
  moveField,
  moveSection,
  newAction,
  newField,
  removeAction,
  removeField,
  removeSection,
  updateAction,
  updateApp,
  updateField,
  updateSection,
  type EditResult,
  type FieldType,
} from "../model.js";
import { useDnd, type DropSpot } from "./dnd.js";
import { Inspector, issues, TYPE_LABEL, type Paint, type Selection } from "./inspector.js";
import { Icon, type IconName } from "./icons.js";
import { editorCss } from "./style.js";

export interface AppEditorProps {
  figure: AppFigure;
  onChange: (next: AppFigure) => void;
  /** ボタンの実行先に選べるワークフロー（閉じた集合）。inputs があれば、その入力から部品を作れる。 */
  workflows?: readonly WorkflowChoice[];
  /** `-> chat` を選べるか（既定 false。ミニアプリでは使えない）。 */
  allowChat?: boolean;
  /** 問題が変わったとき（ホストは error があれば保存を止める）。 */
  onProblems?: (problems: Problem[]) => void;
  theme?: ThemeMode;
  locale?: string;
  className?: string;
}

type Drag = { kind: "new-field"; type: FieldType; hint?: WorkflowInputHint } | { kind: "new-action"; workflow: string | null } | { kind: "new-section" } | { kind: "field"; section: number; index: number } | { kind: "action"; section: number; index: number } | { kind: "section"; section: number };

type Layout = "wide" | "mid" | "narrow";

/** 既定の実行先（無し）。描くたびに新しい配列を作らない（チェッカーの結果を毎回作り直さないため）。 */
const NO_WORKFLOWS: readonly WorkflowChoice[] = [];

export function AppEditor(props: AppEditorProps): ReactElement {
  const { figure: f } = props;
  const mode = props.theme ?? "auto";
  const ja = (props.locale ?? "ja-JP").toLowerCase().startsWith("ja");
  const t = (j: string, e: string) => (ja ? j : e);
  const c: Paint = (tok) => paint(tok, mode);
  const scope = `ye${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  // 実行先は中身で見る（ホストがその場で配列を作っても、同じ中身なら同じものとして扱う）
  const workflowsProp = props.workflows ?? NO_WORKFLOWS;
  const workflowsKey = JSON.stringify(workflowsProp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const workflows = useMemo(() => workflowsProp, [workflowsKey]);
  const allowChat = props.allowChat ?? false;
  const root = useRef<HTMLDivElement | null>(null);
  const [sel, setSel] = useState<Selection>({ kind: "app" });
  const [focusProp, setFocusProp] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>("wide");
  /** キーボードで掴んでいる項目（before は掴んだときの図、origin は掴んだときの場所）。 */
  const [grab, setGrab] = useState<{ sel: Selection; before: AppFigure; origin: Selection } | null>(null);
  /** 動かした項目にフォーカスを合わせる（並べ替えで DOM の位置と項目の対応が変わるため）。 */
  const [focusSel, setFocusSel] = useState<Selection | null>(null);
  const [announce, setAnnounce] = useState("");
  const [showAll, setShowAll] = useState(false);
  const history = useRef<{ past: AppFigure[]; future: AppFigure[] }>({ past: [], future: [] });

  const problems = useMemo(() => checkApp(f, { workflows, allowChat, locale: props.locale }), [f, workflows, allowChat, props.locale]);
  const onProblems = props.onProblems;
  // 中身が変わったときだけ知らせる（ホストが状態に持っても描き直しが続かないように）
  const sentProblems = useRef<string | null>(null);
  useEffect(() => {
    const key = JSON.stringify(problems);
    if (key === sentProblems.current) return;
    sentProblems.current = key;
    onProblems?.(problems);
  }, [problems, onProblems]);

  // 自分の幅で並べ方を決める
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const w = e!.contentRect.width;
      setLayout(w >= 880 ? "wide" : w >= 600 ? "mid" : "narrow");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 選択が消えた場所を指していたら、近い場所に寄せる
  useEffect(() => {
    if (sel.kind === "app") return;
    const s = f.sections[sel.section];
    if (!s) setSel(f.sections.length ? { kind: "section", section: f.sections.length - 1 } : { kind: "app" });
    else if (sel.kind === "field" && !s.fields[sel.index]) setSel(s.fields.length ? { kind: "field", section: sel.section, index: s.fields.length - 1 } : { kind: "section", section: sel.section });
    else if (sel.kind === "action" && !s.actions[sel.index]) setSel(s.actions.length ? { kind: "action", section: sel.section, index: s.actions.length - 1 } : { kind: "section", section: sel.section });
  }, [f, sel]);

  const commit = (next: AppFigure, record = true) => {
    if (record) {
      history.current.past = [...history.current.past.slice(-99), f];
      history.current.future = [];
    }
    props.onChange(next);
  };
  const apply = (r: EditResult, then?: (fig: AppFigure) => void): boolean => {
    if (!r.ok) {
      setAnnounce(limitMessage(r.problem, t));
      return false;
    }
    commit(r.figure, !grab);
    then?.(r.figure);
    return true;
  };
  const undo = () => {
    const h0 = history.current;
    const prev = h0.past.pop();
    if (!prev) return;
    h0.future.push(f);
    props.onChange(prev);
    setAnnounce(t("元に戻しました", "Undone"));
  };
  const redo = () => {
    const h0 = history.current;
    const next = h0.future.pop();
    if (!next) return;
    h0.past.push(f);
    props.onChange(next);
    setAnnounce(t("やり直しました", "Redone"));
  };

  /** キーボードの掴みを終える。置くなら、掴んでからの動きを 1 回の操作として記録する（動いていなければ記録しない）。 */
  const endGrab = (drop: boolean) => {
    if (!grab) return;
    if (drop) {
      if (f !== grab.before) {
        history.current.past = [...history.current.past.slice(-99), grab.before];
        history.current.future = [];
      }
    } else {
      props.onChange(grab.before);
      setSel(grab.origin);
      setFocusSel(grab.origin);
    }
    setGrab(null);
  };

  // 掴んだまま別の場所へフォーカスが移ったら、そこで置いたことにする（掴んだままの編集を記録から漏らさない）
  useEffect(() => {
    if (!grab) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-yui-sel]")?.getAttribute("data-yui-sel") === JSON.stringify(grab.sel)) return;
      endGrab(true);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  });

  // ---------------------------------------------------------------- 足す・動かす

  const targetSection = (): number => (sel.kind === "app" ? Math.max(0, f.sections.length - 1) : sel.section);

  const addField = (type: FieldType, at?: { section: number; index: number }, hint?: WorkflowInputHint) => {
    const s = at?.section ?? targetSection();
    const index = at?.index ?? f.sections[s]?.fields.length ?? 0;
    const x = hint ? fromHint(f, hint, ja) : newField(f, type, undefined, ja);
    apply(insertField(f, { section: s, index }, x), () => {
      setSel({ kind: "field", section: s, index });
      setFocusProp(hint ? null : "label");
      setAnnounce(t(`「${x.label}」を足しました`, `Added “${x.label}”`));
    });
  };
  const addAction = (workflow: string | null, at?: { section: number; index: number }) => {
    const s = at?.section ?? targetSection();
    const index = at?.index ?? f.sections[s]?.actions.length ?? 0;
    apply(insertAction(f, { section: s, index }, newAction(f, workflow, ja)), () => {
      setSel({ kind: "action", section: s, index });
      setFocusProp("label");
    });
  };
  const addSection = (index = f.sections.length) => {
    apply(insertSection(f, index, undefined, ja), () => {
      setSel({ kind: "section", section: index });
      setFocusProp("title");
    });
  };

  const moveSel = (s: Selection, delta: -1 | 1): Selection | null => {
    if (s.kind === "section") {
      const to = s.section + delta;
      if (to < 0 || to >= f.sections.length) return null;
      return apply(moveSection(f, s.section, delta > 0 ? to + 1 : to)) ? { kind: "section", section: to } : null;
    }
    if (s.kind === "field" || s.kind === "action") {
      const list = s.kind === "field" ? f.sections[s.section]!.fields : f.sections[s.section]!.actions;
      const move = s.kind === "field" ? moveField : moveAction;
      let to = { section: s.section, index: s.index + delta };
      // 機能の端では隣の機能へ移る（部品・ボタンとも）
      if (to.index < 0 || to.index >= list.length) {
        const ns = s.section + delta;
        const other = f.sections[ns];
        if (!other) return null;
        to = { section: ns, index: delta > 0 ? 0 : (s.kind === "field" ? other.fields : other.actions).length };
        return apply(move(f, { section: s.section, index: s.index }, to)) ? { ...s, section: ns, index: to.index } : null;
      }
      return apply(move(f, { section: s.section, index: s.index }, { section: s.section, index: delta > 0 ? to.index + 1 : to.index })) ? { ...s, index: to.index } : null;
    }
    return null;
  };

  const removeSel = (s: Selection) => {
    const name = describe(f, s, t);
    const r = s.kind === "field" ? removeField(f, { section: s.section, index: s.index }) : s.kind === "action" ? removeAction(f, { section: s.section, index: s.index }) : s.kind === "section" ? removeSection(f, s.section) : null;
    if (r && apply(r)) setAnnounce(t(`${name}を消しました（Ctrl+Z で元に戻せます）`, `Deleted ${name} (Ctrl+Z to undo)`));
  };

  const { drag, start, suppressClick, ghost, line } = useDnd<Drag>(root, {
    accepts: (d, list) => {
      if (d.kind === "new-field" || d.kind === "field") return list.startsWith("fields:");
      if (d.kind === "new-action" || d.kind === "action") return list.startsWith("actions:");
      return list === "sections";
    },
    onDrop: (d, spot: DropSpot) => {
      const s = Number(spot.list.split(":")[1]);
      if (d.kind === "new-field") addField(d.type, { section: s, index: spot.index }, d.hint);
      else if (d.kind === "new-action") addAction(d.workflow, { section: s, index: spot.index });
      else if (d.kind === "new-section") addSection(spot.index);
      else if (d.kind === "field") {
        const idx = d.section === s && d.index < spot.index ? spot.index - 1 : spot.index;
        if (apply(moveField(f, { section: d.section, index: d.index }, { section: s, index: spot.index }))) setSel({ kind: "field", section: s, index: idx });
      } else if (d.kind === "action") {
        const idx = d.section === s && d.index < spot.index ? spot.index - 1 : spot.index;
        if (apply(moveAction(f, { section: d.section, index: d.index }, { section: s, index: spot.index }))) setSel({ kind: "action", section: s, index: idx });
      } else if (d.kind === "section") {
        const idx = d.section < spot.index ? spot.index - 1 : spot.index;
        if (apply(moveSection(f, d.section, spot.index))) setSel({ kind: "section", section: idx });
      }
    },
  });

  // ---------------------------------------------------------------- キーボード

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !typing && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && !typing && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }
    const item = target.closest<HTMLElement>("[data-yui-sel]");
    if (!item || typing || target !== item) return;
    const s = JSON.parse(item.dataset.yuiSel!) as Selection;
    const back = e.key === "ArrowUp" || (e.key === "ArrowLeft" && s.kind === "action");
    const fwd = e.key === "ArrowDown" || (e.key === "ArrowRight" && s.kind === "action");
    if (grab) {
      if (back || fwd) {
        e.preventDefault();
        const moved = moveSel(grab.sel, back ? -1 : 1);
        if (moved) {
          setGrab({ ...grab, sel: moved });
          setSel(moved);
          setFocusSel(moved);
          setAnnounce(position(moved, t));
        }
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        endGrab(true);
        setAnnounce(t(`置きました。${position(grab.sel, t)}`, `Dropped. ${position(grab.sel, t)}`));
      } else if (e.key === "Escape") {
        e.preventDefault();
        endGrab(false);
        setAnnounce(t("動かすのを取り消しました", "Move cancelled"));
      }
      return;
    }
    if ((e.key === " " || e.key === "Enter") && s.kind !== "app") {
      e.preventDefault();
      if (e.key === "Enter") {
        setSel(s);
        return;
      }
      setSel(s);
      setGrab({ sel: s, before: f, origin: s });
      setAnnounce(t(`${describe(f, s, t)}を掴みました。矢印で動かし、Space で置きます。Escape で戻します。`, `Picked up ${describe(f, s, t)}. Use arrows, Space to drop, Escape to cancel.`));
    } else if (e.altKey && (back || fwd)) {
      e.preventDefault();
      const moved = moveSel(s, back ? -1 : 1);
      if (moved) {
        setSel(moved);
        setFocusSel(moved);
        setAnnounce(position(moved, t));
      }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSel(s);
    }
  };

  // 欄へのフォーカスの指定は 1 回だけ使う（設定パネルが開き直すたびに欄がフォーカスを奪わないように）
  useEffect(() => {
    if (focusProp) setFocusProp(null);
  }, [focusProp]);

  // キーボードで動かした項目に、動いた先でフォーカスを合わせる（1 回だけ）
  useEffect(() => {
    if (!focusSel) return;
    root.current?.querySelector<HTMLElement>(`[data-yui-sel='${JSON.stringify(focusSel)}']`)?.focus();
    setFocusSel(null);
  }, [focusSel, f]);

  // ---------------------------------------------------------------- 描画

  const select = (s: Selection, prop: string | null = null) => {
    if (suppressClick.current) return;
    setSel(s);
    setFocusProp(prop);
  };
  const isSel = (s: Selection) => JSON.stringify(s) === JSON.stringify(sel);
  const dragging = (s: Selection) => drag !== null && "section" in drag.item && drag.item.kind === s.kind && JSON.stringify({ kind: drag.item.kind, ...("index" in drag.item ? { section: drag.item.section, index: drag.item.index } : { section: drag.item.section }) }) === JSON.stringify(s);

  const inspector = h(Inspector, {
    key: `insp-${JSON.stringify(sel)}`,
    figure: f,
    sel,
    problems,
    workflows,
    allowChat,
    c,
    ja,
    focusProp,
    setField: (s, i, patch) => apply(updateField(f, { section: s, index: i }, patch)),
    setAction: (s, i, patch) => apply(updateAction(f, { section: s, index: i }, patch)),
    setSection: (s, patch) => apply(updateSection(f, s, patch)),
    setApp: (patch) => commit(updateApp(f, patch)),
    remove: removeSel,
    move: (s, d) => {
      const m = moveSel(s, d);
      if (m) setSel(m);
    },
  });

  const canvas = h(
    "div",
    { className: "ye-canvas" },
    h(ProblemList, { problems, f, t, showAll, setShowAll, go: (p: Problem) => select(selOf(p.path), p.path.prop ?? null) }),
    h(
      "div",
      { className: "ye-app-title", "data-yui-sel": JSON.stringify({ kind: "app" }), tabIndex: 0, onClick: () => select({ kind: "app" }), "aria-current": isSel({ kind: "app" }) || undefined },
      f.title ? f.title : h("span", { className: "ye-muted" }, t("（画面の見出しなし）", "(no title)")),
    ),
    layout === "narrow" && sel.kind === "app" ? h("div", { className: "ye-inline" }, inspector) : null,
    h(
      "div",
      { className: "ye-sections", "data-yui-list": "sections", "data-yui-axis": "y" },
      ...f.sections.map((s, si) => {
        const ss: Selection = { kind: "section", section: si };
        const secProblems = problems.filter((p) => p.path.section === si && p.path.field === undefined && p.path.action === undefined);
        return h(
          "section",
          { key: si, "data-yui-item": "", className: `ye-section${isSel(ss) ? " is-sel" : ""}${dragging(ss) ? " is-drag" : ""}${secProblems.some((p) => p.severity === "error") ? " has-err" : ""}` },
          h(
            "div",
            { className: "ye-section-head", "data-yui-sel": JSON.stringify(ss), tabIndex: 0, role: "button", "aria-pressed": isSel(ss), "aria-label": t(`機能「${s.title ?? "見出しなし"}」`, `Section “${s.title ?? "untitled"}”`), onClick: () => select(ss), onPointerDown: (e) => start(e, { kind: "section", section: si }, s.title || t("機能", "Section")) },
            grip(t("機能を動かす", "Move section"), (e) => start(e, { kind: "section", section: si }, s.title || t("機能", "Section"), true)),
            h("div", { style: { minWidth: 0, flex: 1, display: "grid", gap: 2 } }, h("div", { className: "ye-section-title" }, s.title || h("span", { className: "ye-muted" }, t(`機能 ${si + 1}（見出しなし）`, `Section ${si + 1} (untitled)`))), s.desc ? h("div", { className: "ye-section-desc" }, s.desc) : null),
            badge(secProblems),
          ),
          issues({ problems: secProblems, c }, { section: si }, `sec${si}`),
          h(
            "div",
            { className: "ye-fields", "data-yui-list": `fields:${si}`, "data-yui-axis": "y" },
            ...s.fields.map((x, fi) => fieldRow(x, si, fi)),
            s.fields.length === 0
              ? h(
                  "div",
                  { className: "ye-empty" },
                  h("div", null, layout === "wide" ? t("左の一覧から入力をここへドラッグするか、押して足します", "Drag inputs here from the palette, or click to add") : t("上の一覧から入力をここへドラッグするか、押して足します", "Drag inputs here from the strip above, or click to add")),
                  h(
                    "div",
                    { className: "ye-quick" },
                    ...(["text", "number", "choice", "date"] as const).map((ty) => h("button", { key: ty, type: "button", className: "ye-quick-item", onClick: () => addField(ty, { section: si, index: 0 }) }, h(Icon, { name: ty }), ja ? TYPE_LABEL[ty].ja : TYPE_LABEL[ty].en)),
                  ),
                )
              : null,
          ),
          h(
            "div",
            { className: "ye-actions", "data-yui-list": `actions:${si}`, "data-yui-axis": "x" },
            ...s.actions.map((a, ai) => actionChip(a, si, ai)),
            h("button", { type: "button", className: "ye-add-action", onClick: () => addAction(workflows[0]?.name ?? (allowChat ? null : ""), { section: si, index: s.actions.length }) }, t("＋ ボタン", "+ Button")),
          ),
          s.actions.some((_, ai) => problemsAt(problems, { section: si, action: ai }).length)
            ? h(
                "div",
                { className: "ye-action-issues" },
                ...s.actions.map((a, ai) => {
                  const list = problemsAt(problems, { section: si, action: ai });
                  return list.length ? h("div", { key: ai, className: "ye-action-issue" }, h("span", { className: "ye-where" }, `「${a.label}」`), issues({ problems: list.slice(0, 2), c }, { section: si, action: ai }, `a${si}-${ai}`)) : null;
                }),
              )
            : null,
          layout === "narrow" && (isSel(ss) || (sel.kind !== "app" && sel.section === si && sel.kind === "action")) ? h("div", { className: "ye-inline" }, inspector) : null,
        );
      }),
    ),
    h("button", { type: "button", className: "ye-add-section", onClick: () => addSection() }, t("＋ 機能を足す（入力とボタンのまとまり）", "+ Add a section")),
  );

  function fieldRow(x: AppField, si: number, fi: number): ReactElement {
    const fs: Selection = { kind: "field", section: si, index: fi };
    const list = problemsAt(problems, { section: si, field: fi });
    const err = list.some((p) => p.severity === "error");
    return h(
      Fragment,
      { key: `${si}-${fi}` },
      h(
        "div",
        {
          "data-yui-item": "",
          "data-yui-sel": JSON.stringify(fs),
          tabIndex: 0,
          role: "button",
          "aria-pressed": isSel(fs),
          "aria-label": `${x.label}（${ja ? TYPE_LABEL[x.type].ja : TYPE_LABEL[x.type].en}）${err ? t("・エラーあり", " · has errors") : ""}`,
          className: `ye-field${isSel(fs) ? " is-sel" : ""}${dragging(fs) ? " is-drag" : ""}${grab && JSON.stringify(grab.sel) === JSON.stringify(fs) ? " is-grab" : ""}${err ? " has-err" : list.length ? " has-warn" : ""}`,
          onClick: () => select(fs, null),
          onPointerDown: (e) => {
            if (e.pointerType === "mouse") start(e, { kind: "field", section: si, index: fi }, `${x.label} · ${ja ? TYPE_LABEL[x.type].ja : TYPE_LABEL[x.type].en}`);
          },
        },
        grip(t(`「${x.label}」を動かす`, `Move “${x.label}”`), (e) => start(e, { kind: "field", section: si, index: fi }, `${x.label} · ${ja ? TYPE_LABEL[x.type].ja : TYPE_LABEL[x.type].en}`, true)),
        h("div", { className: "ye-preview", "aria-hidden": true }, h(FieldView, { field: x, id: `${scope}-p${si}-${fi}`, value: initialValue(x), set: () => {}, c, ja, disabled: true })),
        h("div", { className: "ye-meta" }, h("span", { className: "ye-type" }, ja ? TYPE_LABEL[x.type].ja : TYPE_LABEL[x.type].en), x.key !== x.label ? h("code", { className: "ye-key", title: t("送る名前（key）", "Key") }, x.key) : null, badge(list)),
        list.length ? h("div", { className: "ye-field-issues" }, issues({ problems: list.slice(0, 2), c }, { section: si, field: fi }, `f${si}-${fi}`)) : null,
      ),
      // 開いた設定は一覧の項目に数えない（data-yui-item を付けない。置き場所の数がずれるため）
      layout === "narrow" && isSel(fs) ? h("div", { className: "ye-inline" }, inspector) : null,
    );
  }

  function actionChip(a: AppAction, si: number, ai: number): ReactElement {
    const as: Selection = { kind: "action", section: si, index: ai };
    const list = problemsAt(problems, { section: si, action: ai });
    const err = list.some((p) => p.severity === "error");
    const target = a.target.kind === "chat" ? t("会話に送る", "to chat") : a.target.name || t("実行先なし", "no target");
    return h(
      "div",
      {
        key: `${si}-a${ai}`,
        "data-yui-item": "",
        "data-yui-sel": JSON.stringify(as),
        tabIndex: 0,
        role: "button",
        "aria-pressed": isSel(as),
        "aria-label": t(`ボタン「${a.label}」（${target}）`, `Button “${a.label}” (${target})`),
        className: `ye-chip${ai === 0 ? " is-primary" : ""}${isSel(as) ? " is-sel" : ""}${dragging(as) ? " is-drag" : ""}${grab && JSON.stringify(grab.sel) === JSON.stringify(as) ? " is-grab" : ""}${err ? " has-err" : list.length ? " has-warn" : ""}`,
        onClick: () => select(as),
        onPointerDown: (e) => start(e, { kind: "action", section: si, index: ai }, a.label),
      },
      h("span", { className: "ye-chip-label" }, a.label || t("（文言なし）", "(no text)")),
      h("span", { className: "ye-chip-target" }, a.target.kind === "chat" ? "↩ " : "▶ ", target),
      badge(list),
    );
  }

  const palette = h(Palette, { f, sel, workflows, allowChat, ja, t, start, suppressClick, addField, addAction, addSection, layout });

  const body =
    layout === "wide"
      ? h("div", { className: "ye-body ye-wide" }, h("aside", { className: "ye-side" }, palette), canvas, h("aside", { className: "ye-side ye-right" }, inspector))
      : layout === "mid"
        ? h("div", { className: "ye-body ye-mid" }, h("div", { className: "ye-top" }, palette), h("div", { className: "ye-split" }, canvas, h("aside", { className: "ye-side ye-right" }, inspector)))
        : h("div", { className: "ye-body ye-narrow" }, h("div", { className: "ye-top" }, palette), canvas);

  return h(
    "div",
    {
      ref: root,
      className: [scope, props.className].filter(Boolean).join(" "),
      "data-yui": "app-editor",
      "data-layout": layout,
      "data-dragging": drag ? "" : undefined,
      onKeyDown,
      style: { fontFamily: FONT, color: c("ink") },
    },
    mode === "auto" ? h("style", null, themeCss(`.${scope}`)) : null,
    h("style", null, editorCss(`.${scope}`, c)),
    h(
      "div",
      { className: "ye-toolbar" },
      h("div", { className: "ye-status", role: "status", "aria-live": "polite" }, statusText(problems, t)),
      h("span", { style: { flex: 1 } }),
      h("button", { type: "button", className: "ye-ghost", disabled: history.current.past.length === 0, onClick: undo, title: "Ctrl+Z" }, t("↶ 元に戻す", "↶ Undo")),
      h("button", { type: "button", className: "ye-ghost", disabled: history.current.future.length === 0, onClick: redo, title: "Ctrl+Shift+Z" }, t("↷ やり直す", "↷ Redo")),
    ),
    body,
    h("div", { className: "ye-sr", "aria-live": "assertive" }, announce),
    // 札と線の位置は useDnd が style を直接動かす（指を動かすたびに描き直さない）
    drag ? h("div", { ref: ghost, className: "ye-ghost-drag", "aria-hidden": true }, drag.label) : null,
    drag ? h("div", { ref: line, className: "ye-drop-line", "aria-hidden": true, style: { display: "none" } }) : null,
  );
}

// ---------------------------------------------------------------- パレット

interface PaletteProps {
  f: AppFigure;
  sel: Selection;
  workflows: readonly WorkflowChoice[];
  allowChat: boolean;
  ja: boolean;
  t: (j: string, e: string) => string;
  start: ReturnType<typeof useDnd<Drag>>["start"];
  suppressClick: { current: boolean };
  addField: (type: FieldType, at?: { section: number; index: number }, hint?: WorkflowInputHint) => void;
  addAction: (workflow: string | null) => void;
  addSection: () => void;
  layout: Layout;
}

function Palette(p: PaletteProps): ReactElement {
  const { t, ja } = p;
  const section = p.sel.kind === "app" ? p.f.sections.length - 1 : p.sel.section;
  const sec = p.f.sections[section];
  // 選んでいる機能のボタンが起動するワークフローの、まだ部品の無い入力
  const names = new Set(sec?.actions.flatMap((a) => (a.target.kind === "workflow" ? [a.target.name] : [])) ?? []);
  const hints = p.workflows.filter((w) => names.has(w.name)).flatMap((w) => (w.inputs ?? []).filter((i) => !sec?.fields.some((x) => x.key === i.key)).map((i) => ({ w: w.name, i })));
  const item = (key: string, glyph: IconName, label: string, drag: Drag, onClick: () => void, sub?: string) =>
    h(
      "button",
      {
        key,
        type: "button",
        className: "ye-pal-item",
        // ドラッグで運んだ（取り消した）後の click では足さない
        onClick: () => {
          if (!p.suppressClick.current) onClick();
        },
        onPointerDown: (e: Parameters<PaletteProps["start"]>[0]) => p.start(e, drag, label, false),
        title: t("ドラッグで置く・押すと末尾に足す", "Drag to place, click to append"),
      },
      h("span", { className: "ye-glyph", "aria-hidden": true }, h(Icon, { name: glyph })),
      h("span", { className: "ye-pal-text" }, label, sub ? h("span", { className: "ye-pal-sub" }, sub) : null),
    );
  const group = (title: string, items: ReactNode[]) => (items.length ? h("div", { className: "ye-pal-group", key: title }, h("div", { className: "ye-pal-title" }, title), h("div", { className: "ye-pal-items" }, ...items)) : null);
  return h(
    "div",
    { className: "ye-palette", "aria-label": t("部品の一覧", "Palette") },
    group(
      t("入力", "Inputs"),
      FIELD_TYPES.map((ty) => item(ty, ty, ja ? TYPE_LABEL[ty].ja : TYPE_LABEL[ty].en, { kind: "new-field", type: ty }, () => p.addField(ty))),
    ),
    group(t("ボタン", "Buttons"), [
      ...p.workflows.map((w) => item(`w-${w.name}`, "workflow", w.name, { kind: "new-action", workflow: w.name }, () => p.addAction(w.name), t("ワークフローを起動", "Run workflow"))),
      ...(p.allowChat ? [item("chat", "chat", t("会話に送る", "Send to chat"), { kind: "new-action", workflow: null }, () => p.addAction(null))] : []),
      ...(p.workflows.length === 0 && !p.allowChat ? [h("div", { key: "none", className: "ye-pal-none" }, t("選べるワークフローがありません", "No workflows available"))] : []),
    ]),
    group(t("まとまり", "Layout"), [item("section", "section", t("機能", "Section"), { kind: "new-section" }, () => p.addSection(), t("入力とボタンのまとまり", "Group of inputs and buttons"))]),
    // 選んでいる機能のボタンの実行先の入力（足りないもの）。一覧の最後に置き、出入りで上の並びを動かさない
    hints.length ? group(t("実行先の入力（まだ無いもの）", "Missing workflow inputs"), hints.map(({ w, i }) => item(`h-${w}-${i.key}`, i.type ?? "text", i.label ?? i.key, { kind: "new-field", type: i.type ?? "text", hint: i }, () => p.addField(i.type ?? "text", undefined, i), `${t("送る名前", "key")} ${i.key}${i.required ? t("・必須", " · required") : ""}`))) : null,
  );
}

// ---------------------------------------------------------------- 問題の一覧

function ProblemList(p: { problems: Problem[]; f: AppFigure; t: (j: string, e: string) => string; showAll: boolean; setShowAll: (v: boolean) => void; go: (p: Problem) => void }): ReactElement | null {
  const { problems, t } = p;
  const real = problems.filter((x) => x.code !== "empty");
  if (!real.length) return null;
  const shown = p.showAll ? real : real.slice(0, 4);
  const errors = real.filter((x) => x.severity === "error").length;
  return h(
    "div",
    { className: `ye-problems${errors ? " has-err" : ""}`, role: "region", "aria-label": t("問題", "Problems") },
    h("div", { className: "ye-problems-head" }, errors ? t(`保存できない問題が ${errors} 件あります`, `${errors} problem(s) block saving`) : t(`確かめたいことが ${real.length} 件あります`, `${real.length} thing(s) to check`)),
    h(
      "ul",
      { role: "list" },
      ...shown.map((x, i) =>
        h(
          "li",
          { key: i },
          h(
            "button",
            { type: "button", className: x.severity === "error" ? "ye-err" : "ye-warn", onClick: () => p.go(x) },
            h("span", { className: "ye-dot", "aria-hidden": true }),
            h("span", { className: "ye-where" }, where(p.f, x.path, t)),
            h("span", null, x.message),
          ),
        ),
      ),
    ),
    real.length > 4 ? h("button", { type: "button", className: "ye-link", onClick: () => p.setShowAll(!p.showAll) }, p.showAll ? t("少なく表示", "Show less") : t(`ほか ${real.length - 4} 件を表示`, `Show ${real.length - 4} more`)) : null,
  );
}

// ---------------------------------------------------------------- 小物

function grip(label: string, onPointerDown: (e: Parameters<ReturnType<typeof useDnd>["start"]>[0]) => void): ReactElement {
  return h(
    "span",
    {
      className: "ye-grip",
      "aria-hidden": true,
      title: label,
      onPointerDown: (e: Parameters<typeof onPointerDown>[0]) => {
        e.stopPropagation();
        onPointerDown(e);
      },
    },
    h("svg", { width: 10, height: 16, viewBox: "0 0 10 16", "aria-hidden": true }, ...[2, 8, 14].flatMap((y) => [h("circle", { key: `a${y}`, cx: 2.5, cy: y, r: 1.4 }), h("circle", { key: `b${y}`, cx: 7.5, cy: y, r: 1.4 })])),
  );
}

function badge(list: Problem[]): ReactNode {
  const e = list.filter((p) => p.severity === "error").length;
  const w = list.length - e;
  if (!list.length) return null;
  return h("span", { className: `ye-badge${e ? " is-err" : " is-warn"}`, "aria-hidden": true }, e ? `${e}` : `${w}`);
}

function statusText(problems: Problem[], t: (j: string, e: string) => string): ReactNode {
  if (problems.length === 1 && problems[0]!.code === "empty") return t("部品を置いて始めましょう", "Add parts to get started");
  const e = problems.filter((p) => p.severity === "error").length;
  const w = problems.length - e;
  const dot = (cls: string) => h("span", { className: `ye-dot ${cls}`, "aria-hidden": true });
  if (e) return h(Fragment, null, h("span", { className: "ye-err" }, dot(""), " ", t(`エラー ${e} 件`, `${e} error(s)`)), w ? h("span", { className: "ye-warn" }, "　", dot(""), " ", t(`注意 ${w} 件`, `${w} warning(s)`)) : null);
  if (w) return h("span", { className: "ye-warn" }, dot(""), " ", t(`注意 ${w} 件`, `${w} warning(s)`));
  return hasErrors(problems) ? "" : t("✓ 問題はありません", "✓ No problems");
}

function selOf(p: ProblemPath): Selection {
  if (p.section === undefined) return { kind: "app" };
  if (p.field !== undefined) return { kind: "field", section: p.section, index: p.field };
  if (p.action !== undefined) return { kind: "action", section: p.section, index: p.action };
  return { kind: "section", section: p.section };
}

function where(f: AppFigure, p: ProblemPath, t: (j: string, e: string) => string): string {
  if (p.section === undefined) return t("画面", "Screen");
  const s = f.sections[p.section];
  const sec = s?.title || t(`機能 ${p.section + 1}`, `Section ${p.section + 1}`);
  if (p.field !== undefined) return `${sec} › ${s?.fields[p.field]?.label || t(`入力 ${p.field + 1}`, `Input ${p.field + 1}`)}`;
  if (p.action !== undefined) return `${sec} › ${t("ボタン", "Button")}「${s?.actions[p.action]?.label ?? ""}」`;
  return sec;
}

function describe(f: AppFigure, s: Selection, t: (j: string, e: string) => string): string {
  if (s.kind === "field") return t(`入力「${f.sections[s.section]?.fields[s.index]?.label ?? ""}」`, `input “${f.sections[s.section]?.fields[s.index]?.label ?? ""}”`);
  if (s.kind === "action") return t(`ボタン「${f.sections[s.section]?.actions[s.index]?.label ?? ""}」`, `button “${f.sections[s.section]?.actions[s.index]?.label ?? ""}”`);
  if (s.kind === "section") return t(`機能「${f.sections[s.section]?.title ?? ""}」`, `section “${f.sections[s.section]?.title ?? ""}”`);
  return t("画面", "screen");
}

function position(s: Selection, t: (j: string, e: string) => string): string {
  if (s.kind === "section") return t(`${s.section + 1} 番目の機能`, `Section ${s.section + 1}`);
  if (s.kind === "app") return "";
  return t(`機能 ${s.section + 1} の ${s.index + 1} 番目`, `Section ${s.section + 1}, position ${s.index + 1}`);
}

function limitMessage(p: string, t: (j: string, e: string) => string): string {
  switch (p) {
    case "limit_sections":
      return t("機能は 6 個までです", "Up to 6 sections");
    case "limit_fields":
      return t("入力は全体で 40 個までです", "Up to 40 inputs");
    case "limit_section_fields":
      return t("1 つの機能の入力は 20 個までです", "Up to 20 inputs per section");
    case "limit_actions":
      return t("1 つの機能のボタンは 3 個までです", "Up to 3 buttons per section");
    default:
      return t("そこには置けません", "Can't place it there");
  }
}

/** ワークフローの入力から部品を作る（key・必須・選択肢・範囲を写す）。 */
function fromHint(f: AppFigure, i: WorkflowInputHint, ja: boolean): AppField {
  // 英字の入力名なら `as` で送る名前にでき、ラベルは自由に付けられる。日本語の入力名はラベルがそのまま
  // 送る名前になるので、名前を変えない（重ならない名前に変えると、実行先の入力に当たらなくなる）
  const ascii = /^[A-Za-z_][\w.-]{0,63}$/.test(i.key);
  const label = ascii ? (i.label ?? i.key) : i.key;
  const x = newField(emptyApp(), i.type ?? "text", label, ja);
  const out: AppField = { ...x, label, key: ascii ? i.key : label, required: i.required ?? false };
  if ((i.type ?? "text") === "choice" && i.options && i.options.length >= 2) out.options = i.options.map((v) => ({ label: v, value: v }));
  if ((i.type ?? "text") === "choice" && i.multi) out.multi = true;
  if (i.min !== undefined && i.max !== undefined) Object.assign(out, { min: i.min, max: i.max });
  return out;
}
