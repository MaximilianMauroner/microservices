import { defineConfig } from "vitest/config";
import config from "./vitest.config.ts";

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: [
      "test/products/money/money-statement-formats.test.ts",
      "test/products/publisher/publish-page-resume.test.tsx",
      "test/products/publisher/direct-uploads.integration.test.ts",
    ],
    exclude: [],
    maxWorkers: 1,
    fileParallelism: false,
    allowOnly: false,
    passWithNoTests: false,
    retry: 0,
    testNamePattern: "",
  },
});
