import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const valid = {
  S3_ENDPOINT: "https://bucket.example.test",
  S3_REGION: "auto",
  S3_BUCKET: "tools",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
  PUBLIC_ORIGIN: "https://tools.example.test",
};

describe("configuration", () => {
  it("loads strict bucket and service settings", () => {
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
      markdownShare: {
        publicOrigin: "https://tools.example.test"
      }
    });
  });

  it("rejects insecure or ambiguous settings", () => {
    expect(() => loadConfig({ ...valid, S3_FORCE_PATH_STYLE: "yes" }))
      .toThrow("S3_FORCE_PATH_STYLE must be either true or false");
    expect(() => loadConfig({ ...valid, PUBLIC_ORIGIN: "https://tools.example.test/ops" }))
      .toThrow("PUBLIC_ORIGIN must be an HTTPS origin");
    expect(() => loadConfig({ ...valid, PUBLIC_ORIGIN: "" }))
      .toThrow("Missing required environment variable: PUBLIC_ORIGIN");

  });
});
