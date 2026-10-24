/** パレットの印（16px・線だけ。文字の印は字体で形が崩れるため SVG で描く）。 */

import { createElement as h, type ReactElement } from "react";
import type { FieldType } from "../model.js";

export type IconName = FieldType | "workflow" | "chat" | "section";

const PATHS: Record<IconName, string> = {
  text: "M3 4h10M8 4v8",
  textarea: "M3 4h10M3 7h10M3 10h10M3 13h6",
  number: "M6 3 5 13M11 3l-1 10M3 6h10M3 10h10",
  choice: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  date: "M3 4.5h10v9H3zM3 7.5h10M5.5 2.5v3M10.5 2.5v3M7 9.5h2v2H7z",
  month: "M3 4.5h10v9H3zM3 7.5h10M5.5 2.5v3M10.5 2.5v3M5.5 10h5M5.5 12h5",
  daterange: "M2 8h12M5 5 2 8l3 3M11 5l3 3-3 3",
  toggle: "M5.5 4.5h5a3.5 3.5 0 0 1 0 7h-5a3.5 3.5 0 0 1 0-7ZM10.5 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  slider: "M2 8h12M6 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z",
  count: "M2.5 8h4M11.5 5.5v5M9 8h5",
  rating: "m8 2.5 1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.6 3.8-.5Z",
  workflow: "M5 3.5v9l7-4.5Z",
  chat: "M3 4h10v6.5H7l-3 2.5v-2.5H3Z",
  section: "M2.5 3.5h11v9h-11zM2.5 6.5h11",
};

export function Icon({ name }: { name: IconName }): ReactElement {
  return h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, h("path", { d: PATHS[name] }));
}
