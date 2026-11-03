import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const productionPoolSources = [
  "../../../products/status/heartbeat-repository.ts",
  "../../../products/publisher/postgres-storage.ts",
  "../../../products/money/money-repository.ts",
  "../../../products/money/money-market-data-repository.ts",
  "../../../products/feedback/repository.ts",
  "../../../platform/scheduler/leases.ts"
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
