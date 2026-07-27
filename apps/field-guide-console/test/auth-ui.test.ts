import { generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { describe, expect, it } from "vitest";
import { agentAuth, shooAuth } from "../src/auth.js";
import type { Authenticator } from "../src/http.js";
import { reviewConsole } from "../src/ui.js";
import { responseJson } from "./http-test.js";

const origin = "https://reviews.example";

function authenticatedRequest(value?: string) {
  return new Request(origin, {
    headers: value === undefined ? undefined : { Authorization: value },
  });
}

async function expectRejected(
  auth: Authenticator,
  authorization: string | undefined,
  status: number,
) {
  const result = await auth(authenticatedRequest(authorization));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected authentication to fail.");
  expect(result.response.status).toBe(status);
  expect(result.response.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  return result.response;
}

describe("review UI and authentication", () => {
  it("serves PKCE, separate scopes, history, evidence, and valid action controls", async () => {
    const response = reviewConsole();
    const html = await response.text();
    expect(html).toContain("Shoo.startSignIn");
    expect(html).toContain('data-scope="project"');
    expect(html).toContain('data-scope="global"');
    expect(html).toContain('data-view="history"');
    expect(html).toContain("Evidence");
    expect(html).toContain("confirm_valid");
    expect(html).not.toContain('data-action="edit"');
  });

  it("accepts only an exact agent Bearer credential", async () => {
    const auth = agentAuth("top-secret");
    expect((await auth(authenticatedRequest("Bearer top-secret"))).ok).toBe(true);
    for (const value of [
      undefined,
      "top-secret",
      "bearer top-secret",
      "Bearer  top-secret",
      "Bearer\ttop-secret",
      "Bearer top-secret extra",
      "Bearer wrong",
    ]) {
      const response = await expectRejected(auth, value, 401);
      expect(response.headers.get("www-authenticate")).toBe(
        'Bearer realm="field-guide-console"',
      );
    }

    const unicodeRequest = new Request(origin);
    Object.defineProperty(unicodeRequest, "headers", {
      value: { get: () => "Bearer 𐍈" },
    });
    const unicodeResult = await agentAuth("éx")(unicodeRequest);
    expect(unicodeResult.ok).toBe(false);
    if (unicodeResult.ok)
      throw new Error("Expected Unicode authentication to fail.");
    const unicode = unicodeResult.response;
    expect(unicode.status).toBe(401);
    expect(await responseJson(unicode)).toEqual({
      error: "agent_auth_required",
      message: "Valid agent credentials are required.",
    });
    expect(unicode.headers.get("www-authenticate")).toBe(
      'Bearer realm="field-guide-console"',
    );
  });

  it("verifies Shoo ES256 issuer, audience, verified email, and exact account", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const { privateKey: otherPrivateKey } = await generateKeyPair("ES256");
    const auth = shooAuth({
      allowedEmail: "Owner@Example.com",
      audience: `origin:${origin}`,
      issuer: "https://shoo.dev/path-ignored",
      jwks: async () => publicKey,
    });
    const token = async (
      payload: JWTPayload,
      values: {
        audience?: string;
        expirationTime?: string | number;
        issuer?: string;
        privateKey?: typeof privateKey;
      } = {},
    ) =>
      new SignJWT(payload)
        .setProtectedHeader({ alg: "ES256", kid: "test" })
        .setIssuer(values.issuer ?? "https://shoo.dev")
        .setAudience(values.audience ?? `origin:${origin}`)
        .setExpirationTime(values.expirationTime ?? "5m")
        .sign(values.privateKey ?? privateKey);

    const accepted = await auth(
      authenticatedRequest(
        `Bearer ${await token({ email: "owner@example.com", email_verified: true })}`,
      ),
    );
    expect(accepted).toEqual({ ok: true, email: "owner@example.com" });

    for (const payload of [
      { email: "other@example.com", email_verified: true },
      { email: "owner@example.com", email_verified: false },
      { email_verified: true },
    ]) {
      const response = await expectRejected(
        auth,
        `Bearer ${await token(payload)}`,
        403,
      );
      expect(await responseJson(response)).toMatchObject({
        error: "shoo_email_not_allowed",
      });
    }

    for (const invalid of [
      await token(
        { email: "owner@example.com", email_verified: true },
        { audience: "origin:https://wrong.example" },
      ),
      await token(
        { email: "owner@example.com", email_verified: true },
        { issuer: "https://issuer.example" },
      ),
      await token(
        { email: "owner@example.com", email_verified: true },
        { privateKey: otherPrivateKey },
      ),
      await token(
        { email: "owner@example.com", email_verified: true },
        { expirationTime: Math.floor(Date.now() / 1000) - 60 },
      ),
    ]) {
      const response = await expectRejected(auth, `Bearer ${invalid}`, 401);
      expect(response.headers.get("www-authenticate")).toBe(
        'Bearer realm="field-guide-console"',
      );
    }
    await expectRejected(auth, undefined, 401);
  });
});
