const MAX_TRACKED_KEYS = 10_000;

/** Cloudflare sets this header and replaces any value the client sends. */
export function clientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/**
 * Counts requests per key in fixed windows, in this process only.
 * Returns false once a key has used `limit` requests in its current window.
 */
export function createRateLimit({ limit, windowMs }: { limit: number; windowMs: number }) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()) => {
    const current = windows.get(key);
    if (current && current.resetAt > now) {
      current.count += 1;
      return current.count <= limit;
    }
    windows.delete(key);
    if (windows.size >= MAX_TRACKED_KEYS) {
      for (const [tracked, window] of windows) if (window.resetAt <= now) windows.delete(tracked);
      if (windows.size >= MAX_TRACKED_KEYS) windows.delete(windows.keys().next().value!);
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  };
}
