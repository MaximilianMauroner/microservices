import { describe, expect, it } from "vitest";
import { createHeartbeats, InvalidHeartbeatTokenError, UnknownHeartbeatMonitorError } from "@tools-platform/tools-checker";
import type { HeartbeatRepository } from "../status/src/heartbeat-repository.js";

class MemoryHeartbeatRepository implements HeartbeatRepository {
  readonly values = new Map<string, Date>();
  async record(monitorId: string, seenAt: Date) { this.values.set(monitorId, seenAt); }
  async lastSeenAt(monitorId: string) { return this.values.get(monitorId) ?? null; }
  async close() {}
}

function fixture(repository = new MemoryHeartbeatRepository()) {
  return createHeartbeats({
    definitions: [{ id: "tower", kind: "heartbeat", scope: "public", checkUrl: "https://tools.example.test/health/tower", staleAfterMs: 180_000 }],
    repository,
    token: "a".repeat(64)
  });
}

describe("status heartbeats", () => {
  it("records an authenticated heartbeat and expires it after the threshold", async () => {
    const heartbeat = fixture();
    const receivedAt = new Date("2026-07-31T07:00:00.000Z");
    await heartbeat.receive("tower", `Bearer ${"a".repeat(64)}`, receivedAt);
    await expect(heartbeat.isHealthy("tower", new Date("2026-07-31T07:02:59.999Z"))).resolves.toBe(true);
    await expect(heartbeat.isHealthy("tower", new Date("2026-07-31T07:03:00.001Z"))).resolves.toBe(false);
  });

  it("rejects unknown monitor IDs and invalid credentials", async () => {
    const heartbeat = fixture();
    await expect(heartbeat.receive("unknown", `Bearer ${"a".repeat(64)}`)).rejects.toBeInstanceOf(UnknownHeartbeatMonitorError);
    await expect(heartbeat.receive("tower", "Bearer wrong")).rejects.toBeInstanceOf(InvalidHeartbeatTokenError);
  });

  it("treats a missing heartbeat as unhealthy", async () => {
    await expect(fixture().isHealthy("tower")).resolves.toBe(false);
  });
});
