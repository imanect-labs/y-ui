/**
 * callout（注意書き）と map（地図）。
 *
 * callout: 1 行目の見出しの先頭の語が種類（`callout warning 締め切りの注意`。info・success・warning・danger、
 *   日本語の `情報`・`成功`・`注意`・`警告`/`危険` も可）。本文は段落、`- ` は箇条書き。
 * map: `- 名前 | 緯度 | 経度 | 説明`、`名前: 緯度, 経度`。`route: A -> B -> C (walk)`、`zoom: 14`。
 */

import type { CalloutFigure, MapFigure, MapMarker } from "../ir.js";
import { clip, Diagnostics, hasPipe, isSeparatorRow, LIMITS, type Line, parseOption, splitCells, stripListMarker, takeRefs } from "../lines.js";

const TONES: Record<string, CalloutFigure["tone"]> = {
  info: "info",
  note: "info",
  tip: "info",
  情報: "info",
  ヒント: "info",
  メモ: "info",
  success: "success",
  ok: "success",
  成功: "success",
  完了: "success",
  warning: "warning",
  caution: "warning",
  注意: "warning",
  danger: "danger",
  error: "danger",
  critical: "danger",
  警告: "danger",
  危険: "danger",
  重要: "danger",
};

/** 見出しの先頭の語が種類なら取り出す（`warning 締め切り` → warning と「締め切り」）。 */
export function calloutTone(title: string): { tone: CalloutFigure["tone"]; title: string } | null {
  const m = /^(\S+)(?:\s+(.*))?$/.exec(title.trim());
  if (!m) return null;
  const tone = TONES[m[1]!.normalize("NFKC").toLowerCase().replace(/[:：]$/, "")];
  return tone ? { tone, title: (m[2] ?? "").trim() } : null;
}

export function parseCallout(fig: CalloutFigure, body: Line[], diags: Diagnostics): void {
  const t = calloutTone(fig.title);
  if (t) {
    fig.tone = t.tone;
    fig.title = t.title;
  }
  const paras: string[] = [];
  for (const line of body) {
    const trimmed = line.text.trim();
    if (trimmed === "") continue;
    const opt = parseOption(trimmed, ["note", "src"]);
    if (opt) {
      if (opt.key === "note") fig.note = opt.value;
      else fig.src = opt.value;
      continue;
    }
    const tone = /^(?:tone|種類)\s*[:：]\s*(\S+)$/i.exec(trimmed);
    if (tone && TONES[tone[1]!.toLowerCase()]) {
      fig.tone = TONES[tone[1]!.toLowerCase()]!;
      continue;
    }
    const { text, marked } = stripListMarker(trimmed);
    if (marked) {
      if (fig.items.length >= LIMITS.calloutItems) {
        diags.addOnce(line.no, "warning", "limit_exceeded", `箇条書きは ${LIMITS.calloutItems} 個までです`);
        continue;
      }
      fig.items.push(clip(text, line.no, diags));
    } else paras.push(clip(text, line.no, diags));
  }
  fig.body = paras.join("\n");
}

// ---------------------------------------------------------------- map

const NUM = /^-?\d{1,3}(?:\.\d+)?$/;

function marker(cells: string[], line: number, diags: Diagnostics): MapMarker | null {
  const name = takeRefs(cells[0] ?? "");
  const lat = Number(cells[1]?.trim());
  const lng = Number(cells[2]?.trim());
  if (!name.text || !NUM.test(cells[1]?.trim() ?? "") || !NUM.test(cells[2]?.trim() ?? "")) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    diags.add(line, "warning", "bad_number", `緯度・経度の範囲の外です: ${cells.slice(0, 3).join(" | ")}`);
    return null;
  }
  const m: MapMarker = { label: clip(name.text, line, diags), lat, lng, refs: name.refs };
  const desc = cells.slice(3).filter((c) => c !== "").join(" / ");
  if (desc) {
    const d = takeRefs(desc);
    m.desc = clip(d.text, line, diags);
    m.refs = [...new Set([...m.refs, ...d.refs])];
  }
  return m;
}

export function parseMap(fig: MapFigure, body: Line[], diags: Diagnostics): void {
  let first = true;
  for (const line of body) {
    const raw = stripListMarker(line.text.trim()).text;
    if (raw === "") continue;
    const opt = parseOption(raw, ["note", "src"]);
    if (opt) {
      if (opt.key === "note") fig.note = opt.value;
      else fig.src = opt.value;
      continue;
    }
    const route = /^(?:route|道順|経路)\s*[:：]\s*(.+?)(?:\s*[（(](walk|drive|transit|徒歩|車|電車|公共交通)[)）])?$/i.exec(raw);
    if (route) {
      const stops = route[1]!.split(/\s*(?:->|→|＞|>)\s*/).map((s) => s.trim()).filter(Boolean);
      const known = new Set(fig.markers.map((m) => m.label));
      const unknown = stops.filter((s) => !known.has(s));
      if (unknown.length) diags.add(line.no, "warning", "unrecognized_line", `道順に地点に無い名前があります: ${unknown.join("、")}`);
      const ok = stops.filter((s) => known.has(s));
      const mode = route[2] ? ({ walk: "walk", 徒歩: "walk", drive: "drive", 車: "drive", transit: "transit", 電車: "transit", 公共交通: "transit" } as const)[route[2].toLowerCase() as "walk"] : undefined;
      if (ok.length >= 2) fig.route = { stops: ok, ...(mode ? { mode } : {}) };
      continue;
    }
    const zoom = /^(?:zoom|ズーム)\s*[:：]\s*(\d{1,2})$/i.exec(raw);
    if (zoom) {
      fig.zoom = Math.min(20, Math.max(1, +zoom[1]!));
      continue;
    }
    let cells: string[];
    if (hasPipe(raw) || raw.includes("\t")) {
      cells = splitCells(raw);
      if (isSeparatorRow(cells)) continue;
      // 見出し行（`名前 | 緯度 | 経度`）
      if (first && !NUM.test(cells[1]?.trim() ?? "")) {
        first = false;
        continue;
      }
    } else {
      const kv = /^(.+?)\s*[:：]\s*(-?[\d.]+)\s*[,、]\s*(-?[\d.]+)\s*(?:[,、]\s*(.+))?$/.exec(raw);
      if (!kv) {
        diags.add(line.no, "warning", "unrecognized_line", `解釈できない行を無視しました（「名前 | 緯度 | 経度」）: ${raw}`);
        continue;
      }
      cells = [kv[1]!, kv[2]!, kv[3]!, ...(kv[4] ? [kv[4]] : [])];
    }
    first = false;
    const m = marker(cells, line.no, diags);
    if (!m) {
      diags.add(line.no, "warning", "unrecognized_line", `地点として読めません: ${raw}`);
      continue;
    }
    if (fig.markers.length >= LIMITS.mapMarkers) {
      diags.addOnce(line.no, "warning", "limit_exceeded", `地点は ${LIMITS.mapMarkers} 個までです`);
      continue;
    }
    fig.markers.push(m);
  }
}
