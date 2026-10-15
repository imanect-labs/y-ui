/**
 * v0.7 以降の図（年表・手順・カード・進捗など、文字の多い図）の文字と余白。
 * グラフ（bar / line / stat / flow / stack）は frame.ts の大きさのまま。
 * 読み物として読む図なので、本文は 13〜14px・行間を広めにとり、項目の間をあける。
 */

/** 項目の見出し。 */
export const HEAD = 14;
export const HEAD_LH = 20;
/** 項目の本文・説明。 */
export const TEXT = 13;
export const TEXT_LH = 20;
/** 時期・番号などの補助の文字。 */
export const META = 12;
/** 段落の間。 */
export const PARA_GAP = 6;
/** 項目の間。 */
export const ITEM_GAP = 18;
/** パネル（淡い地の囲み）・カードの角丸と内側の余白。 */
export const RADIUS = 14;
export const PAD = 16;
