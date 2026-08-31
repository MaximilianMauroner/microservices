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
  fetcher: Fetcher = globalThis.fetch
) {
  const response = await retryTransientFetch(
    "/health/publisher",
    { credentials: "same-origin" },
    retryDelaysMs,
    fetcher
  );
  if (!response.ok) throw new Error("Publisher is still starting. Try again in a moment.");
}
