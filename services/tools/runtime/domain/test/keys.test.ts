import { describe, expect, it } from "vitest";
import {
  BUCKET_KEYS,
  auditKey,
  exportKey,
  historyKey,
  recoveryKey
} from "../src/index.js";

describe("bucket key contract", () => {
  it("exports every fixed owner-separated key", () => {
    expect(BUCKET_KEYS).toEqual({
      catalog: "catalog/current.json",
      checkerState: "state/current.json",
      publicSnapshot: "snapshots/public.json",
      privateSnapshot: "snapshots/private.json",
      towerHeartbeat: "heartbeats/tower.json",
      recoveryPrefix: "recovery/",
      exportPrefix: "exports/"
    });
  });

  it("constructs history, audit, recovery, and export keys", () => {
    expect(historyKey("2026-07-27")).toBe("history/2026-07-27.json.gz");
    expect(
      auditKey("2026-07-27T12:34:56.789Z", "audit-1")
    ).toBe("audit/2026/07/2026-07-27T12:34:56.789Z-audit-1.json");
    expect(recoveryKey("state/2026-07-27.json")).toBe(
      "recovery/state/2026-07-27.json"
    );
    expect(exportKey("2026-07-27/state.json.gz")).toBe(
      "exports/2026-07-27/state.json.gz"
    );
  });

  it("rejects invalid dates and path traversal", () => {
    expect(() => historyKey("2026-02-30")).toThrow(/valid/);
    expect(() => auditKey("not-a-date", "audit-1")).toThrow(/timestamp/);
    expect(() => recoveryKey("../state.json")).toThrow(/unsafe/);
    expect(() => exportKey("/absolute")).toThrow(/unsafe/);
  });
});
