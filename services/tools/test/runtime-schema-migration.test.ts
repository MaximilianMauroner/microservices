import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("runtime schema management", () => {
  it("uses the guarded Drizzle push without migration scripts", async () => {
    const [rootConfig, previewConfig, serviceConfig, statusConfig, runtimeSource, packageJson] = await Promise.all([
      readFile(new URL("../../../railway.json", import.meta.url), "utf8"),
      readFile(new URL("../../../railway.preview.json", import.meta.url), "utf8"),
      readFile(new URL("../railway.json", import.meta.url), "utf8"),
      readFile(new URL("../status/railway.json", import.meta.url), "utf8"),
      readFile(new URL("../src/runtime.ts", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
    ]);

    for (const config of [rootConfig, previewConfig, serviceConfig]) {
      expect(config).toContain("db:push-postgres");
      expect(config).toContain("db:push-postgres && pnpm --dir services/tools/publisher run db:backfill");
      expect(config).not.toContain("db:migrate");
    }
    expect(JSON.parse(rootConfig).deploy.sleepApplication).toBe(true);
    expect(JSON.parse(previewConfig).deploy.sleepApplication).toBe(false);
    expect(JSON.parse(statusConfig).deploy).toMatchObject({
      startCommand: "pnpm --dir services/tools/status run start",
      cronSchedule: "*/5 * * * *",
      restartPolicyType: "NEVER"
    });
    expect(runtimeSource).not.toContain("executeChecker");
    expect(runtimeSource).not.toContain("status-checker:");
    expect(JSON.parse(packageJson).scripts["db:migrate"]).toBeUndefined();
    await expect(stat(new URL("../database/migrate.ts", import.meta.url))).rejects.toThrow();
  });
});
