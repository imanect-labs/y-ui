/** 結果の集計と、事前に決めた採用基準の判定（docs/eval-plan.md）。 */

import { ARM_LABELS, type ArmId } from "./prompts.js";
import type { ResultRecord } from "./run.js";

/** 方式 A（現行 emit_ui）が表現できる課題の種類。A と B の比較はこの範囲で行う。 */
export const COMMON_CATEGORIES = ["bar", "line", "stat", "long", "jpnum", "none-unneeded", "none-nodata"];

/** 採用基準（docs/eval-plan.md §5 と一致させる）。 */
export const CRITERIA = {
  /** Gemma で B の合格率が A をこれ以上上回れば採用。 */
  superiority: 0.1,
  /** 「同等」「悪くならない」とみなす差の許容幅。 */
  margin: 0.03,
  /** 同等の場合に求めるトークン比（B / A）。 */
  tokenRatio: 0.5,
};

export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - h) / d, (c + h) / d];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

export interface Agg {
  n: number;
  failed: number;
  pass: number;
  passCi: [number, number];
  syntax: number;
  firstTrySyntax: number;
  fabricatedRate: number;
  semantic: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  firstFigureMs: number;
  totalMs: number;
}

export function aggregate(recs: ResultRecord[]): Agg {
  const ok = recs.filter((r) => r.ok && r.score && r.outcome);
  const attempted = ok.filter((r) => r.outcome!.extraction.attempted);
  const passK = ok.filter((r) => r.score!.pass).length;
  const usage = ok.map((r) => r.outcome!.usage);
  return {
    n: ok.length,
    failed: recs.length - ok.length,
    pass: ok.length ? passK / ok.length : NaN,
    passCi: wilson(passK, ok.length),
    syntax: attempted.length ? attempted.filter((r) => r.outcome!.extraction.syntaxOk).length / attempted.length : NaN,
    firstTrySyntax: attempted.length ? attempted.filter((r) => r.outcome!.firstTrySyntaxOk).length / attempted.length : NaN,
    fabricatedRate: ok.length ? ok.filter((r) => r.score!.fabricated > 0).length / ok.length : NaN,
    semantic: mean(ok.map((r) => r.score!.semantic)),
    promptTokens: mean(usage.map((u) => u.promptTokens)),
    completionTokens: mean(usage.map((u) => u.completionTokens)),
    totalTokens: mean(usage.map((u) => u.promptTokens + u.completionTokens)),
    firstFigureMs: median(ok.flatMap((r) => (r.outcome!.firstFigureMs === undefined ? [] : [r.outcome!.firstFigureMs]))),
    totalMs: median(ok.map((r) => r.outcome!.totalMs)),
  };
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}

export interface Decision {
  model: string;
  effort: string;
  padChars: number;
  a: Agg;
  b: Agg;
  verdict: string;
}

/** 採用基準の判定。主条件は Gemma、Luna は非劣性の確認。 */
export function decide(recs: ResultRecord[], primaryEffort: string, primary = "gemma", secondary = "luna"): { lines: string[]; adopt: boolean | null } {
  const common = recs.filter((r) => COMMON_CATEGORIES.includes(r.category) && r.effort === primaryEffort && r.padChars === 0);
  const pick = (model: string, arm: ArmId) => aggregate(common.filter((r) => r.model === model && r.arm === arm));
  const lines: string[] = [];
  const gA = pick(primary, "A");
  const gB = pick(primary, "B");
  const lA = pick(secondary, "A");
  const lB = pick(secondary, "B");
  if (gA.n === 0 || gB.n === 0 || lA.n === 0 || lB.n === 0) {
    lines.push(`判定に必要な結果が揃っていません（effort=${primaryEffort}、文脈の水増しなし、${primary} と ${secondary} の A・B）。`);
    return { lines, adopt: null };
  }
  const diffG = gB.pass - gA.pass;
  const superior = diffG >= CRITERIA.superiority;
  const equivalentCheaper = diffG >= -CRITERIA.margin && gB.totalTokens <= CRITERIA.tokenRatio * gA.totalTokens;
  const lunaOk = lB.pass - lA.pass >= -CRITERIA.margin;
  lines.push(`- ${primary}: A ${pct(gA.pass)} → B ${pct(gB.pass)}（差 ${(diffG * 100).toFixed(1)} pt、トークン比 B/A ${(gB.totalTokens / gA.totalTokens).toFixed(2)}）`);
  lines.push(`  - 条件1（+${CRITERIA.superiority * 100} pt 以上）: ${superior ? "満たす" : "満たさない"}`);
  lines.push(`  - 条件2（差が -${CRITERIA.margin * 100} pt 以内かつトークン ${CRITERIA.tokenRatio} 倍以下）: ${equivalentCheaper ? "満たす" : "満たさない"}`);
  lines.push(`- ${secondary}: A ${pct(lA.pass)} → B ${pct(lB.pass)}（差 ${((lB.pass - lA.pass) * 100).toFixed(1)} pt、許容 -${CRITERIA.margin * 100} pt）: ${lunaOk ? "悪化なし" : "悪化"}`);
  const adopt = (superior || equivalentCheaper) && lunaOk;
  lines.push(`- **判定: ${adopt ? "Yui（B）を採用" : "採用基準を満たさない"}**`);
  return { lines, adopt };
}

