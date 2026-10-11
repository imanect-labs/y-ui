import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // 開発中はビルドせずにソースを直接使う（公開パッケージは dist を指す）。
    alias: { "@imanect/yui": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "eval/test/**/*.test.ts"],
  },
});
