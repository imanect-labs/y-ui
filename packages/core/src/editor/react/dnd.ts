/**
 * ポインタイベントによる並べ替え（docs/editor.md §4.3）。ライブラリを使わない。
 *
 * - 置き場所の一覧は DOM の印で見つける: `data-yui-list="<id>"`（並ぶ向きは `data-yui-axis="x|y"`）、
 *   その直下の項目は `data-yui-item`。入れ子の一覧（機能の一覧の中の部品の一覧）は、指の下で一番内側のものを選ぶ。
 * - マウスは 4px 動いたら掴む。掴む印（touch-action: none の取っ手）からは押した時点で掴む（タッチでスクロールと取り合わない）。
 * - 掴んでいる間はスクロール領域の端で自動でスクロールし、Escape で取り消す。
 * - HTML5 の Drag and Drop API は使わない（タッチで動かず、見た目も選べないため）。
 * - 札（指に付いてくる名前）と挿入位置の線は ref の要素の style を直接動かす。React の状態が変わるのは
 *   掴んだとき・置き場所が変わったとき・離したときだけ（動かすたびに画面全体を描き直さないため）。
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface DropSpot {
  list: string;
  index: number;
}

export interface DragState<T> {
  item: T;
  label: string;
  over: DropSpot | null;
}

export interface DndOptions<T> {
  /** その一覧に置けるか。 */
  accepts: (item: T, list: string) => boolean;
  onDrop: (item: T, spot: DropSpot) => void;
}

type Line = { x: number; y: number; length: number; vertical: boolean };

const THRESHOLD = 4;
const EDGE = 48;

