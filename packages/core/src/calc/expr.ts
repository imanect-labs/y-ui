/**
 * calc の式: 字句解析・構文解析・評価（docs/calc.md §3）。
 *
 * 式は Yui が自分で構文木にして評価する。`eval`・`Function`・プロパティアクセス・文字列の生成は使わない。
 * 名前は calc の中で前に定義したものだけを参照でき、関数は決まった一覧だけ。
 */

export type Expr =
  | { t: "num"; v: number }
  | { t: "name"; name: string }
  | { t: "neg"; e: Expr }
  | { t: "not"; e: Expr }
  | { t: "bin"; op: BinOp; a: Expr; b: Expr }
  | { t: "call"; fn: Fn; args: Expr[] };

export type BinOp = "+" | "-" | "*" | "/" | "^" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "and" | "or";

export const FUNCTIONS = ["min", "max", "round", "floor", "ceil", "abs", "sqrt", "if"] as const;
export type Fn = (typeof FUNCTIONS)[number];

type Tok = { k: "num"; v: number; at: number } | { k: "name"; v: string; at: number } | { k: "op"; v: string; at: number };

/** 演算子として読む記号（全角・×÷ も受ける）。 */
const OPS = ["<=", ">=", "==", "!=", "+", "-", "*", "/", "^", "(", ")", ",", "<", ">"];

function normalizeOps(src: string): string {
  return src
    .normalize("NFKC")
    .replace(/[×✕]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–—]/g, "-");
}

export function tokenize(src: string): Tok[] | string {
  const s = normalizeOps(src);
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^\d+(?:\.\d+)?/.exec(s.slice(i));
    if (num) {
      out.push({ k: "num", v: Number(num[0]), at: i });
      i += num[0].length;
      continue;
    }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (op) {
      out.push({ k: "op", v: op, at: i });
      i += op.length;
      continue;
    }
    // 名前: 空白・演算子以外が続く部分（日本語可）。数字で始まらない。
    const name = /^[^\s+\-*/^(),<>=!]+/.exec(s.slice(i));
    if (name) {
      out.push({ k: "name", v: name[0], at: i });
      i += name[0].length;
      continue;
    }
    return `「${ch}」は式に使えません`;
  }
  return out;
}

/** 構文解析の結果。rest は式の後ろに残った語（単位として扱う）。 */
export interface ParsedExpr {
  expr: Expr;
  /** 式として読んだ部分の終わり（正規化した文字列での位置）。 */
  end: number;
}

export class ExprError extends Error {}

/**
 * 式を読む。式の後ろに名前だけが続く場合（`… 円`）は、そこで止めて end を返す（呼び出し側が単位にする）。
 */
