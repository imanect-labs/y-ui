/**
 * compare（比較表）・proscons（メリット・デメリット）・swot・checklist（チェックリスト）。
 *
 * - compare: 1 行目が見出し（`機能 | A | B`）、2 行目から `項目 | セル | セル`。セルの ✓・✗・△ は印にする。
 * - proscons: `メリット:` `デメリット:` の見出しの下に箇条書き。見出しが無ければ `+ 項目` / `- 項目`。
 * - swot: `強み:` `弱み:` `機会:` `脅威:` の見出しの下に箇条書き。
 * - checklist: `- [x] 項目`・`- [ ] 項目`・`- [~] 項目`（済・未・進行中）。
 */

import type { ChecklistFigure, ChecklistItem, CompareCell, CompareFigure, ListItem, ProsConsFigure, SwotFigure } from "../ir.js";
import { clip, Diagnostics, hasPipe, isSeparatorRow, LIMITS, type Line, parseOption, splitCells, stripListMarker, takeRefs } from "../lines.js";
import { entry, readEntries } from "./seq.js";
import { indentOf, splitTitle } from "./stack.js";

const OPTIONS = ["note", "src"] as const;

/** `note:` `src:` なら図に入れて true。 */
function option(fig: { note?: string; src?: string }, text: string): boolean {
  const opt = parseOption(text, OPTIONS);
  if (!opt) return false;
  if (opt.key === "note") fig.note = opt.value;
  else fig.src = opt.value;
  return true;
}

// ---------------------------------------------------------------- compare

