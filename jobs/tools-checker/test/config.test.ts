import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const required = {
  TOOLS_ENVIRONMENT: "preview",
  S3_BUCKET: "tools-preview",
  S3_ENDPOINT: "https://bucket.example/",
  S3_REGION: "auto",
  S3_ACCESS_KEY_ID: "access",
  S3_SECRET_ACCESS_KEY: "secret"
};

describe("checker config", () => {
  it("loads strict defaults and preserves the complete webhook URL", () => {
    expect(
      loadConfig({
        ...required,
        DISCORD_WEBHOOK_URL: "https://discord.example/webhook/secret/"
      })
    ).toMatchObject({
      environment: "preview",
      concurrency: 6,
      probeTimeoutMs: 10_000,
      runDeadlineMs: 240_000,
      notificationAttemptLimit: 8,
      discordWebhookUrl: "https://discord.example/webhook/secret/"
    });
  });

  it("fails clearly for missing or invalid configuration", () => {
    expect(() => loadConfig({})).toThrow(
      "Missing required environment variable: TOOLS_ENVIRONMENT"
    );
    expect(() =>
      loadConfig({ ...required, CHECK_CONCURRENCY: "0" })
    ).toThrow(/CHECK_CONCURRENCY/);
    expect(() =>
      loadConfig({ ...required, S3_FORCE_PATH_STYLE: "yes" })
    ).toThrow(/true or false/);
    expect(() =>
      loadConfig({ ...required, DISCORD_WEBHOOK_URL: "file:///secret" })
    ).toThrow(/credential-free HTTP/);
  });
});
