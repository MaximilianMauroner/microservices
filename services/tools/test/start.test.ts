import { describe, expect, it } from "vitest";
import { requirePlatformSession } from "../src/auth-middleware.js";
import { routerSsrOptions } from "../src/router-options.js";
import { documentContentSecurityPolicy } from "../src/content-security-policy.js";

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
