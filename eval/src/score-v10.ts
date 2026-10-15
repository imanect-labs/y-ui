/**
 * 採点（emit_ui の置き換えで足した種類）: app・ask・plan・callout・map。
 * radar・treemap は表のグラフとして score.ts の scoreChart で採点する。
 */

import type { AppFigure, AskFigure, CalloutFigure, MapFigure, PlanFigure } from "@imanect/yui";
import type { PartScore } from "./score-v07.js";
import { matchByText, similarity } from "./similarity.js";

function f1(tp: number, goldN: number, modelN: number): number {
  if (goldN === 0 && modelN === 0) return 1;
  const p = modelN === 0 ? 0 : tp / modelN;
  const r = goldN === 0 ? 0 : tp / goldN;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

/** 入力の種類の同値（自由記述の 1 行・複数行、数値の入れ方の違いは問わない）。 */
const TYPE_GROUP: Record<string, string> = { text: "text", textarea: "text", number: "number", slider: "number", count: "number", choice: "choice", date: "date", daterange: "daterange", month: "month", toggle: "toggle", rating: "rating" };

export function scoreApp(gold: AppFigure, f: AppFigure): PartScore {
  const gf = gold.sections.flatMap((s) => s.fields);
  const mf = f.sections.flatMap((s) => s.fields);
  const map = matchByText(gf.map((x) => x.label), mf.map((x) => x.label), 0.5);
  let typeOk = 0;
  let reqGold = 0;
  let reqOk = 0;
  for (const [g, m] of map) {
    if (TYPE_GROUP[gf[g]!.type] === TYPE_GROUP[mf[m]!.type]) typeOk++;
    // 必須は取りこぼしだけを見る（資料に指定の無い項目を必須にするのは誤りとしない）
    if (gf[g]!.required) {
      reqGold++;
      if (mf[m]!.required) reqOk++;
    }
  }
  const fieldF1 = f1(map.size, gf.length, mf.length);
  const typeAcc = map.size ? typeOk / map.size : 0;
  const reqAcc = reqGold ? reqOk / reqGold : 1;
  // 実行先: 正解のワークフロー名がすべてあり、資料に無い名前を作っていないこと
  const targets = (x: AppFigure) => x.sections.flatMap((s) => s.actions.map((a) => (a.target.kind === "workflow" ? `w:${a.target.name}` : "chat")));
  const gt = new Set(targets(gold));
  const mt = new Set(targets(f));
  const missing = [...gt].filter((t) => !mt.has(t)).length;
  const fabricated = [...mt].filter((t) => t.startsWith("w:") && !gt.has(t)).length;
  const targetsOk = missing === 0 && fabricated === 0;
  return {
    pass: fieldF1 >= 0.85 && typeAcc >= 0.85 && reqAcc >= 0.8 && targetsOk,
    semantic: fieldF1 * typeAcc * (targetsOk ? 1 : 0.5),
    fabricated,
    detail: { fieldF1, typeAcc, reqAcc, missingTargets: missing, fabricatedTargets: fabricated },
  };
}

export function scoreAsk(gold: AskFigure, f: AskFigure): PartScore {
  const map = matchByText(gold.questions.map((q) => q.text), f.questions.map((q) => q.text), 0.4);
  let optTp = 0;
  let optGold = 0;
  let optModel = 0;
  let flagOk = 0;
  for (const [g, m] of map) {
    const gq = gold.questions[g]!;
    const mq = f.questions[m]!;
    optGold += gq.options.length;
    optModel += mq.options.length;
    optTp += matchByText(gq.options.map((o) => o.label), mq.options.map((o) => o.label), 0.5).size;
    // その他は取りこぼしだけを見る（その他を足すのは誤りとしない）
    if (gq.multi === mq.multi && (!gq.other || mq.other) && (gq.options.length === 0) === (mq.options.length === 0)) flagOk++;
  }
  const qF1 = f1(map.size, gold.questions.length, f.questions.length);
  const optF1 = f1(optTp, optGold, optModel);
  const flagAcc = map.size ? flagOk / map.size : 0;
  return { pass: qF1 >= 0.85 && optF1 >= 0.85 && flagAcc >= 0.8, semantic: qF1 * optF1, fabricated: 0, detail: { qF1, optF1, flagAcc } };
}

export function scorePlan(gold: PlanFigure, f: PlanFigure): PartScore {
  const map = matchByText(gold.steps.map((s) => s.title), f.steps.map((s) => (s.desc ? `${s.title} ${s.desc}` : s.title)), 0.4);
  const stepF1 = f1(map.size, gold.steps.length, f.steps.length);
  const pairs = [...map.entries()].sort((a, b) => a[0] - b[0]);
  const ordered = pairs.every((p, i) => i === 0 || p[1] > pairs[i - 1]![1]);
  return { pass: stepF1 >= 0.85 && ordered, semantic: stepF1 * (ordered ? 1 : 0.5), fabricated: 0, detail: { stepF1, ordered } };
}

export function scoreCallout(gold: CalloutFigure, f: CalloutFigure): PartScore {
  const text = (x: CalloutFigure) => [x.title, x.body, ...x.items].join(" ");
  const sim = similarity(text(gold), text(f));
  // 注意（warning）と警告（danger）は近い。情報・成功との取り違えは誤り
  const severe = (t: string) => t === "warning" || t === "danger";
  const toneOk = gold.tone === f.tone || (severe(gold.tone) && severe(f.tone));
  return { pass: toneOk && sim >= 0.45, semantic: (toneOk ? 1 : 0.5) * sim, fabricated: 0, detail: { toneOk, sim } };
}

export function scoreMap(gold: MapFigure, f: MapFigure): PartScore {
  const map = matchByText(gold.markers.map((m) => m.label), f.markers.map((m) => m.label), 0.5);
  let posOk = 0;
  for (const [g, m] of map) if (Math.abs(gold.markers[g]!.lat - f.markers[m]!.lat) < 0.001 && Math.abs(gold.markers[g]!.lng - f.markers[m]!.lng) < 0.001) posOk++;
  const markerF1 = f1(map.size, gold.markers.length, f.markers.length);
  const posAcc = map.size ? posOk / map.size : 0;
  const fabricated = map.size - posOk;
  const routeOk = !gold.route || (f.route !== undefined && f.route.stops.length === gold.route.stops.length);
  return { pass: markerF1 >= 0.85 && posAcc === 1 && routeOk, semantic: markerF1 * posAcc, fabricated, detail: { markerF1, posAcc, routeOk } };
}
