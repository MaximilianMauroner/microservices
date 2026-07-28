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
    const mutated = decodeCatalogDocument(mutate(structuredClone(stored.catalog)));
    if (JSON.stringify(mutated) === JSON.stringify(stored.catalog)) {
      return stored.catalog;
    }
    await this.ensureRevisionAudit(stored.catalog.revision);
    const now = new Date().toISOString();
    const candidate = decodeCatalogDocument({
      ...mutated,
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
    await this.ensureAuditIndexMigration();
    const position = decodeKeyCursor(cursor, "audit");
    const keys = await this.#bucket.listAfter(
      AUDIT_INDEX_PREFIX,
      position.after,
      limit + 1
    );
    const selected = keys.slice(0, limit);
    const lastSelected = selected.at(-1);
    return {
      items: await this.readAuditRecords(selected),
      nextCursor:
        keys.length > limit && lastSelected
          ? encodeKeyCursor("audit", lastSelected)
          : null
    };
  }

  async readHistoryPage(
    cursor: string | undefined,
    limit: number
  ): Promise<{ items: HistoryPartitionDocument[]; nextCursor: string | null }> {
    const position = decodeKeyCursor(cursor, "history");
    const keys = (await this.listAllKeys("history/"))
      .filter((key) => /^history\/\d{4}-\d{2}-\d{2}\.json\.gz$/.test(key))
      .sort((left, right) => right.localeCompare(left))
      .filter((key) => position.after === undefined || key < position.after);
    const selected = keys.slice(0, limit);
    const lastSelected = selected.at(-1);
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
        selected.length < keys.length && lastSelected
          ? encodeKeyCursor("history", lastSelected)
          : null
    };
  }

  async readIncidentPage(
    cursor: string | undefined,
    limit: number
  ): Promise<{ items: Incident[]; nextCursor: string | null }> {
    const position = decodeIncidentCursor(cursor);
    const page = [...(await this.readPrivateSnapshot()).state.incidents]
      .sort(compareIncidentsNewestFirst)
      .filter(
        (incident) =>
          position === null || isIncidentOlderThan(incident, position)
      )
      .slice(0, limit + 1);
    const hasMore = page.length > limit;
    const items = page.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeIncidentCursor({
              startedAt: last.startedAt,
              id: last.id
            })
          : null
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
        if (await this.#bucket.get(cancelledAuditKey(intent.record.id))) continue;
        if (await this.#bucket.get(canonical)) {
          await this.ensureAuditIndex(intent.record);
          await this.ensureImmutableObject(
            revisionAuditKey(intent.record.catalogRevisionAfter),
            intent,
            decodeAuditIntent,
            sameAuditIntent
          );
          continue;
        }
        const catalog = await this.readCatalog().catch(() => null);
        if (
          catalog?.catalog.revision ===
          intent.record.catalogRevisionAfter
        ) {
          await this.finalizeAudit(intent.record);
          await this.ensureImmutableObject(
            revisionAuditKey(intent.record.catalogRevisionAfter),
            intent,
            decodeAuditIntent,
            sameAuditIntent
          );
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
    await this.ensureImmutableObject(
      intentAuditKey(record.id),
      intent,
      decodeAuditIntent,
      sameAuditIntent
    );
    try {
      await this.ensureImmutableObject(
        revisionAuditKey(record.catalogRevisionAfter),
        intent,
        decodeAuditIntent,
        sameAuditIntent
      );
    } catch (error) {
      await this.cancelIntent(record.id);
      throw error;
    }
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
    await this.ensureImmutableObject(
      auditKey(record.occurredAt, record.id),
      record,
      decodeAdminAuditRecord,
      sameAuditRecord
    );
    await this.ensureAuditIndex(record);
  }

  private async ensureAuditIndex(record: AdminAuditRecord): Promise<void> {
    await this.ensureImmutableObject(
      auditIndexKey(record),
      record,
      decodeAdminAuditRecord,
      sameAuditRecord
    );
  }

  private async ensureRevisionAudit(revision: string): Promise<void> {
    const linked = await this.#bucket.get(revisionAuditKey(revision));
    if (linked) {
      const intent = decodeAuditIntent(linked.body);
      if (intent.record.catalogRevisionAfter !== revision) {
        throw new Error("Revision audit obligation mismatch");
      }
      if (await this.#bucket.get(cancelledAuditKey(intent.record.id))) {
        throw new Error("Committed catalog revision has a cancelled audit");
      }
      await this.finalizeAudit(intent.record);
      return;
    }

    const legacy = await this.findIntentForRevision(revision);
    if (legacy) {
      await this.finalizeAudit(legacy.record);
      await this.ensureImmutableObject(
        revisionAuditKey(revision),
        legacy,
        decodeAuditIntent,
        sameAuditIntent
      );
    }
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

  private async ensureAuditIndexMigration(): Promise<void> {
    if (await this.#bucket.get(AUDIT_INDEX_MIGRATION_KEY)) return;
    const keys = (await this.listAllKeys("audit/")).filter((key) =>
      /^audit\/\d{4}\/\d{2}\//.test(key)
    );
    const records = await this.readAuditRecords(keys);
    await Promise.all(records.map((record) => this.ensureAuditIndex(record)));
    await this.ensureImmutableObject(
      AUDIT_INDEX_MIGRATION_KEY,
      AUDIT_INDEX_MIGRATION,
      decodeAuditIndexMigration,
      sameAuditIndexMigration
    );
  }

  private async findIntentForRevision(
    revision: string
  ): Promise<AuditIntent | null> {
    const keys = await this.listAllKeys("audit/intents/");
    for (const key of keys) {
      const intent = decodeAuditIntent(
        requireObject(await this.#bucket.get(key), "Audit intent").body
      );
      if (
        intent.record.catalogRevisionAfter === revision &&
        !(await this.#bucket.get(cancelledAuditKey(intent.record.id)))
      ) {
        return intent;
      }
    }
    return null;
  }

  private async ensureImmutableObject<Value>(
    key: string,
    value: Value,
    decode: (input: unknown) => Value,
    equal: (left: Value, right: Value) => boolean
  ): Promise<void> {
    try {
      await this.#bucket.put(key, value, { ifNoneMatch: "*" });
      return;
    } catch (error) {
      const existing = await this.#bucket.get(key);
      if (existing && equal(decode(existing.body), value)) return;
      throw error;
    }
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
const AUDIT_INDEX_MIGRATION_KEY = "audit/migrations/reverse-index-v1.json";
const AUDIT_INDEX_MIGRATION = {
  protocolVersion: 1 as const,
  complete: true as const
};

interface AuditIndexMigration {
  protocolVersion: 1;
  complete: true;
}

interface KeyCursor {
  after?: string;
}

interface IncidentCursor {
  startedAt: string;
  id: string;
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

function revisionAuditKey(revision: string): string {
  return `audit/revisions/${Buffer.from(revision, "utf8").toString("base64url")}.json`;
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

function encodeKeyCursor(scope: "audit" | "history", after: string): string {
  return Buffer.from(
    JSON.stringify({ version: 2, scope, after }),
    "utf8"
  ).toString("base64url");
}

function decodeKeyCursor(
  cursor: string | undefined,
  scope: "audit" | "history"
): KeyCursor {
  if (cursor === undefined) return {};
  const value = decodeCursorObject(cursor);
  if (
    value.version === 2 &&
    value.scope === scope &&
    typeof value.after === "string" &&
    value.after !== ""
  ) {
    return { after: value.after };
  }
  throw new Error("Invalid pagination cursor");
}

function encodeIncidentCursor(cursor: IncidentCursor): string {
  return Buffer.from(
    JSON.stringify({ version: 2, scope: "incidents", ...cursor }),
    "utf8"
  ).toString("base64url");
}

function decodeIncidentCursor(cursor: string | undefined): IncidentCursor | null {
  if (cursor === undefined) return null;
  const value = decodeCursorObject(cursor);
  if (
    value.version !== 2 ||
    value.scope !== "incidents" ||
    typeof value.startedAt !== "string" ||
    typeof value.id !== "string" ||
    value.startedAt === "" ||
    value.id === ""
  ) {
    throw new Error("Invalid pagination cursor");
  }
  return { startedAt: value.startedAt, id: value.id };
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

function sameAuditRecord(
  left: AdminAuditRecord,
  right: AdminAuditRecord
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameAuditIntent(left: AuditIntent, right: AuditIntent): boolean {
  return (
    left.protocolVersion === right.protocolVersion &&
    left.mutationId === right.mutationId &&
    sameAuditRecord(left.record, right.record)
  );
}

function decodeAuditIndexMigration(input: unknown): AuditIndexMigration {
  if (
    typeof input !== "object" ||
    input === null ||
    !("protocolVersion" in input) ||
    input.protocolVersion !== 1 ||
    !("complete" in input) ||
    input.complete !== true
  ) {
    throw new Error("Invalid audit index migration marker");
  }
  return AUDIT_INDEX_MIGRATION;
}

function sameAuditIndexMigration(
  left: AuditIndexMigration,
  right: AuditIndexMigration
): boolean {
  return (
    left.protocolVersion === right.protocolVersion &&
    left.complete === right.complete
  );
}

function compareIncidentsNewestFirst(left: Incident, right: Incident): number {
  return (
    right.startedAt.localeCompare(left.startedAt) ||
    right.id.localeCompare(left.id)
  );
}

function isIncidentOlderThan(
  incident: Incident,
  cursor: IncidentCursor
): boolean {
  return (
    incident.startedAt < cursor.startedAt ||
    (incident.startedAt === cursor.startedAt && incident.id < cursor.id)
  );
}

function requireObject(
  object: BucketObject | null,
  label: string
): BucketObject {
  if (!object) throw new CatalogNotFoundError();
  return object;
}
