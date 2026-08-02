import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("PostgreSQL decision-record migration", () => {
  it("is committed, checksummed, locked, transactional, and wired before platform startup", async () => {
    const [migration, runner, servicePackage, rootRailway, serviceRailway] = await Promise.all([
      readFile(new URL("../postgres-migrations/20260802120000_decision_records.sql", import.meta.url), "utf8"),
      readFile(new URL("../src/migrate-postgres.ts", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("../../../railway.json", import.meta.url), "utf8"),
      readFile(new URL("../../platform-service/railway.json", import.meta.url), "utf8"),
    ]);
    for (const table of ["decision_records", "decision_feedback_events", "decision_promotions", "decision_promotion_records"])
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    expect(migration).toContain("decision_feedback_events_record_sequence_idx");
    expect(runner).toContain("pg_advisory_xact_lock");
    expect(runner).toContain("checksum mismatch");
    expect(runner).toContain("sql.begin");
    expect(runner).toContain("FIELD_GUIDE_DATABASE_URL");
    expect(runner).not.toContain("process.env.DATABASE_URL");
    expect(JSON.parse(servicePackage).scripts["db:migrate-postgres"]).toBe("bun src/migrate-postgres.ts");
    for (const railwaySource of [rootRailway, serviceRailway]) {
      const railway = JSON.parse(railwaySource) as { deploy: { preDeployCommand?: string[] } };
      expect(railway.deploy.preDeployCommand).toEqual([
        "bun run --cwd apps/field-guide-console db:migrate-postgres",
      ]);
    }
  });
});
