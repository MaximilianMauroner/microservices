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
          monitorId: "public-a",
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

  it("keeps a cross-midnight incident canonical in its opening-day partition", async () => {
    const store = new MemoryStore();
    store.catalog = {
      ...store.catalog,
      value: {
        ...store.catalog.value,
        entries: store.catalog.value.entries.filter(
          ({ id }) => id === "public-a"
        )
      }
    };
    const failing = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    await runChecker({
      store,
      config: configFixture,
      logger,
      fetcher: failing,
      now: () => new Date("2026-07-27T23:51:00.000Z")
    });
    await runChecker({
      store,
      config: configFixture,
      logger,
      fetcher: failing,
      now: () => new Date("2026-07-27T23:56:00.000Z")
    });
    await runChecker({
      store,
      config: configFixture,
      logger,
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 200 })),
      now: () => new Date("2026-07-28T00:01:00.000Z")
    });

    const openingDay = store.history.get("2026-07-27")?.value;
    const recoveryDay = store.history.get("2026-07-28")?.value;
    expect(openingDay?.incidents).toHaveLength(1);
    expect(openingDay?.incidents[0].resolvedAt).toBe(
      "2026-07-28T00:01:00.000Z"
    );
    expect(recoveryDay?.incidents).toEqual([]);
    expect(
      recoveryDay?.observations.every(
        ({ monitorId }) => monitorId === "public-a"
      )
    ).toBe(true);

    const writesAfterResolution = store.historyWrites;
    await runChecker({
      store,
      config: configFixture,
      logger,
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 200 })),
      now: () => new Date("2026-07-28T00:01:00.000Z")
    });
    expect(store.historyWrites).toBe(writesAfterResolution);
  });

  it("groups a check by checkedAt when it crosses midnight after invocation", async () => {
    const store = new MemoryStore();
    store.catalog = {
      ...store.catalog,
      value: {
        ...store.catalog.value,
        entries: store.catalog.value.entries.filter(
          ({ id }) => id === "public-a"
        )
      }
    };
    const beforeMidnight = new Date("2026-07-27T23:59:59.900Z");
    const afterMidnight = new Date("2026-07-28T00:00:00.100Z");
    let clockCalls = 0;

    await runChecker({
      store,
      config: configFixture,
      logger,
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 200 })),
      now: () => (clockCalls++ < 2 ? beforeMidnight : afterMidnight)
    });

    expect(store.history.has("2026-07-27")).toBe(false);
    expect(
      store.history.get("2026-07-28")?.value.observations
    ).toMatchObject([
      {
        checkedAt: afterMidnight.toISOString(),
        monitorId: "public-a"
      }
    ]);
  });
});
