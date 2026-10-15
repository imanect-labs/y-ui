/**
 * ask（質問のカード）と plan（計画のカード）。どちらも回答を会話に送る（docs/emit-ui-replacement.md）。
 *
 * ask:
 *   > 前置き
 *   ? 質問文 [multi] [任意] [例 …]
 *   - 選択肢: 説明
 *   - その他            （自由記述を受ける）
 *   button 回答する     （送るボタンの文言）
 * plan:
 *   > 前置き
 *   1. 見出し: 説明
 *   button この計画で進める
 *   revise: off         （修正の依頼を受けない）
 */

import type { AskFigure, AskQuestion, PlanFigure, StepsFigure } from "../ir.js";
import { clip, Diagnostics, LIMITS, type Line, parseOption, stripListMarker } from "../lines.js";
import { parseSteps } from "./seq.js";
import { splitTitle } from "./stack.js";

const QUESTION = /^(?:[?？]|Q\s*[.:：]|質問\s*[:：])\s*(.+)$/i;
const BUTTON = /^(?:button|ボタン)\s+(.+)$/i;
const OTHER = /^(?:その他|other|others|そのほか)(?:\s*[（(].*[)）]|\s*[:：].*)?$/i;
const MULTI = /(?:^|\s)(?:multi|複数(?:可|選択)?|\(複数可\)|（複数可）)(?=\s|$)/i;
const OPTIONAL = /(?:^|\s)(?:任意|optional)(?=\s|$)/i;
const EXAMPLE = /(?:^|\s)(?:例|e\.g\.)\s+(.+)$/i;

export function parseAsk(fig: AskFigure, body: Line[], diags: Diagnostics): void {
  let q: AskQuestion | null = null;
  for (const line of body) {
    const trimmed = line.text.trim();
    if (trimmed === "") continue;
    const opt = parseOption(trimmed, ["note", "src"]);
    if (opt) {
      if (opt.key === "note") fig.note = opt.value;
      else fig.src = opt.value;
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      fig.intro = clip(fig.intro ? `${fig.intro}\n${quote[1]!.trim()}` : quote[1]!.trim(), line.no, diags);
      continue;
    }
    const b = BUTTON.exec(trimmed);
    if (b) {
      fig.submitLabel = clip(b[1]!.trim(), line.no, diags);
      continue;
    }
    const m = QUESTION.exec(trimmed);
    if (m) {
      if (fig.questions.length >= LIMITS.askQuestions) {
        diags.addOnce(line.no, "warning", "limit_exceeded", `質問は ${LIMITS.askQuestions} 個までです`);
        q = null;
        continue;
      }
      let text = ` ${m[1]!} `;
      const multi = MULTI.test(text);
      text = text.replace(MULTI, " ");
      const optional = OPTIONAL.test(text);
      text = text.replace(OPTIONAL, " ");
      const ex = EXAMPLE.exec(text.trimEnd());
      if (ex) text = text.trimEnd().slice(0, ex.index);
      q = { id: `q${fig.questions.length + 1}`, text: clip(text.trim(), line.no, diags), options: [], multi, other: false, required: !optional };
      if (ex) q.placeholder = clip(ex[1]!.trim(), line.no, diags);
      fig.questions.push(q);
      continue;
    }
    const { text, marked } = stripListMarker(trimmed);
    if (q && marked) {
      if (OTHER.test(text.normalize("NFKC"))) {
        q.other = true;
        continue;
      }
      if (q.options.length >= LIMITS.askOptions) {
        diags.addOnce(line.no, "warning", "limit_exceeded", `選択肢は 1 つの質問に ${LIMITS.askOptions} 個までです`);
        continue;
      }
      const t = splitTitle(text);
      q.options.push({ label: clip(t.title, line.no, diags), ...(t.desc !== undefined ? { desc: clip(t.desc, line.no, diags) } : {}) });
      continue;
    }
    diags.add(line.no, "warning", "unrecognized_line", `解釈できない行を無視しました（質問は「? 質問文」、選択肢は「- 選択肢」）: ${trimmed}`);
  }
  // 選択肢が 1 つだけの質問は選べないので、自由記述にする
  for (const x of fig.questions) {
    if (x.options.length === 1) {
      diags.add(0, "warning", "unrecognized_line", `選択肢が 1 つの質問は自由記述にしました: ${x.text}`);
      x.options = [];
    }
    if (x.options.length === 0) {
      x.multi = false;
      x.other = false;
    }
  }
}

export function parsePlan(fig: PlanFigure, body: Line[], diags: Diagnostics): void {
  const rest: Line[] = [];
  for (const line of body) {
    const trimmed = line.text.trim();
    if (trimmed === "") continue;
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      fig.intro = clip(fig.intro ? `${fig.intro}\n${quote[1]!.trim()}` : quote[1]!.trim(), line.no, diags);
      continue;
    }
    const b = BUTTON.exec(trimmed);
    if (b) {
      fig.approveLabel = clip(b[1]!.trim(), line.no, diags);
      continue;
    }
    const rv = /^(?:revise|修正)\s*[:：]\s*(.+)$/i.exec(trimmed);
    if (rv) {
      fig.revise = !/^(off|false|no|0|なし|しない|不可)$/i.test(rv[1]!.trim());
      continue;
    }
    rest.push(line);
  }
  // 手順は steps と同じ書き方（番号・`見出し: 説明`・字下げの段落）
  const steps: StepsFigure = { kind: "steps", title: "", refs: [], steps: [] };
  parseSteps(steps, rest, diags);
  if (steps.note !== undefined) fig.note = steps.note;
  if (steps.src !== undefined) fig.src = steps.src;
  if (steps.steps.length > LIMITS.planSteps) diags.add(0, "warning", "limit_exceeded", `計画の手順は ${LIMITS.planSteps} 個までです`);
  fig.steps = steps.steps.slice(0, LIMITS.planSteps);
}
