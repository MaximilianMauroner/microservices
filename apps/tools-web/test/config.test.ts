import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const valid = {
  S3_ENDPOINT: "https://bucket.example.test",
  S3_REGION: "auto",
  S3_BUCKET: "tools",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
  CF_ACCESS_ISSUER: "https://team.cloudflareaccess.com",
  CF_ACCESS_AUDIENCE: "audience",
  PUBLIC_ORIGIN: "https://tools.example.test"
};

describe("configuration", () => {
  it("loads strict bucket and Access settings", () => {
    expect(loadConfig(valid)).toEqual({
      port: 3000,
      trustedOrigin: "https://tools.example.test",
      bucket: {
        endpoint: "https://bucket.example.test",
        region: "auto",
        name: "tools",
        accessKeyId: "key",
        secretAccessKey: "secret",
        forcePathStyle: false
      },
      access: {
        issuer: "https://team.cloudflareaccess.com",
        audience: "audience",
        jwksUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/certs"
      }
    });
  });

  it("rejects insecure or ambiguous settings", () => {
    expect(() => loadConfig({ ...valid, CF_ACCESS_ISSUER: "http://team.example" }))
      .toThrow("CF_ACCESS_ISSUER must be an HTTPS origin");
    expect(() => loadConfig({ ...valid, CF_ACCESS_ISSUER: "https://login.example.test" }))
      .toThrow("CF_ACCESS_ISSUER must be a Cloudflare Access team domain");
    expect(() => loadConfig({ ...valid, S3_FORCE_PATH_STYLE: "yes" }))
      .toThrow("S3_FORCE_PATH_STYLE must be either true or false");
    expect(() => loadConfig({ ...valid, CF_ACCESS_AUDIENCE: "" }))
      .toThrow("Missing required environment variable: CF_ACCESS_AUDIENCE");
    expect(() => loadConfig({ ...valid, PUBLIC_ORIGIN: "https://tools.example.test/ops" }))
      .toThrow("PUBLIC_ORIGIN must be an HTTPS origin");
    expect(() => loadConfig({ ...valid, PUBLIC_ORIGIN: "" }))
      .toThrow("Missing required environment variable: PUBLIC_ORIGIN");
  });
});
