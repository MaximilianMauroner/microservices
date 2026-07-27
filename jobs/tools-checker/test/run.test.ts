import { describe, expect, it, vi } from "vitest";
import { runChecker } from "../src/run.js";
import {
  MemoryStore,
  NOW,
  configFixture,
  logger
} from "./helpers.js";

describe("checker run", () => {
  it("enumerates every enabled monitor once and is duplicate-safe", async () => {
    const store = new MemoryStore();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const first = await runChecker({
      store,
      config: configFixture,
      logger,
      fetcher,
      now: () => new Date(NOW)
    });
    expect(first.attemptedMonitorIds).toEqual(["public-a", "tailnet-a"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.state?.value.monitors["tailnet-a"]).toMatchObject({
      status: "unavailable",
      consecutiveFailures: 0,
      latestObservation: {
        errorCode: "unavailable_from_railway"
      }
    });
    expect(store.state?.value.monitors["paused-a"].status).toBe("paused");
    expect(store.publicSnapshot?.statuses["tailnet-a"]).toMatchObject({
      status: "unavailable",
      checkedAt: null
    });

    const duplicate = await runChecker({
      store,
      config: configFixture,
      logger,
      fetcher,
      now: () => new Date(NOW)
    });
    expect(duplicate).toMatchObject({
      runId: first.runId,
      duplicate: true,
      attemptedMonitorIds: []
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      store.history.get("2026-07-27")?.value.observations
    ).toHaveLength(2);
  });

  it("opens on the second failure and resolves on one success", async () => {
    const store = new MemoryStore();
    const failing = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    await runChecker({
      store,
      config: configFixture,
      logger,
      fetcher: failing,
      now: () => new Date("2026-07-27T12:01:00.000Z")
    });
    expect(store.state?.value.monitors["public-a"].status).toBe("checking");

    await runChecker({
      store,
      config: configFixture,
      logger,
      fetcher: failing,
      now: () => new Date("2026-07-27T12:06:00.000Z")
    });
    expect(store.state?.value.monitors["public-a"].status).toBe("down");
    expect(store.state?.value.incidents).toHaveLength(1);
    expect(store.state?.value.notifications[0]).toMatchObject({
      kind: "down",
      status: "pending"
    });

    await runChecker({
      store,
      config: configFixture,
      logger,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, { status: 200 })
      ),
      now: () => new Date("2026-07-27T12:11:00.000Z")
    });
    expect(store.state?.value.monitors["public-a"].status).toBe("up");
    expect(store.state?.value.incidents[0].resolvedAt).not.toBeNull();
    expect(store.state?.value.notifications.map(({ kind }) => kind)).toEqual([
      "down",
      "recovery"
    ]);
  });
});
