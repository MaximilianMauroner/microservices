import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AccessVerifier } from "../../tools-web/src/auth.ts";
import { AccessDeniedError } from "../../tools-web/src/auth.ts";
import { accessAuthentication, createPlatformApp } from "../src/app.ts";

const access: AccessVerifier = {
  async verify(request) {
    if (request.headers.get("cf-access-jwt-assertion") !== "valid") {
      throw new AccessDeniedError();
    }
    return { id: "operator@example.test" };
  }
};

function app() {
  const artifact: RequestHandler = (_request, response) => {
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

  it("keeps the Tools and status surfaces public for GET and HEAD", async () => {
    await request(app()).get("/").expect(200, "tools");
    expect((await request(app()).head("/").expect(200)).text).toBeUndefined();
    await request(app()).get("/status").expect(200, "tools");
    expect((await request(app()).head("/status").expect(200)).text).toBeUndefined();
    await request(app()).get("/assets/tools.css").expect(200, "tools");
    await request(app()).get("/api/public/catalog").expect(200, "tools");
  });

  it("rejects direct-origin access to protected canonical and legacy pages", async () => {
    for (const path of [
      "/publish",
      "/uploads",
      "/artifacts/01234567890123456789012345678901",
      "/p/01234567890123456789012345678901",
      "/files/01234567890123456789012345678901/report%20one.pdf",
      "/f/01234567890123456789012345678901/report%20one.pdf",
      "/review",
      "/manage",
      "/ops"
    ]) {
      await request(app()).get(path).expect(401, { error: "access_required" });
    }
  });

  it("routes canonical applications behind the same Access assertion", async () => {
    const header = { "Cf-Access-Jwt-Assertion": "valid" };
    await request(app()).get("/").set(header).expect(200, "tools");
    await request(app()).get("/status").set(header).expect(200, "tools");
    await request(app()).get("/review").set(header).expect(200, "field-guide");
    await request(app()).get("/publish").set(header).expect(200, "artifact");
    await request(app())
      .get("/artifacts/01234567890123456789012345678901")
      .set(header)
      .expect(200, "artifact");
    await request(app())
      .get("/files/01234567890123456789012345678901/report.pdf")
      .set(header)
      .expect(200, "artifact");
    await request(app()).get("/manage").set(header).expect(200, "tools");
  });

  it("redirects authenticated legacy browser routes and preserves path data and queries", async () => {
    const header = { "Cf-Access-Jwt-Assertion": "valid" };
    await request(app())
      .get("/uploads?view=recent")
      .set(header)
      .expect(308)
      .expect("Location", "/publish?view=recent");
    await request(app())
      .get("/p/01234567890123456789012345678901?download=0")
      .set(header)
      .expect(308)
      .expect(
        "Location",
        "/artifacts/01234567890123456789012345678901?download=0"
      );
    const headRedirect = await request(app())
      .head("/f/01234567890123456789012345678901/report%20one.pdf?download=1")
      .set(header)
      .expect(308)
      .expect(
        "Location",
        "/files/01234567890123456789012345678901/report%20one.pdf?download=1"
      );
    expect(headRedirect.text).toBeUndefined();
    await request(app())
      .get("/ops/catalog?tab=history")
      .set(header)
      .expect(308)
      .expect("Location", "/manage/catalog?tab=history");
  });

  it("does not redirect API or mutation requests", async () => {
    const header = { "Cf-Access-Jwt-Assertion": "valid" };
    await request(app())
      .post("/api/uploads")
      .set(header)
      .expect(200, "artifact");
    await request(app())
      .post("/api/ops/groups")
      .set(header)
      .expect(200, "tools");
    await request(app())
      .post("/uploads")
      .set(header)
      .expect(200, "artifact");
  });

  it("adapts the Access actor for field-guide review attribution", async () => {
    const authenticate = accessAuthentication(access);
    const result = await authenticate(
      new Request("https://tools.example.test/api/review/queue", {
        headers: { "Cf-Access-Jwt-Assertion": "valid" }
      })
    );
    expect(result).toEqual({ ok: true, email: "operator@example.test" });
  });
});
