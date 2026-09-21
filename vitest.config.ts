import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const shared = fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@avatar/shared": shared,
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
