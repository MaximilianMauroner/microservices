import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./platform/ui", import.meta.url).pathname
    }
  },
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "test/harness/journeys.test.ts", "test/products/money/money-repository.integration.test.ts", "test/products/money/money-ledger-contributions.integration.test.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/support/router-link-mock.tsx"]
  }
});
