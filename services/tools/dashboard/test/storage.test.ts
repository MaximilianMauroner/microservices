import {
  AUDIT_SCHEMA_VERSION,
  BUCKET_KEYS,
  HISTORY_SCHEMA_VERSION,
  decodeAdminAuditRecord,
  decodeCatalogDocument,
  type AdminAuditRecord,
  type Incident
} from "@tools-platform/domain";
import { describe, expect, it } from "vitest";
import { CatalogConflictError, WebStorage } from "../src/storage.js";
import { catalog, MemoryBucket, privateSnapshot, publicSnapshot } from "./fixtures.js";

function harmlessChange(value: typeof catalog): typeof catalog {
  return {
    ...value,
    groups: value.groups.map((group, index) => index === 0
      ? { ...group, description: `${group.description ?? ""} updated` }
      : group)
  };
}

describe("web storage ownership and concurrency", () => {
  it("reads prepared projections without exposing generic bucket access", async () => {
    const bucket = seededBucket();
    const storage = new WebStorage(bucket);

    await expect(storage.readPublicSnapshot()).resolves.toEqual(publicSnapshot);
    await expect(storage.readPrivateSnapshot()).resolves.toEqual(privateSnapshot);
    expect(Object.keys(storage)).toEqual([]);
    expect("writeState" in storage).toBe(false);
    expect("writeSnapshot" in storage).toBe(false);
    expect("writeHistory" in storage).toBe(false);
  });

  it("conditionally writes catalog and one immutable, sanitized audit record", async () => {
    const bucket = seededBucket();
    const storage = new WebStorage(bucket);
    const updated = await storage.updateCatalog(
      catalog.revision,
      "admin@example.test",
      "entry.archive",
      "entry",
      "artifact-publisher",
      (current) => ({
        ...current,
        entries: current.entries.map((entry) => ({
          ...entry,
          lifecycle: "archived"
        }))
      })
    );

    expect(updated.revision).not.toBe(catalog.revision);
    expect(bucket.writes[0]?.key).toMatch(/^audit\/intents\//);
    expect(bucket.writes[0]?.condition).toEqual({ ifNoneMatch: "*" });
    expect(bucket.writes[1]?.key).toMatch(/^audit\/revisions\//);
    expect(bucket.writes[2]?.key).toBe(BUCKET_KEYS.catalog);
    expect(bucket.writes[2]?.condition).toEqual({ ifMatch: "catalog-etag" });
    const auditWrite = bucket.writes[3];
    expect(auditWrite?.key).toMatch(/^audit\/\d{4}\/\d{2}\//);
    expect(auditWrite?.condition).toEqual({ ifNoneMatch: "*" });
    expect(decodeAdminAuditRecord(auditWrite?.body)).toMatchObject({
      actor: "admin@example.test",
      action: "entry.archive",
      targetType: "entry",
      targetId: "artifact-publisher",
      catalogRevisionBefore: catalog.revision,
      catalogRevisionAfter: updated.revision
    });
    expect(bucket.writes[4]?.key).toMatch(/^audit\/records\//);
    expect(JSON.stringify(auditWrite?.body)).not.toContain("jwt");
    const page = await storage.readAuditPage(undefined, 1);
    expect(page.items.map(({ id }) => id)).toEqual([
      decodeAdminAuditRecord(auditWrite?.body).id
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("does not create a catalog revision or audit for a structural no-op", async () => {
    const bucket = seededBucket();
    const storage = new WebStorage(bucket);
    const unchanged = await storage.updateCatalog(
      catalog.revision,
      "admin@example.test",
      "group.reorder",
      "group",
      catalog.groups[0]?.id ?? null,
      (current) => current
    );

    expect(unchanged.revision).toBe(catalog.revision);
    expect(bucket.writes).toEqual([]);
  });

  it("maps stale revisions and conditional object failures to catalog conflicts", async () => {
    const bucket = seededBucket();
    const storage = new WebStorage(bucket);
    await expect(
      storage.updateCatalog("stale", "actor", "catalog.reorder", "catalog", null, (value) => value)
    ).rejects.toBeInstanceOf(CatalogConflictError);

    bucket.conflictCatalogWrite = true;
    await expect(
      storage.updateCatalog(catalog.revision, "actor", "catalog.reorder", "catalog", null, harmlessChange)
    ).rejects.toBeInstanceOf(CatalogConflictError);
    expect(bucket.writes.some(({ key }) => key.startsWith("audit/intents/"))).toBe(true);
    expect(bucket.writes.some(({ key }) => key.startsWith("audit/cancelled/"))).toBe(true);
  });

  it("fails the response until a committed revision audit can be repaired", async () => {
    const bucket = seededBucket();
    bucket.failCanonicalAuditWrites = 1;
    const storage = new WebStorage(bucket);

    await expect(
      storage.updateCatalog(
        catalog.revision,
        "admin@example.test",
        "entry.archive",
        "entry",
        "artifact-publisher",
        harmlessChange
      )
    ).rejects.toThrow("simulated audit write failure");
    const committed = decodeCatalogFromBucket(bucket);
    expect(committed.revision).not.toBe(catalog.revision);
    expect(
      [...bucket.objects.keys()].some((key) => key.startsWith("audit/revisions/"))
    ).toBe(true);
    expect(
      [...bucket.objects.keys()].some((key) => key.startsWith("audit/intents/"))
    ).toBe(true);
    expect(
      [...bucket.objects.keys()].some((key) => /^audit\/\d{4}\/\d{2}\//.test(key))
    ).toBe(false);

    await storage.repairPendingAudits();
    expect(
      [...bucket.objects.keys()].some((key) => /^audit\/\d{4}\/\d{2}\//.test(key))
    ).toBe(true);
    expect(
      [...bucket.objects.keys()].some((key) => key.startsWith("audit/records/"))
    ).toBe(true);
  });

  it("blocks B after an early repair until A is canonical and indexed", async () => {
    const bucket = seededBucket();
    const storage = new WebStorage(bucket);
    const revisionA = "revision-a";
    const catalogA = {
      ...catalog,
      revision: revisionA,
      updatedAt: "2026-07-27T00:01:00.000Z"
    };
    const auditA = auditRecord(
      "audit-a",
      "2026-07-27T00:01:00.000Z",
      revisionA,
      catalog.revision
    );
    const intentA = { protocolVersion: 1, mutationId: auditA.id, record: auditA };
    bucket.beforeNextCatalogRead = () => {
      bucket.seed(BUCKET_KEYS.catalog, catalogA, "catalog-a-etag");
      bucket.seed("audit/intents/audit-a.json", intentA, "intent-a-etag");
      bucket.seed(revisionKey(revisionA), intentA, "revision-a-etag");
    };
    bucket.failCanonicalAuditWrites = 2;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        storage.updateCatalog(
          revisionA,
          "admin@example.test",
          "entry.archive",
          "entry",
          "artifact-publisher",
          harmlessChange
        )
      ).rejects.toThrow("simulated audit write failure");
      expect(decodeCatalogFromBucket(bucket).revision).toBe(revisionA);
    }

    const revisionB = await storage.updateCatalog(
      revisionA,
      "admin@example.test",
      "entry.archive",
      "entry",
      "artifact-publisher",
      harmlessChange
    );
    expect(revisionB.revision).not.toBe(revisionA);
    expect(
      [...bucket.objects.keys()].filter((key) =>
        /^audit\/\d{4}\/\d{2}\//.test(key)
      )
    ).toHaveLength(2);
    expect(
      [...bucket.objects.keys()].filter((key) =>
        key.startsWith("audit/records/")
      )
    ).toHaveLength(2);
    expect(
      [...bucket.objects.keys()].some((key) =>
        key.startsWith("audit/intents/") && key !== "audit/intents/audit-a.json"
      )
    ).toBe(true);
  });

  it("treats a committed catalog write with a lost response as success", async () => {
    const bucket = seededBucket();
    bucket.commitCatalogThenFail = true;
    const storage = new WebStorage(bucket);

    const updated = await storage.updateCatalog(
      catalog.revision,
      "admin@example.test",
      "entry.archive",
      "entry",
      "artifact-publisher",
      harmlessChange
    );

    expect(updated.revision).not.toBe(catalog.revision);
    expect(
      [...bucket.objects.keys()].some((key) => /^audit\/\d{4}\/\d{2}\//.test(key))
    ).toBe(true);
    expect(
      [...bucket.objects.keys()].some((key) => key.startsWith("audit/records/"))
    ).toBe(true);
    expect(
      [...bucket.objects.keys()].some((key) => key.startsWith("audit/cancelled/"))
    ).toBe(false);
  });

  it("leaves an inconclusive failed catalog write pending", async () => {
    const bucket = seededBucket();
    bucket.failCatalogWrite = true;
    const storage = new WebStorage(bucket);

    await expect(
      storage.updateCatalog(
        catalog.revision,
        "admin@example.test",
        "entry.archive",
        "entry",
        "artifact-publisher",
        harmlessChange
      )
    ).rejects.toThrow("simulated ambiguous catalog write failure");

    expect(
      [...bucket.objects.keys()].some((key) => key.startsWith("audit/intents/"))
    ).toBe(true);
    expect(
      [...bucket.objects.keys()].some((key) => key.startsWith("audit/cancelled/"))
    ).toBe(false);
  });

  it("leaves a non-current in-flight audit intent pending for its owner", async () => {
    const bucket = seededBucket();
    const pending = auditRecord(
      "pending-mutation",
      "2026-07-27T00:01:00.000Z",
      "future-catalog-revision"
    );
    bucket.seed(
      "audit/intents/pending-mutation.json",
      { protocolVersion: 1, mutationId: pending.id, record: pending },
      "pending-etag"
    );
    const storage = new WebStorage(bucket);

    await storage.repairPendingAudits();

    expect(bucket.objects.has("audit/intents/pending-mutation.json")).toBe(true);
    expect(
      [...bucket.objects.keys()].some((key) => key.startsWith("audit/cancelled/"))
    ).toBe(false);
    expect(
      [...bucket.objects.keys()].some((key) => /^audit\/\d{4}\/\d{2}\//.test(key))
    ).toBe(false);
  });

  it("paginates legacy canonical audits newest-first without mixed-key loss", async () => {
    const bucket = seededBucket();
    const records = [
      auditRecord("audit-old", "2026-07-25T00:00:00.000Z"),
      auditRecord("audit-new", "2026-07-27T00:00:00.000Z"),
      auditRecord("audit-middle", "2026-07-26T00:00:00.000Z")
    ];
    for (const record of records) {
      const year = record.occurredAt.slice(0, 4);
      const month = record.occurredAt.slice(5, 7);
      bucket.seed(
        `audit/${year}/${month}/${record.occurredAt}-${record.id}.json`,
        record,
        `${record.id}-etag`
      );
    }
    const cancelled = auditRecord(
      "cancelled-noise",
      "2026-07-28T00:00:00.000Z",
      "never-committed"
    );
    bucket.seed(
      "audit/intents/cancelled-noise.json",
      { protocolVersion: 1, mutationId: cancelled.id, record: cancelled },
      "intent-etag"
    );
    bucket.seed(
      "audit/cancelled/cancelled-noise.json",
      { protocolVersion: 1, mutationId: cancelled.id, cancelled: true },
      "cancelled-etag"
    );
    const storage = new WebStorage(bucket);

    const first = await storage.readAuditPage(undefined, 1);
    const insertedNewer = auditRecord(
      "audit-inserted-newer",
      "2026-07-28T00:00:00.000Z"
    );
    seedCanonicalAudit(bucket, insertedNewer);
    bucket.seed(auditIndexKeyForTest(insertedNewer), insertedNewer, "new-index");
    const repairedBetweenPages = auditRecord(
      "audit-repaired-between",
      "2026-07-26T12:00:00.000Z",
      "legacy-revision"
    );
    seedCanonicalAudit(bucket, repairedBetweenPages);
    bucket.seed(
      "audit/intents/audit-repaired-between.json",
      {
        protocolVersion: 1,
        mutationId: repairedBetweenPages.id,
        record: repairedBetweenPages
      },
      "legacy-intent"
    );
    const second = await storage.readAuditPage(first.nextCursor ?? undefined, 1);
    const third = await storage.readAuditPage(second.nextCursor ?? undefined, 1);
    const fourth = await storage.readAuditPage(third.nextCursor ?? undefined, 1);

    expect(first.items.map(({ id }) => id)).toEqual(["audit-new"]);
    expect(second.items.map(({ id }) => id)).toEqual([
      "audit-repaired-between"
    ]);
    expect(third.items.map(({ id }) => id)).toEqual(["audit-middle"]);
    expect(fourth.items.map(({ id }) => id)).toEqual(["audit-old"]);
    expect(first.nextCursor).not.toBeNull();
    expect(second.nextCursor).not.toBeNull();
    expect(third.nextCursor).not.toBeNull();
    expect(fourth.nextCursor).toBeNull();
  });

  it("paginates bounded history partitions newest-first", async () => {
    const bucket = seededBucket();
    for (const day of ["2026-07-25", "2026-07-27", "2026-07-26"]) {
      bucket.seed(
        `history/${day}.json.gz`,
        {
          schemaVersion: HISTORY_SCHEMA_VERSION,
          day,
          updatedAt: `${day}T00:00:00.000Z`,
          observations: [],
          incidents: []
        },
        `${day}-etag`
      );
    }
    const storage = new WebStorage(bucket);

    const first = await storage.readHistoryPage(undefined, 1);
    bucket.seed(
      "history/2026-07-28.json.gz",
      {
        schemaVersion: HISTORY_SCHEMA_VERSION,
        day: "2026-07-28",
        updatedAt: "2026-07-28T00:00:00.000Z",
        observations: [],
        incidents: []
      },
      "2026-07-28-etag"
    );
    const second = await storage.readHistoryPage(first.nextCursor ?? undefined, 1);
    const third = await storage.readHistoryPage(second.nextCursor ?? undefined, 1);

    expect(first.items.map(({ day }) => day)).toEqual(["2026-07-27"]);
    expect(second.items.map(({ day }) => day)).toEqual(["2026-07-26"]);
    expect(third.items.map(({ day }) => day)).toEqual(["2026-07-25"]);
    expect(third.nextCursor).toBeNull();
  });

  it("paginates incidents by immutable startedAt and ID boundaries", async () => {
    const bucket = seededBucket();
    seedIncidents(bucket, [
      incident("incident-old", "2026-07-25T00:00:00.000Z"),
      incident("incident-new", "2026-07-27T00:00:00.000Z"),
      incident("incident-middle", "2026-07-26T00:00:00.000Z")
    ]);
    const storage = new WebStorage(bucket);

    const first = await storage.readIncidentPage(undefined, 1);
    seedIncidents(bucket, [
      incident("incident-inserted", "2026-07-28T00:00:00.000Z"),
      incident("incident-old", "2026-07-25T00:00:00.000Z"),
      incident("incident-new", "2026-07-27T00:00:00.000Z"),
      incident("incident-middle", "2026-07-26T00:00:00.000Z")
    ]);
    const second = await storage.readIncidentPage(
      first.nextCursor ?? undefined,
      1
    );
    const third = await storage.readIncidentPage(
      second.nextCursor ?? undefined,
      1
    );

    expect(first.items.map(({ id }) => id)).toEqual(["incident-new"]);
    expect(second.items.map(({ id }) => id)).toEqual(["incident-middle"]);
    expect(third.items.map(({ id }) => id)).toEqual(["incident-old"]);
    expect(third.nextCursor).toBeNull();
  });

  it("uses the same durable audit protocol for catalog initialization", async () => {
    const bucket = new MemoryBucket();
    bucket.failCanonicalAuditWrites = 1;
    const storage = new WebStorage(bucket);

    await expect(
      storage.initializeCatalog(catalog, "admin@example.test")
    ).rejects.toThrow("simulated audit write failure");
    expect(bucket.objects.has(BUCKET_KEYS.catalog)).toBe(true);
    expect(
      [...bucket.objects.keys()].some((key) => key.startsWith("audit/intents/"))
    ).toBe(true);
    await storage.repairPendingAudits();
    expect(
      [...bucket.objects.keys()].some((key) => /^audit\/\d{4}\/\d{2}\//.test(key))
    ).toBe(true);
  });
});

function auditRecord(
  id: string,
  occurredAt: string,
  catalogRevisionAfter = catalog.revision,
  catalogRevisionBefore = "revision-before"
): AdminAuditRecord {
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    id,
    actor: "admin@example.test",
    occurredAt,
    action: "entry.archive",
    targetType: "entry",
    targetId: "artifact-publisher",
    catalogRevisionBefore,
    catalogRevisionAfter
  };
}

function revisionKey(revision: string): string {
  return `audit/revisions/${Buffer.from(revision, "utf8").toString("base64url")}.json`;
}

function auditIndexKeyForTest(record: AdminAuditRecord): string {
  const reverseTimestamp = String(
    Number.MAX_SAFE_INTEGER - Date.parse(record.occurredAt)
  ).padStart(16, "0");
  return `audit/records/${reverseTimestamp}-${record.id}.json`;
}

function seedCanonicalAudit(
  bucket: MemoryBucket,
  record: AdminAuditRecord
): void {
  const year = record.occurredAt.slice(0, 4);
  const month = record.occurredAt.slice(5, 7);
  bucket.seed(
    `audit/${year}/${month}/${record.occurredAt}-${record.id}.json`,
    record,
    `${record.id}-canonical-etag`
  );
}

function decodeCatalogFromBucket(bucket: MemoryBucket) {
  return decodeCatalogDocument(bucket.objects.get(BUCKET_KEYS.catalog)?.body);
}

function incident(id: string, startedAt: string): Incident {
  return {
    id,
    monitorId: "artifact-publisher",
    startedAt,
    openingObservationId: `${id}-open`,
    resolvedAt: null,
    closingObservationId: null
  };
}

function seedIncidents(bucket: MemoryBucket, incidents: Incident[]): void {
  bucket.seed(
    BUCKET_KEYS.privateSnapshot,
    {
      ...privateSnapshot,
      state: { ...privateSnapshot.state, incidents }
    },
    `private-${incidents.length}`
  );
}

function seededBucket(): MemoryBucket {
  const bucket = new MemoryBucket();
  bucket.seed(BUCKET_KEYS.catalog, catalog, "catalog-etag");
  bucket.seed(BUCKET_KEYS.publicSnapshot, publicSnapshot, "public-etag");
  bucket.seed(BUCKET_KEYS.privateSnapshot, privateSnapshot, "private-etag");
  return bucket;
}
