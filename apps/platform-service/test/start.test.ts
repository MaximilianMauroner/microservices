import { describe, expect, it } from "vitest";
import { AccessDeniedError, type AccessVerifier } from "@tools-platform/security";
import { createPlatformAccessFunctionMiddleware } from "../src/access-middleware.js";
import { routerSsrOptions } from "../src/router-options.js";

function verifier(audience: string): AccessVerifier {
  return {
    async verify(request) {
      if (request.headers.get("cf-access-jwt-assertion") !== audience) {
        throw new AccessDeniedError();
      }
      return { id: `${audience}@example.test` };
    }
  };
}

const runtime = {
  access: {
    manage: verifier("manage-audience"),
    publisher: verifier("publisher-audience"),
    review: verifier("review-audience")
  }
};

async function runAccessMiddleware(
  family: "manage" | "publisher" | "review",
  audience: string
) {
  const middleware = createPlatformAccessFunctionMiddleware(family);
  const server = middleware.options.server;
  if (!server) throw new Error("function middleware server handler is missing");
  return server({
    context: {
      request: new Request("https://tools.example.test/_serverFn/test", {
        headers: { "Cf-Access-Jwt-Assertion": audience }
      }),
      runtime
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
  it("binds each protected server function to its own Access family", async () => {
    await expect(runAccessMiddleware("review", "review-audience")).resolves.toMatchObject({
      result: "authorized"
    });
    await expect(runAccessMiddleware("review", "manage-audience")).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(runAccessMiddleware("publisher", "review-audience")).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("passes the request nonce into TanStack Router SSR options", () => {
    expect(routerSsrOptions("request-nonce")).toEqual({ ssr: { nonce: "request-nonce" } });
    expect(routerSsrOptions()).toEqual({});
  });
});
