import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readFile, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  consumePushHandoff,
  createPushHandoff,
  resolvePushDatabase,
  verifyDisposableDatabase,
} from "../src/postgres-push-guard.js";

const execFileAsync = promisify(execFile);
const serviceDirectory = fileURLToPath(new URL("..", import.meta.url));

describe("PostgreSQL schema push", () => {
  it("separates production and disposable-test authorization", async () => {
    const production = "postgres://user:pass@production.example/field_guide";
    const disposable = "postgres://user:pass@test.example/field_guide_test";
    expect(resolvePushDatabase({ DATABASE_URL: production, FIELD_GUIDE_SCHEMA_PUSH_CONFIRM: "field-guide-console-production" }, "production")).toBe(production);
    expect(resolvePushDatabase({ TEST_DATABASE_URL: disposable, FIELD_GUIDE_TEST_DATABASE_CONFIRM: "field-guide-console-test" }, "test")).toBe(disposable);
    expect(() => resolvePushDatabase({ TEST_DATABASE_URL: production }, "test")).toThrow("Disposable test schema push requires");
    expect(() => resolvePushDatabase({ TEST_DATABASE_URL: disposable, FIELD_GUIDE_TEST_DATABASE_CONFIRM: "field-guide-console-test" }, "production")).toThrow("DATABASE_URL is required");
    await expect(verifyDisposableDatabase({ readRelationKind: async () => "r", readValue: async () => "wrong" })).rejects.toThrow("sentinel value");
  });

  it("fails closed before Drizzle or a database connection when test confirmation is absent", async () => {
    await expect(execFileAsync("bun", ["src/push-postgres.ts", "test"], {
      cwd: serviceDirectory,
      env: { ...process.env, DATABASE_URL: "", TEST_DATABASE_URL: "postgres://user:pass@example.com/not_disposable", FIELD_GUIDE_TEST_DATABASE_CONFIRM: "" },
    })).rejects.toMatchObject({ code: 1 });
    await expect(execFileAsync("bun", ["-e", "import('./drizzle.postgres.config.ts')"], {
      cwd: serviceDirectory,
      env: {
        ...process.env,
        FIELD_GUIDE_SCHEMA_PUSH_AUTHORIZATION: "field-guide-console-authorized-schema-push",
        FIELD_GUIDE_SCHEMA_PUSH_URL: "postgres://user:pass@example.com/not_disposable",
        FIELD_GUIDE_SCHEMA_PUSH_CONFIRM: "field-guide-console-production",
        DATABASE_URL: "postgres://user:pass@example.com/not_disposable",
        FIELD_GUIDE_SCHEMA_PUSH_HANDOFF: "",
        FIELD_GUIDE_SCHEMA_PUSH_NONCE: "",
        FIELD_GUIDE_SCHEMA_PUSH_MODE: "",
      },
    })).rejects.toMatchObject({ code: 1 });
  });

  it("issues a private, single-use handoff bound to the confirmed mode and URL", async () => {
    const environment = {
      DATABASE_URL: "postgres://user:pass@production.example/field_guide",
      FIELD_GUIDE_SCHEMA_PUSH_CONFIRM: "field-guide-console-production",
    };
    const handoff = createPushHandoff(environment, "production");
    const authorized = {
      ...environment,
      FIELD_GUIDE_SCHEMA_PUSH_HANDOFF: handoff.path,
      FIELD_GUIDE_SCHEMA_PUSH_NONCE: handoff.nonce,
      FIELD_GUIDE_SCHEMA_PUSH_MODE: handoff.mode,
    };
    try {
      expect(consumePushHandoff(authorized)).toBe(environment.DATABASE_URL);
      expect(() => consumePushHandoff(authorized)).toThrow();
    } finally {
      await rm(handoff.directory, { recursive: true, force: true });
    }
  });

  it("is wired before platform startup", async () => {
    const [servicePackage, rootRailway, serviceRailway] = await Promise.all([
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("../../../railway.json", import.meta.url), "utf8"),
      readFile(new URL("../../../apps/platform-service/railway.json", import.meta.url), "utf8"),
    ]);
    const scripts = JSON.parse(servicePackage).scripts;
    expect(scripts["db:push-postgres"]).toBe("bun src/push-postgres.ts production");
    expect(scripts["db:push-postgres:test"]).toBe("bun src/push-postgres.ts test");
    for (const railwaySource of [rootRailway, serviceRailway]) {
      const railway = JSON.parse(railwaySource) as { deploy: { preDeployCommand?: string[] } };
      expect(railway.deploy.preDeployCommand).toEqual([
        'FIELD_GUIDE_SCHEMA_PUSH_CONFIRM=field-guide-console-production DATABASE_URL="$FIELD_GUIDE_DATABASE_URL" bun run --cwd packages/field-guide-console db:push-postgres',
      ]);
    }
  });
});
