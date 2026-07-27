import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

function validConfigEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    S3_ACCESS_KEY_ID: "test-s3-access-key-id",
    S3_BUCKET: "bucket",
    S3_ENDPOINT: "https://storage.example",
    S3_REGION: "region",
    S3_SECRET_ACCESS_KEY: "test-s3-secret-value",
    UPLOAD_TOKEN: "test-upload-token",
    ...overrides
  };
}

describe("runtime config", () => {
  it("prefers an explicit public base URL over the Railway public domain", () => {
    const config = loadConfig(
      validConfigEnv({
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://publisher.example/",
        RAILWAY_PUBLIC_DOMAIN: "fallback.up.railway.app"
      })
    );

    expect(config.publicBaseUrl).toBe("https://publisher.example");
  });

  it("uses the Railway public domain when production has no explicit public base URL", () => {
    const config = loadConfig(
      validConfigEnv({
        NODE_ENV: "production",
        RAILWAY_PUBLIC_DOMAIN: "publisher.up.railway.app"
      })
    );

    expect(config.publicBaseUrl).toBe("https://publisher.up.railway.app");
  });

  it("requires either public URL source in production", () => {
    expect(() => loadConfig(validConfigEnv({ NODE_ENV: "production" }))).toThrow(
      "PUBLIC_BASE_URL is required when NODE_ENV=production"
    );
  });

  it("rejects malformed explicit and Railway public URL values", () => {
    expect(() =>
      loadConfig(
        validConfigEnv({
          NODE_ENV: "production",
          PUBLIC_BASE_URL: "https://publisher.example/path",
          RAILWAY_PUBLIC_DOMAIN: "fallback.up.railway.app"
        })
      )
    ).toThrow("PUBLIC_BASE_URL must be a valid HTTP(S) origin");

    expect(() =>
      loadConfig(
        validConfigEnv({
          NODE_ENV: "production",
          RAILWAY_PUBLIC_DOMAIN: "//publisher.up.railway.app"
        })
      )
    ).toThrow("RAILWAY_PUBLIC_DOMAIN must be a valid domain");
  });

  it("derives Shoo settings from the public URL and allowed email", () => {
    expect(loadConfig(validConfigEnv()).shoo).toBeUndefined();

    const config = loadConfig(
      validConfigEnv({
        PUBLIC_BASE_URL: "https://uploads.example",
        SHOO_ALLOWED_EMAIL: " Owner@Example.com "
      })
    );
    expect(config.shoo).toEqual({
      allowedEmail: "owner@example.com",
      audience: "origin:https://uploads.example",
      redirectUri: "https://uploads.example/uploads/callback"
    });
  });

  it("rejects invalid or originless Shoo settings", () => {
    expect(() =>
      loadConfig(validConfigEnv({ SHOO_ALLOWED_EMAIL: "not-an-email" }))
    ).toThrow(
      "SHOO_ALLOWED_EMAIL must be a valid email address"
    );
    expect(() =>
      loadConfig(
        validConfigEnv({
          SHOO_ALLOWED_EMAIL: "owner@example.com"
        })
      )
    ).toThrow(
      "PUBLIC_BASE_URL or RAILWAY_PUBLIC_DOMAIN is required when SHOO_ALLOWED_EMAIL is set"
    );
  });
});
