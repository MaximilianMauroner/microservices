import { describe, expect, it } from "vitest";
import {
  AccessDeniedError,
  type AccessVerifier
} from "@tools-platform/security";
import {
  accessAuthentication,
  createPlatformHandler,
  type PlatformAccess
} from "../src/app.js";

function verifier(audience: string): AccessVerifier {
  return {
    async verify(request) {
      if (request.headers.get("cf-access-jwt-assertion") !== audience) {
        throw new AccessDeniedError();
      }
      return { id: "operator@example.test" };
    }
  };
}

const access: PlatformAccess = {
  manage: verifier("manage-audience"),
  publisher: verifier("publisher-audience"),
  review: verifier("review-audience")
};

function request(
  app: ReturnType<typeof createPlatformHandler>,
  path: string,
  init?: RequestInit
) {
  return app(new Request(`https://tools.example.test${path}`, init));
}

function app() {
  return createPlatformHandler({
    access,
    services: {
      artifact: async () => new Response("artifact"),
      fieldGuide: async () => new Response("field-guide"),
      tools: async () => new Response("tools")
    },
    publicOrigin: "https://tools.example.test"
  });
}

describe("platform fetch gateway", () => {
  it("keeps protected route families isolated by Access audience", async () => {
    const platform = app();

    expect((await request(platform, "/")).status).toBe(200);
    expect((await request(platform, "/manage")).status).toBe(401);
    expect(
      (
        await request(platform, "/manage", {
          headers: { "Cf-Access-Jwt-Assertion": "manage-audience" }
        })
      ).status
    ).toBe(200);
    expect(
      (
        await request(platform, "/publish", {
          headers: { "Cf-Access-Jwt-Assertion": "review-audience" }
        })
      ).status
    ).toBe(401);
    expect(
      (
        await request(platform, "/review", {
          headers: { "Cf-Access-Jwt-Assertion": "review-audience" }
        })
      ).status
    ).toBe(200);
  });

  it("allows public catalog, assets, and capability reads without Access", async () => {
    const platform = app();
    for (const path of [
      "/",
      "/status",
      "/assets/tools.css",
      "/api/public/catalog",
      "/artifacts/01234567890123456789012345678901",
      "/files/01234567890123456789012345678901/index.html"
    ]) {
      expect((await request(platform, path)).status, path).toBe(200);
    }
  });

  it("keeps machine APIs on native service tokens", async () => {
    const platform = createPlatformHandler({
      access,
      services: {
        artifact: async (request) =>
          request.headers.get("authorization") === "Bearer upload-token"
            ? new Response("upload-ok")
            : new Response(JSON.stringify({ error: "invalid_upload_token" }), { status: 401 }),
        fieldGuide: async (request) =>
          request.headers.get("authorization") === "Bearer agent-token"
            ? new Response("agent-ok")
            : new Response(JSON.stringify({ error: "invalid_agent_token" }), { status: 401 }),
        tools: async () => new Response("tools")
      },
      publicOrigin: "https://tools.example.test"
    });

    expect((await request(platform, "/api/uploads")).status).toBe(401);
    expect(
      (
        await request(platform, "/api/uploads", {
          method: "POST",
          headers: { Authorization: "Bearer upload-token" },
          body: "payload"
        })
      ).status
    ).toBe(200);
    expect((await request(platform, "/api/agent/status")).status).toBe(401);
    expect(
      (
        await request(platform, "/api/agent/status", {
          headers: { Authorization: "Bearer agent-token" }
        })
      ).status
    ).toBe(200);
  });

  it("preserves legacy browser redirects and query strings", async () => {
    const platform = app();
    const response = await request(platform, "/ops/status?view=all", {
      headers: { "Cf-Access-Jwt-Assertion": "manage-audience" }
    });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("/manage/status?view=all");
  });

  it("adapts Access actors for downstream browser handlers", async () => {
    const authentication = accessAuthentication(access.review);
    const result = await authentication(
      new Request("https://tools.example.test/review", {
        headers: { "Cf-Access-Jwt-Assertion": "review-audience" }
      })
    );
    expect(result).toEqual({ ok: true, email: "operator@example.test" });
  });
});