const YES = /^(?:✓|✔|✔️|✅|☑|○|◯|◎|●|yes|y|true|あり|有り|有|対応|可|使える|できる)(?=$|[\s:：（(、,])/i;
const NO = /^(?:✗|✘|×|✕|❌|☒|x|no|n|false|なし|無し|無|非対応|不可|使えない|できない|-|—|–|ー|－)(?=$|[\s:：（(、,])/i;
const PARTIAL = /^(?:△|▲|一部|部分的|限定|制限あり|条件付き|オプション|partial|limited|optional)(?=$|[\s:：（(、,])/i;
const HIGHLIGHT = /^(?:推奨|おすすめ|オススメ|お勧め|highlight|recommended|best)\s*[:：]\s*(.+)$/i;

/** セルを印と文字に分ける（`✓ 月 10 回まで` → yes と「月 10 回まで」）。 */
export function compareCell(raw: string): CompareCell {
  const text = raw.trim();
  const norm = text.normalize("NFKC");
  for (const [re, mark] of [
    [YES, "yes"],
    [NO, "no"],
    [PARTIAL, "partial"],
  ] as const) {
    const m = re.exec(norm);
    if (!m) continue;
    // 印の後ろの区切り（`: ` や読点）を落とした残りを文字にする
    const rest = norm.slice(m[0].length).replace(/^[\s:：、,]+/, "").trim();
    // 「一部」「オプション」のような語の印は、語そのものも見せる
    return { mark, text: mark === "partial" && rest === "" && !/^[△▲]$/.test(m[0]) ? m[0] : rest };
  }
  return { text };
}

export function parseCompare(fig: CompareFigure, body: Line[], diags: Diagnostics): void {
  let highlight: string | undefined;
  let highlightLine = 0;
  for (const line of body) {
    const raw = stripListMarker(line.text.trim()).text;
    if (raw === "") continue;
    if (!hasPipe(raw) && !raw.includes("\t")) {
      if (option(fig, raw)) continue;
      const h = HIGHLIGHT.exec(raw);
      if (h) {
        highlight = h[1]!.trim();
        highlightLine = line.no;
        continue;
      }
      diags.add(line.no, "warning", "unrecognized_line", `解釈できない行を無視しました: ${raw}`);
      continue;
    }
    const cells = splitCells(raw);
    if (isSeparatorRow(cells)) continue;
    if (fig.columns.length === 0) {
      // 見出し行。比べる選択肢は 6 つまで
      const cols = cells.map((c) => clip(takeRefs(c).text, line.no, diags));
      if (cols.length - 1 > LIMITS.compareOptions) diags.add(line.no, "warning", "limit_exceeded", `比べる選択肢は ${LIMITS.compareOptions} 個までです`);
      fig.columns = cols.slice(0, LIMITS.compareOptions + 1);
      continue;
    }
    if (fig.rows.length >= LIMITS.compareRows) {
      diags.addOnce(line.no, "warning", "limit_exceeded", `比較の項目は ${LIMITS.compareRows} 個までです`);
      continue;
    }
    const n = fig.columns.length - 1;
    const label = takeRefs(cells[0] ?? "");
    const rest = cells.slice(1);
    if (rest.length > n && rest.slice(n).some((c) => c !== "")) diags.add(line.no, "warning", "extra_cells", "見出しより多いセルを無視しました");
    const refs = [...label.refs];
    const row = Array.from({ length: n }, (_, i) => {
      const r = takeRefs(rest[i] ?? "");
      refs.push(...r.refs);
      const c = compareCell(r.text);
      return { ...c, text: clip(c.text, line.no, diags) };
    });
    fig.rows.push({ label: clip(label.text, line.no, diags), cells: row, refs: [...new Set(refs)] });
  }
  if (highlight !== undefined) {
    const key = highlight.normalize("NFKC").toLowerCase();
    const i = fig.columns.findIndex((c, k) => k > 0 && c.normalize("NFKC").toLowerCase() === key);
    if (i > 0) fig.highlight = i;
    else diags.add(highlightLine, "warning", "unrecognized_line", `推奨の選択肢が見出しにありません: ${highlight}`);
  }
}

// ---------------------------------------------------------------- 見出しで分かれた箇条書き（proscons・swot）

/**
 * 見出しの行（`メリット:` `## 強み` `S（強み）:`）で区切られた箇条書きを読む。
 * section は行が見出しならその番号と、見出しの後ろに続く文字（あれば 1 項目目）を返す。
 * 見出しの無い行は fallback で振り分ける（返り値 null は読めない行）。
 */
function readSections(
  fig: { note?: string; src?: string },
  body: Line[],
  diags: Diagnostics,
  count: number,
  limit: number,
  section: (text: string) => { index: number; label: string; rest: string } | null,
  fallback: (raw: string, current: number | null) => { index: number; text: string } | null,
): { lists: ListItem[][]; labels: string[] } {
  const lists: ListItem[][] = Array.from({ length: count }, () => []);
  const labels = Array.from({ length: count }, () => "");
  let current: number | null = null;
  let itemIndent: number | null = null;
  let last: ListItem | null = null;
  const push = (index: number, text: string, line: number) => {
    const list = lists[index]!;
    if (list.length >= limit) {
      diags.addOnce(line, "warning", "limit_exceeded", `1 つの見出しの項目は ${limit} 個までです`);
      last = null;
      return;
    }
    const t = splitTitle(takeRefs(text).text);
    const e = entry(t.title, t.desc, line, diags);
    const item: ListItem = { text: e.title, refs: [...new Set([...takeRefs(text).refs, ...e.refs])] };
    if (e.desc !== undefined) item.desc = e.desc;
    list.push(item);
    last = item;
  };
  for (const line of body) {
    const trimmed = line.text.trim();
    if (trimmed === "") continue;
    const indent = indentOf(line.text);
    if (option(fig, trimmed)) continue;
    const head = section(trimmed.replace(/^#{1,6}\s*/, "").replace(/^\*\*(.+?)\*\*/, "$1"));
    if (head) {
      current = head.index;
      labels[head.index] = clip(head.label, line.no, diags);
      itemIndent = null;
      last = null;
      if (head.rest) push(head.index, head.rest, line.no);
      continue;
    }
    const { text, marked } = stripListMarker(trimmed);
    // 項目より深く字下げした行は、直前の項目の補足に足す
    if (last && itemIndent !== null && indent > itemIndent) {
      const r = takeRefs(text);
      const item: ListItem = last;
      item.desc = clip(item.desc ? `${item.desc}\n${r.text}` : r.text, line.no, diags);
      item.refs = [...new Set([...item.refs, ...r.refs])];
      continue;
    }
    const f = fallback(trimmed, current);
    if (f) {
      itemIndent = indent;
      push(f.index, f.text, line.no);
      continue;
    }
    if (current !== null && (marked || text !== "")) {
      itemIndent = indent;
      push(current, text, line.no);
      continue;
    }
    diags.add(line.no, "warning", "unrecognized_line", `解釈できない行を無視しました: ${trimmed}`);
  }
  return { lists, labels };
}

/** `見出し:`（後ろに項目が続いてもよい）を読む。words は見出しとして認める語。 */
function headLine(text: string, words: RegExp): { label: string; rest: string } | null {
  const m = new RegExp(`^(${words.source})\\s*(?:[（(][^）)]*[）)])?\\s*(?:[:：]\\s*(.*))?$`, "i").exec(text.normalize("NFKC"));
  if (!m) return null;
  // 見出しの名前は書かれたまま（全角の括弧も保つ）。`:` の前まで
  const colon = text.search(/[:：]/);
  const label = (colon >= 0 ? text.slice(0, colon) : text).trim();
  return { label, rest: (m[2] ?? "").trim() };
}

// ---------------------------------------------------------------- proscons

const PROS = /メリット|利点|良い点|よい点|長所|強み|賛成|pros?|advantages?|benefits?|upsides?/;
const CONS = /デメリット|欠点|悪い点|わるい点|短所|弱み|懸念|課題|リスク|反対|cons?|disadvantages?|drawbacks?|downsides?|risks?/;

export function parseProsCons(fig: ProsConsFigure, body: Line[], diags: Diagnostics): void {
  // 表の形（`メリット | デメリット` の見出しと、2 列の行）
  const rows = body.filter((l) => hasPipe(l.text));
  if (rows.length > 0 && rows.length === body.filter((l) => !parseOption(l.text.trim(), OPTIONS)).length) {
    let first = true;
    for (const line of body) {
      if (option(fig, line.text.trim())) continue;
      const cells = splitCells(stripListMarker(line.text.trim()).text);
      if (isSeparatorRow(cells)) continue;
      if (first && headLine(cells[0] ?? "", PROS) && headLine(cells[1] ?? "", CONS)) {
        fig.labels = [cells[0]!.trim(), cells[1]!.trim()];
        first = false;
        continue;
      }
      first = false;
      [0, 1].forEach((side) => {
        const c = cells[side]?.trim();
        if (!c) return;
        const list = side === 0 ? fig.pros : fig.cons;
        if (list.length >= LIMITS.prosconsItems) {
          diags.addOnce(line.no, "warning", "limit_exceeded", `1 つの見出しの項目は ${LIMITS.prosconsItems} 個までです`);
          return;
        }
        const r = takeRefs(c);
        const t = splitTitle(r.text);
        const e = entry(t.title, t.desc, line.no, diags);
        list.push({ text: e.title, ...(e.desc !== undefined ? { desc: e.desc } : {}), refs: [...new Set([...r.refs, ...e.refs])] });
      });
    }
    return;
  }
  const { lists, labels } = readSections(
    fig,
    body,
    diags,
    2,
    LIMITS.prosconsItems,
    (text) => {
      // 「デメリット」は「メリット」を含むので先に見る
      const c = headLine(text, CONS);
      if (c) return { index: 1, ...c };
      const p = headLine(text, PROS);
      return p ? { index: 0, ...p } : null;
    },
    (raw, current) => {
      // 見出しの無い `+ 項目` / `- 項目`、✓ / ✗ の印
      if (/^[+＋]\s+/.test(raw) || /^[✓✔○◯]\s*/.test(raw)) return { index: 0, text: raw.replace(/^(?:[+＋✓✔○◯])\s*/, "") };
      if (/^[✗×✕]\s*/.test(raw) || (current === null && /^[-−－]\s+/.test(raw))) return { index: 1, text: raw.replace(/^(?:[✗×✕\-−－])\s*/, "") };
      return null;
    },
  );
  fig.pros = lists[0]!;
  fig.cons = lists[1]!;
  fig.labels = [labels[0]!, labels[1]!];
}

// ---------------------------------------------------------------- swot

const SWOT_WORDS = [/強み|strengths?|s/, /弱み|weakness(?:es)?|w/, /機会|opportunit(?:y|ies)|o/, /脅威|threats?|t/];

export function parseSwot(fig: SwotFigure, body: Line[], diags: Diagnostics): void {
  const { lists, labels } = readSections(
    fig,
    body,
    diags,
    4,
    LIMITS.swotItems,
    (text) => {
      for (let i = 0; i < 4; i++) {
        // 1 文字の `S` は見出しの形（`S:`・`S（強み）`）のときだけ
        const h = headLine(text, SWOT_WORDS[i]!);
        if (h && (h.label.length > 1 || /[:：（(]/.test(text))) return { index: i, ...h };
      }
      return null;
    },
    () => null,
  );
  fig.sections = lists as SwotFigure["sections"];
  fig.labels = labels as SwotFigure["labels"];
}

// ---------------------------------------------------------------- checklist

const BOX = /^\[([ xX✓✔~\-/・.])\]\s*/;
const DONE_SYM = /^[✓✔☑✅]\s*/;
const TODO_SYM = /^[☐□⬜]\s*/;
const DOING_SYM = /^[◐△▲⏳]\s*/;
const STATE_HEADER = /^(状態|状況|ステータス|status|state|進捗|完了)$/i;
const DONE_WORD = /^(済|済み|完了|done|ok|yes|✓|✔|○|対応済み?|確認済み?)$/i;
const DOING_WORD = /^(進行中|対応中|作業中|確認中|途中|doing|in progress|wip|△)$/i;
const TODO_WORD = /^(未|未着手|未対応|未完了|todo|to do|no|-|×|✗)$/i;

function stateOf(word: string): ChecklistItem["state"] | null {
  const w = word.normalize("NFKC").trim();
  if (DONE_WORD.test(w)) return "done";
  if (DOING_WORD.test(w)) return "doing";
  if (TODO_WORD.test(w)) return "todo";
  return null;
}

export function parseChecklist(fig: ChecklistFigure, body: Line[], diags: Diagnostics): void {
  type Row = { title: string; desc?: string; state: ChecklistItem["state"]; refs: number[]; items?: string[] };
  fig.items = readEntries<Row>(fig, body, diags, LIMITS.checklistItems, "項目", (text, line, first) => {
    let state: ChecklistItem["state"] = "todo";
    let rest = text;
    if (hasPipe(text) || text.includes("\t")) {
      // `項目 | 状態 [| 補足]`
      const cells = splitCells(text);
      if (isSeparatorRow(cells)) return "skip";
      if (first && cells[1] !== undefined && STATE_HEADER.test(cells[1].normalize("NFKC").trim()) && !stateOf(cells[1])) return "skip";
      if (!cells[0]) return null;
      const s = cells[1] !== undefined ? stateOf(cells[1]) : null;
      const e = entry(cells[0], cells.slice(s ? 2 : 1).filter((c) => c !== "").join(" / ") || undefined, line, diags);
      return { title: e.title, ...(e.desc !== undefined ? { desc: e.desc } : {}), state: s ?? "todo", refs: e.refs };
    }
    const box = BOX.exec(rest);
    if (box) {
      const c = box[1]!;
      state = /[xX✓✔]/.test(c) ? "done" : /[~\-/・.]/.test(c) ? "doing" : "todo";
      rest = rest.slice(box[0].length);
    } else if (DONE_SYM.test(rest)) {
      state = "done";
      rest = rest.replace(DONE_SYM, "");
    } else if (TODO_SYM.test(rest)) {
      rest = rest.replace(TODO_SYM, "");
    } else if (DOING_SYM.test(rest)) {
      state = "doing";
      rest = rest.replace(DOING_SYM, "");
    }
    if (rest.trim() === "") return null;
    const t = splitTitle(rest);
    const e = entry(t.title, t.desc, line, diags);
    return { title: e.title, ...(e.desc !== undefined ? { desc: e.desc } : {}), state, refs: e.refs };
  }).map(({ title, desc, state, refs, items }) => {
    // 字下げした箇条書きは補足の段落にする
    const d = [desc, ...(items ?? [])].filter((x) => x !== undefined && x !== "").join("\n");
    return { text: title, ...(d ? { desc: d } : {}), state, refs };
  });
}
