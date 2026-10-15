/**
 * グラフ・数値カード・図を出すべきでない課題を、固定シードで生成する。
 * 生成結果は eval/tasks/tasks.jsonl にコミットし、評価のたびに同じ課題を使う。
 */

import type { ChartFigure, Kind, StatFigure } from "@imanect/yui";
import type { EvalTask } from "./types.js";

// ------------------------------------------------------------ 乱数（mulberry32）

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const between = (r: Rand, lo: number, hi: number, decimals = 0): number => {
  const v = lo + r() * (hi - lo);
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

// ------------------------------------------------------------ 表記

const ja = (v: number, decimals = 0) => v.toLocaleString("ja-JP", { maximumFractionDigits: decimals, minimumFractionDigits: 0 });

/** 円の金額を `1億2,000万円` `△3,500万円` の形にする。 */
export function jpYen(v: number): string {
  const sign = v < 0 ? "△" : "";
  const a = Math.abs(v);
  const oku = Math.floor(a / 1e8);
  const man = Math.round((a % 1e8) / 1e4);
  if (oku > 0) return `${sign}${oku}億${man > 0 ? `${ja(man)}万` : ""}円`;
  return `${sign}${ja(man)}万円`;
}

export function fullWidth(s: string): string {
  return s.replace(/[0-9,.]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
}

// ------------------------------------------------------------ グラフの題材

interface Domain {
  key: string;
  title: string;
  label: string;
  labels: string[];
  series: string[];
  unit: string;
  range: [number, number];
  decimals?: number;
  timeSeries: boolean;
}

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

const DOMAINS: Domain[] = [
  { key: "sales", title: "月別売上", label: "月", labels: MONTHS, series: ["売上"], unit: "万円", range: [80, 400], timeSeries: true },
  { key: "inquiry", title: "地域別の問い合わせ件数", label: "地域", labels: ["北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州"], series: ["件数"], unit: "件", range: [20, 300], timeSeries: false },
  { key: "shipment", title: "製品別の出荷台数", label: "製品", labels: ["製品A", "製品B", "製品C", "製品D", "製品E"], series: ["2024年度", "2025年度"], unit: "台", range: [100, 2000], timeSeries: false },
  { key: "wau", title: "週次アクティブユーザー数", label: "週", labels: ["第1週", "第2週", "第3週", "第4週", "第5週", "第6週", "第7週", "第8週"], series: ["利用者数"], unit: "人", range: [800, 3000], timeSeries: true },
  { key: "overtime", title: "部署別の平均残業時間", label: "部署", labels: ["営業部", "開発部", "人事部", "経理部", "総務部", "企画部"], series: ["残業時間"], unit: "時間", range: [5, 45], decimals: 1, timeSeries: false },
  { key: "profit", title: "四半期ごとの営業利益", label: "四半期", labels: ["2024年Q1", "2024年Q2", "2024年Q3", "2024年Q4", "2025年Q1", "2025年Q2"], series: ["営業利益"], unit: "百万円", range: [-60, 200], timeSeries: true },
  { key: "cvr", title: "チャネル別のコンバージョン率", label: "チャネル", labels: ["検索広告", "SNS広告", "メール", "自然検索", "紹介"], series: ["CVR"], unit: "%", range: [0.5, 6], decimals: 1, timeSeries: false },
  { key: "visitors", title: "店舗別の来客数", label: "店舗", labels: ["新宿店", "渋谷店", "池袋店", "横浜店", "大宮店", "千葉店"], series: ["平日平均", "休日平均"], unit: "人", range: [150, 1200], timeSeries: false },
  { key: "training", title: "年度別の研修受講者数", label: "年度", labels: ["2021年度", "2022年度", "2023年度", "2024年度", "2025年度"], series: ["受講者数"], unit: "人", range: [100, 900], timeSeries: true },
  { key: "tickets", title: "月別の障害チケット数", label: "月", labels: MONTHS, series: ["新規", "解決"], unit: "件", range: [10, 90], timeSeries: true },
];

type ContextStyle = "prose" | "table" | "bullets" | "report";
const STYLES: ContextStyle[] = ["prose", "table", "bullets", "report"];

interface Table {
  title: string;
  label: string;
  series: string[];
  unit: string;
  rows: { label: string; values: number[] }[];
  decimals: number;
}

function makeTable(r: Rand, d: Domain, nRows: number): Table {
  const start = d.timeSeries ? Math.floor(r() * Math.max(1, d.labels.length - nRows + 1)) : 0;
  const labels = d.timeSeries ? d.labels.slice(start, start + nRows) : shuffle(r, d.labels).slice(0, nRows);
  return {
    title: d.title,
    label: d.label,
    series: d.series,
    unit: d.unit,
    decimals: d.decimals ?? 0,
    rows: labels.map((label) => ({ label, values: d.series.map(() => between(r, d.range[0], d.range[1], d.decimals ?? 0)) })),
  };
}

function shuffle<T>(r: Rand, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function renderContext(t: Table, style: ContextStyle, fmt: (v: number) => string = (v) => ja(v, t.decimals)): string {
  const unitSuffix = (v: number) => `${fmt(v)}${t.unit === "%" ? "%" : t.unit}`;
  switch (style) {
    case "prose": {
      const parts = t.rows.map((row) =>
        t.series.length === 1 ? `${row.label}は${unitSuffix(row.values[0]!)}` : `${row.label}は${t.series.map((s, i) => `${s}が${unitSuffix(row.values[i]!)}`).join("、")}`,
      );
      return `${t.title}についての集計結果です。${parts.join("、")}でした。`;
    }
    case "table": {
      const head = `| ${t.label} | ${t.series.map((s) => `${s}（${t.unit}）`).join(" | ")} |`;
      const sep = `|---|${t.series.map(() => "---:").join("|")}|`;
      const body = t.rows.map((row) => `| ${row.label} | ${row.values.map(fmt).join(" | ")} |`);
      return [`${t.title}`, "", head, sep, ...body].join("\n");
    }
    case "bullets":
      return [`${t.title}（単位: ${t.unit}）`, ...t.rows.map((row) => `- ${row.label}: ${t.series.length === 1 ? fmt(row.values[0]!) : t.series.map((s, i) => `${s} ${fmt(row.values[i]!)}`).join(" / ")}`)].join("\n");
    case "report":
      return [
        "【社内レポート抜粋】",
        `本資料では${t.title}を報告する。`,
        ...t.series.map((s, i) => `${s}（${t.unit}）: ${t.rows.map((row) => `${row.label} ${fmt(row.values[i]!)}`).join("、")}`),
        "数値は速報値であり、確定値は翌月に公表する。",
      ].join("\n");
  }
}

function chartGold(kind: Kind, t: Table): ChartFigure {
  return {
    kind: kind as "bar" | "line" | "pie",
    title: t.title,
    refs: [],
    columns: [t.label, ...t.series],
    rows: t.rows.map((row) => ({ label: row.label, values: [...row.values], refs: [] })),
    unit: t.unit,
  };
}

// ------------------------------------------------------------ bar / line

function chartTasks(category: "bar" | "line", count: number, seed: number): EvalTask[] {
  const r = rng(seed);
  const out: EvalTask[] = [];
  for (let i = 0; i < count; i++) {
    const candidates = category === "line" ? DOMAINS.filter((d) => d.timeSeries) : DOMAINS;
    const d = candidates[i % candidates.length]!;
    const t = makeTable(r, d, Math.min(d.labels.length, 4 + Math.floor(r() * 5)));
    const style = STYLES[i % STYLES.length]!;
    let question: string;
    let acceptKinds: Kind[];
    const explicit = i % 3 !== 2;
    if (category === "bar") {
      question = explicit ? pick(r, [`${t.title}を棒グラフで見せて。`, `${t.title}を比較できるように棒グラフにしてください。`]) : `${t.title}をわかりやすく図で示して。`;
      acceptKinds = explicit || !d.timeSeries ? ["bar"] : ["bar", "line"];
    } else {
      question = explicit ? pick(r, [`${t.title}の推移を折れ線グラフで示してください。`, `${t.title}の変化を折れ線グラフにして。`]) : `${t.title}の推移がわかるように図にして。`;
      acceptKinds = explicit ? ["line"] : ["line", "bar"];
    }
    out.push({
      id: `${category}-${String(i + 1).padStart(3, "0")}`,
      category,
      question,
      context: renderContext(t, style),
      expect: "figure",
      acceptKinds,
      gold: chartGold(acceptKinds[0]!, t),
    });
  }
  return out;
}

// ------------------------------------------------------------ pie（構成比）

/** 内訳の題材。合計が意味を持つもの（構成比を問える）だけ。 */
const PIE_DOMAINS: Domain[] = [
  { key: "segment", title: "事業別の売上構成", label: "事業", labels: ["クラウド", "オンプレミス", "保守サポート", "研修", "コンサルティング"], series: ["売上"], unit: "億円", range: [8, 180], timeSeries: false },
  { key: "cost", title: "部門経費の内訳", label: "費目", labels: ["人件費", "外注費", "広告宣伝費", "旅費交通費", "通信費", "消耗品費"], series: ["金額"], unit: "万円", range: [30, 900], timeSeries: false },
  { key: "ticket", title: "問い合わせの種類別の件数", label: "種類", labels: ["ログイン", "請求", "権限", "検索", "ファイル共有", "通知"], series: ["件数"], unit: "件", range: [15, 420], timeSeries: false },
  { key: "age", title: "利用者の年代構成", label: "年代", labels: ["20代", "30代", "40代", "50代", "60代以上"], series: ["人数"], unit: "人", range: [40, 800], timeSeries: false },
  { key: "survey", title: "満足度アンケートの回答", label: "回答", labels: ["満足", "やや満足", "どちらでもない", "やや不満", "不満"], series: ["回答数"], unit: "件", range: [6, 260], timeSeries: false },
  { key: "share", title: "地域別の契約数", label: "地域", labels: ["関東", "近畿", "中部", "九州", "東北", "北海道"], series: ["契約数"], unit: "件", range: [20, 640], timeSeries: false },
];

function pieTasks(count: number, seed: number): EvalTask[] {
  const r = rng(seed);
  const out: EvalTask[] = [];
  for (let i = 0; i < count; i++) {
    const d = PIE_DOMAINS[i % PIE_DOMAINS.length]!;
    const n = Math.min(d.labels.length, 3 + Math.floor(r() * 4));
    // 回答・年代は順序があるので並べ替えない。他は資料の並びを毎回変える。
    const ordered = d.key === "survey" || d.key === "age";
    const labels = ordered ? d.labels.slice(0, n) : shuffle(r, d.labels).slice(0, n);
    const t: Table = { title: d.title, label: d.label, series: d.series, unit: d.unit, decimals: 0, rows: labels.map((label) => ({ label, values: [between(r, d.range[0], d.range[1])] })) };
    const style = STYLES[i % STYLES.length]!;
    const explicit = i % 3 !== 2;
    const question = explicit
      ? pick(r, [`${t.title}を円グラフにして。`, `${t.title}の割合を円グラフで見せてください。`])
      : pick(r, [`${t.title}の構成比がわかるように図で示して。`, `${t.title}の内訳を図にして、どこが大きいか見えるようにして。`]);
    out.push({
      id: `pie-${String(i + 1).padStart(3, "0")}`,
      category: "pie",
      question,
      context: renderContext(t, style),
      expect: "figure",
      // 構成比を問われて棒グラフで答えるのも誤りではない（円グラフを指定された場合を除く）。
      acceptKinds: explicit ? ["pie"] : ["pie", "bar"],
      gold: chartGold("pie", t),
    });
  }
  return out;
}

// ------------------------------------------------------------ scatter（2 つの量の関係）

interface ScatterDomain {
  title: string;
  label: string;
  labels: string[];
  x: { name: string; unit: string; range: [number, number] };
  y: { name: string; unit: string; range: [number, number] };
}

const SCATTER_DOMAINS: ScatterDomain[] = [
  { title: "店舗別の広告費と売上", label: "店舗", labels: ["新宿", "渋谷", "池袋", "横浜", "大宮", "千葉", "立川", "町田"], x: { name: "広告費", unit: "万円", range: [20, 150] }, y: { name: "売上", unit: "百万円", range: [10, 60] } },
  { title: "営業担当者の訪問件数と受注件数", label: "担当者", labels: ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本"], x: { name: "訪問件数", unit: "件", range: [10, 80] }, y: { name: "受注件数", unit: "件", range: [1, 20] } },
  { title: "製品の価格と月間販売数", label: "製品", labels: ["A", "B", "C", "D", "E", "F", "G", "H"], x: { name: "価格", unit: "円", range: [980, 9800] }, y: { name: "月間販売数", unit: "個", range: [50, 900] } },
  { title: "支店の従業員数と顧客満足度", label: "支店", labels: ["札幌", "仙台", "名古屋", "大阪", "広島", "福岡"], x: { name: "従業員数", unit: "人", range: [8, 60] }, y: { name: "顧客満足度", unit: "点", range: [55, 95] } },
  { title: "研修の受講時間と試験の点数", label: "受講者", labels: ["A さん", "B さん", "C さん", "D さん", "E さん", "F さん", "G さん"], x: { name: "受講時間", unit: "時間", range: [2, 30] }, y: { name: "点数", unit: "点", range: [40, 98] } },
];

function scatterTasks(count: number, seed: number): EvalTask[] {
  const r = rng(seed);
  const out: EvalTask[] = [];
  for (let i = 0; i < count; i++) {
    const d = SCATTER_DOMAINS[i % SCATTER_DOMAINS.length]!;
    const n = Math.min(d.labels.length, 5 + Math.floor(r() * 3));
    const labels = shuffle(r, d.labels).slice(0, n);
    const points = labels.map((label) => ({ label, x: between(r, d.x.range[0], d.x.range[1]), y: between(r, d.y.range[0], d.y.range[1]) }));
    const xName = `${d.x.name}（${d.x.unit}）`;
    const yName = `${d.y.name}（${d.y.unit}）`;
    const style = i % 3;
    const context =
      style === 0
        ? `${d.title}の一覧\n\n| ${d.label} | ${xName} | ${yName} |\n|---|---:|---:|\n${points.map((p) => `| ${p.label} | ${ja(p.x)} | ${ja(p.y)} |`).join("\n")}`
        : style === 1
          ? `${d.title}をまとめました。${points.map((p) => `${p.label}は${d.x.name}${ja(p.x)}${d.x.unit}、${d.y.name}${ja(p.y)}${d.y.unit}`).join("。")}です。`
          : `${d.title}\n${points.map((p) => `- ${p.label}: ${d.x.name} ${ja(p.x)}${d.x.unit} / ${d.y.name} ${ja(p.y)}${d.y.unit}`).join("\n")}`;
    const question = i % 4 === 3 ? `${d.x.name}と${d.y.name}の関係がわかるように図にして。` : pick(r, [`${d.title}を散布図にしてください。`, `横軸を${d.x.name}、縦軸を${d.y.name}にした散布図で見せて。`]);
    out.push({
      id: `scatter-${String(i + 1).padStart(3, "0")}`,
      category: "scatter",
      question,
      context,
      expect: "figure",
      acceptKinds: ["scatter"],
      gold: { kind: "scatter", title: d.title, refs: [], columns: [d.label, xName, yName], points: points.map((p) => ({ ...p, refs: [] })) },
    });
  }
  return out;
}

// ------------------------------------------------------------ progress（目標に対する進捗）

const PROGRESS_SETS: { title: string; items: { label: string; unit: string; target: [number, number] }[] }[] = [
  { title: "今期の営業目標の達成状況", items: [{ label: "売上", unit: "万円", target: [5000, 12000] }, { label: "新規顧客数", unit: "社", target: [40, 150] }, { label: "商談件数", unit: "件", target: [200, 600] }] },
  { title: "研修の受講状況", items: [{ label: "情報セキュリティ研修", unit: "人", target: [300, 800] }, { label: "コンプライアンス研修", unit: "人", target: [300, 800] }, { label: "管理職研修", unit: "人", target: [20, 80] }] },
  { title: "プロジェクトの作業の進み具合", items: [{ label: "設計", unit: "画面", target: [20, 60] }, { label: "実装", unit: "画面", target: [20, 60] }, { label: "テスト", unit: "件", target: [300, 900] }, { label: "マニュアル", unit: "ページ", target: [40, 120] }] },
  { title: "店舗ごとの月間売上目標の達成状況", items: [{ label: "新宿店", unit: "万円", target: [800, 2000] }, { label: "横浜店", unit: "万円", target: [600, 1500] }, { label: "大宮店", unit: "万円", target: [400, 1200] }] },
];

function progressTasks(count: number, seed: number): EvalTask[] {
  const r = rng(seed);
  const out: EvalTask[] = [];
  for (let i = 0; i < count; i++) {
    const set = PROGRESS_SETS[i % PROGRESS_SETS.length]!;
    const items = set.items.map((it) => {
      const target = Math.round(between(r, it.target[0], it.target[1]) / 10) * 10;
      const value = Math.round(target * (0.35 + r() * 0.8));
      return { ...it, target, value };
    });
    const style = i % 3;
    const context =
      style === 0
        ? `${set.title}\n\n| 項目 | 実績 | 目標 |\n|---|---:|---:|\n${items.map((it) => `| ${it.label} | ${ja(it.value)}${it.unit} | ${ja(it.target)}${it.unit} |`).join("\n")}`
        : style === 1
          ? `${set.title}です。${items.map((it) => `${it.label}は目標${ja(it.target)}${it.unit}に対して${ja(it.value)}${it.unit}`).join("、")}となっています。`
          : `${set.title}\n${items.map((it) => `- ${it.label}: ${ja(it.value)}${it.unit}（目標 ${ja(it.target)}${it.unit}）`).join("\n")}`;
    const question = i % 4 === 3 ? `${set.title}を、目標に対してどこまで進んだかがわかる図にして。` : pick(r, [`${set.title}を進捗バーで見せてください。`, `${set.title}を、達成率がわかるように図にして。`]);
    out.push({
      id: `progress-${String(i + 1).padStart(3, "0")}`,
      category: "progress",
      question,
      context,
      expect: "figure",
      acceptKinds: ["progress"],
      gold: {
        kind: "progress",
        title: set.title,
        refs: [],
        items: items.map((it) => ({ label: it.label, value: it.value, valueText: `${ja(it.value)}${it.unit}`, target: it.target, targetText: `${ja(it.target)}${it.unit}`, refs: [] })),
      },
    });
  }
  return out;
}

// ------------------------------------------------------------ funnel（段階ごとの数）

const FUNNEL_SETS: { title: string; unit: string; stages: string[]; start: [number, number] }[] = [
  { title: "採用の選考状況", unit: "人", stages: ["応募", "書類選考通過", "一次面接通過", "最終面接通過", "内定承諾"], start: [400, 1500] },
  { title: "営業の商談の進み具合", unit: "件", stages: ["リード", "商談化", "提案", "見積提出", "受注"], start: [300, 1200] },
  { title: "Web サイトの購入までの流れ", unit: "人", stages: ["訪問", "商品ページ閲覧", "カート追加", "購入手続き", "購入完了"], start: [5000, 40000] },
  { title: "無料体験から有料契約までの状況", unit: "社", stages: ["無料体験の申込", "初回ログイン", "機能を3つ以上利用", "有料契約"], start: [200, 900] },
];

function funnelTasks(count: number, seed: number): EvalTask[] {
  const r = rng(seed);
  const out: EvalTask[] = [];
  for (let i = 0; i < count; i++) {
    const set = FUNNEL_SETS[i % FUNNEL_SETS.length]!;
    let v = Math.round(between(r, set.start[0], set.start[1]) / 10) * 10;
    const stages = set.stages.map((label, k) => {
      if (k > 0) v = Math.max(1, Math.round(v * (0.2 + r() * 0.55)));
      return { label, value: v };
    });
    const style = i % 3;
    const context =
      style === 0
        ? `${set.title}\n\n| 段階 | ${set.unit === "件" ? "件数" : "人数"} |\n|---|---:|\n${stages.map((s) => `| ${s.label} | ${ja(s.value)}${set.unit} |`).join("\n")}`
        : style === 1
          ? `${set.title}をまとめました。${stages.map((s) => `${s.label}が${ja(s.value)}${set.unit}`).join("、")}でした。`
          : `${set.title}\n${stages.map((s) => `- ${s.label}: ${ja(s.value)}${set.unit}`).join("\n")}`;
    const question = i % 4 === 3 ? `${set.title}で、どの段階で大きく減っているかがわかる図にして。` : pick(r, [`${set.title}をファネルで見せて。`, `${set.title}を段階ごとの歩留まりがわかるファネル図にしてください。`]);
    out.push({
      id: `funnel-${String(i + 1).padStart(3, "0")}`,
      category: "funnel",
      question,
      context,
      expect: "figure",
      acceptKinds: i % 4 === 3 ? ["funnel", "bar"] : ["funnel"],
      gold: { kind: "funnel", title: set.title, refs: [], unit: set.unit, stages: stages.map((s) => ({ ...s, refs: [] })) },
    });
  }
  return out;
}

// ------------------------------------------------------------ long（大量の行）

const PREFECTURES = "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split(" ");

function longTasks(count: number, seed: number): EvalTask[] {
  const r = rng(seed);
  const out: EvalTask[] = [];
  for (let i = 0; i < count; i++) {
    let t: Table;
    let acceptKinds: Kind[];
    let question: string;
    if (i % 3 === 0) {
      t = { title: "都道府県別の契約件数", label: "都道府県", series: ["契約件数"], unit: "件", decimals: 0, rows: PREFECTURES.map((p) => ({ label: p, values: [between(r, 5, 900)] })) };
      acceptKinds = ["bar"];
      question = "都道府県別の契約件数を棒グラフにしてください。";
    } else if (i % 3 === 1) {
      const days = 28 + Math.floor(r() * 4);
      t = { title: "日別のログイン数（10月）", label: "日付", series: ["ログイン数"], unit: "回", decimals: 0, rows: Array.from({ length: days }, (_, k) => ({ label: `10/${k + 1}`, values: [between(r, 300, 1800)] })) };
      acceptKinds = ["line", "bar"];
      question = "10月の日別ログイン数の推移をグラフで見せて。";
    } else {
      t = { title: "時間帯別のアクセス数", label: "時間帯", series: ["PC", "スマートフォン"], unit: "件", decimals: 0, rows: Array.from({ length: 24 }, (_, h) => ({ label: `${h}時`, values: [between(r, 20, 900), between(r, 20, 1500)] })) };
      acceptKinds = ["line", "bar"];
      question = "時間帯別のアクセス数を端末別にグラフで比較して。";
    }
    out.push({
      id: `long-${String(i + 1).padStart(3, "0")}`,
      category: "long",
      question,
      context: renderContext(t, i % 2 === 0 ? "table" : "bullets"),
      expect: "figure",
      acceptKinds,
      gold: chartGold(acceptKinds[0]!, t),
    });
  }
  return out;
}

// ------------------------------------------------------------ jpnum（日本語の数値表記）

function jpnumTasks(count: number, seed: number): EvalTask[] {
  const r = rng(seed);
  const out: EvalTask[] = [];
  const divisions = ["第一事業部", "第二事業部", "第三事業部", "海外事業部", "新規事業室"];
  for (let i = 0; i < count; i++) {
    let t: Table;
    let fmt: (v: number) => string;
    let question: string;
    if (i % 2 === 0) {
      const negative = i % 4 === 0;
      t = {
        title: negative ? "事業部別の営業損益" : "事業部別の売上高",
        label: "事業部",
        series: [negative ? "営業損益" : "売上高"],
        unit: "円",
        decimals: 0,
        rows: shuffle(r, divisions)
          .slice(0, 4 + (i % 2))
          .map((label) => ({ label, values: [Math.round(between(r, negative ? -0.8 : 0.3, negative ? 1.5 : 4.5, 2) * 1e8 / 1e6) * 1e6] })),
      };
      // 損益の課題には必ず赤字（△）の行を含める。
      if (negative && t.rows.every((row) => row.values[0]! >= 0)) {
        const last = t.rows[t.rows.length - 1]!;
        last.values[0] = -Math.max(1e6, Math.round(last.values[0]! / 2e6) * 1e6);
      }
      fmt = jpYen;
      question = `${t.title}を棒グラフで比較して。`;
    } else {
      t = {
        title: "拠点別の受注件数",
        label: "拠点",
        series: ["受注件数"],
        unit: "件",
        decimals: 0,
        rows: ["札幌", "仙台", "東京", "名古屋", "大阪", "福岡"].slice(0, 4 + (i % 3)).map((label) => ({ label, values: [between(r, 300, 4800)] })),
      };
      fmt = (v) => fullWidth(ja(v));
      question = "拠点別の受注件数を棒グラフにしてください。";
    }
    // 単位は値の側に書く（`1億2,000万円` `１，２００件`）。
    const ctx = renderContext({ ...t, unit: "" }, i % 3 === 0 ? "prose" : "bullets", fmt).replace("（単位: ）", "");
    out.push({
      id: `jpnum-${String(i + 1).padStart(3, "0")}`,
      category: "jpnum",
      question,
      context: ctx,
      expect: "figure",
      acceptKinds: ["bar"],
      gold: chartGold("bar", t),
    });
  }
  return out;
}

// ------------------------------------------------------------ stat

interface StatDomain {
  title: string;
  items: { label: string; make: (r: Rand) => { value: string; num?: number } }[];
  sentence: (vals: string[]) => string;
}

const STAT_DOMAINS: StatDomain[] = [
  {
    title: "今月の営業実績",
    items: [
      { label: "売上", make: (r) => { const v = between(r, 1200, 9000); return { value: `${ja(v)}万円`, num: v * 1e4 }; } },
      { label: "前年比", make: (r) => { const v = between(r, -12, 30, 1); return { value: `${v >= 0 ? "+" : ""}${v}%`, num: v }; } },
      { label: "新規顧客数", make: (r) => { const v = between(r, 40, 400); return { value: `${ja(v)}社`, num: v }; } },
      { label: "解約率", make: (r) => { const v = between(r, 0.3, 4, 1); return { value: `${v}%`, num: v }; } },
    ],
    sentence: (v) => `今月の売上は${v[0]}で、前年比は${v[1]}でした。新規顧客数は${v[2]}、解約率は${v[3]}です。`,
  },
  {
    title: "採用活動の状況",
    items: [
      { label: "応募数", make: (r) => { const v = between(r, 300, 2500); return { value: `${ja(v)}人`, num: v }; } },
      { label: "面接実施数", make: (r) => { const v = between(r, 60, 280); return { value: `${ja(v)}人`, num: v }; } },
      { label: "内定数", make: (r) => { const v = between(r, 8, 50); return { value: `${v}人`, num: v }; } },
      { label: "内定承諾率", make: (r) => { const v = between(r, 40, 90); return { value: `${v}%`, num: v }; } },
    ],
    sentence: (v) => `今期の応募数は${v[0]}、面接を実施したのは${v[1]}でした。内定は${v[2]}に出し、内定承諾率は${v[3]}です。`,
  },
  {
    title: "サポート窓口の状況",
    items: [
      { label: "問い合わせ件数", make: (r) => { const v = between(r, 800, 6000); return { value: `${ja(v)}件`, num: v }; } },
      { label: "平均応答時間", make: (r) => { const v = between(r, 2, 40); return { value: `${v}分`, num: v }; } },
      { label: "一次解決率", make: (r) => { const v = between(r, 55, 95); return { value: `${v}%`, num: v }; } },
    ],
    sentence: (v) => `先月の問い合わせは${v[0]}ありました。平均応答時間は${v[1]}、一次解決率は${v[2]}でした。`,
  },
  {
    title: "工場の稼働状況",
    items: [
      { label: "生産数", make: (r) => { const v = between(r, 10000, 90000); return { value: `${ja(v)}個`, num: v }; } },
      { label: "不良率", make: (r) => { const v = between(r, 0.1, 2.5, 2); return { value: `${v}%`, num: v }; } },
      { label: "設備稼働率", make: (r) => { const v = between(r, 70, 98, 1); return { value: `${v}%`, num: v }; } },
    ],
    sentence: (v) => `今週の生産数は${v[0]}でした。不良率は${v[1]}、設備稼働率は${v[2]}です。`,
  },
  {
    title: "Web サイトのアクセス状況",
    items: [
      { label: "ページビュー", make: (r) => { const v = between(r, 50000, 900000); return { value: `${ja(v)}PV`, num: v }; } },
      { label: "訪問者数", make: (r) => { const v = between(r, 8000, 120000); return { value: `${ja(v)}人`, num: v }; } },
      { label: "直帰率", make: (r) => { const v = between(r, 20, 75, 1); return { value: `${v}%`, num: v }; } },
      { label: "平均滞在時間", make: (r) => { const m = between(r, 1, 6); const s = between(r, 0, 59); return { value: `${m}分${s}秒` }; } },
    ],
    sentence: (v) => `先月のページビューは${v[0]}、訪問者数は${v[1]}でした。直帰率は${v[2]}、平均滞在時間は${v[3]}です。`,
  },
];

function statTasks(count: number, seed: number): EvalTask[] {
  const r = rng(seed);
  const questions = ["主要な数値をカードでまとめて表示して。", "数字を一目でわかるように示してください。", "KPI を数値カードで見せて。", "この状況を指標ごとにまとめて。"];
  const out: EvalTask[] = [];
  for (let i = 0; i < count; i++) {
    const d = STAT_DOMAINS[i % STAT_DOMAINS.length]!;
    const made = d.items.map((it) => ({ label: it.label, ...it.make(r) }));
    const gold: StatFigure = {
      kind: "stat",
      title: d.title,
      refs: [],
      items: made.map((m) => (m.num === undefined ? { label: m.label, value: m.value, refs: [] } : { label: m.label, value: m.value, num: m.num, refs: [] })),
    };
    out.push({
      id: `stat-${String(i + 1).padStart(3, "0")}`,
      category: "stat",
      question: `${d.title}について、${questions[i % questions.length]}`,
      context: d.sentence(made.map((m) => m.value)),
      expect: "figure",
      acceptKinds: ["stat"],
      gold,
    });
  }
  return out;
}

// ------------------------------------------------------------ 図を出すべきでない課題

const UNNEEDED: { question: string; context: string }[] = [
  { question: "有給休暇は何日前までに申請すればよいですか？", context: "就業規則 第21条（年次有給休暇の取得）\n年次有給休暇を取得しようとする者は、原則として取得予定日の3日前までに所属長へ申請しなければならない。ただし、病気その他やむを得ない事由がある場合は、事後速やかに申請することで足りる。" },
  { question: "この議事録を3行で要約してください。", context: "定例会議 議事録（10月7日）\n・新製品の発売時期について、品質確認が終わるまで延期することで合意した。\n・展示会への出展は前年と同じ規模で行う。担当は営業企画部。\n・社内勉強会を月1回開催する案が出され、次回会議で決定する。" },
  { question: "納品遅延についてのお詫びメールの文面を考えて。", context: "取引先: 株式会社サンプル商事 購買部 山田様\n状況: 10月10日納品予定の部品が、物流の混乱により10月15日にずれ込む見込み。代替手段として一部を先行出荷できる。" },
  { question: "RAG とは何ですか？社内向けに簡単に説明してください。", context: "社内用語集より: RAG（検索拡張生成）は、質問に関連する社内文書を検索し、その内容を根拠として生成AIが回答を作る仕組み。回答に引用元を示せるため、内容の確認がしやすい。" },
  { question: "この契約条項で注意すべき点を教えて。", context: "第8条（損害賠償）乙が本契約に違反し甲に損害を与えた場合、乙はその損害を賠償する。ただし、賠償額は本契約に基づき甲が乙に支払った委託料の総額を上限とする。" },
  { question: "新しく配属された人向けに、チームへの挨拶文を考えて。", context: "配属先: 情報システム部 インフラチーム\n前職: 製造業の社内SE（5年）\n趣味: 登山" },
  { question: "社内イベントの案内文を作ってください。", context: "イベント: 秋の社内交流会\n日時: 11月14日（金）18:30〜20:30\n場所: 本社 10階 ラウンジ\n内容: 軽食・部署紹介・ビンゴ大会\n申込: 11月7日までに総務部へ" },
  { question: "この製品の特徴を一言で表すと？", context: "製品資料: 新型業務用プリンター X100 は、従来機より静音性を高め、オフィスの会話を妨げない設計とした。トナー交換も前面から片手で行える。" },
  { question: "経費精算で領収書を紛失した場合はどうすればいいですか？", context: "経費精算規程 第12条: 領収書を紛失した場合は、支払証明書に支払日・支払先・金額・用途を記載し、所属長の承認を得て提出すること。" },
  { question: "在宅勤務の申請方法を教えて。", context: "在宅勤務規程: 在宅勤務を希望する者は、前日までに勤怠システムで在宅勤務申請を行い、所属長の承認を得る。初回のみ情報セキュリティ研修の受講が必要。" },
];

const NODATA: { question: string; context: string }[] = [
  { question: "来年度の売上予測を折れ線グラフで見せて。", context: "経営企画部メモ: 来年度の予算策定は11月から開始する。各事業部は10月末までに事業計画の骨子を提出すること。売上予測の数値は未確定。" },
  { question: "競合他社の市場シェアを棒グラフで比較して。", context: "営業部週報: 今週は大手顧客2社への提案を実施した。競合の動向については、展示会で情報収集を行う予定。" },
  { question: "部署別の従業員満足度をグラフにして。", context: "人事部より: 従業員満足度調査は11月に実施予定です。設問案を現在作成中で、結果は1月に公表します。" },
  { question: "過去5年間の離職率の推移をグラフで示して。", context: "人事制度の概要: 当社は2023年に評価制度を改定し、半期ごとの面談を導入した。離職防止のため、メンター制度も導入している。" },
  { question: "製品別の利益率を数値カードでまとめて。", context: "製品一覧: 製品A（業務用プリンター）、製品B（複合機）、製品C（保守サービス）。いずれも法人向けに販売している。" },
  { question: "地域別の来店者数を棒グラフにして。", context: "店舗運営マニュアル: 来店者数は各店舗の入口カウンターで計測し、本部のシステムへ毎日送信する。集計結果は月初に共有する。" },
  { question: "今月の広告費の内訳をグラフで見せて。", context: "マーケティング部連絡: 今月から広告費の管理を新しい会計システムに移行しました。内訳の集計方法は来週の会議で確認します。" },
  { question: "チーム別の残業時間を比較するグラフを作って。", context: "働き方改革の取り組み: 残業の事前申請を徹底し、ノー残業デーを毎週水曜日に設定した。各チームのリーダーは申請状況を確認すること。" },
  { question: "四半期ごとの問い合わせ件数の推移を見せて。", context: "サポート窓口の案内: 受付時間は平日9時〜18時。問い合わせはメールと電話で受け付け、チャット窓口は来年開設予定。" },
  { question: "主要KPIを数値カードで表示して。", context: "経営会議の議題: ①中期経営計画の進捗確認 ②新規事業の方向性 ③人材育成方針。各議題の資料は前日までに共有すること。" },
];

function noneTasks(kind: "none-unneeded" | "none-nodata"): EvalTask[] {
  const src = kind === "none-unneeded" ? UNNEEDED : NODATA;
  return src.map((t, i) => ({
    id: `${kind}-${String(i + 1).padStart(3, "0")}`,
    category: kind,
    question: t.question,
    context: t.context,
    expect: "none" as const,
    acceptKinds: [],
  }));
}

export function generatedTasks(): EvalTask[] {
  return [
    ...chartTasks("bar", 25, 101),
    ...chartTasks("line", 20, 202),
    ...pieTasks(18, 606),
    ...scatterTasks(10, 707),
    ...progressTasks(8, 808),
    ...funnelTasks(8, 909),
    ...statTasks(20, 303),
    ...longTasks(10, 404),
    ...jpnumTasks(10, 505),
    ...noneTasks("none-unneeded"),
    ...noneTasks("none-nodata"),
  ];
}
