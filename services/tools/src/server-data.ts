import { getGlobalStartContext } from "@tanstack/react-start";
import { attachPlatformPrincipal } from "@tools-platform/security";

type PlatformHandler = (request: Request) => Promise<Response>;

// Railway can wake the web and Postgres services independently. A read made
// during Postgres startup is reported by a mounted service as a 5xx response;
// give that short recovery window a bounded retry budget.
const PLATFORM_DATA_RETRY_DELAYS_MS = [100, 250, 500, 1_000] as const;

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
  retryDelaysMs: readonly number[] = PLATFORM_DATA_RETRY_DELAYS_MS
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await operation();
    const retryDelayMs = retryDelaysMs[attempt];
    if (response.status < 500 || retryDelayMs === undefined) return response;
    await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
  }
}
