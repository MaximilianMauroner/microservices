import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const productionPoolSources = [
  "../status/src/heartbeat-repository.ts",
  "../publisher/src/postgres-storage.ts",
  "../field-guide/src/postgres-repository.ts",
  "../money/money-repository.ts",
  "../money/money-market-data-repository.ts",
  "../feedback/repository.ts",
  "../src/scheduled-task-leases.ts"
] as const;

describe("serverless Postgres pools", () => {
  it("closes idle connections before Railway's inactivity window", async () => {
    const sources = await Promise.all(
      productionPoolSources.map((path) => readFile(new URL(path, import.meta.url), "utf8"))
    );

    for (const source of sources) {
      expect(source).toContain("idle_timeout: 120");
    }
  });
});
