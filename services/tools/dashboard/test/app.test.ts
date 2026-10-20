import { BUCKET_KEYS } from "@tools-platform/domain";
import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationRequiredError,
  createApp,
  type AppLogger,
  type PrincipalAuthenticator
} from "../src/app.js";
import {
  MarkdownAdminUnavailableError,
  type MarkdownAdminReader
} from "../src/markdown-admin.js";
import { WebStorage } from "../src/storage.js";
import { MemoryBucket, privateSnapshot, publicSnapshot } from "./fixtures.js";

const allowed: PrincipalAuthenticator = async () => {
  return { id: "admin@example.test" };
};

const denied: PrincipalAuthenticator = async () => {
  throw new AuthenticationRequiredError();
};

const markdownAdmin: MarkdownAdminReader = {
  async list() {
    return {
      generatedAt: Date.UTC(2026, 6, 29, 9),
      truncated: false,
      documents: [
        {
          token: "j57dzxnpat8g9sbksewde1dznh8bczet",
          filename: "private-notes.md",
          createdAt: Date.UTC(2026, 6, 28, 9),
          updatedAt: Date.UTC(2026, 6, 29, 8),
          expiresAt: Date.UTC(2026, 7, 5, 8),
          checkpointCount: 2
        }
      ]
    };
  }
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

  it("serves CSP-safe static assets", async () => {
    const bucket = seededBucket();
    const app = testApp(bucket, allowed);
    const css = await app(new Request("https://tools.example.test/assets/tools.css"));
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");

    const suiteCss = await app(
      new Request("https://tools.example.test/assets/suite.css")
    );
    expect(suiteCss.status).toBe(200);
    expect(await suiteCss.text()).toContain("--background: #000");

    const localTime = await app(
      new Request("https://tools.example.test/assets/local-time.js")
    );
    expect(localTime.status).toBe(200);
    expect(localTime.headers.get("content-type")).toContain("text/javascript");

    for (const product of ["publisher", "money", "status", "markdown-share", "network-console", "tools"]) {
      const icon = await app(
        new Request(`https://tools.example.test/assets/icons/${product}.png`)
      );
      expect(icon.status).toBe(200);
      expect(icon.headers.get("content-type")).toBe("image/png");
    }
  });

  it("requires a verified session for private reads", async () => {
    const bucket = seededBucket();
    const app = testApp(bucket, denied);
    for (const path of [
      "/api/ops/snapshot",
      "/api/ops/documents"
    ]) {
      const response = await app(new Request(`https://tools.example.test${path}`));
      expect(response.status).toBe(401);
    }
  });

  it("serves document metadata through the private inventory API", async () => {
    const response = await testApp(seededBucket(), allowed)(
      new Request("https://tools.example.test/api/ops/documents")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      ...await markdownAdmin.list(),
      publicOrigin: "https://markdown.example.test"
    });
  });

  it("fails closed when the private Markdown inventory is unavailable", async () => {
    const bucket = seededBucket();
    const unavailable: MarkdownAdminReader = {
      async list() {
        throw new MarkdownAdminUnavailableError();
      }
    };
    const app = testApp(bucket, allowed, quiet, unavailable);
    const response = await app(
      new Request("https://tools.example.test/api/ops/documents")
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "markdown_admin_unavailable"
    });
  });

  it("passes document pagination cursors only through the authenticated admin route", async () => {
    const list = vi.fn(async (cursor?: string, asOf?: number) => ({ generatedAt: asOf ?? 1_000, documents: [], truncated: Boolean(cursor), ...(cursor ? { nextCursor: "next-page" } : {}) }));
    const app = testApp(seededBucket(), allowed, quiet, { list });
    const response = await app(new Request("https://tools.example.test/api/ops/documents?cursor=previous-page&asOf=1000"));
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith("previous-page", 1_000);
    expect(await response.json()).toMatchObject({ nextCursor: "next-page" });
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
  logger: AppLogger = quiet,
  markdownReader: MarkdownAdminReader = markdownAdmin
) {
  return createApp({
    storage: new WebStorage(bucket),
    authenticate,
    markdownAdmin: markdownReader,
    markdownSharePublicOrigin: "https://markdown.example.test",
    trustedOrigin: "https://tools.example.test",
    logger
  });
}
