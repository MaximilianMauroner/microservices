import { getGlobalStartContext } from "@tanstack/react-start";
import { attachAccessActor } from "@tools-platform/security";

type PlatformHandler = (request: Request) => Promise<Response>;

export function internalPlatformRequest(pathname: string, init: RequestInit = {}) {
  const context = getGlobalStartContext();
  if (!context) throw new Error("Platform request context is unavailable.");
  const headers = new Headers(init.headers);
  const request = new Request(new URL(pathname, context.runtime.publicOrigin), {
    ...init,
    headers
  });
  if (context.accessActor) attachAccessActor(request, context.accessActor);
  return { context, request };
}

export async function readPlatformJson<T>(handler: PlatformHandler, pathname: string): Promise<T> {
  const response = await handler(internalPlatformRequest(pathname).request);
  if (!response.ok) {
    throw new Error(`Platform data request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
