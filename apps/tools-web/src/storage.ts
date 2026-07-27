import {
  AUDIT_SCHEMA_VERSION,
  BUCKET_KEYS,
  auditKey,
  decodeAdminAuditRecord,
  decodeCatalogDocument,
  decodeHistoryPartitionDocument,
  decodePrivateSnapshotDocument,
  decodePublicSnapshotDocument,
  type AdminAuditRecord,
  type CatalogDocument,
  type HistoryPartitionDocument,
  type Incident,
  type PrivateSnapshotDocument,
  type PublicSnapshotDocument
} from "@tools-platform/domain";
import {
  BucketReadError,
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

  async readiness(): Promise<void> {
    try {
      await Promise.all([this.readCatalog(), this.readPublicSnapshot()]);
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
    const audit = createAudit(
      actor,
      "catalog.initialize",
      "catalog",
      null,
      decoded,
      decoded
    );
    await this.writeIntent(audit);
    try {
      await this.#bucket.put(BUCKET_KEYS.catalog, decoded, { ifNoneMatch: "*" });
    } catch (error) {
      await this.cancelIntent(audit.id);
      if (error instanceof BucketConflictError) throw new CatalogConflictError();
      throw error;
    }
    await this.finalizeAudit(audit);
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
    await this.repairPendingAudits();
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
    const audit = createAudit(
      actor,
      action,
      targetType,
      targetId,
      stored.catalog,
      candidate
    );
    await this.writeIntent(audit);
    try {
      await this.#bucket.put(BUCKET_KEYS.catalog, candidate, {
        ifMatch: stored.objectEtag
      });
    } catch (error) {
      await this.cancelIntent(audit.id);
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
    await this.finalizeAudit(audit);
    return candidate;
  }

  async readAuditPage(
    cursor: string | undefined,
    limit: number
  ): Promise<{ items: AdminAuditRecord[]; nextCursor: string | null }> {
    await this.repairPendingAudits();
    const page = await this.#bucket.list("audit/", cursor, limit * 4);
    const keys = page.keys
      .filter((key) => /^audit\/\d{4}\/\d{2}\//.test(key))
      .slice(0, limit);
    const records = await Promise.all(
      keys.map(async (key) =>
        decodeAdminAuditRecord(
          requireObject(await this.#bucket.get(key), "Audit record").body
        )
      )
    );
    return {
      items: records,
      nextCursor: page.nextCursor ?? null
    };
  }

  async readHistoryPage(
    cursor: string | undefined,
    limit: number
  ): Promise<{ items: HistoryPartitionDocument[]; nextCursor: string | null }> {
    const page = await this.#bucket.list("history/", cursor, limit);
    const keys = page.keys.filter((key) =>
      /^history\/\d{4}-\d{2}-\d{2}\.json\.gz$/.test(key)
    );
    const partitions = await Promise.all(
      keys.map(async (key) =>
        decodeHistoryPartitionDocument(
          requireObject(await this.#bucket.get(key), "History partition").body
        )
      )
    );
    return {
      items: partitions,
      nextCursor: page.nextCursor ?? null
    };
  }

  async readIncidentPage(
    cursor: string | undefined,
    limit: number
  ): Promise<{ items: Incident[]; nextCursor: string | null }> {
    const offset = parseOffset(cursor);
    const page = [...(await this.readPrivateSnapshot()).state.incidents]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(offset, offset + limit + 1);
    const hasMore = page.length > limit;
    return {
      items: page.slice(0, limit),
      nextCursor: hasMore ? String(offset + limit) : null
    };
  }

  async repairPendingAudits(): Promise<void> {
    let cursor: string | undefined;
    do {
      const page = await this.#bucket.list("audit/intents/", cursor, 100);
      for (const key of page.keys) {
        const intent = decodeAuditIntent(
          requireObject(await this.#bucket.get(key), "Audit intent").body
        );
        const canonical = auditKey(
          intent.record.occurredAt,
          intent.record.id
        );
        if (await this.#bucket.get(canonical)) continue;
        if (await this.#bucket.get(cancelledAuditKey(intent.record.id))) continue;
        const catalog = await this.readCatalog().catch(() => null);
        if (
          catalog?.catalog.revision !==
          intent.record.catalogRevisionAfter
        ) {
          await this.cancelIntent(intent.record.id);
          continue;
        }
        await this.#bucket.put(canonical, intent.record, {
          ifNoneMatch: "*"
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
  }

  private async writeIntent(record: AdminAuditRecord): Promise<void> {
    const intent: AuditIntent = {
      protocolVersion: 1,
      mutationId: record.id,
      record
    };
    await this.#bucket.put(intentAuditKey(record.id), intent, {
      ifNoneMatch: "*"
    });
  }

  private async cancelIntent(id: string): Promise<void> {
    await this.#bucket
      .put(
        cancelledAuditKey(id),
        { protocolVersion: 1, mutationId: id, cancelled: true },
        { ifNoneMatch: "*" }
      )
      .catch(() => undefined);
  }

  private async finalizeAudit(record: AdminAuditRecord): Promise<void> {
    await this.#bucket
      .put(auditKey(record.occurredAt, record.id), record, {
        ifNoneMatch: "*"
      })
      .catch(() => undefined);
  }
}

interface AuditIntent {
  protocolVersion: 1;
  mutationId: string;
  record: AdminAuditRecord;
}

function createAudit(
  actor: string,
  action: string,
  targetType: AdminAuditRecord["targetType"],
  targetId: string | null,
  before: CatalogDocument,
  after: CatalogDocument
): AdminAuditRecord {
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    actor,
    occurredAt: new Date().toISOString(),
    action,
    targetType,
    targetId,
    catalogRevisionBefore: before.revision,
    catalogRevisionAfter: after.revision
  };
}

function intentAuditKey(id: string): string {
  return `audit/intents/${id}.json`;
}

function cancelledAuditKey(id: string): string {
  return `audit/cancelled/${id}.json`;
}

function decodeAuditIntent(input: unknown): AuditIntent {
  if (
    typeof input !== "object" ||
    input === null ||
    !("protocolVersion" in input) ||
    input.protocolVersion !== 1 ||
    !("mutationId" in input) ||
    typeof input.mutationId !== "string" ||
    !("record" in input)
  ) {
    throw new Error("Invalid audit intent");
  }
  const record = decodeAdminAuditRecord(input.record);
  if (record.id !== input.mutationId) {
    throw new Error("Audit intent mutation ID mismatch");
  }
  return { protocolVersion: 1, mutationId: input.mutationId, record };
}

function parseOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid pagination cursor");
  }
  return value;
}

function requireObject(
  object: BucketObject | null,
  label: string
): BucketObject {
  if (!object) throw new CatalogNotFoundError();
  return object;
}
