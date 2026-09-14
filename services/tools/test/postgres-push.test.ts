import { describe, expect, it } from "vitest";
import { DISPOSABLE_DATABASE_SENTINEL, resolvePushDatabase, verifyDisposableDatabase } from "../database/postgres-push-guard.js";
import { moneyImportConstraintRepairs } from "../database/runtime-schema-reconciliation.js";

describe("Tools PostgreSQL schema push guard", () => {
  it("requires the explicit production confirmation", () => {
    const url = "postgres://user:pass@production.example/tools";
    expect(resolvePushDatabase({ DATABASE_URL: url, TOOLS_SCHEMA_PUSH_CONFIRM: "tools-platform-production" }, "production")).toBe(url);
    expect(() => resolvePushDatabase({ DATABASE_URL: url }, "production")).toThrow("TOOLS_SCHEMA_PUSH_CONFIRM=tools-platform-production");
  });

  it("protects disposable database operations with the Tools sentinel", async () => {
    await expect(verifyDisposableDatabase({
      readRelationKind: async () => "r",
      readValue: async () => DISPOSABLE_DATABASE_SENTINEL.value,
    })).resolves.toBeUndefined();
    await expect(verifyDisposableDatabase({
      readRelationKind: async () => "r",
      readValue: async () => "wrong-purpose",
    })).rejects.toThrow("Disposable database sentinel");
  });

  it("retains runtime constraint reconciliation", () => {
    expect(moneyImportConstraintRepairs([])).toEqual({ provider: true, format: true, category: true });
  });
});
