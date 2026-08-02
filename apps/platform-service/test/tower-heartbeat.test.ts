import { describe, expect, it } from "vitest";
import type {
  ConditionalWrite,
  JsonBucket
} from "../../tools-web/src/bucket.ts";
import {
  createTowerHeartbeat,
  InvalidHeartbeatTokenError
} from "../src/tower-heartbeat.ts";

class MemoryBucket implements JsonBucket {
  value: unknown;

  async get(_key: string) {
    return this.value === undefined
      ? null
      : { body: this.value, etag: "heartbeat-etag" };
  }

  async put(
    _key: string,
    body: unknown,
    _condition?: ConditionalWrite
  ) {
    this.value = body;
    return "heartbeat-etag";
  }

  async list(_prefix: string, _cursor: string | undefined, _limit: number) {
    return { keys: [] };
  }

  async listAfter(
    _prefix: string,
    _after: string | undefined,
    _limit: number
  ) {
    return [];
  }
}

describe("Tower heartbeat", () => {
  it("stores an authenticated heartbeat and expires it after the threshold", async () => {
    const bucket = new MemoryBucket();
    const heartbeat = createTowerHeartbeat({
      bucket,
      token: "a".repeat(64),
      staleAfterMs: 180_000
    });
    const receivedAt = new Date("2026-07-31T07:00:00.000Z");

    await heartbeat.receive(`Bearer ${"a".repeat(64)}`, receivedAt);

    await expect(
      heartbeat.isHealthy(new Date("2026-07-31T07:02:59.999Z"))
    ).resolves.toBe(true);
    await expect(
      heartbeat.isHealthy(new Date("2026-07-31T07:03:00.001Z"))
    ).resolves.toBe(false);
  });

  it("rejects missing, malformed, and incorrect bearer credentials", async () => {
    const heartbeat = createTowerHeartbeat({
      bucket: new MemoryBucket(),
      token: "a".repeat(64),
      staleAfterMs: 180_000
    });

    for (const authorization of [
      undefined,
      "Basic credential",
      "Bearer wrong",
      `bearer ${"a".repeat(64)}`
    ]) {
      await expect(heartbeat.receive(authorization)).rejects.toBeInstanceOf(
        InvalidHeartbeatTokenError
      );
    }
  });

  it("treats a missing heartbeat as unhealthy", async () => {
    const heartbeat = createTowerHeartbeat({
      bucket: new MemoryBucket(),
      token: "a".repeat(64),
      staleAfterMs: 180_000
    });

    await expect(heartbeat.isHealthy()).resolves.toBe(false);
  });
});
