import {
  AccessDeniedError,
  attachAccessActor,
  classifyRoute,
  getAttachedAccessActor,
  isArtifactPath,
  isFieldGuidePath,
  type AccessActor,
  type AccessFamily,
  type AccessVerifier
} from "@tools-platform/security";
import type { Authentication, FetchHandler } from "@tools-platform/field-guide/http";

export interface PlatformAccess {
  manage: AccessVerifier;
  publisher: AccessVerifier;
  review: AccessVerifier;
}

export type PlatformHandler = (request: Request) => Promise<Response>;

export type PlatformServices = {
  artifact: PlatformHandler;
  fieldGuide: FetchHandler;
  tools: FetchHandler;
};

/**
 * Authenticates one request using the central route-family policy and stores
 * the verified actor on the request for package handlers that need attribution.
 */
export async function authenticatePlatformRequest(
  request: Request,
  access: PlatformAccess,
  options: { readOnly?: boolean; localAuth?: boolean } = {}
): Promise<{ actor?: AccessActor; response?: Response }> {
  const route = classifyRoute(new URL(request.url).pathname, request.method);
  if (route.kind !== "access") return {};

  if (
    options.localAuth ||
    (options.readOnly &&
      (request.method === "GET" || request.method === "HEAD"))
  ) {
    const actor = { id: options.localAuth ? "local@localhost" : "design@local.invalid" };
    attachAccessActor(request, actor);
    return { actor };
  }

  try {
    const actor = await access[route.family].verify(request);
    attachAccessActor(request, actor);
    return { actor };
  } catch (error) {
    if (!(error instanceof AccessDeniedError)) {
      console.error(JSON.stringify({
        event: "platform.access_verification_failed",
        errorType: error instanceof Error ? error.name : "UnknownError"
      }));
    }
    return {
      response: new Response(JSON.stringify({ error: "access_required" }), {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
          "WWW-Authenticate": 'Bearer realm="cloudflare-access"'
        }
      })
    };
  }
}

/**
 * Fetch-compatible composition root used by contract tests and by the Start
 * route delegates. Start's global middleware performs the same auth step
 * before its route tree, so production routes do not duplicate verification.
 */
export function createPlatformHandler(options: {
  access: PlatformAccess;
  services: PlatformServices;
  publicOrigin: string;
}): PlatformHandler {
  return async (request) => {
    const authentication = await authenticatePlatformRequest(request, options.access);
    if (authentication.response) return authentication.response;

    const pathname = new URL(request.url).pathname;
    const handler = isArtifactPath(pathname)
      ? options.services.artifact
      : isFieldGuidePath(pathname)
        ? options.services.fieldGuide
        : options.services.tools;
    const redirect = legacyBrowserRedirect(request);
    if (redirect) {
      return new Response(null, {
        status: 308,
        headers: {
          "Cache-Control": "private, no-store",
          Location: redirect
        }
      });
    }
    try {
      return await handler(request);
    } catch (error) {
      console.error(JSON.stringify({
        event: "platform.request_failed",
        errorType: error instanceof Error ? error.name : "UnknownError"
      }));
      return new Response(JSON.stringify({ error: "internal_error" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      });
    }
  };
}

export function accessAuthentication(access: AccessVerifier) {
  return async (request: Request): Promise<Authentication> => {
    try {
      const actor = getAttachedAccessActor(request) ?? (await access.verify(request));
      return { ok: true, email: actor.id };
    } catch {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({
            error: "access_required",
            message: "Cloudflare Access authentication is required."
          }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "WWW-Authenticate": 'Bearer realm="cloudflare-access"'
            }
          }
        )
      };
    }
  };
}

export function contextAwareAccessVerifier(access: AccessVerifier): AccessVerifier {
  return {
    async verify(request) {
      return getAttachedAccessActor(request) ?? access.verify(request);
    }
  };
}

export function accessFamilyForPath(
  pathname: string,
  method: string
): AccessFamily | undefined {
  const route = classifyRoute(pathname, method);
  return route.kind === "access" ? route.family : undefined;
}

function legacyBrowserRedirect(request: Request): string | undefined {
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  const url = new URL(request.url);
  const path = url.pathname;
  let destination: string | undefined;
  if (path === "/uploads" || path === "/uploads/callback") {
    destination = "/publish";
  } else if (path === "/ops" || path.startsWith("/ops/")) {
    destination = `/manage${path.slice("/ops".length)}`;
  } else if (path === "/p" || path.startsWith("/p/")) {
    destination = `/artifacts${path.slice("/p".length)}`;
  } else if (path === "/f" || path.startsWith("/f/")) {
    destination = `/files${path.slice("/f".length)}`;
  }
  return destination === undefined
    ? undefined
    : `${destination}${url.search}${url.hash}`;
}
