import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RequestServerNextFnOptions, RequestServerOptions, RequestServerResult } from "@tanstack/react-start";
import { requestHandler } from "@tanstack/react-start/server";
import { requirePlatformSession } from "../src/auth-middleware.js";
import { routerSsrOptions } from "../src/router-options.js";
import { documentContentSecurityPolicy } from "../src/content-security-policy.js";
import { uploadLinkPostMiddleware } from "../src/routes/api/upload-links.js";
import { getPlatformRuntime } from "../src/runtime.js";

const operator = { subject: "google-subject", email: "operator@example.test" };
const runtime = vi.hoisted(() => ({
  signedIn: true,
  readOnly: false,
  artifactUploadOrigins: [] as string[],
  resolvePrincipal: async () => undefined as unknown
}));
runtime.resolvePrincipal = async () => (runtime.signedIn ? operator : undefined);

vi.mock("../src/runtime.js", () => ({ getPlatformRuntime: async () => runtime }));

let startModule: typeof import("../src/start.js");

beforeAll(async () => {
  vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud");
  startModule = await import("../src/start.js");
});

type RequestOptions = RequestServerOptions<{}, undefined>;
type RequestResult<TContext = undefined> = RequestServerResult<{}, undefined, TContext>;

async function handleThroughRequestMiddleware(
  request: Request,
  handlerType: "serverFn" | "router",
  handlerResponse: Response | (() => Response | Promise<Response>)
) {
  const handle = requestHandler(async (request) => {
    const { requestMiddleware = [] } = await startModule.startInstance.getOptions();
    const servers = requestMiddleware.map((middleware) => middleware.options.server);
    const pathname = new URL(request.url).pathname;
    const context: RequestOptions["context"] = { runtime: await getPlatformRuntime(), request };
    let index = -1;
    const next = async <TContext = undefined>(options?: RequestServerNextFnOptions<TContext>): Promise<RequestResult<TContext>> => {
      Object.assign(context, options?.context);
      const server = servers[++index];
      const result = server
        ? await server({ request, pathname, handlerType, context, next })
        : { request, pathname, context, response: typeof handlerResponse === "function" ? await handlerResponse() : handlerResponse };
      if (!(result instanceof Response)) Object.assign(context, result.context);
      return {
        request,
        pathname,
        context: context as RequestResult<TContext>["context"],
        response: result instanceof Response ? result : result.response
      };
    };
    return (await next()).response;
  });
  return handle(request, {});
}

async function runSessionMiddleware(authenticated: boolean) {
  const server = requirePlatformSession.options.server;
  if (!server) throw new Error("function middleware server handler is missing");
  return server({
    context: {
      request: new Request("https://tools.example.test/_serverFn/test", {
        headers: { Referer: "https://tools.example.test/review?view=queue" }
      }),
      ...(authenticated
        ? { principal: { subject: "google-subject", email: "operator@example.test" } }
        : {})
    },
    next: async (nextContext: Record<string, unknown>) => ({
      ...nextContext,
      result: "authorized"
    }),
    data: undefined,
    method: "GET",
    serverFnMeta: { id: "test", name: "test" },
    signal: new AbortController().signal
  } as never);
}

