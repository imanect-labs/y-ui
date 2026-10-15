/** 図 1 つをシーンにする（見出し → 本体 → 注記）。 */

import type { Figure } from "../ir.js";
import { toText } from "../text.js";
import { layoutChart } from "./chart.js";
import { drawNote, drawTitle, makeCtx, type LayoutOptions } from "./frame.js";
import { layoutFlow } from "./flow.js";
import { layoutPie } from "./pie.js";
import { layoutScatter } from "./scatter.js";
import { layoutSeq } from "./seq.js";
import { layoutTree } from "./tree.js";
import { layoutCards, layoutFunnel, layoutProgress } from "./v08.js";
import { layoutGantt, layoutQuadrant } from "./v08b.js";
import type { Scene } from "./scene.js";
import { layoutStack } from "./stack.js";
import { layoutStat } from "./stat.js";

export type { LayoutOptions } from "./frame.js";

export function layout(f: Figure, opts: LayoutOptions = {}): Scene {
  const ctx = makeCtx(opts);
  let y = drawTitle(ctx, f, ctx.pad - 4);
  switch (f.kind) {
    case "bar":
    case "line":
      y = layoutChart(ctx, f, y);
      break;
    case "pie":
      y = layoutPie(ctx, f, y);
      break;
    case "stat":
      y = layoutStat(ctx, f, y);
      break;
    case "flow":
      y = layoutFlow(ctx, f, y + 4);
      break;
    case "stack":
      y = layoutStack(ctx, f, y + 4);
      break;
    case "scatter":
      y = layoutScatter(ctx, f, y);
      break;
    case "timeline":
    case "steps":
      y = layoutSeq(ctx, f, y + 4);
      break;
    case "tree":
      y = layoutTree(ctx, f, y + 4);
      break;
    case "cards":
      y = layoutCards(ctx, f, y + 2);
      break;
    case "progress":
      y = layoutProgress(ctx, f, y);
      break;
    case "funnel":
      y = layoutFunnel(ctx, f, y + 12);
      break;
    case "quadrant":
      y = layoutQuadrant(ctx, f, y);
      break;
    case "gantt":
      y = layoutGantt(ctx, f, y);
      break;
  }
  y = drawNote(ctx, f, y);
  return { width: ctx.width, height: Math.ceil(y + ctx.pad - 6), items: ctx.items, title: f.title, desc: toText(f), targets: ctx.targets };
}
