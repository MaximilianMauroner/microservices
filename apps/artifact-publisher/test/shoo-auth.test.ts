import express from "express";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT
} from "jose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createShooAuth } from "../src/shoo-auth.js";

const audience = "origin:https://uploads.example";
const issuer = "https://shoo.dev";

describe("Shoo authentication", () => {
  it("rejects requests without a bearer token before contacting Shoo", async () => {
    const app = express();
    app.get(
      "/protected",
      createShooAuth({
        allowedEmail: "owner@example.com",
        audience
      }),
      (_req, res) => res.json({ ok: true })
    );

    const response = await request(app).get("/protected").expect(401);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toEqual({
      error: "shoo_auth_required",
      message: "Sign in with Google to upload files."
    });
  });

  it("accepts an active Shoo token for the exact verified email", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    const token = await new SignJWT({
      email: "Owner@Example.com",
      email_verified: true,
      pairwise_sub: "test-user"
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const app = express();
    app.get(
      "/protected",
      createShooAuth({
        allowedEmail: "owner@example.com",
        audience,
        jwks: createLocalJWKSet({
          keys: [{ ...publicJwk, kid: "test-key", alg: "ES256" }]
        })
      }),
      (_req, res) => res.json({ email: res.locals.shooEmail })
    );

    await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect({ email: "owner@example.com" });
  });

  it("rejects a valid token belonging to another email", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    const token = await new SignJWT({
      email: "other@example.com",
      email_verified: true
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const app = express();
    app.get(
      "/protected",
      createShooAuth({
        allowedEmail: "owner@example.com",
        audience,
        jwks: createLocalJWKSet({
          keys: [{ ...publicJwk, kid: "test-key", alg: "ES256" }]
        })
      }),
      (_req, res) => res.json({ ok: true })
    );

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.error).toBe("shoo_email_not_allowed");
  });
});
