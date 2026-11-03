import {
  attachPlatformPrincipal,
  classifyRoute,
  getAttachedPlatformPrincipal,
  type PlatformPrincipal,
  type ServiceFamily
} from "#security";
import {
  AuthenticationRequiredError,
  type PrincipalAuthenticator
} from "#dashboard";
import { signInLocation } from "./lib/auth-return-path.js";
import { homePath, principalMayOpen } from "./product-access.js";

type FetchHandler = (request: Request) => Promise<Response>;

export type PrincipalResolver = (
  request: Request
) => Promise<PlatformPrincipal | undefined>;

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
  const pathname = new URL(request.url).pathname;
  const route = classifyRoute(pathname, request.method);
  if (route.kind !== "human-session" && route.kind !== "server-function") {
    return {};
  }

  const principal = await resolvePrincipal(request);
  if (principal) {
    if (route.kind === "human-session" && !principalMayOpen(principal, pathname)) {
      return { response: accessDenied(request, principal) };
    }
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

export function toolsPrincipalAuthentication(): PrincipalAuthenticator {
  return (request: Request) => {
    const principal = getAttachedPlatformPrincipal(request);
    if (principal?.role !== "admin") throw new AuthenticationRequiredError();
    return { id: principal.email };
  };
}

function accessDenied(request: Request, principal: PlatformPrincipal): Response {
  if (isDocumentNavigation(request)) {
    return new Response(null, {
      status: 302,
      headers: { "Cache-Control": "private, no-store", Location: homePath(principal) }
    });
  }
  return new Response(JSON.stringify({ error: "access_denied" }), {
    status: 403,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function isDocumentNavigation(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return request.headers.get("accept")?.includes("text/html") ?? false;
}