describe("TanStack Start request boundaries", () => {
  it("dispatches upload-link creation before TanStack's document fallback", async () => {
    const handle = vi.fn(async () => new Response(JSON.stringify({ id: "link-id" }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    }));
    const next = vi.fn();
    const server = uploadLinkPostMiddleware.options.server;
    if (!server) throw new Error("upload-link route middleware is missing");

    const response = await server({
      request: new Request("https://tools.example.test/api/upload-links?durationMs=86400000", {
        method: "POST"
      }),
      context: {
        runtime: { services: { publisher: { handle } } }
      },
      next
    } as never) as Response;

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "link-id" });
    expect(handle).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it("shares one principal across protected server functions", async () => {
    await expect(runSessionMiddleware(true)).resolves.toMatchObject({
      result: "authorized"
    });
  });

  it("redirects an expired server-function session to safe recovery", async () => {
    await expect(runSessionMiddleware(false)).rejects.toMatchObject({
      options: {
        href: "/sign-in?returnTo=%2Freview%3Fview%3Dqueue&reason=session_expired",
        statusCode: 307
      }
    });
  });

  it.each([
    { signedIn: true, method: "GET", status: 200 },
    { signedIn: true, method: "POST", status: 200 },
    { signedIn: true, method: "GET", status: 500 },
    { signedIn: true, method: "POST", status: 500 },
    { signedIn: false, method: "GET", status: 200 },
    { signedIn: false, method: "POST", status: 200 }
  ])("does not cache server-function $method status $status with signedIn=$signedIn", async ({ signedIn, method, status }) => {
    runtime.signedIn = signedIn;
    const body = status === 200 ? { answers: ["private answer"] } : { error: "submission_failed" };
    const response = await handleThroughRequestMiddleware(
      new Request("https://tools.example.test/_serverFn/feedback-submission", { method }),
      "serverFn",
      Response.json(body, { status, headers: { "Cache-Control": "public, max-age=3600" } })
    );

    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(body);
  });

  it("keeps cross-origin server-function requests forbidden", async () => {
    runtime.signedIn = true;
    const response = await handleThroughRequestMiddleware(
      new Request("https://tools.example.test/_serverFn/feedback-submission", {
        method: "POST",
        headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }
      }),
      "serverFn",
      Response.json({ answers: ["private answer"] })
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("Forbidden");
  });

  it("does not cache a framework error when a server-function handler throws", async () => {
    runtime.signedIn = true;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await handleThroughRequestMiddleware(
        new Request("https://tools.example.test/_serverFn/missing-function"),
        "serverFn",
        async () => { throw new Error("Server function not found"); }
      );

      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ status: 500, unhandled: true });
    } finally {
      errorLog.mockRestore();
    }
  });

  it("preserves public capability response caching without a browser session", async () => {
    runtime.signedIn = false;
    const response = await handleThroughRequestMiddleware(
      new Request("https://tools.example.test/artifacts/public-capability"),
      "router",
      new Response("artifact", { headers: { "Cache-Control": "public, max-age=3600" } })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(await response.text()).toBe("artifact");
  });

  it("still requires a browser session for private documents", async () => {
    runtime.signedIn = false;
    const response = await handleThroughRequestMiddleware(
      new Request("https://tools.example.test/money", { headers: { Accept: "text/html" } }),
      "router",
      new Response("private document")
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/sign-in?returnTo=%2Fmoney&reason=session_required");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps private documents private and non-cacheable", async () => {
    runtime.signedIn = true;
    const response = await handleThroughRequestMiddleware(
      new Request("https://tools.example.test/money", { headers: { Accept: "text/html" } }),
      "router",
      new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=utf-8" } })
    );

    expect(response.headers.get("Cache-Control")).toBe("private, no-store, no-transform");
  });

  it("passes the request nonce into TanStack Router SSR options", () => {
    expect(routerSsrOptions("request-nonce")).toEqual({ ssr: { nonce: "request-nonce" } });
    expect(routerSsrOptions()).toEqual({});
  });

  it("allows Vite's inline development styles without weakening production", () => {
    const development = documentContentSecurityPolicy("request-nonce", true);
    expect(development).toContain("style-src 'self' 'unsafe-inline';");
    expect(development).not.toContain("style-src 'self' 'unsafe-inline' 'nonce-");
    expect(development).toContain("script-src 'self' 'nonce-request-nonce'");

    const production = documentContentSecurityPolicy("request-nonce", false);
    expect(production).toContain("style-src 'self' 'nonce-request-nonce';");
    expect(production).not.toContain("style-src 'self' 'unsafe-inline'");
  });

  it("allows only the configured Convex origins on Markdown Share documents", () => {
    const policy = documentContentSecurityPolicy("request-nonce", false, [
      "https://example.convex.cloud",
      "wss://example.convex.cloud"
    ], true);
    expect(policy).toContain("connect-src 'self' https://example.convex.cloud wss://example.convex.cloud;");
    expect(policy).toContain("img-src 'self' data: https:;");
    expect(policy).not.toContain("connect-src *");
  });

  it("keeps HTTPS images blocked on other Tools documents", () => {
    const policy = documentContentSecurityPolicy("request-nonce", false);
    expect(policy).toContain("img-src 'self' data:;");
    expect(policy).not.toContain("img-src 'self' data: https:;");
  });
});
