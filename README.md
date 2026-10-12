# Yui (結)

[日本語](README.ja.md)

**Tie text and UI together.** Yui is a tiny notation for drawing figures inside Markdown with a ` ```ui ` block, plus a parser, an SVG renderer and React components.
Drop it into a chat UI or a Markdown editor the same way you use a Markdown renderer.

````md
```ui
bar Revenue and profit by quarter
unit: $M
Quarter | Revenue | Profit
Q1 | 120 | 30
Q2 | 150 | -5
```
````

- **The model writes data, not layout.** Placement, colors and axes are the renderer's job, so even small models get it right from a short prompt.
- **Accepts what models already write.** Markdown tables, bullet lists, Mermaid-style arrows and Japanese number formats (`1億2,000万円`, `△120`) just work.
- **Renders while streaming.** Lines are committed one by one; a figure only grows and never shows a half-written value.
- **Safe for any input.** No HTML, URLs or scripts — only text and numbers end up on screen.

npm: [`@imanect/yui`](https://www.npmjs.com/package/@imanect/yui)

## Figure kinds

<table>
<tr><th>Kind</th><th>You write</th><th>You get</th></tr>
<tr>
<td><code>bar</code></td>
<td><pre>bar Revenue and profit by quarter
unit: $M
Quarter | Revenue | Profit
Q1 | 120 | 30
Q2 | 150 | -5
Q3 | 135 | 12
Q4 | 210 | 44</pre></td>
<td><img src="docs/images/en-bar.png" width="400" alt="bar chart"></td>
</tr>
<tr>
<td><code>line</code></td>
<td><pre>line Weekly active users
Week | Web | App
W1 | 1200 | 800
W2 | 1350 | 950
…</pre></td>
<td><img src="docs/images/en-line.png" width="400" alt="line chart"></td>
</tr>
<tr>
<td><code>stat</code></td>
<td><pre>stat This month
Revenue | $3.2M | +18% YoY
New customers | 165
Churn | 2.2% | 2.6% last month
ARPU | $19.4K</pre></td>
<td><img src="docs/images/en-stat.png" width="400" alt="KPI cards"></td>
</tr>
<tr>
<td><code>flow</code></td>
<td><pre>flow Expense approval
Submit report -> Manager review
Manager review -approve-> Finance check -> Payment
Manager review -reject-> Revise
Revise -> Submit report</pre></td>
<td><img src="docs/images/en-flow.png" width="400" alt="flowchart"></td>
</tr>
<tr>
<td><code>stack</code></td>
<td><pre>stack System architecture
- Clients: Web / Electron / external chat
- Product API: tasks, conversations, users, auth
- Agent runtime: Elixir / Erlang OTP
  - Agent process
  - Session / journal
  - Scheduler / loop
  - Lean kernel
- LLM: OpenAI / Anthropic | Tools: external APIs | Storage: DB / object store</pre></td>
<td><img src="docs/images/en-stack.png" width="400" alt="architecture diagram"></td>
</tr>
</table>

Bar charts with many rows turn horizontal, flowcharts mark branches as diamonds and route loops around the side, and every figure re-lays out to its width and follows light/dark mode. Full notation: [docs/spec.md](docs/spec.md) (Japanese).

## Usage

```tsx
// React — e.g. replace code blocks in react-markdown
import { YuiBlock, isYuiLanguage } from "@imanect/yui/react";

const code = ({ className, children }) =>
  isYuiLanguage(className)
    ? <YuiBlock source={String(children)} streaming={isStreaming} />
    : <code className={className}>{children}</code>;
```

```ts
// SVG — same result in the browser and on the server
import { parseBlock, toText } from "@imanect/yui";
import { renderSVG } from "@imanect/yui/svg";

const { figure } = parseBlock(source, { final: true });
renderSVG(figure);                                 // screens: CSS variables, follows light/dark, fluid width
renderSVG(figure, { theme: "light", width: 720 }); // export: colors and size baked in
toText(figure);                                    // plain-Markdown fallback (tables / lists)
```

One layout drives both SVG and React output, so exports look exactly like the screen. The default palette is colorblind-validated in both light and dark; override it with CSS variables (`--yui-s1` … `--yui-s8`, `--yui-ink`, …).

## Does it work with small models?

We compared Yui against a JSON tool-call UI spec on Gemma 4 31B (141 tasks): Yui reached 92–99% versus 72–91%, with a quarter to a third of the tokens and half the latency. Flowcharts and architecture diagrams, which the JSON approach could barely produce, came out right 70–80% of the time. Details (Japanese): [docs/eval-results-2026-10-12-gemma.md](docs/eval-results-2026-10-12-gemma.md).

## Repository

| Path | What |
|---|---|
| `packages/core` | `@imanect/yui`: parser, IR, text fallback; `/svg` renderer; `/react` components |
| `eval` | Harness that measures how well models write Yui (tasks, scoring, runs, reports) |
| `scripts` | Rendering gallery and README images |
| `docs` | Spec, export design, evaluation plan and results (Japanese) |

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm eval truncation        # streaming robustness check (no model needed)
pnpm tsx scripts/readme-images.ts
```

Releases are published to npm by GitHub Actions when a `v*` tag is pushed (npm Trusted Publishing; no tokens in the repo).

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) at your option. Copyright (c) 2026 Imanect Labs.
