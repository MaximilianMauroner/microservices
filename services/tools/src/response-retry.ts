export const TRANSIENT_RESPONSE_RETRY_DELAYS_MS = [
  100,
  250,
  500,
  1_000,
  2_000,
  3_000,
  3_000
] as const;

type ResponseOperation = () => Promise<Response>;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function retryTransientResponse(
  operation: ResponseOperation,
  retryDelaysMs: readonly number[] = TRANSIENT_RESPONSE_RETRY_DELAYS_MS,
  signal?: AbortSignal | null
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await operation();
    const retryDelayMs = retryDelaysMs[attempt];
    if (!isServerError(response) || retryDelayMs === undefined) return response;
    await discard(response);
    await waitForRetry(retryDelayMs, signal);
  }
}

export async function retryTransientFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  retryDelaysMs: readonly number[] = TRANSIENT_RESPONSE_RETRY_DELAYS_MS,
  fetcher: Fetcher = globalThis.fetch
): Promise<Response> {
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    throw new Error("Transient fetch retry only supports GET and HEAD requests.");
  }

  for (let attempt = 0; ; attempt += 1) {
    const retryDelayMs = retryDelaysMs[attempt];
    try {
      const response = await fetcher(input, init);
      if (!isServerError(response) || retryDelayMs === undefined) return response;
      await discard(response);
    } catch (error) {
      if (init.signal?.aborted || retryDelayMs === undefined) throw error;
    }
    await waitForRetry(retryDelayMs, init.signal);
  }
}

function isServerError(response: Response) {
  return response.status >= 500 && response.status <= 599;
}

async function discard(response: Response) {
  await response.body?.cancel().catch(() => undefined);
}

function waitForRetry(milliseconds: number, signal?: AbortSignal | null) {
  if (!signal) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new Error("Request aborted.");
}
