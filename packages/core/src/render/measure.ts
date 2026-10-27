/**
 * 文字幅の見積もりと折り返し。
 *
 * ブラウザでもサーバーでも同じ配置になるよう、既定では文字種ごとの幅の表で決定的に見積もる
 * （全角 1em、半角英数はおよそ 0.5〜0.62em）。ホストは measure を差し替えられる。
 */

export type Measure = (text: string, fontSize: number, weight?: number) => number;

function charWidth(code: number): number {
  // 全角（CJK・かな・全角英数記号）
  if (
    (code >= 0x3000 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return 1;
  }
  if (code === 0x20) return 0.28;
  if (code >= 0x30 && code <= 0x39) return 0.56; // 数字
  if (code >= 0x41 && code <= 0x5a) return 0.64; // 大文字
  if (code >= 0x61 && code <= 0x7a) return 0.52; // 小文字
  if (".,:;'|!ilI[]()".includes(String.fromCharCode(code))) return 0.3;
  if (code < 0x80) return 0.56;
  return 0.8;
}

export const estimate: Measure = (text, fontSize, weight = 400) => {
  let em = 0;
  for (const ch of text) em += charWidth(ch.codePointAt(0)!);
  return em * fontSize * (weight >= 600 ? 1.04 : 1);
};

const LATIN = "[A-Za-z0-9][A-Za-z0-9.,%\\-+/_]*[」』）)\\]、。，．！？]*\\s*";
const OTHER = "[「『（(]*.[」』）)\\]、。，．・！？ーぁぃぅぇぉっゃゅょァィゥェォッャュョ々]*";
/** 折り返しの単位（開き括弧と続く英単語をまとめる）。 */
const TOKEN = new RegExp(`\\[\\d+\\](?:\\[\\d+\\])*|[「『（(]*${LATIN}|\\s+|${OTHER}`, "gu");
/** 開き括弧を語の先頭の 1 文字とだけまとめる分け方（まとめた英単語が 1 行に入らないとき）。 */
const TOKEN_PLAIN = new RegExp(`\\[\\d+\\](?:\\[\\d+\\])*|${LATIN}|\\s+|${OTHER}`, "gu");

/**
 * maxWidth に収まるように折り返す。和文は文字単位、欧文は単語単位で折る。
 * maxLines を超える分は末尾を「…」にする。
 */
export function wrap(text: string, maxWidth: number, fontSize: number, measure: Measure = estimate, maxLines = 3, weight = 400): string[] {
  // 引用番号 `[1]` は 1 語として扱う。行頭に来てはいけない閉じ括弧・句読点は、直前の文字とまとめて 1 語にする（禁則）。
  // 開き括弧は続く英単語とまとめる（「（pre-filter）」を「（p」で折らない）。まとめた語が 1 行に入らないときは、
  // 開き括弧と語の先頭の 1 文字だけをまとめる従来の分け方に戻す
  const tokens = (text.match(TOKEN) ?? []).flatMap((tok) =>
    /^[「『（(]/.test(tok) && measure(tok.trimEnd(), fontSize, weight) > maxWidth ? (tok.match(TOKEN_PLAIN) ?? [tok]) : [tok],
  );
  const lines: string[] = [];
  let cur = "";
  for (const tok of tokens) {
    // 文字単位に崩した語の後に残った空白だけの行頭は、行にせず捨てる（空行を作らない）
    if (cur.trim() === "") cur = "";
    else if (measure((cur + tok).trimEnd(), fontSize, weight) > maxWidth) {
      lines.push(cur.trimEnd());
      cur = "";
    }
    const t = cur === "" ? tok.trimStart() : tok;
    // 1 語だけで幅を超える場合は文字単位に崩す
    if (cur === "" && measure(t.trimEnd(), fontSize, weight) > maxWidth && t.length > 1) {
      for (const ch of t) {
        if (measure(cur + ch, fontSize, weight) > maxWidth && cur !== "") {
          lines.push(cur.trimEnd());
          cur = "";
        }
        cur += ch;
      }
      continue;
    }
    cur += t;
  }
  if (cur.trim() !== "") lines.push(cur.trimEnd());
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (last.length > 0 && measure(`${last}…`, fontSize, weight) > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines.length > 0 ? lines : [""];
}

/** 1 行に収める（収まらなければ末尾を「…」にする）。 */
export function fit(text: string, maxWidth: number, fontSize: number, measure: Measure = estimate, weight = 400): string {
  if (measure(text, fontSize, weight) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && measure(`${t}…`, fontSize, weight) > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}
