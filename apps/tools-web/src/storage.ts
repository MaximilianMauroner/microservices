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
      await Promise.all([
        this.readCatalog(),
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
      if (error instanceof BucketConflictError) {
        await this.cancelIntent(audit.id);
        throw new CatalogConflictError();
      }
      const committed = await this.catalogHasRevision(decoded.revision);
      if (committed) {
        await this.finalizeAudit(audit);
        return decoded;
      }
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
      if (error instanceof BucketConflictError) {
        await this.cancelIntent(audit.id);
        let currentRevision: string | undefined;
        try {
          currentRevision = (await this.readCatalog()).catalog.revision;
        } catch {
          // A conflict remains actionable even if the follow-up read fails.
        }
        throw new CatalogConflictError(currentRevision);
      }
      const committed = await this.catalogHasRevision(candidate.revision);
      if (committed) {
        await this.finalizeAudit(audit);
        return candidate;
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
    const position = decodeAuditCursor(cursor);
    if (position.source === "legacy") {
      return this.readLegacyAuditPage(position.offset, limit);
    }

    const indexed = await this.#bucket.list(
      AUDIT_INDEX_PREFIX,
      position.token,
      limit
    );
    const items = await this.readAuditRecords(indexed.keys);
    if (indexed.nextCursor) {
      return {
        items,
        nextCursor: encodeAuditCursor({
          source: "index",
          token: indexed.nextCursor
        })
      };
    }

    const legacy = await this.legacyAuditRecords();
    const remaining = limit - items.length;
    const appended = legacy.slice(0, remaining);
    const consumed = appended.length;
    return {
      items: [...items, ...appended],
      nextCursor:
        consumed < legacy.length
          ? encodeAuditCursor({ source: "legacy", offset: consumed })
          : null
    };
  }

  async readHistoryPage(
    cursor: string | undefined,
    limit: number
  ): Promise<{ items: HistoryPartitionDocument[]; nextCursor: string | null }> {
    const offset = decodeOffsetCursor(cursor);
    const keys = (await this.listAllKeys("history/"))
      .filter((key) => /^history\/\d{4}-\d{2}-\d{2}\.json\.gz$/.test(key))
      .sort((left, right) => right.localeCompare(left));
    const selected = keys.slice(offset, offset + limit);
    const partitions = await Promise.all(
      selected.map(async (key) =>
        decodeHistoryPartitionDocument(
          requireObject(await this.#bucket.get(key), "History partition").body
        )
      )
    );
    return {
      items: partitions,
      nextCursor:
        offset + selected.length < keys.length
          ? encodeOffsetCursor(offset + selected.length)
          : null
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
        if (await this.#bucket.get(canonical)) {
          await this.ensureAuditIndex(intent.record);
          continue;
        }
        if (await this.#bucket.get(cancelledAuditKey(intent.record.id))) continue;
        const catalog = await this.readCatalog().catch(() => null);
        if (
          catalog?.catalog.revision ===
          intent.record.catalogRevisionAfter
        ) {
          await this.finalizeAudit(intent.record);
        }
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
    try {
      await this.#bucket.put(auditKey(record.occurredAt, record.id), record, {
        ifNoneMatch: "*"
      });
    } catch (error) {
      if (!(error instanceof BucketConflictError)) return;
    }
    await this.ensureAuditIndex(record);
  }

  private async ensureAuditIndex(record: AdminAuditRecord): Promise<void> {
    await this.#bucket
      .put(auditIndexKey(record), record, { ifNoneMatch: "*" })
      .catch(() => undefined);
  }

  private async catalogHasRevision(revision: string): Promise<boolean> {
    return (
      (await this.readCatalog().catch(() => null))?.catalog.revision === revision
    );
  }

  private async readAuditRecords(keys: string[]): Promise<AdminAuditRecord[]> {
    return Promise.all(
      keys.map(async (key) =>
        decodeAdminAuditRecord(
          requireObject(await this.#bucket.get(key), "Audit record").body
        )
      )
    );
  }

  private async readLegacyAuditPage(
    offset: number,
    limit: number
  ): Promise<{ items: AdminAuditRecord[]; nextCursor: string | null }> {
    const records = await this.legacyAuditRecords();
    const items = records.slice(offset, offset + limit);
    return {
      items,
      nextCursor:
        offset + items.length < records.length
          ? encodeAuditCursor({
              source: "legacy",
              offset: offset + items.length
            })
          : null
    };
  }

  private async legacyAuditRecords(): Promise<AdminAuditRecord[]> {
    const keys = (await this.listAllKeys("audit/")).filter((key) =>
      /^audit\/\d{4}\/\d{2}\//.test(key)
    );
    const records = await this.readAuditRecords(keys);
    const legacy = await Promise.all(
      records.map(async (record) => ({
        record,
        indexed: (await this.#bucket.get(auditIndexKey(record))) !== null
      }))
    );
    return legacy
      .filter(({ indexed }) => !indexed)
      .map(({ record }) => record)
      .sort(
        (left, right) =>
          right.occurredAt.localeCompare(left.occurredAt) ||
          right.id.localeCompare(left.id)
      );
  }

  private async listAllKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.#bucket.list(prefix, cursor, 100);
      keys.push(...page.keys);
      cursor = page.nextCursor;
    } while (cursor);
    return keys;
  }
}

interface AuditIntent {
  protocolVersion: 1;
  mutationId: string;
  record: AdminAuditRecord;
}

const AUDIT_INDEX_PREFIX = "audit/records/";

type AuditCursor =
  | { source: "index"; token?: string }
  | { source: "legacy"; offset: number };

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

function auditIndexKey(record: AdminAuditRecord): string {
  const timestamp = Date.parse(record.occurredAt);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error("Audit timestamp cannot be indexed");
  }
  const reverseTimestamp = String(Number.MAX_SAFE_INTEGER - timestamp).padStart(
    16,
    "0"
  );
  return `${AUDIT_INDEX_PREFIX}${reverseTimestamp}-${record.id}.json`;
}

function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(
    JSON.stringify({ version: 1, ...cursor }),
    "utf8"
  ).toString("base64url");
}

function decodeAuditCursor(cursor: string | undefined): AuditCursor {
  if (cursor === undefined) return { source: "index" };
  const value = decodeCursorObject(cursor);
  if (value.version !== 1 || typeof value.source !== "string") {
    throw new Error("Invalid audit pagination cursor");
  }
  if (value.source === "index") {
    if (value.token !== undefined && typeof value.token !== "string") {
      throw new Error("Invalid audit pagination cursor");
    }
    return value.token === undefined
      ? { source: "index" }
      : { source: "index", token: value.token };
  }
  if (
    value.source === "legacy" &&
    typeof value.offset === "number" &&
    Number.isSafeInteger(value.offset) &&
    value.offset >= 0
  ) {
    return { source: "legacy", offset: value.offset };
  }
  throw new Error("Invalid audit pagination cursor");
}

function encodeOffsetCursor(offset: number): string {
  return Buffer.from(
    JSON.stringify({ version: 1, offset }),
    "utf8"
  ).toString("base64url");
}

function decodeOffsetCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const value = decodeCursorObject(cursor);
  if (
    value.version !== 1 ||
    typeof value.offset !== "number" ||
    !Number.isSafeInteger(value.offset) ||
    value.offset < 0
  ) {
    throw new Error("Invalid pagination cursor");
  }
  return value.offset;
}

function decodeCursorObject(cursor: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    );
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Invalid pagination cursor");
    }
    return Object.fromEntries(Object.entries(value));
  } catch {
    throw new Error("Invalid pagination cursor");
  }
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
