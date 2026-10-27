import { describe, expect, it } from "vitest";
import { parseBlock, toSource, toText, type ChartFigure, type FlowFigure, type StackFigure, type StatFigure } from "../src/index.js";

const final = { final: true } as const;

describe("bar / line", () => {
  it("基本形", () => {
    const r = parseBlock("bar 売上推移 [1]\n月 | 売上 | 利益\n1月 | 120 | 30\n2月 | 150 | △10\n", final);
    const f = r.figure as ChartFigure;
    expect(f.kind).toBe("bar");
    expect(f.title).toBe("売上推移");
    expect(f.refs).toEqual([1]);
    expect(f.columns).toEqual(["月", "売上", "利益"]);
    expect(f.rows).toEqual([
      { label: "1月", values: [120, 30], refs: [] },
      { label: "2月", values: [150, -10], refs: [] },
    ]);
    expect(r.diagnostics).toEqual([]);
  });

  it("GFM の表をそのまま受ける", () => {
    const r = parseBlock("line | 来場者数\n| 月 | 人数 |\n|---|---:|\n| 4月 | 1,200 |\n| 5月 | 1,350 |\n", final);
    const f = r.figure as ChartFigure;
    expect(f.columns).toEqual(["月", "人数"]);
    expect(f.rows.map((x) => x.values[0])).toEqual([1200, 1350]);
  });

  it("年の列見出しを見出しとして扱う", () => {
    const f = parseBlock("bar 比較\n地域 | 2024 | 2025年\n東京 | 10 | 12\n", final).figure as ChartFigure;
    expect(f.columns).toEqual(["地域", "2024", "2025年"]);
    expect(f.rows).toHaveLength(1);
  });

  it("不正な行だけを除き、診断を残す", () => {
    const r = parseBlock("bar 売上\n月 | 金額\n1月 | 100\n2月 | abc\n3月 | 200\n", final);
    const f = r.figure as ChartFigure;
    expect(f.rows.map((x) => x.label)).toEqual(["1月", "3月"]);
    expect(r.diagnostics.map((d) => [d.line, d.code])).toEqual([[4, "bad_number"]]);
  });

  it("見出し行が無ければ補う", () => {
    const r = parseBlock("bar 売上\n1月 | 100\n2月 | 150\n", final);
    const f = r.figure as ChartFigure;
    expect(f.columns).toEqual(["項目", "値"]);
    expect(f.rows).toHaveLength(2);
    expect(r.diagnostics[0]?.code).toBe("missing_header");
  });

  it("`ラベル: 数値` の行とオプション行", () => {
    const f = parseBlock("bar 件数\nunit: 件\nstacked: true\n- 東京: 12\n- 大阪: 8\nnote: 速報値\n", final).figure as ChartFigure;
    expect(f.unit).toBe("件");
    expect(f.stacked).toBe(true);
    expect(f.note).toBe("速報値");
    expect(f.rows.map((r) => [r.label, r.values[0]])).toEqual([
      ["東京", 12],
      ["大阪", 8],
    ]);
  });

  it("欠損値は null", () => {
    const f = parseBlock("line 推移\n月 | A | B\n1月 | 1 | -\n", final).figure as ChartFigure;
    expect(f.rows[0]?.values).toEqual([1, null]);
  });

  it("フェンスの情報文字列で種類を受ける", () => {
    const f = parseBlock("売上\n月 | 金額\n1月 | 1\n", { final: true, kind: "bar" }).figure as ChartFigure;
    expect(f.title).toBe("売上");
    expect(f.rows).toHaveLength(1);
  });

  it("日本語の種類名", () => {
    expect(parseBlock("棒グラフ：売上\n月 | 金額\n1月 | 1\n", final).figure?.kind).toBe("bar");
  });
});

describe("stat", () => {
  it("`項目 | 値 | 補足` と `項目: 値`", () => {
    const f = parseBlock("stat 今月の実績\n売上 | 320万円 | 前年比 +18% [2]\n顧客数: 1,240人\n", final).figure as StatFigure;
    expect(f.items).toEqual([
      { label: "売上", value: "320万円", num: 3_200_000, sub: "前年比 +18%", refs: [2] },
      { label: "顧客数", value: "1,240人", num: 1240, refs: [] },
    ]);
  });
});

