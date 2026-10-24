/**
 * エディタの確認用ページ（scripts/editor-demo.ts がまとめて HTML にする）。
 * URL の ?theme=dark・?sample=<名前>・?lang=en で状態を変える。
 */
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { toSource, type AppFigure } from "@imanect/yui";
import { checkEditable, emptyApp, hasErrors, type Problem } from "@imanect/yui/editor";
import { AppEditor } from "@imanect/yui/editor/react";
import { AppView } from "@imanect/yui/react";

const SAMPLES: Record<string, string> = {
  expense: `app 経費の処理
## 経費の申請
> 領収書の内容を入力してください。
件名 = text 必須 例 4月 大阪出張の交通費
金額 = number 1..1000000 円 必須 as amount
区分 = choice 交通費 | 出張費 | 備品 as category
日付 = date 必須
立替 = toggle 初期 オン
button 申請する -> workflow 経費申請

## 月次の集計
対象月 = month 必須
部署 = choice 営業=sales | 開発=dev | 管理=admin multi
button 集計する -> workflow 月次集計
`,
};

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = theme;
const locale = params.get("lang") === "en" ? "en" : "ja-JP";
const sample = params.get("sample") ?? "expense";

const workflows = [
  { name: "経費申請", inputs: [{ key: "amount", label: "金額", type: "number" as const, required: true }, { key: "category", label: "区分", type: "choice" as const, required: true, options: ["交通費", "出張費", "備品"] }, { key: "件名", required: true }, { key: "日付", type: "date" as const }, { key: "立替", type: "toggle" as const }, { key: "memo", label: "備考", type: "textarea" as const }] },
  { name: "月次集計" },
];

function initial(): AppFigure {
  if (sample === "empty") return emptyApp("新しい画面");
  const r = checkEditable(SAMPLES.expense!);
  if (!r.ok) throw new Error("sample");
  if (sample !== "broken") return r.figure;
  // チェッカーの見え方を確かめるため、書けない設定をわざと入れる
  const f = structuredClone(r.figure);
  const s0 = f.sections[0]!;
  s0.fields[0]!.placeholder = "multi line";
  s0.fields[1]!.min = 1;
  delete s0.fields[1]!.max;
  s0.fields[2]!.options!.push({ label: "その他", value: "その他" });
  s0.actions[0]!.target = { kind: "workflow", name: "存在しない" };
  f.sections[1]!.title = "";
  return f;
}

function Demo() {
  const [figure, setFigure] = useState<AppFigure>(initial);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [tab, setTab] = useState<"edit" | "source" | "preview">("edit");
  (window as unknown as { __figure: AppFigure }).__figure = figure;
  return h(
    "div",
    { style: { maxWidth: 1240, margin: "0 auto", padding: "20px 16px 80px" } },
    h(
      "div",
      { style: { display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" } },
      ...(["edit", "source", "preview"] as const).map((k) => h("button", { key: k, "data-tab": k, onClick: () => setTab(k), style: { font: "inherit", fontSize: 13, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: tab === k ? "var(--fg)" : "transparent", color: tab === k ? "var(--bg)" : "var(--fg)", cursor: "pointer" } }, { edit: "組み立てる", source: "書く", preview: "プレビュー" }[k])),
      h("span", { style: { flex: 1 } }),
      h("span", { "data-save": hasErrors(problems) ? "blocked" : "ok", style: { fontSize: 12, opacity: 0.7 } }, hasErrors(problems) ? "保存できません" : "保存できます"),
    ),
    tab === "edit"
      ? // 実行先はわざとその場で配列にする（描くたびに新しい配列でも描き直しが続かないことを確かめる）
        h(AppEditor, { figure, onChange: setFigure, workflows: workflows.map((w) => ({ ...w })), allowChat: false, onProblems: setProblems, theme, locale })
      : tab === "source"
        ? h("pre", { "data-source": "", style: { fontSize: 13, padding: 16, border: "1px solid var(--line)", borderRadius: 12, whiteSpace: "pre-wrap" } }, toSource(figure))
        : h(AppView, { figure, theme, onAction: () => ({ ok: true }) }),
  );
}

createRoot(document.getElementById("root")!).render(h(StrictMode, null, h(Demo)));
