import { describe, expect, it, vi } from "vitest";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../field-guide/src/postgres-push-guard.js";

describe("money PostgreSQL destructive-test gate", () => {
  it("allows cleanup only after the canonical sentinel matches", async () => {
    const cleanup = vi.fn(async () => undefined);
    await withVerifiedDisposableDatabase({
      readRelationKind: async () => "r",
      readValue: async () => DISPOSABLE_DATABASE_SENTINEL.value,
    }, cleanup);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it.each([
    { kind: undefined, value: DISPOSABLE_DATABASE_SENTINEL.value },
    { kind: "v", value: DISPOSABLE_DATABASE_SENTINEL.value },
    { kind: "r", value: undefined },
    { kind: "r", value: "wrong-purpose" },
  ])("blocks cleanup for an invalid sentinel: $kind/$value", async ({ kind, value }) => {
    const cleanup = vi.fn(async () => undefined);
    await expect(withVerifiedDisposableDatabase({
      readRelationKind: async () => kind,
      readValue: async () => value,
    }, cleanup)).rejects.toThrow("Disposable database sentinel");
    expect(cleanup).not.toHaveBeenCalled();
  });
});
