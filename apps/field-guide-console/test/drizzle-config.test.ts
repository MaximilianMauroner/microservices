import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  consumeSQLitePushHandoff,
  createSQLitePushHandoff,
  resolveSQLitePushPath,
} from "../src/sqlite-push-guard.js";

const serviceDirectory = fileURLToPath(new URL("..", import.meta.url));

describe("SQLite Drizzle config", () => {
  it("requires an explicit absolute path and confirmation", () => {
    expect(() => resolveSQLitePushPath({},)).toThrow("explicit absolute path");
    expect(() => resolveSQLitePushPath({ SQLITE_PATH: "data/field-guide.sqlite" })).toThrow("explicit absolute path");
    expect(() => resolveSQLitePushPath({ SQLITE_PATH: "/tmp/field-guide.sqlite" })).toThrow("requires FIELD_GUIDE_SQLITE_PUSH_CONFIRM");
  });

  it("rejects direct config invocation even with public confirmation values", () => {
    const result = spawnSync("bun", ["-e", "import('./drizzle.config.ts')"], {
      cwd: serviceDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        SQLITE_PATH: "/tmp/field-guide.sqlite",
        FIELD_GUIDE_SQLITE_PUSH_CONFIRM: "field-guide-console-sqlite",
        FIELD_GUIDE_SQLITE_PUSH_HANDOFF: "",
        FIELD_GUIDE_SQLITE_PUSH_NONCE: "",
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("guarded db:push-sqlite command");
  });

  it("issues a private, single-use handoff bound to the SQLite path", () => {
    const environment = {
      SQLITE_PATH: "/tmp/field-guide.sqlite",
      FIELD_GUIDE_SQLITE_PUSH_CONFIRM: "field-guide-console-sqlite",
    };
    const handoff = createSQLitePushHandoff(environment);
    const authorized = {
      ...environment,
      FIELD_GUIDE_SQLITE_PUSH_HANDOFF: handoff.path,
      FIELD_GUIDE_SQLITE_PUSH_NONCE: handoff.nonce,
    };
    try {
      expect(consumeSQLitePushHandoff(authorized)).toBe(environment.SQLITE_PATH);
      expect(() => consumeSQLitePushHandoff(authorized)).toThrow();
    } finally {
      rmSync(handoff.directory, { recursive: true, force: true });
    }
  });
});