describe("flow", () => {
  const labels = (f: FlowFigure) => f.edges.map((e) => `${f.nodes.find((n) => n.id === e.from)?.label}>${e.label ?? ""}>${f.nodes.find((n) => n.id === e.to)?.label}`);

  it("連結とラベル", () => {
    const f = parseBlock("flow 注文処理\n注文 -> 在庫確認 -> 出荷\n在庫確認 -なし-> 取り寄せ\n", final).figure as FlowFigure;
    expect(f.nodes.map((n) => n.label)).toEqual(["注文", "在庫確認", "出荷", "取り寄せ"]);
    expect(labels(f)).toEqual(["注文>>在庫確認", "在庫確認>>出荷", "在庫確認>なし>取り寄せ"]);
  });

  it("Mermaid 風の記法を受ける", () => {
    const src = "flow 承認\nflowchart LR\n  A[申請] --> B{金額 10万円以上?}\n  B -->|はい| C[部長承認]\n  B -- いいえ --> D[課長承認]\n  C --> E([完了])\n  D --> E\n";
    const f = parseBlock(src, final).figure as FlowFigure;
    expect(f.direction).toBe("LR");
    expect(f.nodes.map((n) => [n.label, n.shape])).toEqual([
      ["申請", "box"],
      ["金額 10万円以上?", "decision"],
      ["部長承認", "box"],
      ["課長承認", "box"],
      ["完了", "terminal"],
    ]);
    expect(labels(f)).toEqual([
      "申請>>金額 10万円以上?",
      "金額 10万円以上?>はい>部長承認",
      "金額 10万円以上?>いいえ>課長承認",
      "部長承認>>完了",
      "課長承認>>完了",
    ]);
  });

  it("矢印の別表記とハイフンを含む名前", () => {
    const f = parseBlock("flow 送信\nE-mail 作成 → 確認 => 送信\n", final).figure as FlowFigure;
    expect(f.nodes.map((n) => n.label)).toEqual(["E-mail 作成", "確認", "送信"]);
  });

  it("同じ名前は同じノード、重複する辺は 1 本", () => {
    const f = parseBlock("flow x\nA -> B\nA -> B\nB -> A\n", final).figure as FlowFigure;
    expect(f.nodes).toHaveLength(2);
    expect(f.edges).toHaveLength(2);
  });

  it("名前の後の空白に続く丸括弧は名前の一部（Mermaid の id としない）", () => {
    const f = parseBlock("flow x\nBook (PDF/Text) -> 目次の抽出\nA(丸) -> B\n", final).figure as FlowFigure;
    expect(f.nodes.map((n) => n.label)).toEqual(["Book (PDF/Text)", "目次の抽出", "丸", "B"]);
  });

  it("枠: subgraph 〜 end。ノードは最初に書かれた枠に属し、枠の外の行で枠をまたいでつなぐ", () => {
    const src = [
      "flow 学習と推論",
      "subgraph 準備",
      "  本 -> 目次の抽出",
      "end",
      "subgraph S2[学習]",
      "  direction LR",
      "  連結 -> 微調整",
      "  目次の抽出 -> 連結",
      "end",
      "微調整 -> 推論",
    ].join("\n");
    const f = parseBlock(src, final).figure as FlowFigure;
    expect(f.groups).toEqual([
      { id: "g1", label: "準備" },
      { id: "g2", label: "学習", direction: "LR" },
    ]);
    expect(f.nodes.map((n) => [n.label, n.group])).toEqual([
      ["本", "g1"],
      ["目次の抽出", "g1"],
      ["連結", "g2"],
      ["微調整", "g2"],
      ["推論", undefined],
    ]);
    expect(labels(f)).toContain("目次の抽出>>連結");
  });

  it("枠: ## 見出し は次の見出しまで。End という名前のノードは枠の終わりにしない", () => {
    const f = parseBlock("flow x\n## 前半\nStart -> A\n## 後半\nA -> B\nEnd\n", final).figure as FlowFigure;
    expect(f.groups?.map((g) => g.label)).toEqual(["前半", "後半"]);
    expect(f.nodes.map((n) => [n.label, n.group])).toEqual([
      ["Start", "g1"],
      ["A", "g1"],
      ["B", "g2"],
      ["End", "g2"],
    ]);
  });

  it("枠の名前や id を矢印の端に書くと、枠につなぐ", () => {
    const f = parseBlock("flow x\nsubgraph S1[受付]\n  申込\nend\n開始 -> S1\n開始 -> 受付\n", final).figure as FlowFigure;
    expect(f.nodes.map((n) => n.label)).toEqual(["申込", "開始"]);
    expect(f.edges).toEqual([{ from: "n2", to: "g1" }]);
  });

  it("枠の中の枠は外に並べ、閉じていない end と上限は診断を出す", () => {
    const r = parseBlock("flow x\nsubgraph A\nsubgraph B\n  b\nend\n  a\nend\nend\n", final);
    const f = r.figure as FlowFigure;
    expect(f.nodes.map((n) => [n.label, n.group])).toEqual([
      ["b", "g2"],
      ["a", "g1"],
    ]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["nested_too_deep", "unrecognized_line"]);
  });

  it("強調: **名前**、A:::クラス、style、class。色の指定は読まない", () => {
    const src = ["flow x", "**受付** -> B:::hot -> C -> D", "style C fill:#f00", "class D important", "classDef hot fill:#f00"].join("\n");
    const r = parseBlock(src, final);
    const f = r.figure as FlowFigure;
    expect(f.nodes.map((n) => [n.label, n.emphasis])).toEqual([
      ["受付", true],
      ["B", true],
      ["C", true],
      ["D", true],
    ]);
    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([["info", "unrecognized_line"]]);
  });

  it("枠と強調はテキスト化を通しても保つ", () => {
    const src = "flow x\ndir: LR\nsubgraph 前\n  A -> **B**\nend\nsubgraph 後\n  X[同名] -> C\nend\nY[同名] -> A\nB -> C\n";
    const f = parseBlock(src, final).figure as FlowFigure;
    const back = parseBlock(toSource(f), final).figure as FlowFigure;
    const norm = (x: FlowFigure) => ({
      groups: x.groups,
      nodes: x.nodes.map((n) => `${n.label}/${n.group ?? "-"}/${n.emphasis ?? false}`).sort(),
      edges: x.edges.map((e) => `${x.nodes.find((n) => n.id === e.from)?.group ?? "-"}:${labels({ ...x, edges: [e] })[0]}`).sort(),
    });
    expect(norm(back)).toEqual(norm(f));
    expect(toText(f)).toBe(["**x**", "", "- 前", "  - A → B", "- 後", "  - 同名 → C", "- 同名 → A", "- B → C"].join("\n"));
  });
});

