import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { classifyRoute, type PlatformPrincipal } from "@tools-platform/security";
import { authenticatePlatformRequest } from "./app.js";
import { getPlatformRuntime, type PlatformRuntime } from "./runtime.js";
import { PLATFORM_UI_BUILD } from "./build-identity.js";
import { documentContentSecurityPolicy } from "./content-security-policy.js";

export type PlatformRequestContext = {
  runtime: PlatformRuntime;
  request: Request;
  principal?: PlatformPrincipal;
  nonce?: string;
};

const platformRequestMiddleware = createMiddleware().server(
  async ({ request, handlerType, next }) => {
    const runtime = await getPlatformRuntime();
    if (
      runtime.readOnly &&
      handlerType !== "serverFn" &&
      request.method !== "GET" &&
      request.method !== "HEAD"
    ) {
      return new Response(JSON.stringify({ error: "read_only_local_mode" }), {
        status: 405,
        headers: {
          Allow: "GET, HEAD",
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8"
        }
      });
    }
    const authentication = await authenticatePlatformRequest(
      request,
      runtime.resolvePrincipal
    );
    if (authentication.response) return authentication.response;
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const result = await next({
      context: {
        runtime,
        request,
        nonce,
        ...(authentication.principal ? { principal: authentication.principal } : {})
      }
    });
    const response = result.response as Response;
    const headers = new Headers(response.headers);
    const pathname = new URL(request.url).pathname;
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    if (
      headers.get("Content-Type")?.startsWith("text/html") &&
      !headers.has("Content-Security-Policy")
    ) {
      headers.set(
        "Content-Security-Policy",
        documentContentSecurityPolicy(
          nonce,
          process.env.NODE_ENV === "development"
        )
      );
    }
    if (headers.get("Content-Type")?.startsWith("text/html")) {
      headers.set("X-Platform-UI-Build", PLATFORM_UI_BUILD);
    }
    if (classifyRoute(pathname, request.method).kind === "human-session") {
      headers.set("Cache-Control", "private, no-store");
    }
    if (headers.get("Content-Type")?.startsWith("text/html")) {
      const cacheControl = headers.get("Cache-Control");
      headers.set("Cache-Control", cacheControl ? `${cacheControl}, no-transform` : "no-transform");
    }
    return {
      ...result,
      response: new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      })
    };
  }
);

const csrfMiddleware = createCsrfMiddleware({
  filter: ({ handlerType }) => handlerType === "serverFn",
  origin: (origin) => origin === process.env.PUBLIC_ORIGIN,
  // TanStack invokes loaders through an internal server-function request during SSR.
  // Those requests have no browser Origin headers; cross-origin browser requests do.
  allowRequestsWithoutOriginCheck: true
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, platformRequestMiddleware]
}));

declare module "@tanstack/react-router" {
  interface Register {
    server: {
      requestContext: PlatformRequestContext;
    };
  }
}
