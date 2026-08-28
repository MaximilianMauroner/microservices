export type MarkdownShareClientConfig = Readonly<{
  convexUrl: string;
  connectOrigins: readonly [string, string];
}>;

/** Validates the public Convex origin used by the browser and document CSP. */
export function loadMarkdownShareClientConfig(value: string | undefined): MarkdownShareClientConfig {
  const input = value?.trim();
  if (!input) throw new Error("Missing required environment variable: VITE_CONVEX_URL");

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("VITE_CONVEX_URL must be a valid Convex HTTP(S) origin");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("VITE_CONVEX_URL must be an HTTPS origin or a local HTTP origin");
  }

  const websocket = new URL(url.origin);
  websocket.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return { convexUrl: url.origin, connectOrigins: [url.origin, websocket.origin] };
}
