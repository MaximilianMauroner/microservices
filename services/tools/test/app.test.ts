import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classifyRoute, getAttachedPlatformPrincipal } from "@tools-platform/security";
import {
  createPlatformHandler,
  type PlatformHandler,
  type PrincipalResolver
} from "./platform-handler.js";

const principal = {
  role: "admin",
  subject: "google-subject",
  email: "operator@example.test"
} as const;

const member = {
  role: "member",
  subject: "friend-subject",
  email: "friend@example.test",
  products: [] as string[]
} as const;

const kitchenMember = { ...member, products: ["kitchen"] };

const resolvePrincipal: PrincipalResolver = async (request) => {
  const cookie = request.headers.get("cookie");
  if (cookie === "session=valid") return principal;
  if (cookie === "session=member") return member;
  if (cookie === "session=kitchen") return kitchenMember;
  return undefined;
};

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

function routeTreePaths(): string[] {
  const source = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
  const paths = [...source.matchAll(/fullPath: '([^']+)'/g)].map(([, path]) =>
    path!.replace(/\$[A-Za-z]*/g, "x").replace(/(.)\/$/, "$1"));
  return [...new Set(paths)];
}

function app() {
  return createPlatformHandler({
    resolvePrincipal,
    services: {
      publisher: mounted(async () => new Response("artifact")),
      manage: mounted(async () => new Response("tools"))
    },
    publicOrigin: "https://tools.example.test"
  });
}

describe("platform fetch gateway", () => {
  it("uses one application session across every private browser surface", async () => {
    const platform = app();
    for (const path of [
      "/",
      "/status",
      "/api/public/catalog",
      "/manage",
      "/publish",
      "/review",
      "/tools/private/money"
    ]) {
      expect((await request(platform, path)).status, path).toBe(401);
      expect(
        (await request(platform, path, { headers: { Cookie: "session=valid" } })).status,
        path
      ).toBe(200);
    }
  });

  it("keeps every private route admin-only for a member without grants", async () => {
    const platform = app();
    const privatePaths = routeTreePaths().filter((path) =>
      ["GET", "POST"].some((method) => classifyRoute(path, method).kind === "human-session"));
    expect(privatePaths).toEqual(expect.arrayContaining(["/", "/money", "/status", "/feedback", "/documents", "/api/money/activity", "/settings"]));

    for (const path of privatePaths) {
      for (const method of ["GET", "POST"]) {
        if (classifyRoute(path, method).kind !== "human-session") continue;
        const admin = await request(platform, path, { method, headers: { Cookie: "session=valid" } });
        const asMember = await request(platform, path, { method, headers: { Cookie: "session=member" } });
        expect(admin.status, `${method} ${path} as admin`).toBe(200);
        expect(asMember.status, `${method} ${path} as member`).toBe(["/settings", "/consent"].includes(path) ? 200 : 403);
      }
    }
  });

  it("sends a member's page navigation to Settings and leaves server functions to their own check", async () => {
    const platform = app();
    const page = await request(platform, "/money", { headers: { Cookie: "session=member", Accept: "text/html" } });
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/settings");

    const serverFunction = await request(platform, "/_serverFn/any", { method: "POST", headers: { Cookie: "session=member" } });
    expect(serverFunction.status).toBe(200);
  });

  it("opens only granted products for a member and sends page loads to the first one", async () => {
    const platform = app();
    const asKitchen = (path: string, init: RequestInit = {}) =>
      request(platform, path, { ...init, headers: { Cookie: "session=kitchen", ...init.headers } });
    expect((await asKitchen("/kitchen")).status).toBe(200);
    expect((await asKitchen("/api/kitchen/recipes", { method: "POST" })).status).toBe(200);
    expect((await asKitchen("/settings")).status).toBe(200);
    expect((await asKitchen("/kitchenette")).status).toBe(403);
    expect((await asKitchen("/money")).status).toBe(403);
    expect((await asKitchen("/api/money/activity")).status).toBe(403);
    const page = await asKitchen("/", { headers: { Accept: "text/html" } });
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/kitchen");
    expect((await request(platform, "/kitchen", { headers: { Cookie: "session=member" } })).status).toBe(403);
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

  it("keeps sign-in infrastructure, health checks, and capability reads public", async () => {
    const platform = app();
    for (const path of [
      "/sign-in",
      "/api/auth/callback/google",
      "/assets/tools.css",
      "/health",
      "/drop/guest-upload-token",
      "/artifacts/01234567890123456789012345678901",
      "/files/01234567890123456789012345678901/index.html",
      "/.well-known/oauth-protected-resource/api/mcp",
      "/.well-known/oauth-authorization-server/api/auth"
    ]) {
      expect((await request(platform, path)).status, path).toBe(200);
    }

    expect((await request(platform, "/artifacts/id", { method: "POST" })).status).toBe(401);
    expect((await request(platform, "/files/id/index.html", { method: "DELETE" })).status).toBe(401);
    expect((await request(platform, "/api/drop/guest-upload-token/uploads", { method: "POST" })).status).toBe(200);
    expect((await request(platform, "/api/upload-links", { method: "POST" })).status).toBe(401);
    expect((await request(platform, "/.well-known/oauth-protected-resource", { method: "POST" })).status).toBe(401);
  });

  it("keeps machine APIs on their native service tokens", async () => {
    const platform = createPlatformHandler({
      resolvePrincipal,
      services: {
        publisher: mounted(async (request) =>
          request.headers.get("authorization") === "Bearer upload-token"
            ? new Response("upload-ok")
            : new Response(JSON.stringify({ error: "invalid_upload_token" }), { status: 401 })),
        manage: mounted(async () => new Response("tools"))
      },
      publicOrigin: "https://tools.example.test"
    });

    expect((await request(platform, "/api/mcp", { method: "POST" })).status, "MCP checks its own bearer token").toBe(200);
    expect((await request(platform, "/api/uploads")).status).toBe(401);
    expect((await request(platform, "/api/uploads", {
      method: "POST",
      headers: { Authorization: "Bearer upload-token" },
      body: "payload"
    })).status).toBe(200);
  });

  it("attaches the generic principal for mounted service attribution", async () => {
    let attached;
    const platform = createPlatformHandler({
      resolvePrincipal,
      services: {
        publisher: mounted(async () => new Response()),
        manage: mounted(async (request) => {
          attached = getAttachedPlatformPrincipal(request);
          return new Response();
        })
      },
      publicOrigin: "https://tools.example.test"
    });
    await request(platform, "/manage", { headers: { Cookie: "session=valid" } });
    expect(attached).toEqual(principal);

  });
});
