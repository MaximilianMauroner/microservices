import { describe, expect, it, vi } from "vitest";
import {
  type CheckerStateDocument,
  type NotificationDelivery,
} from "@tools-platform/domain";
import {
  drainNotifications,
  retryDelaySeconds
} from "../src/notifications.js";
import {
  NOW,
  catalogFixture,
  emptyState
} from "./helpers.js";

describe("Discord outbox", () => {
  it("delivers pending notifications and stores no webhook data", async () => {
    const state = {
      ...emptyState(),
      incidents: [
        {
          id: "incident-1",
          monitorId: "public-a",
          startedAt: NOW.toISOString(),
          openingObservationId: "observation-1",
          resolvedAt: null,
          closingObservationId: null
        }
      ],
      notifications: [
        {
          id: "notification-1",
          incidentId: "incident-1",
          displayName: "public-a",
          kind: "down" as const,
          status: "pending" as const,
          attempts: 0,
          nextAttemptAt: NOW.toISOString(),
          claimToken: null,
          claimedUntil: null,
          deliveredAt: null,
          lastErrorCode: null
        }
      ]
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const result = await drainNotifications(
      state,
      catalogFixture(),
      "https://discord.example/webhook/secret",
      {
        expectedEtag: "state-1",
        maxAttempts: 8,
        persist: async (_state, expectedEtag) =>
          expectedEtag === "state-1" ? "state-2" : "state-3"
      },
      fetcher,
      () => new Date(NOW)
    );
    expect(result.attempted).toBe(1);
    expect(result.state.notifications[0]).toMatchObject({
      status: "delivered",
      attempts: 1,
      deliveredAt: NOW.toISOString(),
      lastErrorCode: null
    });
    expect(JSON.stringify(result.state)).not.toContain("webhook/secret");
  });

  it("honors Retry-After and caps retry delay", async () => {
    expect(
      retryDelaySeconds(
        new Response(null, {
          status: 429,
          headers: { "retry-after": "120" }
        }),
        1,
        NOW.getTime()
      )
    ).toBe(120);
    expect(
      retryDelaySeconds(new Response(null, { status: 500 }), 100, NOW.getTime())
    ).toBe(3600);
  });

  it("claims conditionally before POST so concurrent drains send once", async () => {
    const initial = notificationState(1);
    let stored = initial;
    let etag = "state-1";
    let writes = 1;
    const persist = async (
      state: CheckerStateDocument,
      expectedEtag: string
    ) => {
      if (expectedEtag !== etag) throw new Error("ETag conflict");
      stored = state;
      etag = `state-${++writes}`;
      return etag;
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const options = {
      expectedEtag: "state-1",
      maxAttempts: 8,
      persist
    };

    const results = await Promise.allSettled([
      drainNotifications(
        initial,
        catalogFixture(),
        "https://discord.example/webhook/secret",
        options,
        fetcher,
        () => new Date(NOW)
      ),
      drainNotifications(
        initial,
        catalogFixture(),
        "https://discord.example/webhook/secret",
        options,
        fetcher,
        () => new Date(NOW)
      )
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(stored.notifications[0].status).toBe("delivered");
  });

  it("bounds notification delivery attempts per run", async () => {
    let etag = "state-1";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const result = await drainNotifications(
      notificationState(3),
      catalogFixture(),
      "https://discord.example/webhook/secret",
      {
        expectedEtag: etag,
        maxAttempts: 2,
        persist: async (_state, expectedEtag) => {
          expect(expectedEtag).toBe(etag);
          etag = `state-${Number(etag.split("-")[1]) + 1}`;
          return etag;
        }
      },
      fetcher,
      () => new Date(NOW)
    );

    expect(result.attempted).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.state.notifications.filter(({ status }) => status === "pending"))
      .toHaveLength(1);
  });
});

function notificationState(count: number): CheckerStateDocument {
  const incidents = Array.from({ length: count }, (_, index) => ({
    id: `incident-${index}`,
    monitorId: "public-a",
    startedAt: NOW.toISOString(),
    openingObservationId: `observation-${index}`,
    resolvedAt: null,
    closingObservationId: null
  }));
  const notifications: NotificationDelivery[] = incidents.map(
    (incident, index) => ({
      id: `notification-${index}`,
      incidentId: incident.id,
      displayName: "public-a",
      kind: "down",
      status: "pending",
      attempts: 0,
      nextAttemptAt: NOW.toISOString(),
      claimToken: null,
      claimedUntil: null,
      deliveredAt: null,
      lastErrorCode: null
    })
  );
  return {
    ...emptyState(),
    incidents,
    notifications
  };
}
