import { describe, expect, it } from "vitest";
import { getAttachedPlatformPrincipal } from "@tools-platform/security";
import {
  createPlatformHandler,
  reviewerAuthentication,
  type PlatformHandler,
  type PrincipalResolver
} from "../src/app.js";

const principal = {
  subject: "google-subject",
  email: "operator@example.test"
};

const resolvePrincipal: PrincipalResolver = async (request) =>
  request.headers.get("cookie") === "session=valid" ? principal : undefined;

const mounted = (handle: PlatformHandler) => ({
  handle,
  readiness: async () => {},
  close: () => {}
});

function request(
  app: ReturnType<typeof createPlatformHandler>,
  path: string,
  init?: RequestInit
) {
  return app(new Request(`https://tools.example.test${path}`, init));
}

function app() {
  return createPlatformHandler({
    resolvePrincipal,
    services: {
      publisher: mounted(async () => new Response("artifact")),
      review: mounted(async () => new Response("field-guide")),
      manage: mounted(async () => new Response("tools"))
    },
    publicOrigin: "https://tools.example.test"
  });
}

describe("platform fetch gateway", () => {
  it("uses one application session across every private browser surface", async () => {
    const platform = app();
    for (const path of ["/manage", "/publish", "/review", "/tools/private/money"]) {
      expect((await request(platform, path)).status, path).toBe(401);
      expect(
        (await request(platform, path, { headers: { Cookie: "session=valid" } })).status,
        path
      ).toBe(200);
    }
  });

  it("redirects private document navigations to a validated sign-in return path", async () => {
    const response = await request(app(), "/manage/status?view=all", {
      headers: { Accept: "text/html" }
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/sign-in?returnTo=%2Fmanage%2Fstatus%3Fview%3Dall&reason=session_required"
    );
  });

  it("allows public pages and canonical capability reads without a session", async () => {
    const platform = app();
    for (const path of [
      "/",
      "/sign-in",
      "/api/auth/callback/google",
      "/status",
      "/assets/tools.css",
      "/api/public/catalog",
      "/artifacts/01234567890123456789012345678901",
      "/files/01234567890123456789012345678901/index.html"
    ]) {
      expect((await request(platform, path)).status, path).toBe(200);
    }
  });

  it("keeps machine APIs on their native service tokens", async () => {
    const platform = createPlatformHandler({
      resolvePrincipal,
      services: {
        publisher: mounted(async (request) =>
          request.headers.get("authorization") === "Bearer upload-token"
            ? new Response("upload-ok")
            : new Response(JSON.stringify({ error: "invalid_upload_token" }), { status: 401 })),
        review: mounted(async (request) =>
          request.headers.get("authorization") === "Bearer agent-token"
            ? new Response("agent-ok")
            : new Response(JSON.stringify({ error: "invalid_agent_token" }), { status: 401 })),
        manage: mounted(async () => new Response("tools"))
      },
      publicOrigin: "https://tools.example.test"
    });

    expect((await request(platform, "/api/uploads")).status).toBe(401);
    expect((await request(platform, "/api/uploads", {
      method: "POST",
      headers: { Authorization: "Bearer upload-token" },
      body: "payload"
    })).status).toBe(200);
    expect((await request(platform, "/api/agent/status")).status).toBe(401);
    expect((await request(platform, "/api/agent/status", {
      headers: { Authorization: "Bearer agent-token" }
    })).status).toBe(200);
  });

  it("attaches the generic principal for mounted service attribution", async () => {
    let attached;
    const platform = createPlatformHandler({
      resolvePrincipal,
      services: {
        publisher: mounted(async () => new Response()),
        review: mounted(async () => new Response()),
        manage: mounted(async (request) => {
          attached = getAttachedPlatformPrincipal(request);
          return new Response();
        })
      },
      publicOrigin: "https://tools.example.test"
    });
    await request(platform, "/manage", { headers: { Cookie: "session=valid" } });
    expect(attached).toEqual(principal);

    const auth = reviewerAuthentication(
      Object.assign(new Request("https://tools.example.test/review"), {})
    );
    expect(auth.ok).toBe(false);
  });
});
