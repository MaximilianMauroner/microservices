import { defineConfig } from "vitest/config";
import config from "./vitest.config.ts";

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: ["test/platform/auth/platform-identity.integration.test.ts", "test/platform/access/per-person-data.integration.test.ts", "test/products/kitchen/sync.integration.test.ts", "test/products/money/money-repository.integration.test.ts", "test/products/money/money-ledger-contributions.integration.test.ts", "test/products/documents/repository.test.ts", "test/products/documents/changes.test.ts", "test/products/documents/http.test.ts", "test/products/documents/import-convex.test.ts"],
    exclude: [],
    maxWorkers: 1,
    fileParallelism: false,
    allowOnly: false,
    passWithNoTests: false,
    retry: 0,
    testNamePattern: "",
  },
});
