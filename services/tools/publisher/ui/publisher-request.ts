import {
  TRANSIENT_RESPONSE_RETRY_DELAYS_MS,
  retryTransientFetch
} from "../../src/response-retry.js";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function fetchPublisherRead(
  pathname: string,
  init: RequestInit = {},
  retryDelaysMs: readonly number[] = TRANSIENT_RESPONSE_RETRY_DELAYS_MS,
  fetcher: Fetcher = globalThis.fetch
) {
  return retryTransientFetch(pathname, init, retryDelaysMs, fetcher);
}

export async function waitForPublisher(
  retryDelaysMs: readonly number[] = TRANSIENT_RESPONSE_RETRY_DELAYS_MS,
  fetcher: Fetcher = globalThis.fetch,
  signal?: AbortSignal | null
) {
  const response = await retryTransientFetch(
    "/health/publisher",
    signal ? { credentials: "same-origin", signal } : { credentials: "same-origin" },
    retryDelaysMs,
    fetcher
  );
  if (!response.ok) throw new Error("Publisher is still starting. Try again in a moment.");
}

/** Reads a JSON body, or throws the server's message when the response failed. */
export async function readPayload<T = unknown>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => undefined) as { message?: unknown } | undefined;
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : fallback);
  return payload as T;
}