describe("stack", () => {
  it("添付の構成図", () => {
    const src = [
      "stack システム構成",
      "- クライアント層: Web / Electron / 外部チャット",
      "- Comma Product API: Task・Conversation・User・認証",
      "↓ gRPC",
      "- Salix — Agent Runtime: Elixir / Erlang OTP",
      "  - Agent Process",
      "  - Session / Journal",
      "  - Scheduler / Loop",
      "  - Lean Kernel",
      "- LLM: OpenAI / Anthropic | Tools: 外部API / Device | Storage: DB / Object Store",
      "note: 公開資料を基にした論理構成図。",
      "",
    ].join("\n");
    const r = parseBlock(src, final);
    const f = r.figure as StackFigure;
    expect(r.diagnostics).toEqual([]);
    expect(f.tiers.map((t) => t.boxes.map((b) => b.title))).toEqual([
      ["クライアント層"],
      ["Comma Product API"],
      ["Salix — Agent Runtime"],
      ["LLM", "Tools", "Storage"],
    ]);
    expect(f.tiers[2]?.arrowLabel).toBe("gRPC");
    expect(f.tiers[2]?.boxes[0]?.desc).toBe("Elixir / Erlang OTP");
    expect(f.tiers[2]?.boxes[0]?.children.map((c) => c.title)).toEqual(["Agent Process", "Session / Journal", "Scheduler / Loop", "Lean Kernel"]);
    expect(f.tiers[3]?.boxes[2]?.desc).toBe("DB / Object Store");
    expect(f.note).toBe("公開資料を基にした論理構成図。");
  });

  it("箇条書き記号が無くても層として読む・時刻は分けない", () => {
    const f = parseBlock("stack 日程\n受付 10:00\n講演: 基調講演\n", final).figure as StackFigure;
    expect(f.tiers.map((t) => [t.boxes[0]?.title, t.boxes[0]?.desc])).toEqual([
      ["受付 10:00", undefined],
      ["講演", "基調講演"],
    ]);
  });
});

