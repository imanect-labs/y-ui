/** `@imanect/yui-embed`: Markdown の ```ui ブロックを画像 URL にして埋め込む（docs/embed.md）。 */
export { CodeError, decodeSource, encodeSource, MAX_CODE_LENGTH, MAX_SOURCE_BYTES } from "./code.js";
export {
  type BlockReport,
  embedMarkdown,
  type EmbedOptions,
  type EmbedResult,
  embedSource,
  type EmbedTheme,
  END,
  imageUrl,
  type ImageUrlOptions,
  LONG_URL,
  normalizeBase,
  START,
  wrapBlock,
} from "./embed.js";
