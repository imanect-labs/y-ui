import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // 開発中はビルドせずにソースを直接使う（公開パッケージは dist を指す）。
    alias: [
      { find: /^@imanect\/yui\/guide$/, replacement: fileURLToPath(new URL("./packages/core/src/guide/index.ts", import.meta.url)) },
      { find: /^@imanect\/yui\/svg$/, replacement: fileURLToPath(new URL("./packages/core/src/svg.ts", import.meta.url)) },
      { find: /^@imanect\/yui\/editor\/react$/, replacement: fileURLToPath(new URL("./packages/core/src/editor/react/index.ts", import.meta.url)) },
      { find: /^@imanect\/yui\/editor$/, replacement: fileURLToPath(new URL("./packages/core/src/editor/index.ts", import.meta.url)) },
      { find: /^@imanect\/yui\/react$/, replacement: fileURLToPath(new URL("./packages/core/src/react/index.ts", import.meta.url)) },
      { find: /^@imanect\/yui$/, replacement: fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)) },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "eval/test/**/*.test.ts"],
  },
});
