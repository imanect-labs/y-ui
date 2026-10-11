# @imanect/yui

**Yui (結)** — a tiny, LLM-friendly notation for drawing figures inside Markdown, and the parser for it.

Models write a few lines of data in a ` ```ui ` block; the renderer decides layout, colors and axes.
It is designed to be written correctly by small models with a short prompt, rendered while streaming, and safe for any input (no HTML, URLs or scripts).

````md
```ui
bar Monthly sales [1]
unit: 10k JPY
Month | Sales | Profit
Jan | 120 | 30
Feb | 150 | -10
```
````

Five figure kinds in v0.1: `bar`, `line`, `stat`, `flow` and `stack` (layered architecture diagrams).
The parser is lenient with what models naturally write (GFM tables, Mermaid-style arrows, Japanese number formats such as `1億2,000万円` or `△120`) and reports per-line diagnostics instead of failing the whole block.

> Status: **0.1 — parser only.** Renderers (`@imanect/yui/svg`, `@imanect/yui/react`) and a Markdown plugin are planned.

## Install

```sh
npm install @imanect/yui
```

## Usage

```ts
import { parseMarkdown, toText } from "@imanect/yui";

// Works on partial (streaming) text: unfinished last lines are held back,
// so a figure only ever grows and never shows a half-written value.
for (const seg of parseMarkdown(streamingText)) {
  if (seg.type === "ui" && seg.result.figure) {
    render(seg.result.figure, seg.result.diagnostics);
  }
}

// Plain-Markdown fallback (tables / lists) for places that don't support Yui.
toText(figure);
```

Other exports: `parseBlock` (one block), `splitMarkdown`, `toSource` (canonical source), `transformMarkdown`, `parseNumber`.

## Docs

- Notation spec (Japanese): [docs/spec.md](https://github.com/imanect-labs/y-ui/blob/main/docs/spec.md)
- Export / copy design (Japanese): [docs/export.md](https://github.com/imanect-labs/y-ui/blob/main/docs/export.md)

## License

Licensed under either of [MIT](./LICENSE-MIT) or [Apache-2.0](./LICENSE-APACHE) at your option.
