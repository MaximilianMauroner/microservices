import { BUCKET_KEYS } from "@tools-platform/domain";
import { describe, expect, it } from "vitest";
import { BucketReadError } from "../src/bucket.js";
import { WebStorage } from "../src/storage.js";
import { MemoryBucket, privateSnapshot, publicSnapshot } from "./fixtures.js";

describe("dashboard snapshot reads", () => {
  it("reads the prepared public and private projections", async () => {
    const bucket = seededBucket();
    const storage = new WebStorage(bucket);

    await expect(storage.readPublicSnapshot()).resolves.toEqual(publicSnapshot);
    await expect(storage.readPrivateSnapshot()).resolves.toEqual(privateSnapshot);
  });

  it("is ready with valid snapshots and no stored catalog", async () => {
    const bucket = seededBucket();
    await expect(new WebStorage(bucket).readiness()).resolves.toBeUndefined();
  });

  it.each([BUCKET_KEYS.publicSnapshot, BUCKET_KEYS.privateSnapshot])(
    "fails readiness when %s is missing or invalid",
    async (key) => {
      const bucket = seededBucket();
      const storage = new WebStorage(bucket);
      bucket.objects.delete(key);
      await expect(storage.readiness()).rejects.toBeInstanceOf(BucketReadError);

      bucket.seed(key, { schemaVersion: 999 });
      await expect(storage.readiness()).rejects.toBeInstanceOf(BucketReadError);
    }
  );

  it("fails closed when a requested snapshot is missing", async () => {
    const storage = new WebStorage(new MemoryBucket());
    await expect(storage.readPublicSnapshot()).rejects.toBeInstanceOf(BucketReadError);
    await expect(storage.readPrivateSnapshot()).rejects.toBeInstanceOf(BucketReadError);
  });
});

function seededBucket(): MemoryBucket {
  const bucket = new MemoryBucket();
  bucket.seed(BUCKET_KEYS.publicSnapshot, publicSnapshot);
  bucket.seed(BUCKET_KEYS.privateSnapshot, privateSnapshot);
  return bucket;
}
