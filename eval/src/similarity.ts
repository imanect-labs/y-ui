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

/** 0..1。完全一致 1、一方が他方を含めば 0.9、それ以外は文字 bigram の Dice 係数。 */
export function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (x === "" || y === "") return x === y ? 1 : 0;
  if (x === y) return 1;
  if (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x))) return 0.9;
  // 送り仮名・助詞の違い（差戻し／差し戻し、課長承認／課長が承認）: ひらがなを除いた骨格で比べる。
  const sx = x.replace(/[ぁ-ゟ]/g, "");
  const sy = y.replace(/[ぁ-ゟ]/g, "");
  if (sx.length >= 2 && sx === sy) return 0.85;
  const bx = bigrams(x);
  const by = bigrams(y);
  let inter = 0;
  for (const [k, n] of bx) inter += Math.min(n, by.get(k) ?? 0);
  const total = [...bx.values()].reduce((s, n) => s + n, 0) + [...by.values()].reduce((s, n) => s + n, 0);
  return total === 0 ? 0 : (2 * inter) / total;
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
