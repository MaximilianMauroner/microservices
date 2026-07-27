import { BUCKET_KEYS } from "@tools-platform/domain";
import { describe, expect, it } from "vitest";
import { createApp, type AppLogger } from "../src/app.js";
import { AccessDeniedError, type AccessVerifier } from "../src/auth.js";
import { WebStorage } from "../src/storage.js";
import { catalog, MemoryBucket, privateSnapshot, publicSnapshot } from "./fixtures.js";

const allowed: AccessVerifier = {
  async verify() {
    return { id: "admin@example.test" };
  }
};

const denied: AccessVerifier = {
  async verify() {
    throw new AccessDeniedError();
  }
};

describe("tools web routes", () => {
  it("does no bucket work until a request and checks bucket readability on health", async () => {
    const bucket = seededBucket();
    const app = createApp({ storage: new WebStorage(bucket), access: denied, logger: quiet });
    expect(bucket.reads).toBe(0);

    const response = await app(new Request("https://tools.example.test/health"));
    expect(response.status).toBe(200);
    expect(bucket.reads).toBe(1);
  });

  it("serves only the prepared public projection from public routes", async () => {
    const bucket = seededBucket();
    const app = createApp({ storage: new WebStorage(bucket), access: denied, logger: quiet });
    for (const path of ["/", "/api/public/catalog"]) {
      const response = await app(new Request(`https://tools.example.test${path}`));
      const text = await response.text();
      expect(response.status).toBe(200);
      if (path === "/") {
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(response.headers.get("content-security-policy")).toContain(
          "default-src 'none'"
        );
      }
      expect(text).toContain("Artifact Publisher");
      expect(text).not.toContain("secret operator note");
      expect(text).not.toContain("/private");
      expect(text).not.toContain("operations");
    }
  });

  it("serves CSP-safe static assets and renders protected operations state", async () => {
    const bucket = seededBucket();
    const app = createApp({ storage: new WebStorage(bucket), access: allowed, logger: quiet });
    const css = await app(new Request("https://tools.example.test/assets/tools.css"));
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");

    const ops = await app(new Request("https://tools.example.test/ops/catalog"));
    const html = await ops.text();
    expect(ops.status).toBe(200);
    expect(ops.headers.get("content-security-policy")).toContain(
      "script-src 'self'"
    );
    expect(html).toContain("Tools operations");
    expect(html).toContain(`data-revision="${catalog.revision}"`);
    expect(html).not.toContain("notification-secret");
  });

  it("requires independently verified Access assertions for all ops routes", async () => {
    const bucket = seededBucket();
    const app = createApp({ storage: new WebStorage(bucket), access: denied, logger: quiet });
    for (const path of ["/ops", "/ops/anything", "/api/ops/catalog"]) {
      const response = await app(new Request(`https://tools.example.test${path}`));
      expect(response.status).toBe(401);
    }
  });

  it("supports conditional archive/pause/resume/delete CRUD with audit writes", async () => {
    const bucket = seededBucket();
    const app = createApp({ storage: new WebStorage(bucket), access: allowed, logger: quiet });
    const archived = await app(
      mutationRequest("/api/ops/entries/artifact-publisher/archive", catalog.revision)
    );
    expect(archived.status).toBe(200);
    const archivedBody = await archived.json();
    const archivedRevision = readRevision(archivedBody);
    expect(JSON.stringify(bucket.objects.get(BUCKET_KEYS.catalog)?.body))
      .toContain('"lifecycle":"archived"');

    const paused = await app(
      mutationRequest("/api/ops/entries/artifact-publisher/pause", archivedRevision)
    );
    expect(paused.status).toBe(200);
    const pausedBody = await paused.json();
    const pausedRevision = readRevision(pausedBody);
    expect(JSON.stringify(bucket.objects.get(BUCKET_KEYS.catalog)?.body))
      .toContain('"paused":true');

    const resumed = await app(
      mutationRequest("/api/ops/entries/artifact-publisher/resume", pausedRevision)
    );
    expect(resumed.status).toBe(200);
    await resumed.json();
    expect(JSON.stringify(bucket.objects.get(BUCKET_KEYS.catalog)?.body))
      .toContain('"paused":false');
    expect(bucket.writes.filter(({ key }) => key.startsWith("audit/"))).toHaveLength(3);
    expect(bucket.writes.every(({ key }) =>
      key === BUCKET_KEYS.catalog || key.startsWith("audit/")
    )).toBe(true);
  });

  it("creates, replaces, reorders, and deletes catalog resources", async () => {
    const bucket = seededBucket();
    const app = createApp({ storage: new WebStorage(bucket), access: allowed, logger: quiet });
    let revision = catalog.revision;

    const createdGroup = await app(
      jsonMutation("POST", "/api/ops/groups", revision, {
        id: "experiments",
        name: "Experiments",
        order: 2,
        visibility: "private"
      })
    );
    expect(createdGroup.status).toBe(200);
    revision = readRevision(await createdGroup.json());

    const updatedGroup = await app(
      jsonMutation("PUT", "/api/ops/groups/experiments", revision, {
        id: "experiments",
        name: "Lab",
        description: "In progress",
        order: 2,
        visibility: "private"
      })
    );
    expect(updatedGroup.status).toBe(200);
    revision = readRevision(await updatedGroup.json());

    const reordered = await app(
      jsonMutation("PUT", "/api/ops/order", revision, {
        groupIds: ["experiments", "operations", "public-tools"],
        entryIdsByGroup: {
          experiments: [],
          operations: [],
          "public-tools": ["artifact-publisher"]
        }
      })
    );
    expect(reordered.status).toBe(200);
    const reorderedBody = await reordered.json();
    revision = readRevision(reorderedBody);
    expect(JSON.stringify(bucket.objects.get(BUCKET_KEYS.catalog)?.body))
      .toContain('"id":"experiments","name":"Lab"');

    const deletedGroup = await app(
      jsonMutation("DELETE", "/api/ops/groups/experiments", revision)
    );
    expect(deletedGroup.status).toBe(200);
    revision = readRevision(await deletedGroup.json());

    const deletedEntry = await app(
      jsonMutation("DELETE", "/api/ops/entries/artifact-publisher", revision)
    );
    expect(deletedEntry.status).toBe(200);
    await deletedEntry.json();
    expect(JSON.stringify(bucket.objects.get(BUCKET_KEYS.catalog)?.body))
      .not.toContain("artifact-publisher");
    expect(bucket.writes.filter(({ key }) => key.startsWith("audit/"))).toHaveLength(5);
  });

  it("returns 409 for stale revision writes and does not leak request data to logs", async () => {
    const bucket = seededBucket();
    const logged: Array<Readonly<Record<string, string | number>>> = [];
    const logger: AppLogger = {
      info(_event, fields) {
        logged.push(fields);
      },
      error(_event, fields) {
        logged.push(fields);
      }
    };
    const app = createApp({ storage: new WebStorage(bucket), access: allowed, logger });
    const response = await app(
      new Request("https://tools.example.test/api/ops/groups", {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": "very-secret-token",
          "If-Match": '"stale"',
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id: "private-secret",
          name: "Sensitive internal name",
          order: 3,
          visibility: "private"
        })
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "revision_conflict",
      revision: catalog.revision,
      message: "The catalog changed. Reload and review the latest revision."
    });
    const serializedLogs = JSON.stringify(logged);
    expect(serializedLogs).not.toContain("very-secret-token");
    expect(serializedLogs).not.toContain("Sensitive internal name");
    expect(serializedLogs).not.toContain("private-secret");
  });

  it("validates replacement bodies and provides ETags for UI concurrency", async () => {
    const bucket = seededBucket();
    const app = createApp({ storage: new WebStorage(bucket), access: allowed, logger: quiet });
    const read = await app(new Request("https://tools.example.test/api/ops/catalog"));
    expect(read.headers.get("etag")).toBe(`"${catalog.revision}"`);

    const invalid = await app(
      new Request("https://tools.example.test/api/ops/entries/artifact-publisher", {
        method: "PUT",
        headers: {
          "If-Match": `"${catalog.revision}"`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: "different-id" })
      })
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "invalid_request",
      message: "Entry ID cannot change"
    });
  });
});

function mutationRequest(path: string, revision: string): Request {
  return new Request(`https://tools.example.test${path}`, {
    method: "POST",
    headers: { "If-Match": `"${revision}"` },
    body: "{}"
  });
}

function jsonMutation(
  method: string,
  path: string,
  revision: string,
  body?: unknown
): Request {
  return new Request(`https://tools.example.test${path}`, {
    method,
    headers: {
      "If-Match": `"${revision}"`,
      "Content-Type": "application/json"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function readRevision(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("revision" in value) ||
    typeof value.revision !== "string"
  ) {
    throw new Error("Response omitted revision");
  }
  return value.revision;
}

function seededBucket(): MemoryBucket {
  const bucket = new MemoryBucket();
  bucket.seed(BUCKET_KEYS.catalog, catalog, "catalog-etag");
  bucket.seed(BUCKET_KEYS.publicSnapshot, publicSnapshot, "public-etag");
  bucket.seed(BUCKET_KEYS.privateSnapshot, privateSnapshot, "private-etag");
  return bucket;
}

const quiet: AppLogger = {
  info() {},
  error() {}
};
