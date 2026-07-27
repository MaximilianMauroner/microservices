import { BUCKET_KEYS, decodeAdminAuditRecord } from "@tools-platform/domain";
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
    expect(JSON.stringify(auditWrite?.body)).not.toContain("jwt");
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

function seededBucket(): MemoryBucket {
  const bucket = new MemoryBucket();
  bucket.seed(BUCKET_KEYS.catalog, catalog, "catalog-etag");
  bucket.seed(BUCKET_KEYS.publicSnapshot, publicSnapshot, "public-etag");
  bucket.seed(BUCKET_KEYS.privateSnapshot, privateSnapshot, "private-etag");
  return bucket;
}
