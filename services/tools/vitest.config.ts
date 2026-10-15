import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname
    }
  },
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, ...(process.env.TOOLS_REQUIRED_POSTGRES === "1" ? [] : ["test/money-repository.integration.test.ts"])],
    include: ["test/**/*.test.{ts,tsx}", "markdown-share/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/router-link-mock.tsx"]
  }
});
