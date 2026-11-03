import { serviceForPath } from "#security";
import { authenticatePlatformRequest, type PlatformServices, type PrincipalResolver } from "../../platform/gateway.js";

export type { PrincipalResolver } from "../../platform/gateway.js";
export type PlatformHandler = (request: Request) => Promise<Response>;

export function createPlatformHandler(options: {
  resolvePrincipal: PrincipalResolver;
  services: PlatformServices;
  publicOrigin: string;
}): PlatformHandler {
  return async (request) => {
    const authentication = await authenticatePlatformRequest(
      request,
      options.resolvePrincipal
    );
    if (authentication.response) return authentication.response;

    const pathname = new URL(request.url).pathname;
    const handler = options.services[serviceForPath(pathname)].handle;
    try {
      return await handler(request);
    } catch (error) {
      console.error(JSON.stringify({
        event: "platform.request_failed",
        errorType: error instanceof Error ? error.name : "UnknownError"
      }));
      return new Response(JSON.stringify({ error: "internal_error" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
  };
}
