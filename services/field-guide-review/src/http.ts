export type FetchHandler = (request: Request) => Promise<Response>;

export type Authentication =
  | { ok: true; email?: string }
  | { ok: false; response: Response };

export type Authenticator = (
  request: Request,
) => Authentication | Promise<Authentication>;

export const MAX_JSON_BYTES = 128 * 1024;

const DEFAULT_CSP =
  "default-src 'none'; style-src 'self'; script-src 'self' https://shoo.dev; connect-src 'self' https://shoo.dev; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export class PayloadTooLargeError extends Error {}

export function secureHeaders(initial?: HeadersInit) {
  const headers = new Headers(initial);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  if (!headers.has("Content-Security-Policy"))
    headers.set("Content-Security-Policy", DEFAULT_CSP);
  if (!headers.has("Referrer-Policy"))
    headers.set("Referrer-Policy", "no-referrer");
  if (!headers.has("X-Content-Type-Options"))
    headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

export function jsonResponse(
  value: unknown,
  init: ResponseInit = {},
): Response {
  const headers = secureHeaders(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function htmlResponse(
  value: string,
  init: ResponseInit = {},
): Response {
  const headers = secureHeaders(init.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(value, { ...init, headers });
}

export function textResponse(
  value: string,
  init: ResponseInit = {},
): Response {
  const headers = secureHeaders(init.headers);
  headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(value, { ...init, headers });
}

export function isJsonMediaType(value: string | null) {
  if (!value) return false;
  return /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|\s*$)/i.test(
    value,
  );
}

export async function readJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Unexpected end of JSON input");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_JSON_BYTES) {
      await reader.cancel("JSON body is too large.").catch(() => undefined);
      throw new PayloadTooLargeError("JSON body exceeds 128 KiB.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
