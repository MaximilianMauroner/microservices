import type { Authenticator, FetchHandler } from "../src/http.js";

export const passAuth: Authenticator = () => ({ ok: true });

export function callApp(
  app: FetchHandler,
  path: string,
  options: Omit<RequestInit, "body"> & {
    body?: BodyInit;
    json?: unknown;
  } = {},
) {
  const headers = new Headers(options.headers);
  const body = options.json === undefined ? options.body : JSON.stringify(options.json);
  if (options.json !== undefined && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  return app(
    new Request(new URL(path, "https://reviews.example"), {
      ...options,
      body,
      headers,
    }),
  );
}

export async function responseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
