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
    expect(bucket.writes[0]?.key).toBe(BUCKET_KEYS.catalog);
    expect(bucket.writes[0]?.condition).toEqual({ ifMatch: "catalog-etag" });
    const auditWrite = bucket.writes[1];
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

    bucket.conflictNextWrite = true;
    await expect(
      storage.updateCatalog(catalog.revision, "actor", "catalog.reorder", "catalog", null, (value) => value)
    ).rejects.toBeInstanceOf(CatalogConflictError);
    expect(bucket.writes).toHaveLength(0);
  });
});

function seededBucket(): MemoryBucket {
  const bucket = new MemoryBucket();
  bucket.seed(BUCKET_KEYS.catalog, catalog, "catalog-etag");
  bucket.seed(BUCKET_KEYS.publicSnapshot, publicSnapshot, "public-etag");
  bucket.seed(BUCKET_KEYS.privateSnapshot, privateSnapshot, "private-etag");
  return bucket;
}
