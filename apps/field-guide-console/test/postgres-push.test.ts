import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("PostgreSQL schema push", () => {
  it("is explicitly confirmed and wired before platform startup", async () => {
    const [config, servicePackage, rootRailway, serviceRailway] = await Promise.all([
      readFile(new URL("../drizzle.postgres.config.ts", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("../../../railway.json", import.meta.url), "utf8"),
      readFile(new URL("../../platform-service/railway.json", import.meta.url), "utf8"),
    ]);
    expect(config).toContain("process.env.TEST_DATABASE_URL");
    expect(config).toContain("process.env.DATABASE_URL");
    expect(config).toContain("FIELD_GUIDE_SCHEMA_PUSH_CONFIRM");
    expect(config).toContain("field-guide-console-production");
    expect(config.indexOf("testDatabaseUrl ??")).toBeGreaterThan(-1);
    expect(JSON.parse(servicePackage).scripts["db:push-postgres"]).toBe(
      "drizzle-kit push --config drizzle.postgres.config.ts",
    );
    for (const railwaySource of [rootRailway, serviceRailway]) {
      const railway = JSON.parse(railwaySource) as { deploy: { preDeployCommand?: string[] } };
      expect(railway.deploy.preDeployCommand).toEqual([
        'FIELD_GUIDE_SCHEMA_PUSH_CONFIRM=field-guide-console-production DATABASE_URL="$FIELD_GUIDE_DATABASE_URL" bun run --cwd apps/field-guide-console db:push-postgres',
      ]);
    }
  });
});