export interface ReportOptions {
  effort?: string;
  /** 採用判定の主条件・副条件のモデル名（既定 gemma / luna）。 */
  primary?: string;
  secondary?: string;
  /** レポート冒頭に入れる注記。 */
  notes?: string[];
}

export function renderReport(recs: ResultRecord[], opts: ReportOptions = {}): string {
  const primaryEffort = opts.effort ?? "low";
  const out: string[] = ["# Yui 評価結果", "", ...(opts.notes ?? []).flatMap((n) => [n, ""])];
  const failed = recs.filter((r) => !r.ok);
  out.push(`生成 ${recs.length} 件（API 失敗 ${failed.length} 件）`, "");

  out.push("## 採用基準の判定（事前登録）", "", ...decide(recs, primaryEffort, opts.primary, opts.secondary).lines, "");

  const conditions = groupBy(recs, (r) => `${r.model}|${r.effort}|${r.padChars}`);
  for (const [cond, rs] of conditions) {
    const [model, effort, pad] = cond.split("|");
    out.push(`## ${model} / effort=${effort}${pad !== "0" ? ` / 文脈 +${pad} 文字` : ""}`, "");
    out.push("| 方式 | n | 合格率 [95%CI] | 構文成功 | 初回構文成功 | 数値捏造 | 意味スコア | 入力tok | 出力tok | 最初の図(ms) | 全体(ms) |");
    out.push("|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    const byArm = groupBy(rs, (r) => r.arm);
    for (const arm of Object.keys(ARM_LABELS) as ArmId[]) {
      const g = byArm.get(arm);
      if (!g) continue;
      const a = aggregate(g);
      out.push(
        `| ${arm} ${ARM_LABELS[arm]} | ${a.n}${a.failed ? ` (+${a.failed} 失敗)` : ""} | ${pct(a.pass)} [${pct(a.passCi[0])}–${pct(a.passCi[1])}] | ${pct(a.syntax)} | ${pct(a.firstTrySyntax)} | ${pct(a.fabricatedRate)} | ${a.semantic.toFixed(3)} | ${a.promptTokens.toFixed(0)} | ${a.completionTokens.toFixed(0)} | ${a.firstFigureMs.toFixed(0)} | ${a.totalMs.toFixed(0)} |`,
      );
    }
    out.push("");
    const cats = [...new Set(rs.map((r) => r.category))];
    out.push(`| 種類 | ${[...byArm.keys()].join(" | ")} |`, `|---|${[...byArm.keys()].map(() => "---:").join("|")}|`);
    for (const c of cats) {
      const cells = [...byArm.keys()].map((arm) => {
        const g = byArm.get(arm)!.filter((r) => r.category === c);
        return g.length ? pct(aggregate(g).pass) : "–";
      });
      out.push(`| ${c} | ${cells.join(" | ")} |`);
    }
    out.push("");
  }
  return out.join("\n");
}
