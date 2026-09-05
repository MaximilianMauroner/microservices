import { InvalidHeartbeatTokenError, UnknownHeartbeatMonitorError } from "@tools-platform/tools-checker";
import type { PlatformRequestContext } from "./start.js";
import { favicons } from "./favicons.js";
import {
  TRANSIENT_RESPONSE_RETRY_DELAYS_MS,
  retryTransientResponse
} from "./response-retry.js";

export type PlatformRouteInput = {
  request: Request;
  context: PlatformRequestContext;
  params: Record<string, string>;
};

export function tools({ request, context }: PlatformRouteInput) {
  return context.runtime.services.manage.handle(request);
}

export function readOnly() {
  return json({ error: "read_only" }, 405, { Allow: "GET, HEAD" });
}

export function fieldGuide({ request, context }: PlatformRouteInput) {
  return handleFieldGuideRequest(request, context.runtime.services.review.handle);
}

export function artifact({ request, context }: PlatformRouteInput) {
  return handleArtifactRequest(request, context.runtime.services.publisher.handle);
}

type ArtifactHandler = (request: Request) => Promise<Response>;

type FieldGuideHandler = (request: Request) => Promise<Response>;

/**
 * Decision-record submission is safe to repeat because its record ID is also
 * its idempotency key. Keep the first caller connected while PostgreSQL wakes.
 */
export function handleFieldGuideRequest(
  request: Request,
  handler: FieldGuideHandler,
  retryDelaysMs: readonly number[] = TRANSIENT_RESPONSE_RETRY_DELAYS_MS
) {
  const url = new URL(request.url);
  const retryable = request.method === "POST" &&
    url.pathname.replace(/\/+$/, "").toLowerCase() === "/api/agent/decision-records";
  const operation = () => handler(request.clone());
  return retryable
    ? retryTransientResponse(operation, retryDelaysMs, request.signal)
    : handler(request);
}

export function handleArtifactRequest(
  request: Request,
  handler: ArtifactHandler,
  retryDelaysMs: readonly number[] = TRANSIENT_RESPONSE_RETRY_DELAYS_MS
) {
  const operation = () => handler(request);
  return request.method === "GET" || request.method === "HEAD"
    ? retryTransientResponse(operation, retryDelaysMs, request.signal)
    : operation();
}

export function favicon({ request }: PlatformRouteInput) {
  return new Response(null, {
    status: 307,
    headers: {
      "Cache-Control": "public, max-age=3600",
      Location: new URL(favicons.directory, request.url).href
    }
  });
}

export async function live() {
  return json({ ok: true });
}

export async function health({ context }: PlatformRouteInput) {
  try {
    await context.runtime.health();
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "dependency_unavailable" }, 503);
  }
}

export async function componentHealth({ context, params }: PlatformRouteInput) {
  const service = params.component === "tools"
    ? context.runtime.services.manage
    : params.component === "publisher" || params.component === "review"
      ? context.runtime.services[params.component]
      : undefined;
  if (!service) return json({ error: "not_found" }, 404);
  try {
    await service.readiness();
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "dependency_unavailable" }, 503);
  }
}

export async function towerHealth({ context }: PlatformRouteInput) {
  try {
    const healthy = await context.runtime.heartbeats.isHealthy("tower");
    return healthy
      ? json({ ok: true })
      : json({ ok: false, error: "heartbeat_stale" }, 503);
  } catch {
    return json({ ok: false, error: "dependency_unavailable" }, 503);
  }
}

export async function statusHeartbeat({ request, context, params }: PlatformRouteInput) {
  try {
    await context.runtime.heartbeats.receive(params.monitorId, request.headers.get("authorization") ?? undefined);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error instanceof InvalidHeartbeatTokenError) {
      return json({ error: "invalid_heartbeat_token" }, 401);
    }
    if (error instanceof UnknownHeartbeatMonitorError) return json({ error: "monitor_not_found" }, 404);
    return json({ error: "heartbeat_storage_unavailable" }, 503);
  }
}

function json(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...Object.fromEntries(new Headers(extraHeaders))
    }
  });
}
