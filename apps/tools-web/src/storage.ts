import {
  AUDIT_SCHEMA_VERSION,
  BUCKET_KEYS,
  auditKey,
  decodeCatalogDocument,
  decodePrivateSnapshotDocument,
  decodePublicSnapshotDocument,
  type AdminAuditRecord,
  type CatalogDocument,
  type PrivateSnapshotDocument,
  type PublicSnapshotDocument
} from "@tools-platform/domain";
import {
  BucketConflictError,
  type BucketObject,
  type JsonBucket
} from "./bucket.js";

export interface StoredCatalog {
  catalog: CatalogDocument;
  objectEtag: string;
}

export class CatalogNotFoundError extends Error {
  constructor() {
    super("Catalog has not been initialized");
    this.name = "CatalogNotFoundError";
  }
}

export class CatalogConflictError extends Error {
  constructor(public readonly currentRevision?: string) {
    super("Catalog revision conflict");
    this.name = "CatalogConflictError";
  }
}

export class WebStorage {
  readonly #bucket: JsonBucket;

  constructor(bucket: JsonBucket) {
    this.#bucket = bucket;
  }

  async liveness(): Promise<void> {
    await this.#bucket.get(BUCKET_KEYS.publicSnapshot);
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

  async readCatalog(): Promise<StoredCatalog> {
    const object = await this.#bucket.get(BUCKET_KEYS.catalog);
    if (!object) throw new CatalogNotFoundError();
    return {
      catalog: decodeCatalogDocument(object.body),
      objectEtag: object.etag
    };
  }

  async initializeCatalog(
    catalog: CatalogDocument,
    actor: string
  ): Promise<CatalogDocument> {
    const decoded = decodeCatalogDocument(catalog);
    try {
      await this.#bucket.put(BUCKET_KEYS.catalog, decoded, { ifNoneMatch: "*" });
    } catch (error) {
      if (error instanceof BucketConflictError) throw new CatalogConflictError();
      throw error;
    }
    await this.writeAudit(actor, "catalog.initialize", "catalog", null, decoded, decoded);
    return decoded;
  }

  async updateCatalog(
    expectedRevision: string,
    actor: string,
    action: string,
    targetType: AdminAuditRecord["targetType"],
    targetId: string | null,
    mutate: (catalog: CatalogDocument) => CatalogDocument
  ): Promise<CatalogDocument> {
    const stored = await this.readCatalog();
    if (stored.catalog.revision !== expectedRevision) {
      throw new CatalogConflictError(stored.catalog.revision);
    }
    const now = new Date().toISOString();
    const candidate = decodeCatalogDocument({
      ...mutate(structuredClone(stored.catalog)),
      schemaVersion: stored.catalog.schemaVersion,
      revision: crypto.randomUUID(),
      updatedAt: now
    });
    try {
      await this.#bucket.put(BUCKET_KEYS.catalog, candidate, {
        ifMatch: stored.objectEtag
      });
    } catch (error) {
      if (error instanceof BucketConflictError) {
        let currentRevision: string | undefined;
        try {
          currentRevision = (await this.readCatalog()).catalog.revision;
        } catch {
          // A conflict remains actionable even if the follow-up read fails.
        }
        throw new CatalogConflictError(currentRevision);
      }
      throw error;
    }
    await this.writeAudit(
      actor,
      action,
      targetType,
      targetId,
      stored.catalog,
      candidate
    );
    return candidate;
  }

  private async writeAudit(
    actor: string,
    action: string,
    targetType: AdminAuditRecord["targetType"],
    targetId: string | null,
    before: CatalogDocument,
    after: CatalogDocument
  ): Promise<void> {
    const occurredAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const record: AdminAuditRecord = {
      schemaVersion: AUDIT_SCHEMA_VERSION,
      id,
      actor,
      occurredAt,
      action,
      targetType,
      targetId,
      catalogRevisionBefore: before.revision,
      catalogRevisionAfter: after.revision
    };
    await this.#bucket.put(auditKey(occurredAt, id), record, {
      ifNoneMatch: "*"
    });
  }
}

function requireObject(
  object: BucketObject | null,
  label: string
): BucketObject {
  if (!object) throw new CatalogNotFoundError();
  return object;
}