export function useDnd<T>(root: { current: HTMLElement | null }, opts: DndOptions<T>) {
  const [drag, setDrag] = useState<DragState<T> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const live = useRef<{ item: T; label: string; x: number; y: number; over: DropSpot | null; scroller: HTMLElement | null } | null>(null);
  const suppressClick = useRef(false);
  /** 指に付いてくる札（呼ぶ側が描き、ここで位置を動かす）。 */
  const ghost = useRef<HTMLElement | null>(null);
  /** 挿入位置の線。 */
  const line = useRef<HTMLElement | null>(null);

  const locate = useCallback(
    (item: T, x: number, y: number): { over: DropSpot | null; line: Line | null } => {
      const el = root.current;
      if (!el) return { over: null, line: null };
      let best: { list: HTMLElement; area: number } | null = null;
      for (const list of Array.from(el.querySelectorAll<HTMLElement>("[data-yui-list]"))) {
        const id = list.dataset.yuiList!;
        if (!optsRef.current.accepts(item, id)) continue;
        const r = list.getBoundingClientRect();
        const pad = 16;
        if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) continue;
        const area = r.width * r.height;
        if (!best || area < best.area) best = { list, area };
      }
      if (!best) return { over: null, line: null };
      const list = best.list;
      const vertical = list.dataset.yuiAxis === "x";
      const items = Array.from(list.children).filter((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute("data-yui-item"));
      const rects = items.map((c) => c.getBoundingClientRect());
      let index = rects.length;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i]!;
        const before = vertical ? y < r.top || (y <= r.bottom && x < r.left + r.width / 2) : y < r.top + r.height / 2;
        if (before) {
          index = i;
          break;
        }
      }
      const lr = list.getBoundingClientRect();
      let ln: Line;
      if (vertical) {
        const r = rects[index] ?? rects[index - 1];
        ln = r ? { x: rects[index] ? r.left - 4 : r.right + 4, y: r.top, length: r.height, vertical: true } : { x: lr.left + 8, y: lr.top + 4, length: Math.max(24, lr.height - 8), vertical: true };
      } else {
        const r = rects[index];
        const prev = rects[index - 1];
        const at = r && prev ? (prev.bottom + r.top) / 2 : r ? r.top - 3 : prev ? prev.bottom + 3 : lr.top + 12;
        ln = { x: lr.left + 4, y: at, length: lr.width - 8, vertical: false };
      }
      return { over: { list: list.dataset.yuiList!, index }, line: ln };
    },
    [root],
  );

  /** 指の位置で置き場所を探し、札と線を動かす。置き場所が変わったときだけ React の状態を変える。 */
  const follow = useCallback(
    (x: number, y: number) => {
      const d = live.current;
      if (!d) return;
      d.x = x;
      d.y = y;
      const r = locate(d.item, x, y);
      if (ghost.current) ghost.current.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
      const ln = line.current;
      if (ln) {
        ln.style.display = r.line ? "block" : "none";
        if (r.line) {
          const v = r.line.vertical;
          ln.style.transform = `translate(${v ? r.line.x - 1 : r.line.x}px, ${v ? r.line.y : r.line.y - 1}px)`;
          ln.style.width = `${v ? 3 : r.line.length}px`;
          ln.style.height = `${v ? r.line.length : 3}px`;
        }
      }
      const same = (a: DropSpot | null, b: DropSpot | null) => (a === null ? b === null : b !== null && a.list === b.list && a.index === b.index);
      if (!same(d.over, r.over)) {
        d.over = r.over;
        setDrag({ item: d.item, label: d.label, over: r.over });
      }
    },
    [locate],
  );

  // 自動スクロール（掴んでいる間だけ回す。スクロール領域は掴んだときに一度だけ探す）
  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    const tick = () => {
      const d = live.current;
      if (!d) return;
      const rect = d.scroller ? d.scroller.getBoundingClientRect() : null;
      const top = rect ? rect.top : 0;
      const bottom = rect ? rect.bottom : window.innerHeight;
      const dy = d.y < top + EDGE ? -Math.ceil((top + EDGE - d.y) / 4) : d.y > bottom - EDGE ? Math.ceil((d.y - (bottom - EDGE)) / 4) : 0;
      if (dy) {
        if (d.scroller) d.scroller.scrollTop += dy;
        else window.scrollBy(0, dy);
        follow(d.x, d.y);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drag !== null, follow]);

  /** 押したときに呼ぶ。immediate なら動かす前から掴む（取っ手）。 */
  const start = useCallback(
    (e: ReactPointerEvent, item: T, label: string, immediate = false) => {
      if (e.button !== 0) return;
      const sx = e.clientX;
      const sy = e.clientY;
      let started = false;
      const begin = (x: number, y: number) => {
        started = true;
        document.documentElement.style.userSelect = "none";
        const first = locate(item, x, y);
        live.current = { item, label, x, y, over: first.over, scroller: scrollParent(root.current) };
        setDrag({ item, label, over: first.over });
        // 札と線は描かれた直後に位置を合わせる
        requestAnimationFrame(() => follow(x, y));
      };
      const move = (ev: PointerEvent) => {
        if (!started) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
          begin(ev.clientX, ev.clientY);
        }
        ev.preventDefault();
        follow(ev.clientX, ev.clientY);
      };
      const end = (drop: boolean) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key, true);
        document.documentElement.style.userSelect = "";
        const d = live.current;
        live.current = null;
        setDrag(null);
        if (!started) return;
        // 離した直後の click（選択・パレットの「押して足す」）を 1 回だけ飲み込む。Escape で取り消した後の離しも同じ
        suppressClick.current = true;
        const clear = () => {
          suppressClick.current = false;
          window.removeEventListener("pointerdown", clear, true);
        };
        window.addEventListener("pointerdown", clear, true);
        setTimeout(clear, 400);
        if (drop && d?.over) optsRef.current.onDrop(d.item, d.over);
      };
      const up = () => end(true);
      const cancel = () => end(false);
      const key = (ev: KeyboardEvent) => {
        if (ev.key === "Escape" && started) {
          ev.preventDefault();
          ev.stopPropagation();
          end(false);
        }
      };
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key, true);
      if (immediate) {
        e.preventDefault();
        begin(sx, sy);
      }
    },
    [follow, locate, root],
  );

  return { drag, start, suppressClick, ghost, line };
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}
