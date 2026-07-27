import {
  AUDIT_SCHEMA_VERSION,
  BUCKET_KEYS,
  HISTORY_SCHEMA_VERSION,
  decodeAdminAuditRecord,
  type AdminAuditRecord
} from "@tools-platform/domain";
import { describe, expect, it } from "vitest";
import { CatalogConflictError, WebStorage } from "../src/storage.js";
import { catalog, MemoryBucket, privateSnapshot, publicSnapshot } from "./fixtures.js";

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
    expect(bucket.writes[1]?.key).toBe(BUCKET_KEYS.catalog);
    expect(bucket.writes[1]?.condition).toEqual({ ifMatch: "catalog-etag" });
    const auditWrite = bucket.writes[2];
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
    expect(bucket.writes[3]?.key).toMatch(/^audit\/records\//);
    expect(JSON.stringify(auditWrite?.body)).not.toContain("jwt");
    const page = await storage.readAuditPage(undefined, 1);
    expect(page.items.map(({ id }) => id)).toEqual([
      decodeAdminAuditRecord(auditWrite?.body).id
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("maps stale revisions and conditional object failures to catalog conflicts", async () => {
    const bucket = seededBucket();
    const storage = new WebStorage(bucket);
    await expect(
      storage.updateCatalog("stale", "actor", "catalog.reorder", "catalog", null, (value) => value)
    ).rejects.toBeInstanceOf(CatalogConflictError);

    bucket.conflictCatalogWrite = true;
    await expect(
      storage.updateCatalog(catalog.revision, "actor", "catalog.reorder", "catalog", null, (value) => value)
    ).rejects.toBeInstanceOf(CatalogConflictError);
    expect(bucket.writes.some(({ key }) => key.startsWith("audit/intents/"))).toBe(true);
    expect(bucket.writes.some(({ key }) => key.startsWith("audit/cancelled/"))).toBe(true);
  });

  it("returns catalog success with a durable audit obligation and repairs it later", async () => {
    const bucket = seededBucket();
    bucket.failCanonicalAuditWrites = 1;
    const storage = new WebStorage(bucket);

    const updated = await storage.updateCatalog(
      catalog.revision,
      "admin@example.test",
      "entry.archive",
      "entry",
      "artifact-publisher",
      (value) => value
    );
    expect(updated.revision).not.toBe(catalog.revision);
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
      (value) => value
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
        (value) => value
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
    const second = await storage.readAuditPage(first.nextCursor ?? undefined, 1);
    const third = await storage.readAuditPage(second.nextCursor ?? undefined, 1);

    expect(first.items.map(({ id }) => id)).toEqual(["audit-new"]);
    expect(second.items.map(({ id }) => id)).toEqual(["audit-middle"]);
    expect(third.items.map(({ id }) => id)).toEqual(["audit-old"]);
    expect(first.nextCursor).not.toBeNull();
    expect(second.nextCursor).not.toBeNull();
    expect(third.nextCursor).toBeNull();
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
    const second = await storage.readHistoryPage(first.nextCursor ?? undefined, 1);
    const third = await storage.readHistoryPage(second.nextCursor ?? undefined, 1);

    expect(first.items.map(({ day }) => day)).toEqual(["2026-07-27"]);
    expect(second.items.map(({ day }) => day)).toEqual(["2026-07-26"]);
    expect(third.items.map(({ day }) => day)).toEqual(["2026-07-25"]);
    expect(third.nextCursor).toBeNull();
  });

  it("uses the same durable audit protocol for catalog initialization", async () => {
    const bucket = new MemoryBucket();
    bucket.failCanonicalAuditWrites = 1;
    const storage = new WebStorage(bucket);

    await expect(
      storage.initializeCatalog(catalog, "admin@example.test")
    ).resolves.toEqual(catalog);
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
  catalogRevisionAfter = catalog.revision
): AdminAuditRecord {
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    id,
    actor: "admin@example.test",
    occurredAt,
    action: "entry.archive",
    targetType: "entry",
    targetId: "artifact-publisher",
    catalogRevisionBefore: "revision-before",
    catalogRevisionAfter
  };
}

function seededBucket(): MemoryBucket {
  const bucket = new MemoryBucket();
  bucket.seed(BUCKET_KEYS.catalog, catalog, "catalog-etag");
  bucket.seed(BUCKET_KEYS.publicSnapshot, publicSnapshot, "public-etag");
  bucket.seed(BUCKET_KEYS.privateSnapshot, privateSnapshot, "private-etag");
  return bucket;
}
