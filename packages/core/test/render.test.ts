import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseBlock, type Figure } from "../src/index.js";
import { YuiBlock, YuiFigure, isYuiLanguage } from "../src/react/index.js";
import { estimate, wrap } from "../src/render/measure.js";
import { layout, renderSVG } from "../src/svg.js";
import { DARK, LIGHT } from "../src/render/theme.js";

// 評価の課題の正解（141 件中 121 件に図がある）をそのまま描画の検査に使う
const golds: [string, Figure][] = readFileSync(new URL("../../../eval/tasks/tasks.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l))
  .filter((t) => t.gold)
  .map((t) => [t.id, t.gold]);

const fig = (src: string) => parseBlock(src, { final: true }).figure!;

describe("レイアウト", () => {
  it.each([640, 360, 320])("幅 %ipx: 全課題で数値が壊れず、文字が図の外にはみ出さない", (width) => {
    for (const [id, f] of golds) {
      const scene = layout(f, { width });
      expect(Number.isFinite(scene.height), id).toBe(true);
      for (const it of scene.items) {
        if (it.t !== "text") continue;
        expect(Number.isFinite(it.x) && Number.isFinite(it.y), `${id}: ${it.text}`).toBe(true);
        const w = estimate(it.text, it.size, it.weight);
        const left = it.anchor === "middle" ? it.x - w / 2 : it.anchor === "end" ? it.x - w : it.x;
        expect(left, `${id} (${width}px): 「${it.text}」が左にはみ出す`).toBeGreaterThanOrEqual(-1);
        expect(left + w, `${id} (${width}px): 「${it.text}」が右にはみ出す`).toBeLessThanOrEqual(scene.width + 1);
        expect(it.y, `${id}: 「${it.text}」が下にはみ出す`).toBeLessThanOrEqual(scene.height);
      }
    }
  });

  it("同じ入力なら同じ SVG（決定的）", () => {
    const f = fig("flow x\nA -> B -> C\nB -no-> D\n");
    expect(renderSVG(f)).toBe(renderSVG(f));
  });

  it("流れ図の分岐はひし形、ループは脇を回す", () => {
    const scene = layout(fig("flow x\n申請 -> 承認\n承認 -可-> 完了\n承認 -否-> 申請\n"));
    expect(scene.items.filter((i) => i.t === "path" && i.fill === "accentWash")).toHaveLength(1);
    expect(scene.items.filter((i) => i.t === "path" && i.arrow)).toHaveLength(3);
  });

  it("流れ図: 出る辺が 2 本以上ならひし形（ラベルが無くても）。枠をまたぐ辺は数えない", () => {
    const diamonds = (src: string) => layout(fig(src)).items.filter((i) => i.t === "path" && i.fill === "accentWash").length;
    expect(diamonds("flow x\n抽出 -> 生成\n抽出 -> 連結\n")).toBe(1);
    expect(diamonds("flow x\nsubgraph 前\n  抽出 -> 生成\nend\nsubgraph 後\n  連結\nend\n抽出 -> 連結\n")).toBe(0);
    expect(diamonds("flow x\nsubgraph 前\n  抽出 -> 生成\n  抽出 -> 確認\nend\n")).toBe(1);
  });

  describe("流れ図の枠", () => {
    const paper = [
      "flow 目次検索",
      "dir: LR",
      "subgraph Stage 1 — Input Preparation",
      "  Book (PDF/Text) -> ToC Extraction -> Synthetic QA Generation",
      "end",
      "subgraph Stage 2 — Training",
      "  C1[Concatenate ToC + Query] -> LLM Fine-tuning -> Target: ToC Leaf Node",
      "end",
      "subgraph Stage 3 — Inference",
      "  Query Input -> C2[Concatenate ToC + Query]",
      "  ToC -> C2",
      "  C2 -> Fine-tuned LLM -> **Constrained Generation** -> Predicted Leaf Node",
      "end",
      "ToC Extraction -> C1",
      "Synthetic QA Generation -> C1",
      "LLM Fine-tuning -> Fine-tuned LLM",
    ].join("\n");
    type Rect = { x: number; y: number; w: number; h: number };
    const frames = (sc: ReturnType<typeof layout>) => sc.items.filter((i) => i.t === "path" && i.dash !== undefined);
    const nodeRects = (sc: ReturnType<typeof layout>) => sc.targets.map((t) => t.hit as Rect);

    it.each([960, 640, 360])("幅 %ipx: 枠を 3 つ描き、箱は重ならず、文字は図の中に収まる", (width) => {
      const sc = layout(fig(paper), { width });
      expect(frames(sc)).toHaveLength(3);
      const rs = nodeRects(sc);
      expect(rs).toHaveLength(12);
      for (let i = 0; i < rs.length; i++) {
        for (let j = i + 1; j < rs.length; j++) {
          const [a, b] = [rs[i]!, rs[j]!];
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${i} と ${j} が重なる（${width}px）`).toBe(false);
        }
      }
      for (const it of sc.items) if (it.t === "text") expect(it.x).toBeLessThanOrEqual(sc.width);
    });

    it("横向きで幅に収まれば、段を左から右に並べ、枠をまたぐ辺もつながる", () => {
      const sc = layout(fig(paper), { width: 960 });
      const xs = frames(sc).map((p) => Number(/^M(-?[\d.]+)/.exec((p as { d: string }).d)![1]));
      expect(xs[0]!).toBeLessThan(xs[1]!);
      expect(xs[1]!).toBeLessThan(xs[2]!);
      // 枠の中 9 本 + 枠をまたぐ 3 本
      expect(sc.items.filter((i) => i.t === "path" && i.arrow)).toHaveLength(12);
    });

    it("中身の無い枠につなぐ辺があっても描ける（生成途中で枠を開いた直後など）", () => {
      for (const src of ["flow x\nsubgraph 受付\nend\n開始 -> 受付\n", "flow x\nsubgraph 受付\n開始 -> 受付\n"]) {
        const sc = layout(fig(src), { width: 640 });
        expect(sc.targets).toHaveLength(1);
        expect(sc.items.filter((i) => i.t === "path" && i.arrow)).toHaveLength(0);
      }
    });

    it("強調した箱は強調の色の太い枠で描く", () => {
      const sc = layout(fig(paper), { width: 960 });
      expect(sc.items.filter((i) => i.t === "rect" && i.stroke === "s5" && i.strokeWidth === 2)).toHaveLength(1);
    });

    it("狭い幅で全部を縦に積むと、枠の中の箱を貫かないように枠の外側を回す", () => {
      const sc = layout(fig(paper), { width: 360 });
      const rs = nodeRects(sc);
      for (const p of sc.items) {
        if (p.t !== "path" || !p.arrow) continue;
        // 縦の区間（x が同じ 2 点）が、端以外の箱を縦に横切らない
        const pts = [...p.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
        for (let k = 0; k + 1 < pts.length; k++) {
          const [[x1, y1], [x2, y2]] = [pts[k]!, pts[k + 1]!];
          if (Math.abs(x1 - x2) > 0.01) continue;
          const crossed = rs.filter((r) => x1 > r.x + 1 && x1 < r.x + r.w - 1 && Math.min(y1, y2) < r.y && Math.max(y1, y2) > r.y + r.h);
          expect(crossed, p.d).toEqual([]);
        }
      }
    });
  });

  it("狭い幅で項目名が区画に入らない棒グラフは、行が少なくても横向きにする", () => {
    const f = fig("bar 部署別\n部署 | 件数\nカスタマーサクセス本部 第一グループ | 412\nエンタープライズ営業本部 | 288\n経営企画室 | 120\n");
    const names = (w: number) => layout(f, { width: w }).items.filter((i) => i.t === "text" && i.anchor === "end" && !/^[\d,]+$/.test(i.text)).length;
    expect(names(320)).toBe(3);
    // 広い幅で項目名が入るなら縦のまま
    expect(names(1200)).toBe(0);
  });

  it("項目名が区画に入る棒グラフは、狭い幅でも縦のまま（判定と描画で同じ区画の幅を使う）", () => {
    const f = fig("bar 流入元\n流入元 | 件数\n紹介 | 40\nメール | 25\n自然検索 | 60\n検索広告 | 30\nSNS広告 | 20\n");
    const sc = layout(f, { width: 320 });
    expect(sc.items.filter((i) => i.t === "text" && i.anchor === "end" && !/^[\d,]+$/.test(i.text))).toHaveLength(0);
    expect(sc.items.filter((i) => i.t === "text" && i.anchor === "middle" && /紹介|メール|検索|SNS/.test(i.text))).toHaveLength(5);
  });

  it("間引いた横軸のラベルは、図の外へはみ出さず、隣どうし重ならない", () => {
    const rows = Array.from({ length: 7 }, (_, i) => `2024年度第${i + 1}期 | ${100 + i}`).join("\n");
    for (const width of [360, 640]) {
      const scene = layout(fig(`line 推移\n期 | 売上\n${rows}\n`), { width });
      const pad = width < 400 ? 12 : 16;
      const spans = scene.items
        .filter((i): i is Extract<typeof i, { t: "text" }> => i.t === "text" && i.anchor === "middle" && i.text.startsWith("2024"))
        .map((i) => [i.x - estimate(i.text, i.size) / 2, i.x + estimate(i.text, i.size) / 2] as const);
      expect(spans.length).toBeGreaterThan(1);
      spans.forEach(([l, r], k) => {
        expect(l, `${width}px`).toBeGreaterThanOrEqual(pad - 0.5);
        expect(r, `${width}px`).toBeLessThanOrEqual(width - pad + 0.5);
        if (k > 0) expect(l, `${width}px: 前のラベルと重なる`).toBeGreaterThanOrEqual(spans[k - 1]![1]);
      });
    }
  });

  it("比較表: 印の横に文字が入らない狭い列は印だけを描き、値はツールチップで見せる", () => {
    const src = "compare 方式\n観点 | ACL | RBAC | ABAC | ReBAC | 個別索引\n表現力 | △ 個別指定のみ | △ 役職単位 | ✓ 属性 | ✓ 継承 | ✓ 可\n";
    const narrow = layout(fig(src), { width: 320 });
    // 1 文字ずつ縦に折り返さない（セルの文字の断片を描かない）
    const texts = narrow.items.filter((i): i is Extract<typeof i, { t: "text" }> => i.t === "text");
    const rowTop = texts.find((i) => i.text === "表現力")!.y - 10;
    expect(texts.filter((i) => i.y >= rowTop && /^(個|役|属|継)/.test(i.text))).toHaveLength(0);
    // 1 行に入る短い文字は残す
    expect(texts.some((i) => i.text === "可")).toBe(true);
    expect(narrow.targets[0]?.tip?.rows.map((r) => r.value).join(" ")).toContain("個別指定のみ");
    const wide = layout(fig(src), { width: 900 });
    expect(wide.items.some((i) => i.t === "text" && i.text.includes("個別指定のみ"))).toBe(true);
  });

  it("行が多い棒グラフは横向きにする", () => {
    const many = golds.find(([id]) => id === "long-001")![1];
    const scene = layout(many, { width: 640 });
    // 横向きなら、項目名は右揃え（anchor end）で棒の左に並ぶ
    expect(scene.items.filter((i) => i.t === "text" && i.anchor === "end" && i.text.endsWith("県")).length).toBeGreaterThan(40);
  });
});

describe("折り返し", () => {
  it("開き括弧と続く英単語の間では折らない", () => {
    const lines = wrap("検索結果を絞る（post-filter）で二段目", 150, 13);
    expect(lines.some((l) => l.includes("（post-filter）")), lines.join("/")).toBe(true);
  });

  it("長い語を文字単位に崩した後に空行を作らない", () => {
    for (let width = 30; width <= 160; width++) {
      const lines = wrap("supercalifragilistic expialidocious antidisestablishment word", width, 13, estimate, 20);
      expect(lines.filter((l) => l.trim() === ""), `${width}px: ${JSON.stringify(lines)}`).toEqual([]);
    }
  });

  it("括弧ごとまとめた語が 1 行に入らなくても、幅を超える行を作らない", () => {
    for (const [text, width] of [["モデル（GPT-4o）を使う", 50], ["権限は「ReBAC」で判定する", 50], ["APIは（REST）とする", 45], ["a supercalifragilistic word", 60]] as const) {
      const lines = wrap(text, width, 13, estimate, 9);
      expect(lines.join("").replace(/\s+/g, ""), text).toBe(text.replace(/\s+/g, ""));
      for (const l of lines) expect(estimate(l, 13), `${text}: 「${l}」`).toBeLessThanOrEqual(width);
    }
  });
});

describe("SVG", () => {
  const f = fig('bar <script>alert(1)</script> & "x"\n月 | 売上\n1月 | 120\n');

  it("文字はエスケープする", () => {
    const svg = renderSVG(f);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;");
  });

  it("画面用は CSS 変数、書き出し用は色を焼き込む", () => {
    expect(renderSVG(f)).toContain("var(--yui-s1, var(--yui-default-s1))");
    const baked = renderSVG(f, { theme: "light" });
    expect(baked).not.toContain("var(");
    expect(baked).toContain(`fill="${LIGHT.s1}"`);
    expect(baked).toMatch(/^<svg [^>]*width="\d+" height="\d+"/);
  });

  it("ページの明示（class=\"dark\" / data-theme）を OS の設定より優先する", () => {
    const css = renderSVG(f).match(/<style>([^<]*)<\/style>/)![1]!;
    expect(css).toContain(':root:where([data-theme="dark"],.dark)');
    expect(css).toContain(':root:where(:not([data-theme="light"]):not(.light))');
    expect(css).toContain("font-family:var(--yui-font,");
  });

  it("読み上げ用に、表にした内容を desc に入れる", () => {
    expect(renderSVG(f)).toMatch(/<desc id="[^"]+">[^<]*\| 1月 \| 120 \|/);
  });
});

describe("React", () => {
  it("YuiBlock はソースを解析して SVG を描く", () => {
    const html = renderToStaticMarkup(createElement(YuiBlock, { source: "bar 売上\n月 | 金額\n1月 | 120\n2月 | abc\n", width: 480 }));
    expect(html).toContain("<svg");
    expect(html).toContain("1 件の行を表示できませんでした");
    expect(html).toContain("data-yui-source");
  });

  it("ストリーミング中は確定した行だけ描き、図にできなければ何も出さない", () => {
    expect(renderToStaticMarkup(createElement(YuiBlock, { source: "bar 売", streaming: true }))).toBe("");
    const partial = renderToStaticMarkup(createElement(YuiBlock, { source: "bar 売上\n月 | 金額\n1月 | 120\n2月 | 15", streaming: true, width: 480 }));
    const svg = partial.slice(partial.indexOf("<svg"), partial.indexOf("</svg>"));
    expect(svg).toContain("1月: 120");
    expect(svg).not.toContain("2月");
  });

  it("ホバーの受け口: 図の上に重ね、キーボードでも辿れる（書き出しの SVG には出さない）", () => {
    const out = renderToStaticMarkup(createElement(YuiFigure, { figure: fig("bar 売上\n月 | 金額\n1月 | 120\n2月 | 150\n"), width: 480 }));
    expect(out).toMatch(/<div class="yui[^"]*" style="position:relative" tabindex="0" role="group"/);
    expect(out.match(/fill="transparent"/g)?.length).toBe(2);
    const off = renderToStaticMarkup(createElement(YuiFigure, { figure: fig("bar 売上\n月 | 金額\n1月 | 120\n"), width: 480, interactive: false }));
    expect(off).not.toContain("tabindex");
    expect(renderSVG(fig("bar 売上\n月 | 金額\n1月 | 120\n"))).not.toContain("transparent");
  });

  it("図にできないソースはそのまま表示する", () => {
    expect(renderToStaticMarkup(createElement(YuiBlock, { source: "gauge x\nA | 1\n" }))).toContain("<pre");
  });

  it("YuiFigure とコードブロックの言語名の判定", () => {
    expect(renderToStaticMarkup(createElement(YuiFigure, { figure: fig("stat x\n売上 | 3,200万円\n"), theme: "dark", width: 320 }))).toContain(`fill:${DARK.surface2}`);
    expect(isYuiLanguage("language-ui")).toBe(true);
    expect(isYuiLanguage("hljs language-yui")).toBe(true);
    expect(isYuiLanguage("language-uix")).toBe(false);
  });
});

describe("ホバーの対象", () => {
  it("棒: 行ごとに全系列の値と単位を出し、その行の棒だけを残す", () => {
    const sc = layout(fig("bar 売上\nunit: 百万円\n四半期 | 売上 | 利益\nQ1 | 120 | 30\nQ2 | 150 | -5\n"), { width: 640 });
    expect(sc.targets).toHaveLength(2);
    const t = sc.targets[1]!;
    expect(t.tip?.title).toBe("Q2");
    expect(t.tip?.rows.map((r) => [r.label, r.value])).toEqual([["売上", "150"], ["利益", "-5"]]);
    expect(t.tip?.footer).toBe("単位: 百万円");
    expect(t.keep).toEqual(["r1"]);
    const bars = sc.items.filter((it) => it.group === "r1");
    expect(bars.length).toBeGreaterThanOrEqual(2);
    // 指す位置は高いほうの棒の上端（当たり判定の中）
    expect(t.tip!.y).toBeGreaterThanOrEqual(t.hit.y);
    expect(t.tip!.y).toBeLessThan(t.hit.y + t.hit.h);
  });

  it("折れ線: 縦線と全系列の点を出し、何も薄くしない", () => {
    const sc = layout(fig("line 利用者\n週 | Web | App\nW1 | 10 | 5\nW2 | 12 | 8\n"), { width: 640 });
    const t = sc.targets[0]!;
    expect(t.keep).toEqual([]);
    expect(t.guide).toBeDefined();
    expect(t.points).toHaveLength(2);
    expect(t.tip?.rows).toHaveLength(2);
  });

  it("横向きの棒も行ごとに出す", () => {
    const rows = Array.from({ length: 16 }, (_, i) => `項目${i} | ${i + 1}`).join("\n");
    const sc = layout(fig(`bar 多い\n項目 | 値\n${rows}\n`), { width: 480 });
    expect(sc.targets).toHaveLength(16);
    expect(sc.targets[3]!.tip?.rows[0]?.value).toBe("4");
  });

  it("流れ図: 箱ごとに、つながる線と前後の箱を残す（ツールチップは出さない）", () => {
    const sc = layout(fig("flow 承認\n申請 -> 承認\n承認 -> 完了\n"), { width: 480 });
    expect(sc.targets).toHaveLength(3);
    // ノードの id は登場順（n1 = 申請, n2 = 承認, n3 = 完了）
    const mid = sc.targets.find((t) => t.keep[0] === "n:n2")!;
    expect(mid.tip).toBeUndefined();
    expect([...mid.keep].sort()).toEqual(["e0", "e1", "n:n1", "n:n2", "n:n3"]);
    expect(sc.targets.find((t) => t.keep[0] === "n:n1")!.keep).not.toContain("n:n3");
  });

  it("数値カード・構成図は対象を持たない", () => {
    expect(layout(fig("stat x\n売上 | 1\n"), { width: 480 }).targets).toEqual([]);
    expect(layout(fig("stack x\n- A\n- B\n"), { width: 480 }).targets).toEqual([]);
  });
});

describe("pie", () => {
  const fig = parseBlock("pie 内訳\nunit: 件\n区分 | 件数\nA | 3\nB | 1\nC | 0\n", { final: true }).figure!;

  it("値が 0 より大きい項目だけ扇を描き、凡例と当たり判定は全項目に持つ", () => {
    const scene = layout(fig);
    const wedges = scene.items.filter((it) => it.t === "path" && it.group?.startsWith("s"));
    expect(wedges).toHaveLength(2);
    expect(scene.targets).toHaveLength(3);
    expect(scene.targets.map((t) => Boolean(t.hitPath))).toEqual([true, true, false]);
    expect(scene.targets[0]!.tip).toMatchObject({ title: "A", rows: [{ label: "件数", value: "3件" }, { label: "割合", value: "75%" }] });
  });

  it("中央に合計を出し、説明（desc）は値と割合の表にする", () => {
    const svg = renderSVG(fig, { theme: "light" });
    expect(svg).toContain(">4件<");
    expect(svg).toContain("| A | 3 | 75% |");
  });

  it("1 項目だけでも一周の輪を描く", () => {
    const one = parseBlock("pie x\nA | 5\n", { final: true }).figure!;
    const ring = layout(one).items.find((it) => it.t === "path");
    expect(ring && ring.t === "path" && (ring.d.match(/M/g) ?? []).length).toBe(2);
  });
});

describe("目盛り", () => {
  // 図に描いた目盛りの文字（数字だけのテキスト）を拾う
  const tickTexts = (src: string) =>
    layout(fig(src), { width: 640 })
      .items.filter((it): it is Extract<typeof it, { t: "text" }> => it.t === "text" && it.tabular === true)
      .map((it) => it.text);

  it("値がすべて整数なら、目盛りも整数だけ（人数・回数）", () => {
    const people = tickTexts("line 週ごとの利用者\nunit: 人\n週 | 人数\n1週 | 3\n2週 | 12\n3週 | 7\n");
    expect(people.length).toBeGreaterThan(2);
    expect(people.every((t) => /^\d+$/.test(t)), people.join(",")).toBe(true);
    const tiny = tickTexts("bar 回数\n日 | 回数\n月 | 1\n火 | 2\n");
    expect(tiny.every((t) => /^\d+$/.test(t)), tiny.join(",")).toBe(true);
  });

  it("小数を含む値は従来どおり細かく刻み、隣どうしが同じ表記にならない", async () => {
    const cost = tickTexts("line コスト\nunit: セント\n日 | コスト\n1日 | 0.1\n2日 | 0.35\n3日 | 0.2\n");
    expect(cost.some((t) => t.includes(".")), cost.join(",")).toBe(true);
    // 0.5 セント未満の幅でも、目盛りの数字が重ならない（以前は小数 1 桁に丸めて「0」が並んだ）
    const { formatTick, niceTicks, tickStep } = await import("../src/render/frame.js");
    const ticks = niceTicks(0, 0.004);
    const labels = ticks.map((t) => formatTick(t, "ja-JP", tickStep(ticks)));
    expect(new Set(labels).size, labels.join(",")).toBe(ticks.length);
    expect(new Set(ticks.map((t) => formatTick(t, "ja-JP"))).size).toBeLessThan(ticks.length);
  });

  it("整数の間隔は 1 未満にせず 2.5 刻みも使わない", async () => {
    const { niceTicks, tickDigits } = await import("../src/render/frame.js");
    expect(niceTicks(0, 12, 5, true)).toEqual([0, 5, 10, 15]);
    expect(niceTicks(0, 2, 5, true)).toEqual([0, 1, 2]);
    expect(niceTicks(0, 12)).toEqual([0, 2.5, 5, 7.5, 10, 12.5]);
    expect(niceTicks(0, 2)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect([tickDigits(undefined), tickDigits(5), tickDigits(0.5), tickDigits(0.25), tickDigits(0.001)]).toEqual([1, 1, 1, 2, 3]);
    expect([tickDigits(1e-7), tickDigits(1e-11)]).toEqual([7, 11]);
  });

  it("ごく小さい間隔や短縮表記でも、隣どうしの目盛りの数字が重ならない", async () => {
    const { formatTick, niceTicks, tickStep } = await import("../src/render/frame.js");
    const { scatterTicks } = await import("../src/render/scatter.js");
    for (const ticks of [niceTicks(0, 0.0000004), scatterTicks(10000, 10004, 5, true), niceTicks(0, 120000)]) {
      const labels = ticks.map((t) => formatTick(t, "ja-JP", tickStep(ticks)));
      expect(new Set(labels).size, labels.join(",")).toBe(ticks.length);
    }
    // 重ならないときは短縮表記のまま
    expect(formatTick(40000, "ja-JP", 20000)).toBe("4万");
  });
});
