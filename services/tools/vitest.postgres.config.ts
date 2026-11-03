import { defineConfig } from "vitest/config";
import config from "./vitest.config.ts";

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: ["test/platform-identity.integration.test.ts", "test/per-person-data.integration.test.ts", "test/money-repository.integration.test.ts", "test/money-ledger-contributions.integration.test.ts", "test/markdown-share/repository.test.ts", "test/markdown-share/changes.test.ts", "test/markdown-share/http.test.ts", "test/markdown-share/import-convex.test.ts"],
    exclude: [],
    maxWorkers: 1,
    fileParallelism: false,
    allowOnly: false,
    passWithNoTests: false,
    retry: 0,
    testNamePattern: "",
  },
});
