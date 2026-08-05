import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import type { AccessActor } from "@tools-platform/security";
import { authenticatePlatformRequest } from "./app.js";
import { getPlatformRuntime, type PlatformRuntime } from "./runtime.js";

export type PlatformRequestContext = {
  runtime: PlatformRuntime;
  request: Request;
  accessActor?: AccessActor;
  nonce?: string;
};

const platformRequestMiddleware = createMiddleware().server(
  async ({ request, next }) => {
    const runtime = await getPlatformRuntime();
    const authentication = await authenticatePlatformRequest(request, runtime.access);
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
      headers.set(
        "Content-Security-Policy",
        `default-src 'none'; style-src 'self' 'nonce-${nonce}'; script-src 'self' 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
      );
    }
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      (pathname === "/" || pathname === "/status") &&
      response.status < 400
    ) {
      headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=240");
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
