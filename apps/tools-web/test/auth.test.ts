import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { AccessDeniedError, createAccessVerifier } from "../src/auth.js";

describe("Cloudflare Access verification", () => {
  it("verifies signature, issuer, audience, expiry and extracts a sanitized actor", async () => {
    const issuer = "https://team.cloudflareaccess.com";
    const audience = "access-audience";
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const key = async () => publicKey;
    const verifier = createAccessVerifier({
      issuer,
      audience,
      jwksUrl: `${issuer}/cdn-cgi/access/certs`,
      key
    });
    const token = await new SignJWT({ email: "Admin@Example.test" })
      .setProtectedHeader({ alg: "RS256", kid: jwk.kid ?? "test" })
      .setSubject("actor-id")
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(
      verifier.verify(
        new Request("https://tools.example.test/ops", {
          headers: { "Cf-Access-Jwt-Assertion": token }
        })
      )
    ).resolves.toEqual({ id: "admin@example.test" });
  });

  it("rejects missing, expired, wrong-issuer and wrong-audience assertions", async () => {
    const issuer = "https://team.cloudflareaccess.com";
    const audience = "access-audience";
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const verifier = createAccessVerifier({
      issuer,
      audience,
      jwksUrl: `${issuer}/cdn-cgi/access/certs`,
      key: async () => publicKey
    });
    const tokens = await Promise.all([
      signed(privateKey, issuer, audience, "0s"),
      signed(privateKey, "https://other.cloudflareaccess.com", audience, "5m"),
      signed(privateKey, issuer, "other-audience", "5m")
    ]);

    await expect(
      verifier.verify(new Request("https://tools.example.test/ops"))
    ).rejects.toBeInstanceOf(AccessDeniedError);
    for (const token of tokens) {
      await expect(
        verifier.verify(
          new Request("https://tools.example.test/ops", {
            headers: { "Cf-Access-Jwt-Assertion": token }
          })
        )
      ).rejects.toBeInstanceOf(AccessDeniedError);
    }
  });
});

async function signed(
  privateKey: CryptoKey,
  issuer: string,
  audience: string,
  expiry: string
): Promise<string> {
  return new SignJWT({ email: "admin@example.test" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(privateKey);
}
