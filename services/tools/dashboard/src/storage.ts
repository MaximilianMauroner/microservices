import {
  BUCKET_KEYS,
  decodePrivateSnapshotDocument,
  decodePublicSnapshotDocument,
  type PrivateSnapshotDocument,
  type PublicSnapshotDocument
} from "@tools-platform/domain";
import {
  BucketReadError,
  type BucketObject,
  type JsonBucket
} from "./bucket.js";

export class WebStorage {
  readonly #bucket: JsonBucket;

  constructor(bucket: JsonBucket) {
    this.#bucket = bucket;
  }

  async readiness(): Promise<void> {
    try {
      await Promise.all([
        this.readPublicSnapshot(),
        this.readPrivateSnapshot()
      ]);
    } catch {
      throw new BucketReadError("Required bucket objects are not ready");
    }
  }

  async readPublicSnapshot(): Promise<PublicSnapshotDocument> {
    return decodePublicSnapshotDocument(
      requireObject(
        await this.#bucket.get(BUCKET_KEYS.publicSnapshot),
        "Public snapshot"
      ).body
    );
  }

  async readPrivateSnapshot(): Promise<PrivateSnapshotDocument> {
    return decodePrivateSnapshotDocument(
      requireObject(
        await this.#bucket.get(BUCKET_KEYS.privateSnapshot),
        "Private snapshot"
      ).body
    );
  }
}

function requireObject(
  object: BucketObject | null,
  label: string
): BucketObject {
  if (!object) throw new BucketReadError(`${label} is not available`);
  return object;
}
