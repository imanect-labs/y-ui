/** 表記ゆれを吸収したテキスト比較（ノード名・ラベル・項目名の対応付けに使う）。 */

export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[\d+\]/g, "")
    .replace(/[\s・、。,.「」『』()（）\[\]【】/／:：\-ー_~〜"'`*#]/g, "");
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  if (s.length === 1) m.set(s, 1);
  for (let i = 0; i < s.length - 1; i++) {
    const b = s.slice(i, i + 2);
    m.set(b, (m.get(b) ?? 0) + 1);
  }
  return m;
}

function dice(x: string, y: string): number {
  if (x === "" || y === "") return 0;
  const bx = bigrams(x);
  const by = bigrams(y);
  let inter = 0;
  for (const [k, n] of bx) inter += Math.min(n, by.get(k) ?? 0);
  const total = [...bx.values()].reduce((s, n) => s + n, 0) + [...by.values()].reduce((s, n) => s + n, 0);
  return total === 0 ? 0 : (2 * inter) / total;
}

/** 最長共通部分列の長さ。 */
function lcs(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j]!, prev[j - 1]!);
      diag = up;
    }
  }
  return prev[b.length]!;
}

/** ひらがな（送り仮名・助詞）を除いた骨格。全部ひらがなの語はそのまま。 */
function skeleton(s: string): string {
  const k = s.replace(/[\u3041-\u309f]/g, "");
  return k === "" ? s : k;
}

/**
 * 0..1。完全一致 1、一方が他方を含めば 0.9、ひらがなを除いた骨格が一致すれば 0.85。
 * それ以外は、文字 bigram の Dice 係数（そのまま・骨格）と、骨格の最長共通部分列が短い方を
 * どれだけ覆うか（「経理確認」と「経理部が内容を確認」）の大きい方。
 */
export function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (x === "" || y === "") return x === y ? 1 : 0;
  if (x === y) return 1;
  if (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x))) return 0.9;
  const sx = skeleton(x);
  const sy = skeleton(y);
  if (sx.length >= 2 && sx === sy) return 0.85;
  let s = Math.max(dice(x, y), dice(sx, sy));
  const shorter = Math.min(sx.length, sy.length);
  if (shorter >= 2) {
    const cover = lcs(sx, sy) / shorter;
    if (cover >= 0.75) s = Math.max(s, 0.6 + 0.2 * cover);
  }
  return s;
}

/**
 * 類似度の高い順に 1 対 1 で対応付ける（貪欲法）。threshold 未満は対応させない。
 * 戻り値は gold の添字 → model の添字。
 */
export function matchByText(gold: string[], model: string[], threshold = 0.5): Map<number, number> {
  const pairs: [number, number, number][] = [];
  gold.forEach((g, i) =>
    model.forEach((m, j) => {
      const s = similarity(g, m);
      if (s >= threshold) pairs.push([s, i, j]);
    }),
  );
  pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const out = new Map<number, number>();
  const used = new Set<number>();
  for (const [, i, j] of pairs) {
    if (out.has(i) || used.has(j)) continue;
    out.set(i, j);
    used.add(j);
  }
  return out;
}
