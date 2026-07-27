import {
  HISTORY_SCHEMA_VERSION,
  type HistoryPartitionDocument
} from "@tools-platform/domain";
import { describe, expect, it, vi } from "vitest";
import { assertCheckerOwnedKey } from "../src/bucket.js";
import { runChecker } from "../src/run.js";
import {
  MemoryStore,
  configFixture,
  logger
} from "./helpers.js";

describe("history retention and ownership", () => {
  it("prunes old observations while retaining incident history", async () => {
    const store = new MemoryStore();
    const old: HistoryPartitionDocument = {
      schemaVersion: HISTORY_SCHEMA_VERSION,
      day: "2026-06-01",
      updatedAt: "2026-06-01T12:00:00.000Z",
      observations: [
        {
          id: "old-observation",
          runId: "old-run",
          checkedAt: "2026-06-01T12:00:00.000Z",
          success: false,
          statusCode: 503,
          latencyMs: 10,
          errorCode: "http_error"
        }
      ],
      incidents: [
        {
          id: "old-incident",
          monitorId: "public-a",
          startedAt: "2026-06-01T12:00:00.000Z",
          openingObservationId: "old-observation",
          resolvedAt: "2026-06-01T12:05:00.000Z",
          closingObservationId: "old-success"
        }
      ]
    };
    store.history.set(old.day, { value: old, etag: "old-etag" });

    await runChecker({
      store,
      config: configFixture,
      logger,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, { status: 200 })
      ),
      now: () => new Date("2026-07-27T12:01:00.000Z")
    });
    expect(store.history.get(old.day)?.value.observations).toEqual([]);
    expect(store.history.get(old.day)?.value.incidents).toEqual(old.incidents);
  });

  it("allows checker-owned keys and rejects catalog writes", () => {
    expect(() => assertCheckerOwnedKey("state/current.json")).not.toThrow();
    expect(() => assertCheckerOwnedKey("snapshots/public.json")).not.toThrow();
    expect(() =>
      assertCheckerOwnedKey("history/2026-07-27.json.gz")
    ).not.toThrow();
    expect(() => assertCheckerOwnedKey("catalog/current.json")).toThrow(
      /cannot write/
    );
    expect(() => assertCheckerOwnedKey("audit/2026/07/x.json")).toThrow(
      /cannot write/
    );
  });
});
