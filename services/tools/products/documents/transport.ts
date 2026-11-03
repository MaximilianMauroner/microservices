import { ShareError, type ShareErrorCode } from "./types.js";

export async function shareRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/share/documents${path}`, {
    ...options,
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    if (body?.error?.code) throw new ShareError(body.error.code as ShareErrorCode, body.error.message);
    throw new Error("The document service could not be reached.");
  }
  return body as T;
}

export function documentRequest<T>(token: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return shareRequest<T>(`/${encodeURIComponent(token)}${path}`, {
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    signal,
  });
}
