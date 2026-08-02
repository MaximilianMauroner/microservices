import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AccessVerifier } from "../../tools-web/src/auth.ts";
import { AccessDeniedError } from "../../tools-web/src/auth.ts";
import {
  accessAuthentication,
  createPlatformApp,
  type PlatformAccess
} from "../src/app.ts";
import {
  InvalidHeartbeatTokenError,
  type TowerHeartbeat
} from "../src/tower-heartbeat.ts";

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

function nativeTokenArtifact(): RequestHandler {
  return (request, response) => {
    if (request.get("authorization") !== "Bearer upload-token") {
      response.status(401).json({ error: "invalid_upload_token" });
      return;
    }
    response.status(200).send("artifact-token-ok");
  };
}

const nativeTokenFieldGuide = async (request: Request) => {
  if (request.headers.get("authorization") !== "Bearer agent-token") {
    return new Response(
      JSON.stringify({ error: "invalid_agent_token" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
  return new Response("agent-token-ok");
};

function appWithNativeTokens() {
  return createPlatformApp({
    access,
    artifact: nativeTokenArtifact(),
    fieldGuide: nativeTokenFieldGuide,
    tools: async () => new Response("tools"),
    health: async () => undefined,
    publicOrigin: "https://tools.example.test"
  });
}

const legacyAccess: AccessVerifier = {
  async verify(request) {
    if (request.headers.get("cf-access-jwt-assertion") !== "review-audience") {
      throw new AccessDeniedError();
    }
    return { id: "operator@example.test" };
  }
};

function app() {
  const artifact: RequestHandler = (artifactRequest, response) => {
      if (
        artifactRequest.originalUrl.startsWith("/artifacts/%ZZ") ||
        artifactRequest.originalUrl.includes("/%ZZ") ||
        artifactRequest.originalUrl.includes("/%25ZZ")
      ) {
      response.sendStatus(404);
      return;
    }
    response.status(200).send("artifact");
  };
  return createPlatformApp({
    access,
    artifact,
    fieldGuide: async () => new Response("field-guide"),
    tools: async () => new Response("tools"),
    health: async () => undefined,
    publicOrigin: "https://tools.example.test"
  });
}

describe("platform gateway", () => {
  it("keeps platform health available to Railway", async () => {
    await request(app()).get("/health").expect(200, { ok: true });
  });

  it("reports component health independently and without browser Access", async () => {
    const checks: string[] = [];
    const componentApp = createPlatformApp({
      access,
      artifact: (_request, response) => response.sendStatus(404),
      fieldGuide: async () => new Response("field-guide"),
      tools: async () => new Response("tools"),
      health: async () => undefined,
      componentHealth: {
        tools: async () => {
          checks.push("tools");
        },
        publisher: async () => {
          checks.push("publisher");
          throw new Error("storage unavailable");
        },
        review: async () => {
          checks.push("review");
        },
      },
      publicOrigin: "https://tools.example.test",
    });

    await request(componentApp).get("/health/tools").expect(200, { ok: true });
    await request(componentApp)
      .get("/health/publisher")
      .expect(503, { ok: false, error: "dependency_unavailable" });
    await request(componentApp).get("/health/review").expect(200, { ok: true });
    expect(checks).toEqual(["tools", "publisher", "review"]);
  });

  it("accepts authenticated Tower heartbeats and exposes only current health", async () => {
    let healthy = false;
    const towerHeartbeat: TowerHeartbeat = {
      async receive(authorization) {
        if (authorization !== "Bearer tower-token") {
          throw new InvalidHeartbeatTokenError();
        }
        healthy = true;
      },
      async isHealthy() {
        return healthy;
      }
    };
    const heartbeatApp = createPlatformApp({
      access,
      artifact: (_request, response) => response.sendStatus(404),
      fieldGuide: async () => new Response("field-guide"),
      tools: async () => new Response("tools"),
      towerHeartbeat,
      health: async () => undefined,
      publicOrigin: "https://tools.example.test"
    });

    await request(heartbeatApp)
      .get("/health/tower")
      .expect(503, { ok: false, error: "heartbeat_stale" });
    await request(heartbeatApp)
      .post("/api/heartbeat/tower")
      .expect(401, { error: "invalid_heartbeat_token" });
    await request(heartbeatApp)
      .post("/api/heartbeat/tower")
      .set("Authorization", "Bearer tower-token")
      .expect(204);
    await request(heartbeatApp)
      .get("/health/tower")
      .expect(200, { ok: true });
  });

  it("keeps the Tools and status surfaces public for GET and HEAD", async () => {
    await request(app()).get("/").expect(200, "tools");
    expect((await request(app()).head("/").expect(200)).text).toBeUndefined();
    await request(app()).get("/status").expect(200, "tools");
    expect((await request(app()).head("/status").expect(200)).text).toBeUndefined();
    await request(app()).get("/assets/tools.css").expect(200, "tools");
    await request(app()).get("/api/public/catalog").expect(200, "tools");
  });

  it("serves only the exact Manage browser assets publicly", async () => {
    for (const path of ["/assets/markdown-admin.js", "/assets/ops.js"]) {
      await request(app()).get(path).expect(200, "tools");
      expect((await request(app()).head(path).expect(200)).text).toBeUndefined();
      await request(app())
        .post(path)
        .expect(401, { error: "access_required" });
    }

    for (const path of [
      "/manage",
      "/api/ops/catalog",
      "/assets/ops.js.map",
      "/assets/other.js"
    ]) {
      await request(app()).get(path).expect(401, { error: "access_required" });
    }
  });

  it("rejects direct-origin access to protected browser pages and APIs", async () => {
    for (const path of [
      "/publish",
      "/uploads",
      "/api/external-uploads",
      "/review",
      "/manage",
      "/ops"
    ]) {
      await request(app()).get(path).expect(401, { error: "access_required" });
    }
  });

  it("routes canonical applications only with their route-family Access assertion", async () => {
    await request(app()).get("/").expect(200, "tools");
    await request(app()).get("/status").expect(200, "tools");
    await request(app())
      .get("/review")
      .set("Cf-Access-Jwt-Assertion", "review-audience")
      .expect(200, "field-guide");
    await request(app())
      .get("/publish")
      .set("Cf-Access-Jwt-Assertion", "publisher-audience")
      .expect(200, "artifact");
    await request(app())
      .get("/manage")
      .set("Cf-Access-Jwt-Assertion", "manage-audience")
      .expect(200, "tools");
    await request(app())
      .get("/manage/documents")
      .set("Cf-Access-Jwt-Assertion", "manage-audience")
      .expect(200, "tools");
  });

  it("rejects cross-audience assertion replay between protected route families", async () => {
    const cases = [
      ["/manage/documents", "publisher-audience"],
      ["/manage/documents", "review-audience"],
      ["/manage", "publisher-audience"],
      ["/manage", "review-audience"],
      ["/publish", "manage-audience"],
      ["/publish", "review-audience"],
      ["/uploads", "manage-audience"],
      ["/review", "manage-audience"],
      ["/review", "publisher-audience"],
      ["/ops", "publisher-audience"]
    ] as const;
    for (const [path, audience] of cases) {
      await request(app())
        .get(path)
        .set("Cf-Access-Jwt-Assertion", audience)
        .expect(401, { error: "access_required" });
    }
  });

  it("serves canonical capability reads publicly for GET and HEAD", async () => {
    await request(app())
      .get("/artifacts/01234567890123456789012345678901")
      .expect(200, "artifact");
    expect(
      (
        await request(app())
          .head("/artifacts/01234567890123456789012345678901")
          .expect(200)
      ).text
    ).toBeUndefined();
    await request(app())
      .get("/files/01234567890123456789012345678901/report%20one.pdf")
      .expect(200, "artifact");
    expect(
      (
        await request(app())
          .head("/files/01234567890123456789012345678901/report%20one.pdf")
          .expect(200)
      ).text
    ).toBeUndefined();
  });

  it("redirects legacy capability reads publicly and preserves path data and queries", async () => {
    const publisherHeader = {
      "Cf-Access-Jwt-Assertion": "publisher-audience"
    };
    await request(app())
      .get("/uploads?view=recent")
      .set(publisherHeader)
      .expect(308)
      .expect("Location", "/publish?view=recent");
    await request(app())
      .get("/p/01234567890123456789012345678901?download=0")
      .expect(308)
      .expect(
        "Location",
        "/artifacts/01234567890123456789012345678901?download=0"
      );
    const headRedirect = await request(app())
      .head("/f/01234567890123456789012345678901/report%20one.pdf?download=1")
      .expect(308)
      .expect(
        "Location",
        "/files/01234567890123456789012345678901/report%20one.pdf?download=1"
      );
    expect(headRedirect.text).toBeUndefined();
    await request(app())
      .get("/ops/catalog?tab=history")
      .set("Cf-Access-Jwt-Assertion", "manage-audience")
      .expect(308)
      .expect("Location", "/manage/catalog?tab=history");
  });

  it("keeps non-read requests to capability paths Publisher-Access protected", async () => {
    for (const path of [
      "/artifacts/01234567890123456789012345678901",
      "/files/01234567890123456789012345678901/report.pdf",
      "/p/01234567890123456789012345678901",
      "/f/01234567890123456789012345678901/report.pdf"
    ]) {
      await request(app()).post(path).expect(401, { error: "access_required" });
      await request(app())
        .post(path)
        .set("Cf-Access-Jwt-Assertion", "publisher-audience")
        .expect(200, "artifact");
    }
  });

  it("keeps browser-protected API and mutation requests on their stable handlers", async () => {
    await request(app())
      .post("/api/ops/groups")
      .set("Cf-Access-Jwt-Assertion", "manage-audience")
      .expect(200, "tools");
    await request(app())
      .post("/uploads")
      .set("Cf-Access-Jwt-Assertion", "publisher-audience")
      .expect(200, "artifact");
    await request(app())
      .post("/api/external-uploads")
      .set("Cf-Access-Jwt-Assertion", "publisher-audience")
      .expect(200, "artifact");
  });

  it("preserves native token-only machine APIs without weakening their guards", async () => {
    const uploadRequests = [
      ["post", "/api/uploads"],
      ["put", "/api/uploads/01234567890123456789012345678901"],
      ["delete", "/api/uploads/01234567890123456789012345678901"]
    ] as const;
    for (const [method, path] of uploadRequests) {
      await request(appWithNativeTokens())
        [method](path)
        .set("Authorization", "Bearer upload-token")
        .expect(200, "artifact-token-ok");
      await request(appWithNativeTokens())
        [method](path)
        .expect(401, { error: "invalid_upload_token" });
    }
    await request(appWithNativeTokens())
      .post("/api/agent/candidates")
      .set("Authorization", "Bearer agent-token")
      .expect(200, "agent-token-ok");
    await request(appWithNativeTokens())
      .post("/api/agent/candidates")
      .expect(401, { error: "invalid_agent_token" });
  });

  it("serves canonical Manage HEAD bodylessly after a legacy HEAD redirect", async () => {
    const direct = await request(app())
      .head("/manage/catalog")
      .set("Cf-Access-Jwt-Assertion", "manage-audience")
      .expect(200);
    expect(direct.text).toBeUndefined();
    const followed = await request(app())
      .head("/ops/catalog")
      .set("Cf-Access-Jwt-Assertion", "manage-audience")
      .redirects(1)
      .expect(200);
    expect(followed.text).toBeUndefined();
  });

  it("keeps malformed legacy capability paths safe after canonical redirect", async () => {
    await request(app())
      .get("/p/%ZZ")
      .redirects(1)
      .expect(404);
    await request(app())
      .get(`/f/${"a".repeat(32)}/%ZZ`)
      .redirects(1)
      .expect(404);
  });

  it("adapts the Access actor for field-guide review attribution", async () => {
    const authenticate = accessAuthentication(legacyAccess);
    const result = await authenticate(
      new Request("https://tools.example.test/api/review/queue", {
        headers: { "Cf-Access-Jwt-Assertion": "review-audience" }
      })
    );
    expect(result).toEqual({ ok: true, email: "operator@example.test" });
  });
});
