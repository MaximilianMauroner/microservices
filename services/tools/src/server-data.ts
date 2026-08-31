import { getGlobalStartContext } from "@tanstack/react-start";
import { attachPlatformPrincipal } from "@tools-platform/security";
import {
  TRANSIENT_RESPONSE_RETRY_DELAYS_MS,
  retryTransientResponse
} from "./response-retry.js";

type PlatformHandler = (request: Request) => Promise<Response>;

export function internalPlatformRequest(pathname: string, init: RequestInit = {}) {
  const context = getGlobalStartContext();
  if (!context) throw new Error("Platform request context is unavailable.");
  const headers = new Headers(init.headers);
  const request = new Request(new URL(pathname, context.runtime.publicOrigin), {
    ...init,
    headers
  });
  if (context.principal) attachPlatformPrincipal(request, context.principal);
  return { context, request };
}

export async function readPlatformResponse(
  handler: PlatformHandler,
  pathname: string
): Promise<Response> {
  return retryTransientPlatformResponse(() =>
    handler(internalPlatformRequest(pathname).request)
  );
}

export async function readPlatformJson<T>(handler: PlatformHandler, pathname: string): Promise<T> {
  const response = await readPlatformResponse(handler, pathname);
  if (!response.ok) {
    throw new Error(`Platform data request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function retryTransientPlatformResponse(
  operation: () => Promise<Response>,
  retryDelaysMs: readonly number[] = TRANSIENT_RESPONSE_RETRY_DELAYS_MS
): Promise<Response> {
  // Railway can wake the web and Postgres services independently. Keep the
  // loader pending while Postgres finishes starting instead of exposing a 5xx.
  return retryTransientResponse(operation, retryDelaysMs);
}
