import { describe, expect, it, vi } from "vitest";
import { runChecker } from "../src/run.js";
import {
  MemoryStore,
  NOW,
  catalogFixture,
  configFixture,
  emptyState,
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

  it("reconciles a deleted monitor without wedging its pending notification", async () => {
    const store = new MemoryStore();
    store.catalog = {
      value: {
        ...catalogFixture(),
        entries: catalogFixture().entries.filter(({ id }) => id !== "public-a")
      },
      etag: "catalog-2"
    };
    store.state = {
      etag: "state-old",
      value: {
        ...emptyState(),
        monitors: {
          "public-a": {
            monitorId: "public-a",
            status: "down",
            consecutiveFailures: 2,
            latestObservation: null,
            openIncidentId: "incident-deleted"
          }
        },
        incidents: [
          {
            id: "incident-deleted",
            monitorId: "public-a",
            startedAt: NOW.toISOString(),
            openingObservationId: "observation-deleted",
            resolvedAt: null,
            closingObservationId: null
          }
        ],
        notifications: [
          {
            id: "notification-deleted",
            incidentId: "incident-deleted",
            displayName: "Deleted Tool",
            kind: "down",
            status: "pending",
            attempts: 0,
            nextAttemptAt: NOW.toISOString(),
            claimToken: null,
            claimedUntil: null,
            deliveredAt: null,
            lastErrorCode: null
          }
        ]
      }
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 })
    );

    await runChecker({
      store,
      config: {
        ...configFixture,
        discordWebhookUrl: "https://discord.example/webhook/secret"
      },
      logger,
      fetcher,
      now: () => new Date("2026-07-27T12:06:00.000Z")
    });

    expect(store.state?.value.monitors["public-a"]).toBeUndefined();
    expect(store.state?.value.incidents[0].resolvedAt).not.toBeNull();
    expect(store.state?.value.notifications[0]).toMatchObject({
      displayName: "Deleted Tool",
      status: "delivered"
    });
  });

  it("does not publish snapshots when the authoritative state CAS loses", async () => {
    const store = new MemoryStore();
    store.writeState = async () => {
      throw new Error("ETag conflict");
    };

    await expect(
      runChecker({
        store,
        config: configFixture,
        logger,
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(null, { status: 200 })
        ),
        now: () => new Date(NOW)
      })
    ).rejects.toThrow("ETag conflict");
    expect(store.publicSnapshot).toBeNull();
    expect(store.privateSnapshot).toBeNull();
  });
});