describe("エラーとストリーミング", () => {
  it("種類が分からなければ figure は null", () => {
    const r = parseBlock("gauge 達成率\nA | 1\n", final);
    expect(r.figure).toBeNull();
    expect(r.diagnostics[0]?.code).toBe("unknown_kind");
  });

  it("空のブロック", () => {
    expect(parseBlock("", final).diagnostics[0]?.code).toBe("empty");
    expect(parseBlock("bar 売上\n", final).diagnostics.at(-1)?.code).toBe("empty");
  });

  it("確定していない最終行は読まない", () => {
    const r = parseBlock("bar 売上\n月 | 金額\n1月 | 100\n2月 | 15", { final: false });
    const f = r.figure as ChartFigure;
    expect(r.pending).toBe(true);
    expect(f.rows.map((x) => x.values[0])).toEqual([100]);
    // 確定すれば読む
    expect((parseBlock("bar 売上\n月 | 金額\n1月 | 100\n2月 | 15", final).figure as ChartFigure).rows).toHaveLength(2);
  });
});

describe("pie", () => {
  const final = { final: true };
  it("項目と値を読み、別名（円グラフ・donut）も受ける", () => {
    for (const head of ["pie", "円グラフ", "donut"]) {
      const r = parseBlock(`${head} 売上の内訳 [2]\nunit: 億円\n事業 | 売上\nクラウド | 120\nオンプレ | 80 [3]\n`, final);
      expect(r.figure).toMatchObject({ kind: "pie", title: "売上の内訳", refs: [2], unit: "億円", columns: ["事業", "売上"], rows: [{ label: "クラウド", values: [120] }, { label: "オンプレ", values: [80], refs: [3] }] });
      expect(r.diagnostics).toEqual([]);
    }
  });

  it("`項目: 値` と列名の無い表も受ける", () => {
    expect(parseBlock("pie x\nA: 3\nB: 1\n", final).figure).toMatchObject({ columns: ["項目", "値"], rows: [{ label: "A", values: [3] }, { label: "B", values: [1] }] });
  });

  it("2 系列目以降・負の値・欠損は描かずに知らせる", () => {
    const r = parseBlock("pie x\n項目 | 今年 | 昨年\nA | 3 | 1\nB | -1 | 2\nC | - | 2\nD | 0 | 1\n", final);
    expect(r.figure).toMatchObject({ columns: ["項目", "今年"], rows: [{ label: "A", values: [3] }, { label: "D", values: [0] }] });
    expect(r.diagnostics.map((d) => d.code)).toEqual(["extra_cells", "bad_number", "bad_number"]);
  });

  it("13 項目目以降は省略して知らせる", () => {
    const body = Array.from({ length: 14 }, (_, i) => `項目${i + 1} | ${i + 1}`).join("\n");
    const r = parseBlock(`pie x\n${body}\n`, final);
    expect((r.figure as { rows: unknown[] }).rows).toHaveLength(12);
    expect(r.diagnostics.some((d) => d.code === "limit_exceeded")).toBe(true);
  });

  it("ソースに戻して読み直すと同じ図になる", () => {
    const f = parseBlock("pie 構成\nunit: %\n区分 | 比率\n国内 | 62.5\n海外 | 37.5\nnote: 2025年度\n", final).figure!;
    expect(parseBlock(toSource(f), final).figure).toEqual(f);
  });
});
