import { timingSafeEqual } from "node:crypto";
import type { JsonBucket } from "../../tools-web/src/bucket.ts";
import { BUCKET_KEYS } from "../../../packages/tools-domain/src/keys.ts";

const HEARTBEAT_SCHEMA_VERSION = 1;

interface HeartbeatRecord {
  schemaVersion: typeof HEARTBEAT_SCHEMA_VERSION;
  lastSeenAt: string;
}

export interface TowerHeartbeat {
  receive(authorization: string | undefined, now?: Date): Promise<void>;
  isHealthy(now?: Date): Promise<boolean>;
}

export class InvalidHeartbeatTokenError extends Error {
  constructor() {
    super("Invalid Tower heartbeat token");
    this.name = "InvalidHeartbeatTokenError";
  }
}

export function createTowerHeartbeat(options: {
  bucket: JsonBucket;
  token: string;
  staleAfterMs: number;
}): TowerHeartbeat {
  return {
    async receive(authorization, now = new Date()) {
      if (!validBearerToken(authorization, options.token)) {
        throw new InvalidHeartbeatTokenError();
      }
      await options.bucket.put(BUCKET_KEYS.towerHeartbeat, {
        schemaVersion: HEARTBEAT_SCHEMA_VERSION,
        lastSeenAt: now.toISOString()
      } satisfies HeartbeatRecord);
    },

    async isHealthy(now = new Date()) {
      const stored = await options.bucket.get(BUCKET_KEYS.towerHeartbeat);
      if (!stored) return false;
      const record = decodeHeartbeatRecord(stored.body);
      const ageMs = now.getTime() - new Date(record.lastSeenAt).getTime();
      return ageMs >= 0 && ageMs <= options.staleAfterMs;
    }
  };
}

function validBearerToken(
  authorization: string | undefined,
  expected: string
): boolean {
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match) return false;
  const presentedBytes = Buffer.from(match[1], "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    presentedBytes.length === expectedBytes.length &&
    timingSafeEqual(presentedBytes, expectedBytes)
  );
}

function decodeHeartbeatRecord(input: unknown): HeartbeatRecord {
  if (typeof input !== "object" || input === null) {
    throw new Error("Tower heartbeat record must be an object");
  }
  const record = input as Record<string, unknown>;
  if (
    record.schemaVersion !== HEARTBEAT_SCHEMA_VERSION ||
    typeof record.lastSeenAt !== "string"
  ) {
    throw new Error("Tower heartbeat record is invalid");
  }
  const parsed = new Date(record.lastSeenAt);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== record.lastSeenAt
  ) {
    throw new Error("Tower heartbeat timestamp is invalid");
  }
  return {
    schemaVersion: HEARTBEAT_SCHEMA_VERSION,
    lastSeenAt: record.lastSeenAt
  };
}
