import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import type { AccessActor } from "@tools-platform/security";
import { authenticatePlatformRequest } from "./app.js";
import { getPlatformRuntime, type PlatformRuntime } from "./runtime.js";
import { PLATFORM_UI_BUILD } from "./build-identity.js";

export type PlatformRequestContext = {
  runtime: PlatformRuntime;
  request: Request;
  accessActor?: AccessActor;
  nonce?: string;
};

const platformRequestMiddleware = createMiddleware().server(
  async ({ request, next }) => {
    const runtime = await getPlatformRuntime();
    if (runtime.readOnly && request.method !== "GET" && request.method !== "HEAD") {
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
      runtime.access,
      { readOnly: runtime.readOnly, localAuth: runtime.localAuth }
    );
    if (authentication.response) return authentication.response;
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const result = await next({
      context: {
        runtime,
        request,
        nonce,
        ...(authentication.actor ? { accessActor: authentication.actor } : {})
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
      const styleSources = process.env.NODE_ENV === "development"
        ? "'self' 'unsafe-inline'"
        : "'self'";
      headers.set(
        "Content-Security-Policy",
        `default-src 'none'; style-src ${styleSources} 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; script-src 'self' 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
      );
    }
    if (headers.get("Content-Type")?.startsWith("text/html")) {
      headers.set("X-Platform-UI-Build", PLATFORM_UI_BUILD);
    }
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      (pathname === "/" || pathname === "/status") &&
      response.status < 400
    ) {
      headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=240");
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
  filter: ({ handlerType }) => handlerType === "serverFn"
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
