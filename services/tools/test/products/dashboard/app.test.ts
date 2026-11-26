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
  it("serves the public catalog and checks snapshot readiness for page HEAD requests", async () => {
    const app = testApp(seededBucket(), denied);
    const catalog = await app(new Request("https://tools.example.test/api/public/catalog"));
    expect(catalog.status).toBe(200);
    expect(catalog.headers.get("cache-control")).toContain("public, max-age=60");
    await expect(catalog.json()).resolves.toEqual(publicSnapshot);

    const unavailable = testApp(new MemoryBucket(), denied);
    for (const path of ["/", "/status"]) {
      const head = new Request(`https://tools.example.test${path}`, { method: "HEAD" });
      const response = await app(head);
      expect(response.status).toBe(200);
      expect(response.body).toBeNull();
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("cache-control")).toBe("public, max-age=60");
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect((await unavailable(head)).status).toBe(503);
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
    logger
  });
}
