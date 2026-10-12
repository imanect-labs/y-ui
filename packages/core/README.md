# @imanect/yui

**Yui (結)** — a tiny, LLM-friendly notation for drawing figures inside Markdown, with a parser, an SVG renderer and React components.

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

Five figure kinds: `bar`, `line`, `stat` (KPI cards), `flow` (flowcharts with branches and loops) and `stack` (layered architecture diagrams).
The parser is lenient with what models naturally write (GFM tables, Mermaid-style arrows, Japanese number formats such as `1億2,000万円` or `△120`) and reports per-line diagnostics instead of failing the whole block.

## Install

```sh
npm install @imanect/yui
```

`react` (>= 18) is an optional peer dependency, needed only for `@imanect/yui/react`.

## React

```tsx
import { YuiBlock, isYuiLanguage } from "@imanect/yui/react";

// e.g. with react-markdown
<Markdown
  components={{
    code({ className, children }) {
      return isYuiLanguage(className)
        ? <YuiBlock source={String(children)} streaming={isStreaming} />
        : <code className={className}>{children}</code>;
    },
  }}
>
  {text}
</Markdown>
```

`YuiBlock` re-lays out to its container width, follows the page's light/dark theme, and while `streaming` draws only completed lines — a figure grows and never shows a half-written value.

## SVG (browser or server)

```ts
import { parseBlock } from "@imanect/yui";
import { renderSVG } from "@imanect/yui/svg";

const { figure } = parseBlock(source, { final: true });
renderSVG(figure!);                                  // for screens: CSS variables, fluid width
renderSVG(figure!, { theme: "light", width: 720 });  // for export: colors and size baked in
```

The same layout drives both outputs, so what you export is what you saw. Every SVG carries a `<desc>` with a plain-text table of the data for screen readers.

## Theming

Colors are CSS custom properties: `--yui-s1` … `--yui-s8` (series), `--yui-ink`, `--yui-ink2`, `--yui-muted`, `--yui-grid`, `--yui-axis`, `--yui-surface`, `--yui-surface2`, `--yui-border`, `--yui-accentWash`, `--yui-accentLine`.
Set them on any ancestor to match your design system. The defaults are a colorblind-validated palette with separate light and dark steps.

## Parser only

```ts
import { parseMarkdown, toText } from "@imanect/yui";

for (const seg of parseMarkdown(streamingText)) {
  if (seg.type === "ui" && seg.result.figure) draw(seg.result.figure);
}
toText(figure); // plain-Markdown fallback (tables / lists)
```

## Docs

- Notation spec (Japanese): [docs/spec.md](https://github.com/imanect-labs/y-ui/blob/main/docs/spec.md)
- Evaluation with small models (Japanese): [docs/eval-results-2026-10-12-gemma.md](https://github.com/imanect-labs/y-ui/blob/main/docs/eval-results-2026-10-12-gemma.md)

## License

Licensed under either of [MIT](./LICENSE-MIT) or [Apache-2.0](./LICENSE-APACHE) at your option.
