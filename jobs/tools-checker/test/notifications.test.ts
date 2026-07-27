import { describe, expect, it, vi } from "vitest";
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
          kind: "down" as const,
          status: "pending" as const,
          attempts: 0,
          nextAttemptAt: NOW.toISOString(),
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
});
