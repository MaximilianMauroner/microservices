import { InvalidHeartbeatTokenError } from "./tower-heartbeat.js";
import type { PlatformRequestContext } from "./start.js";

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#000"/><path d="M7 24V8l9 10 9-10v16" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/></svg>`;

export type PlatformRouteInput = {
  request: Request;
  context: PlatformRequestContext;
  params: Record<string, string>;
};

export function tools({ request, context }: PlatformRouteInput) {
  return context.runtime.tools(request);
}

export function fieldGuide({ request, context }: PlatformRouteInput) {
  return context.runtime.fieldGuide(request);
}

export function artifact({ request, context }: PlatformRouteInput) {
  return context.runtime.artifact(request);
}

export function favicon() {
  return new Response(FAVICON_SVG, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "image/svg+xml; charset=utf-8"
    }
  });
}

export function redirectTo(pathname: string) {
  return ({ request }: PlatformRouteInput) => {
    const url = new URL(request.url);
    url.pathname = pathname;
    return new Response(null, {
      status: 308,
      headers: {
        "Cache-Control": "private, no-store",
        Location: url.toString()
      }
    });
  };
}

export function redirectLegacyPrefix(prefix: string, replacement: string) {
  return ({ request }: PlatformRouteInput) => {
    const url = new URL(request.url);
    url.pathname = `${replacement}${url.pathname.slice(prefix.length)}`;
    return new Response(null, {
      status: 308,
      headers: {
        "Cache-Control": "private, no-store",
        Location: url.toString()
      }
    });
  };
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
  const check = context.runtime.componentHealth[
    params.component as keyof PlatformRequestContext["runtime"]["componentHealth"]
  ];
  if (!check) return json({ error: "not_found" }, 404);
  try {
    await check();
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "dependency_unavailable" }, 503);
  }
}

export async function towerHealth({ context }: PlatformRouteInput) {
  try {
    const healthy = await context.runtime.towerHeartbeat.isHealthy();
    return healthy
      ? json({ ok: true })
      : json({ ok: false, error: "heartbeat_stale" }, 503);
  } catch {
    return json({ ok: false, error: "dependency_unavailable" }, 503);
  }
}

export async function towerHeartbeat({ request, context }: PlatformRouteInput) {
  try {
    await context.runtime.towerHeartbeat.receive(request.headers.get("authorization") ?? undefined);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error instanceof InvalidHeartbeatTokenError) {
      return json({ error: "invalid_heartbeat_token" }, 401);
    }
    return json({ error: "heartbeat_storage_unavailable" }, 503);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
