import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("runtime schema management", () => {
  it("uses the guarded Drizzle push without migration scripts", async () => {
    const [rootConfig, previewConfig, serviceConfig, packageJson] = await Promise.all([
      readFile(new URL("../../../railway.json", import.meta.url), "utf8"),
      readFile(new URL("../../../railway.preview.json", import.meta.url), "utf8"),
      readFile(new URL("../railway.json", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
    ]);

    for (const config of [rootConfig, previewConfig, serviceConfig]) {
      expect(config).toContain("db:push-postgres");
      expect(config).toContain("db:push-postgres && pnpm --dir services/tools/publisher run db:backfill");
      expect(config).not.toContain("db:migrate");
    }
    expect(JSON.parse(packageJson).scripts["db:migrate"]).toBeUndefined();
    await expect(stat(new URL("../database/migrate.ts", import.meta.url))).rejects.toThrow();
  });
});
