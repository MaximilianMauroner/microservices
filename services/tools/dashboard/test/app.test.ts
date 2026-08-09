import {
  AUDIT_SCHEMA_VERSION,
  BUCKET_KEYS,
  HISTORY_SCHEMA_VERSION
} from "@tools-platform/domain";
import { describe, expect, it } from "vitest";
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
import { catalog, MemoryBucket, privateSnapshot, publicSnapshot } from "./fixtures.js";

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
    expect(bucket.reads).toBe(3);
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

    empty.seed(BUCKET_KEYS.catalog, catalog, "catalog");
    empty.seed(BUCKET_KEYS.publicSnapshot, { schemaVersion: 999 }, "snapshot");
    expect(
      (await app(new Request("https://tools.example.test/health"))).status
    ).toBe(503);

    empty.seed(BUCKET_KEYS.publicSnapshot, publicSnapshot, "public");
    empty.seed(BUCKET_KEYS.privateSnapshot, { schemaVersion: 999 }, "private");
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

  it("serves private status only after Access authentication", async () => {
    const bucket = seededBucket();
    const unauthenticated = await testApp(bucket, denied)(
      new Request("https://tools.example.test/manage/status")
    );
    expect(unauthenticated.status).toBe(401);

    const authenticated = await testApp(bucket, allowed)(
      new Request("https://tools.example.test/manage/status")
    );
    const html = await authenticated.text();
    expect(authenticated.status).toBe(200);
    expect(authenticated.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain("Private services");
    expect(html).toContain("admin@example.test");
    expect(html).not.toContain("secret operator note");
  });

  it("serves CSP-safe static assets and renders protected operations state", async () => {
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

    const icon = await app(
      new Request("https://tools.example.test/assets/icons/artifact-publisher.png")
    );
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/png");

    const moneyIcon = await app(
      new Request("https://tools.example.test/assets/icons/money-tracker.png")
    );
    expect(moneyIcon.status).toBe(200);
    expect(moneyIcon.headers.get("content-type")).toBe("image/png");

    const ops = await app(new Request("https://tools.example.test/ops/catalog"));
    const html = await ops.text();
    expect(ops.status).toBe(200);
    expect(ops.headers.get("content-security-policy")).toContain(
      "script-src 'self'"
    );
    expect(html).toContain('<h1 id="ops-title">Catalog</h1>');
    expect(html).toContain(`data-revision="${catalog.revision}"`);
    expect(html).not.toContain("notification-secret");

    const manage = await app(
      new Request("https://tools.example.test/manage/catalog")
    );
    expect(manage.status).toBe(200);
    expect(await manage.text()).toContain('aria-current="page">Manage');

    const admin = await app(
      new Request("https://tools.example.test/manage/documents")
    );
    const adminHtml = await admin.text();
    expect(admin.status).toBe(200);
    expect(admin.headers.get("cache-control")).toBe("private, no-store");
    expect(adminHtml).toContain("Markdown documents");
    expect(adminHtml).toContain("private-notes.md");
    expect(adminHtml).toContain(
      "https://markdown.example.test/d/private-notes.md--j57dzxnpat8g9sbksewde1dznh8bczet"
    );
    expect(adminHtml).not.toContain("document body");
  });

  it("requires independently verified Access assertions for all ops routes", async () => {
    const bucket = seededBucket();
    const app = testApp(bucket, denied);
    for (const path of [
      "/manage",
      "/manage/anything",
      "/manage/documents",
      "/ops",
      "/ops/anything",
      "/manage/status",
      "/status/private",
      "/api/ops/catalog"
    ]) {
      const response = await app(new Request(`https://tools.example.test${path}`));
      expect(response.status).toBe(401);
    }
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
      new Request("https://tools.example.test/manage/documents")
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "markdown_admin_unavailable"
    });
  });

  it("enforces exact-origin JSON CSRF boundaries after authentication", async () => {
    const bucket = seededBucket();
    let verifications = 0;
    const authenticate: PrincipalAuthenticator = async () => {
      verifications += 1;
      return { id: "admin@example.test" };
    };
    const app = testApp(bucket, authenticate);
    const request = (headers: HeadersInit) =>
      app(
        new Request("https://tools.example.test/api/ops/groups", {
          method: "POST",
          headers: {
            "If-Match": `"${catalog.revision}"`,
            ...headers
          },
          body: "{}"
        })
      );

    expect(
      (await request({
        Origin: "https://evil.example",
        "Content-Type": "application/json"
      })).status
    ).toBe(403);
    expect(
      (await request({ "Content-Type": "application/json" })).status
    ).toBe(403);
    expect(
      (await request({
        Origin: "https://tools.example.test",
        "Content-Type": "text/plain"
      })).status
    ).toBe(400);
    const missingContentType = await app(
      new Request("https://tools.example.test/api/ops/groups", {
        method: "POST",
        headers: {
          "If-Match": `"${catalog.revision}"`,
          Origin: "https://tools.example.test"
        },
        body: new Uint8Array()
      })
    );
    expect(missingContentType.status).toBe(400);
    expect(verifications).toBe(4);
    expect(bucket.writes).toHaveLength(0);
  });

  it("serves protected paginated audit, history, and incident data only", async () => {
    const bucket = seededBucket();
    bucket.seed(
      "audit/2026/07/2026-07-27T00:00:00.000Z-audit-1.json",
      {
        schemaVersion: AUDIT_SCHEMA_VERSION,
        id: "audit-1",
        actor: "admin@example.test",
        occurredAt: "2026-07-27T00:00:00.000Z",
        action: "entry.archive",
        targetType: "entry",
        targetId: "artifact-publisher",
        catalogRevisionBefore: "revision_0",
        catalogRevisionAfter: catalog.revision
      },
      "audit-etag"
    );
    bucket.seed(
      "history/2026-07-27.json.gz",
      {
        schemaVersion: HISTORY_SCHEMA_VERSION,
        day: "2026-07-27",
        updatedAt: "2026-07-27T00:00:00.000Z",
        observations: [
          {
            id: "observation-1",
            runId: "run-1",
            monitorId: "artifact-publisher",
            checkedAt: "2026-07-27T00:00:00.000Z",
            success: true,
            statusCode: 200,
            latencyMs: 20,
            errorCode: null
          }
        ],
        incidents: []
      },
      "history-etag"
    );
    bucket.seed(
      BUCKET_KEYS.privateSnapshot,
      {
        ...privateSnapshot,
        state: {
          ...privateSnapshot.state,
          incidents: [
            {
              id: "incident-1",
              monitorId: "artifact-publisher",
              startedAt: "2026-07-27T00:00:00.000Z",
              openingObservationId: "observation-1",
              resolvedAt: null,
              closingObservationId: null
            }
          ]
        }
      },
      "private-with-incident"
    );
    const app = testApp(bucket, allowed);

    const audit = await app(
      new Request("https://tools.example.test/api/ops/audit?limit=1")
    );
    expect(audit.status).toBe(200);
    expect(await audit.json()).toMatchObject({
      items: [{ id: "audit-1" }],
      nextCursor: null
    });
    const history = await app(
      new Request("https://tools.example.test/api/ops/history?limit=1")
    );
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({
      items: [{
        day: "2026-07-27",
        observations: [{ monitorId: "artifact-publisher" }]
      }],
      nextCursor: null
    });
    const incidents = await app(
      new Request("https://tools.example.test/api/ops/incidents?limit=1")
    );
    expect(incidents.status).toBe(200);
    expect(await incidents.json()).toMatchObject({
      items: [{ id: "incident-1" }],
      nextCursor: null
    });
    expect(
      (await app(
        new Request("https://tools.example.test/api/public/history")
      )).status
    ).toBe(404);
  });

  it("supports conditional archive/pause/resume/delete CRUD with audit writes", async () => {
    const bucket = seededBucket();
    const app = testApp(bucket, allowed);
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
    expect(bucket.writes.filter(({ key }) =>
      /^audit\/\d{4}\/\d{2}\//.test(key)
    )).toHaveLength(3);
    expect(bucket.writes.every(({ key }) =>
      key === BUCKET_KEYS.catalog || key.startsWith("audit/")
    )).toBe(true);
  });

  it("reports incomplete audit finalization and repairs it on audit read", async () => {
    const bucket = seededBucket();
    bucket.failCanonicalAuditWrites = 1;
    const app = testApp(bucket, allowed);

    const mutation = await app(
      mutationRequest(
        "/api/ops/entries/artifact-publisher/archive",
        catalog.revision
      )
    );
    expect(mutation.status).toBe(500);
    const audit = await app(
      new Request("https://tools.example.test/api/ops/audit?limit=10")
    );
    expect(audit.status).toBe(200);
    expect(JSON.stringify(await audit.json())).toContain("entry.archive");
    expect(
      [...bucket.objects.keys()].some((key) => /^audit\/\d{4}\/\d{2}\//.test(key))
    ).toBe(true);
  });

  it("creates, replaces, reorders, and deletes catalog resources", async () => {
    const bucket = seededBucket();
    const app = testApp(bucket, allowed);
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
    expect(bucket.writes.filter(({ key }) =>
      /^audit\/\d{4}\/\d{2}\//.test(key)
    )).toHaveLength(5);
  });

  it("returns an unchanged response for a boundary reorder without writing", async () => {
    const bucket = seededBucket();
    const app = testApp(bucket, allowed);
    const writesBefore = bucket.writes.length;
    const response = await app(jsonMutation(
      "POST",
      "/api/ops/groups/public-tools/reorder",
      catalog.revision,
      { direction: "up" }
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      revision: catalog.revision,
      reload: false,
      changed: false
    });
    const lastResponse = await app(jsonMutation(
      "POST",
      "/api/ops/groups/operations/reorder",
      catalog.revision,
      { direction: "down" }
    ));
    expect(await lastResponse.json()).toEqual({
      revision: catalog.revision,
      reload: false,
      changed: false
    });
    expect(bucket.writes).toHaveLength(writesBefore);
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
    const app = testApp(bucket, allowed, logger);
    const response = await app(
      new Request("https://tools.example.test/api/ops/groups", {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": "very-secret-token",
          "If-Match": '"stale"',
          "Content-Type": "application/json",
          Origin: "https://tools.example.test"
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
    const app = testApp(bucket, allowed);
    const read = await app(new Request("https://tools.example.test/api/ops/catalog"));
    expect(read.headers.get("etag")).toBe(`"${catalog.revision}"`);

    const invalid = await app(
      new Request("https://tools.example.test/api/ops/entries/artifact-publisher", {
        method: "PUT",
        headers: {
          "If-Match": `"${catalog.revision}"`,
          "Content-Type": "application/json",
          Origin: "https://tools.example.test"
        },
        body: JSON.stringify({ id: "different-id" })
      })
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "invalid_request",
      message: "Entry ID cannot change"
    });

    const invalidScope = await app(
      jsonMutation(
        "PATCH",
        "/api/ops/entries/artifact-publisher",
        catalog.revision,
        { monitor: { url: "https://example.test/health", scope: "internal" } }
      )
    );
    expect(invalidScope.status).toBe(400);
    expect(await invalidScope.json()).toEqual({
      error: "invalid_request",
      message: "monitor.scope must be public or tailscale"
    });
  });

  it("rejects blocked literal monitor targets on create, replace, and patch", async () => {
    const bucket = seededBucket();
    const app = testApp(bucket, allowed);
    const existing = catalog.entries[0];
    if (!existing) throw new Error("Catalog fixture requires an entry");
    const blockedMonitor = {
      enabled: true,
      paused: false,
      scope: "public",
      url: "http://127.0.0.1/health"
    };
    const requests = [
      jsonMutation("POST", "/api/ops/entries", catalog.revision, {
        id: "blocked-service",
        groupId: "public-tools",
        name: "Blocked service",
        description: "Must not be persisted.",
        visibility: "public",
        monitor: blockedMonitor
      }),
      jsonMutation(
        "PUT",
        "/api/ops/entries/artifact-publisher",
        catalog.revision,
        { ...existing, monitor: blockedMonitor }
      ),
      jsonMutation(
        "PATCH",
        "/api/ops/entries/artifact-publisher",
        catalog.revision,
        { monitor: blockedMonitor }
      )
    ];

    for (const request of requests) {
      const response = await app(request);
      expect(response.status).toBe(400);
    }
    expect(bucket.writes).toHaveLength(0);
  });
});

function mutationRequest(path: string, revision: string): Request {
  return new Request(`https://tools.example.test${path}`, {
    method: "POST",
    headers: {
      "If-Match": `"${revision}"`,
      "Content-Type": "application/json",
      Origin: "https://tools.example.test"
    },
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
      "Content-Type": "application/json",
      Origin: "https://tools.example.test"
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
