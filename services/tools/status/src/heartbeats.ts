import { timingSafeEqual } from "node:crypto";
import type { HeartbeatMonitorDefinition } from "./definitions.js";
import type { HeartbeatRepository } from "./heartbeat-repository.js";

export class InvalidHeartbeatTokenError extends Error {}
export class UnknownHeartbeatMonitorError extends Error {}
export function createHeartbeats(options: { definitions: readonly HeartbeatMonitorDefinition[]; repository: HeartbeatRepository; token: string }) {
  const definitions = new Map(options.definitions.map((definition) => [definition.id, definition]));
  return {
    async receive(monitorId: string, authorization: string | undefined, now = new Date()) {
      if (!definitions.has(monitorId)) throw new UnknownHeartbeatMonitorError(`Unknown heartbeat monitor: ${monitorId}`);
      if (!validBearerToken(authorization, options.token)) throw new InvalidHeartbeatTokenError("Invalid heartbeat token");
      await options.repository.record(monitorId, now);
    },
    async isHealthy(monitorId: string, now = new Date()) {
      const definition = definitions.get(monitorId);
      if (!definition) throw new UnknownHeartbeatMonitorError(`Unknown heartbeat monitor: ${monitorId}`);
      const lastSeenAt = await options.repository.lastSeenAt(monitorId);
      if (!lastSeenAt) return false;
      const age = now.getTime() - lastSeenAt.getTime();
      return age >= 0 && age <= definition.staleAfterMs;
    }
  };
}
function validBearerToken(authorization: string | undefined, expected: string) {
  const presented = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!presented) return false;
  const left = Buffer.from(presented); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
