import {
  attachPlatformPrincipal,
  classifyRoute,
  getAttachedPlatformPrincipal,
  serviceForPath,
  type PlatformPrincipal,
  type ServiceFamily
} from "@tools-platform/security";
import {
  AuthenticationRequiredError,
  type PrincipalAuthenticator
} from "@tools-platform/web";
import type { Authentication, FetchHandler } from "@tools-platform/field-guide/http";
import { signInLocation } from "./lib/auth-return-path.js";

export type PrincipalResolver = (
  request: Request
) => Promise<PlatformPrincipal | undefined>;

export type PlatformHandler = (request: Request) => Promise<Response>;

export type MountedService = {
  handle: FetchHandler;
  readiness: () => Promise<void>;
  close: () => void | Promise<void>;
};

export type PlatformServices = Record<ServiceFamily, MountedService>;

/** Resolves a browser session once and enforces it only for human-private URLs. */
export async function authenticatePlatformRequest(
  request: Request,
  resolvePrincipal: PrincipalResolver
): Promise<{ principal?: PlatformPrincipal; response?: Response }> {
  const route = classifyRoute(new URL(request.url).pathname, request.method);
  if (route.kind !== "human-session" && route.kind !== "server-function") {
    return {};
  }

  const principal = await resolvePrincipal(request);
  if (principal) {
    attachPlatformPrincipal(request, principal);
    return { principal };
  }
  if (route.kind === "server-function") return {};

  if (isDocumentNavigation(request)) {
    const url = new URL(request.url);
    return {
      response: new Response(null, {
        status: 302,
        headers: {
          "Cache-Control": "private, no-store",
          Location: signInLocation(`${url.pathname}${url.search}${url.hash}`, "session_required")
        }
      })
    };
  }

  return {
    response: new Response(JSON.stringify({ error: "authentication_required" }), {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8"
      }
    })
  };
}

/** Fetch-compatible composition root used by route-policy contract tests. */
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

export function toolsPrincipalAuthentication(): PrincipalAuthenticator {
  return (request: Request) => {
    const principal = getAttachedPlatformPrincipal(request);
    if (!principal) throw new AuthenticationRequiredError();
    return { id: principal.email };
  };
}

export function reviewerAuthentication(request: Request): Authentication {
  const principal = getAttachedPlatformPrincipal(request);
  if (principal) return { ok: true, email: principal.email };
  return {
    ok: false,
    response: new Response(
      JSON.stringify({ error: "authentication_required" }),
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    )
  };
}

function isDocumentNavigation(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return request.headers.get("accept")?.includes("text/html") ?? false;
}
