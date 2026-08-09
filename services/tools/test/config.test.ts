import { describe, expect, it } from "vitest";
import { loadPlatformAuthConfig } from "../src/config.ts";

const valid = {
  GOOGLE_CLIENT_ID: "google-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  BETTER_AUTH_SECRET: "a".repeat(32),
  AUTH_ALLOWED_GOOGLE_SUBJECT: "108123456789012345678"
};

describe("platform authentication configuration", () => {
  it("loads the Google-only stateless auth contract", () => {
    expect(
      loadPlatformAuthConfig(valid, "https://tools.example.test")
    ).toEqual({
      publicOrigin: "https://tools.example.test",
      googleClientId: valid.GOOGLE_CLIENT_ID,
      googleClientSecret: valid.GOOGLE_CLIENT_SECRET,
      secret: valid.BETTER_AUTH_SECRET,
      allowedGoogleEmail: "maximilian.mauroner@gmail.com",
      allowedGoogleSubject: valid.AUTH_ALLOWED_GOOGLE_SUBJECT
    });
  });

  it.each([
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "BETTER_AUTH_SECRET",
    "AUTH_ALLOWED_GOOGLE_SUBJECT"
  ] as const)("fails closed when %s is missing", (name) => {
    expect(() =>
      loadPlatformAuthConfig({ ...valid, [name]: undefined }, "https://tools.example.test")
    ).toThrow(`Missing required environment variable: ${name}`);
  });

  it("rejects weak secrets and malformed subject identifiers", () => {
    expect(() =>
      loadPlatformAuthConfig(
        { ...valid, BETTER_AUTH_SECRET: "short" },
        "https://tools.example.test"
      )
    ).toThrow("BETTER_AUTH_SECRET must be at least 32 non-whitespace characters");
    expect(() =>
      loadPlatformAuthConfig(
        { ...valid, AUTH_ALLOWED_GOOGLE_SUBJECT: "subject with spaces" },
        "https://tools.example.test"
      )
    ).toThrow("AUTH_ALLOWED_GOOGLE_SUBJECT must be a valid Google subject identifier");
  });
});