export function parseExpr(src: string): ParsedExpr {
  const toks = tokenize(src);
  if (typeof toks === "string") throw new ExprError(toks);
  // 構文木の深さ（評価の再帰）を抑えるため、語の数に上限を置く（記法側でも 1 式 200 文字まで）
  if (toks.length > MAX_TOKENS) throw new ExprError(`式が長すぎます（語は ${MAX_TOKENS} 個まで）`);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === "op" && peek()!.v === v;
  const isWord = (v: string) => peek()?.k === "name" && String(peek()!.v).toLowerCase() === v;

  const primary = (): Expr => {
    const t = peek();
    if (!t) throw new ExprError("式が途中で終わっています");
    if (t.k === "num") {
      p++;
      return { t: "num", v: t.v };
    }
    if (t.k === "op" && t.v === "(") {
      p++;
      const e = or();
      if (!isOp(")")) throw new ExprError("「)」がありません");
      p++;
      return e;
    }
    if (t.k === "name") {
      p++;
      const lower = t.v.toLowerCase();
      if (isOp("(")) {
        if (!(FUNCTIONS as readonly string[]).includes(lower)) throw new ExprError(`関数「${t.v}」は使えません（${FUNCTIONS.join(" / ")}）`);
        p++;
        const args: Expr[] = [];
        if (!isOp(")")) {
          for (;;) {
            args.push(or());
            if (isOp(",")) {
              p++;
              continue;
            }
            break;
          }
        }
        if (!isOp(")")) throw new ExprError("「)」がありません");
        p++;
        const fn = lower as Fn;
        const arity: Record<Fn, [number, number]> = { min: [1, 99], max: [1, 99], round: [1, 2], floor: [1, 1], ceil: [1, 1], abs: [1, 1], sqrt: [1, 1], if: [3, 3] };
        const [lo, hi] = arity[fn];
        if (args.length < lo || args.length > hi) throw new ExprError(`${fn} の引数の数が違います`);
        return { t: "call", fn, args };
      }
      return { t: "name", name: t.v };
    }
    throw new ExprError(`「${t.v}」の位置に値がありません`);
  };
  const unary = (): Expr => {
    if (isOp("-")) {
      p++;
      return { t: "neg", e: unary() };
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return pow();
  };
  const pow = (): Expr => {
    const a = primary();
    if (isOp("^")) {
      p++;
      return { t: "bin", op: "^", a, b: unary() };
    }
    return a;
  };
  const mul = (): Expr => {
    let a = unary();
    while (isOp("*") || isOp("/")) {
      const op = peek()!.v as BinOp;
      p++;
      a = { t: "bin", op, a, b: unary() };
    }
    return a;
  };
  const add = (): Expr => {
    let a = mul();
    while (isOp("+") || isOp("-")) {
      const op = peek()!.v as BinOp;
      p++;
      a = { t: "bin", op, a, b: mul() };
    }
    return a;
  };
  const cmp = (): Expr => {
    const a = add();
    const t = peek();
    if (t?.k === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(t.v)) {
      p++;
      return { t: "bin", op: t.v as BinOp, a, b: add() };
    }
    return a;
  };
  const not = (): Expr => {
    if (isWord("not")) {
      p++;
      return { t: "not", e: not() };
    }
    return cmp();
  };
  const and = (): Expr => {
    let a = not();
    while (isWord("and")) {
      p++;
      a = { t: "bin", op: "and", a, b: not() };
    }
    return a;
  };
  const or = (): Expr => {
    let a = and();
    while (isWord("or")) {
      p++;
      a = { t: "bin", op: "or", a, b: and() };
    }
    return a;
  };

  const expr = or();
  const next = peek();
  // 式の後ろに名前が続くなら単位（呼び出し側で扱う）。それ以外が残るのは誤り
  if (next && next.k !== "name") throw new ExprError(`「${next.k === "num" ? next.v : next.v}」の前に演算子がありません`);
  return { expr, end: next ? next.at : normalizeOps(src).length };
}

/** 式が参照する名前。 */
export function namesIn(e: Expr, out: Set<string> = new Set()): Set<string> {
  switch (e.t) {
    case "name":
      out.add(e.name);
      break;
    case "neg":
    case "not":
      namesIn(e.e, out);
      break;
    case "bin":
      namesIn(e.a, out);
      namesIn(e.b, out);
      break;
    case "call":
      for (const a of e.args) namesIn(a, out);
      break;
    case "num":
      break;
  }
  return out;
}

/** 1 つの式の語の数の上限。 */
export const MAX_TOKENS = 300;

/** 1 回の評価で行える演算の上限。 */
export const MAX_OPS = 10_000;

/** 評価する。未定義の名前・0 除算・定義域外・上限超えは null（画面には「—」）。 */
export function evaluate(e: Expr, env: ReadonlyMap<string, number | null>, budget = { ops: 0 }): number | null {
  if (++budget.ops > MAX_OPS) return null;
  const ok = (v: number) => (Number.isFinite(v) ? v : null);
  switch (e.t) {
    case "num":
      return e.v;
    case "name":
      return env.get(e.name) ?? null;
    case "neg": {
      const v = evaluate(e.e, env, budget);
      return v === null ? null : -v;
    }
    case "not": {
      const v = evaluate(e.e, env, budget);
      return v === null ? null : v === 0 ? 1 : 0;
    }
    case "bin": {
      const a = evaluate(e.a, env, budget);
      const b = evaluate(e.b, env, budget);
      if (a === null || b === null) return null;
      switch (e.op) {
        case "+":
          return ok(a + b);
        case "-":
          return ok(a - b);
        case "*":
          return ok(a * b);
        case "/":
          return b === 0 ? null : ok(a / b);
        case "^":
          return ok(a ** b);
        case "<":
          return a < b ? 1 : 0;
        case "<=":
          return a <= b ? 1 : 0;
        case ">":
          return a > b ? 1 : 0;
        case ">=":
          return a >= b ? 1 : 0;
        case "==":
          return Math.abs(a - b) < 1e-9 ? 1 : 0;
        case "!=":
          return Math.abs(a - b) < 1e-9 ? 0 : 1;
        case "and":
          return a !== 0 && b !== 0 ? 1 : 0;
        case "or":
          return a !== 0 || b !== 0 ? 1 : 0;
      }
      return null;
    }
    case "call": {
      if (e.fn === "if") {
        const c = evaluate(e.args[0]!, env, budget);
        if (c === null) return null;
        return evaluate(e.args[c !== 0 ? 1 : 2]!, env, budget);
      }
      const vs = e.args.map((a) => evaluate(a, env, budget));
      if (vs.some((v) => v === null)) return null;
      const n = vs as number[];
      switch (e.fn) {
        case "min":
          return Math.min(...n);
        case "max":
          return Math.max(...n);
        case "round": {
          const d = Math.max(0, Math.min(10, Math.round(n[1] ?? 0)));
          const k = 10 ** d;
          return Math.round(n[0]! * k) / k;
        }
        case "floor":
          return Math.floor(n[0]!);
        case "ceil":
          return Math.ceil(n[0]!);
        case "abs":
          return Math.abs(n[0]!);
        case "sqrt":
          return n[0]! < 0 ? null : Math.sqrt(n[0]!);
      }
    }
  }
  return null;
}

/** 式を書き戻す（「式を見る」・テキスト化用。括弧は必要なところだけ付ける）。 */
export function exprSource(e: Expr, parent = 0): string {
  const prec: Record<BinOp, number> = { or: 1, and: 2, "<": 4, "<=": 4, ">": 4, ">=": 4, "==": 4, "!=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "^": 8 };
  switch (e.t) {
    case "num":
      return String(e.v);
    case "name":
      return e.name;
    case "neg": {
      const s = `-${exprSource(e.e, 7)}`;
      return parent > 7 ? `(${s})` : s;
    }
    case "not": {
      const s = `not ${exprSource(e.e, 3)}`;
      return parent > 3 ? `(${s})` : s;
    }
    case "call":
      return `${e.fn}(${e.args.map((a) => exprSource(a)).join(", ")})`;
    case "bin": {
      const p = prec[e.op];
      // 左結合（^ は右結合）
      const left = exprSource(e.a, e.op === "^" ? p + 1 : p);
      const right = exprSource(e.b, e.op === "^" ? p : p + 1);
      const s = `${left} ${e.op} ${right}`;
      return parent > p ? `(${s})` : s;
    }
  }
}
