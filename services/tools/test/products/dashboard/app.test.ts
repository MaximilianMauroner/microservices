import { BUCKET_KEYS } from "#domain";
import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationRequiredError,
  createApp,
  type AppLogger,
  type PrincipalAuthenticator
} from "../../../products/dashboard/src/app.js";
import { WebStorage } from "../../../products/dashboard/src/storage.js";
import { MemoryBucket, privateSnapshot, publicSnapshot } from "./fixtures.js";

const allowed: PrincipalAuthenticator = async () => {
  return { id: "admin@example.test" };
};

const denied: PrincipalAuthenticator = async () => {
  throw new AuthenticationRequiredError();
};

describe("tools web routes", () => {
  it("does no bucket work until a request and checks bucket readability on health", async () => {
    const bucket = seededBucket();
    const app = testApp(bucket, denied);
    expect(bucket.reads).toBe(0);

    const response = await app(new Request("https://tools.example.test/health"));
    expect(response.status).toBe(200);
    expect(bucket.reads).toBe(2);
  });

  it("separates process liveness from required-object readiness", async () => {
    const empty = new MemoryBucket();
    const app = testApp(empty, denied);
    const live = await app(new Request("https://tools.example.test/live"));
    expect(live.status).toBe(200);
    expect(empty.reads).toBe(0);
    expect(
      (await app(new Request("https://tools.example.test/health"))).status
    ).toBe(503);

    empty.seed(BUCKET_KEYS.publicSnapshot, { schemaVersion: 999 });
    expect(
      (await app(new Request("https://tools.example.test/health"))).status
    ).toBe(503);

    empty.seed(BUCKET_KEYS.publicSnapshot, publicSnapshot);
    empty.seed(BUCKET_KEYS.privateSnapshot, { schemaVersion: 999 });
    expect(
      (await app(new Request("https://tools.example.test/health"))).status
    ).toBe(503);
  });

  it("serves only the prepared public projection from public routes", async () => {
    const bucket = seededBucket();
    const app = testApp(bucket, denied);
    for (const path of ["/", "/status", "/api/public/catalog"]) {
      const response = await app(new Request(`https://tools.example.test${path}`));
      const text = await response.text();
      expect(response.status).toBe(200);
      if (path === "/" || path === "/status") {
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(response.headers.get("content-security-policy")).toContain(
          "default-src 'none'"
        );
      }
      expect(text).toContain("Artifact Publisher");
      expect(text).not.toContain("secret operator note");
      expect(text).not.toContain("uploads.example.test/private");
      expect(text).not.toContain('id="group-operations"');
    }
  });

  it("serves the suite stylesheet", async () => {
    const app = testApp(seededBucket(), allowed);
    const suiteCss = await app(
      new Request("https://tools.example.test/assets/suite.css")
    );
    expect(suiteCss.status).toBe(200);
    expect(await suiteCss.text()).toContain("--background: #000");
  });

  it("serves the private Status snapshot only after session authentication", async () => {
    const bucket = seededBucket();
    const deniedResponse = await testApp(bucket, denied)(
      new Request("https://tools.example.test/api/ops/snapshot")
    );
    expect(deniedResponse.status).toBe(401);
    expect(bucket.reads).toBe(0);

    const response = await testApp(bucket, allowed)(
      new Request("https://tools.example.test/api/ops/snapshot")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(privateSnapshot);
  });

  it("does not serve the removed operations pages, APIs, or script", async () => {
    const bucket = seededBucket();
    const app = testApp(bucket, allowed);
    for (const path of [
      "/ops",
      "/ops/catalog",
      "/manage",
      "/manage/catalog",
      "/manage/status",
      "/status/private",
      "/manage/documents",
      "/api/ops/catalog",
      "/api/ops/documents",
      "/api/ops/audit",
      "/api/ops/history",
      "/api/ops/incidents",
      "/assets/ops.js",
      "/assets/markdown-admin.js"
    ]) {
      const response = await app(new Request(`https://tools.example.test${path}`));
      expect(response.status).toBe(404);
    }
    expect(bucket.reads).toBe(0);
  });

  it("does not accept catalog or monitor mutations", async () => {
    const bucket = seededBucket();
    const app = testApp(bucket, allowed);
    for (const [method, path] of [
      ["PUT", "/api/ops/catalog"],
      ["POST", "/api/ops/groups"],
      ["PATCH", "/api/ops/entries/artifact-publisher"],
      ["DELETE", "/api/ops/entries/artifact-publisher"],
      ["POST", "/api/ops/entries/artifact-publisher/monitor/pause"]
    ]) {
      const response = await app(new Request(`https://tools.example.test${path}`, {
        method,
        headers: {
          Origin: "https://tools.example.test",
          "Content-Type": "application/json",
          "If-Match": '"revision_1"',
          "If-None-Match": "*"
        },
        body: "{}"
      }));
      expect(response.status).toBe(404);
    }
    expect(bucket.reads).toBe(0);
    expect(bucket.objects.size).toBe(2);
  });

  it("does not expose storage errors or private data in responses and logs", async () => {
    const bucket = seededBucket();
    const secret = "private-storage-credential";
    bucket.get = async () => { throw new Error(secret); };
    const logger = { info: vi.fn(), error: vi.fn() };
    const response = await testApp(bucket, allowed, logger)(
      new Request("https://tools.example.test/api/ops/snapshot")
    );
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe('{"error":"internal_error"}');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secret);
  });
});

function seededBucket(): MemoryBucket {
  const bucket = new MemoryBucket();
  bucket.seed(BUCKET_KEYS.publicSnapshot, publicSnapshot);
  bucket.seed(BUCKET_KEYS.privateSnapshot, privateSnapshot);
  return bucket;
}

const quiet: AppLogger = {
  info() {},
  error() {}
};

function testApp(
  bucket: MemoryBucket,
  authenticate: PrincipalAuthenticator,
  logger: AppLogger = quiet
) {
  return createApp({
    storage: new WebStorage(bucket),
    authenticate,
    trustedOrigin: "https://tools.example.test",
    logger
  });
}
