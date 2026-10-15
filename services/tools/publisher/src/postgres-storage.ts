import crypto from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";
import {
  htmlKey,
  HtmlUpdateConflictError,
  RangeNotSatisfiableError,
  temporaryFileKey,
  type ListUploadsOptions,
  type S3UploadStorageConfig,
  type StoredUploadPage,
  type StoredUploadSummary,
  type StoredTemporaryFile,
  type UploadListCursor,
  UploadLinkInactiveError,
  type UploadStorage
} from "./storage.js";
import { createS3UploadStorage, summarizeUploads } from "./storage.js";
import { createDirectUploads } from "./direct-uploads.js";
import { createMultipartStorage } from "./multipart-storage.js";
import { DirectUploadError } from "./multipart-storage.js";
import { commitHtmlVersion, replacementKey, type HtmlVersionReceipt } from "./html-versions.js";

type ArtifactRow = {
  id: string;
  kind: "html" | "file";
  filename: string;
  content_type: string;
  bytes: string;
  object_key: string;
  project: string | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  upload_link_id: string | null;
  sha256: string | null;
};

type PendingOperation = {
  operation_id: string;
  artifact_id: string;
  owner_id: string;
  operation_kind: "put_html" | "put_file" | "delete";
  payload: UpsertArtifact | string | null;
};

const OPERATION_LEASE_MS = 6 * 60 * 60 * 1000;

/** Keeps file bodies in S3 while making Postgres authoritative for metadata. */
export function createPostgresUploadStorage(
  s3Config: S3UploadStorageConfig,
  databaseUrl: string
): UploadStorage {
  const bodies = createS3UploadStorage(s3Config);
  const sql = postgres(databaseUrl, { max: 5, idle_timeout: 120 });
  const storage = createMetadataBackedUploadStorage(bodies, sql);
  // Separate bounded lock connections keep long verification reads from
  // starving the durable writes that must happen before S3 completion.
  const locks = postgres(databaseUrl, { max: 2, idle_timeout: 120 });
  storage.directUploads = createDirectUploads(sql, createMultipartStorage(s3Config), locks);
  const endpoint = new URL(s3Config.endpoint);
  storage.uploadOrigins = [endpoint.origin, ...(s3Config.forcePathStyle ? [] :
    [`${endpoint.protocol}//${s3Config.bucket}.${endpoint.host}`])];
  return storage;
}

export function createMetadataBackedUploadStorage(
  bodies: UploadStorage,
  sql: Sql
): UploadStorage {
  return {
    async putHtml(id, filePath, metadata, options) {
      await reconcileArtifactOperations(bodies, sql, options);
      const current = await find(sql, id, "html");
      if (options?.expectedObjectKey && current?.object_key !== options.expectedObjectKey) throw new HtmlUpdateConflictError();
      if (options?.ifMatch) {
        if (!current) throw new HtmlUpdateConflictError();
        const previous = await bodies.getHtml(id, { ...options, headOnly: true, objectKey: current.object_key });
        previous?.body.destroy();
        if (previous?.etag !== options.ifMatch) throw new HtmlUpdateConflictError();
      }
      const stagingId = current ? crypto.randomBytes(24).toString("base64url") : undefined;
      const objectKey = stagingId ? replacementKey(id, stagingId) : htmlKey(id);
      const now = new Date();
      const intended: UpsertArtifact = {
        id, kind: "html", filename: metadata.originalName,
        contentType: "text/html; charset=utf-8", bytes: metadata.bytes,
        objectKey, project: metadata.project, sha256: metadata.sha256, now,
        ...(current && stagingId ? { expectedObjectKey: current.object_key, stagingId } : {})
      };
      await runDurableMutation({
        prepare: () => prepare(sql, id, "put_html", intended),
        mutate: async () => {
          await bodies.putHtml(id, filePath, metadata, { ...options, ifMatch: undefined, objectKey });
          if (!(await matchesStoredBody(bodies, intended, options))) throw new Error("Stored HTML does not match the staged upload");
        },
        reconcile: (operation) => reconcileOperation(bodies, sql, { operation_id: operation.operationId, owner_id: operation.ownerId, artifact_id: id, operation_kind: "put_html", payload: intended }, options),
        finalize: async (operation) => { await finalizePut(sql, operation, intended); }
      });
    },
    async getHtml(id, options) {
      await reconcileArtifactOperations(bodies, sql, options);
      const row = await find(sql, id, "html");
      if (!row) return null;
      const object = await bodies.getHtml(id, { ...options, objectKey: row.object_key });
      if (!object) return null;
      const { project: _legacyProject, ...body } = object;
      return { ...body, version: row.object_key, bytes: Number(row.bytes), sha256: row.sha256 ?? body.sha256, lastModified: row.updated_at, ...(row.project ? { project: row.project } : {}) };
    },
    async putTemporaryFile(id, filePath, metadata, options) {
      await reconcileArtifactOperations(bodies, sql, options);
      const now = new Date();
      const intended: UpsertArtifact = {
        id, kind: "file", filename: metadata.originalName,
        contentType: metadata.contentType, bytes: metadata.bytes,
        objectKey: temporaryFileKey(id), expiresAt: metadata.expiresAt,
        uploadLinkId: metadata.uploadLinkId, sha256: metadata.sha256, now
      };
      let finalized = false;
      let finalizationOperation: OperationOwner | undefined;
      await runDurableMutation({
        prepare: () => prepare(sql, id, "put_file", intended),
        mutate: () => bodies.putTemporaryFile(id, filePath, metadata, options),
        reconcile: (operation) => reconcileOperation(bodies, sql, { operation_id: operation.operationId, owner_id: operation.ownerId, artifact_id: id, operation_kind: "put_file", payload: intended }, options),
        finalize: async (operation) => {
          finalizationOperation = operation;
          finalized = await finalizePut(sql, operation, intended);
        }
      });
      if (!finalized) {
        if (!finalizationOperation) throw new Error("Guest upload finalization lost its operation owner");
        await bodies.deleteUpload(id, options);
        await finalizeDelete(sql, finalizationOperation, id);
        throw new UploadLinkInactiveError();
      }
    },
    async getTemporaryFile(id, options) {
      await reconcileArtifactOperations(bodies, sql, options);
      const row = await find(sql, id, "file");
      if (!row) return null;
      let object: StoredTemporaryFile | null;
      try {
        object = await bodies.getTemporaryFile(id, { ...options, objectKey: row.object_key });
      } catch (error) {
        if (error instanceof RangeNotSatisfiableError) {
          throw new RangeNotSatisfiableError(error.totalBytes, row.expires_at ?? undefined);
        }
        throw error;
      }
      if (!object) return null;
      const { expiresAt: _objectExpiry, ...body } = object;
      return {
        ...body,
        // A ranged read carries one slice. Its own length has to survive, or the
        // response states a Content-Length that contradicts its Content-Range.
        bytes: body.contentRange ? body.bytes : Number(row.bytes),
        contentType: row.content_type,
        originalName: row.filename,
        ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
        lastModified: row.updated_at,
        sha256: row.sha256 ?? body.sha256
      };
    },
    async presignTemporaryFile(id, expiresInSeconds, delivery) {
      await reconcileArtifactOperations(bodies, sql);
      const row = await find(sql, id, "file");
      if (!row) return null;
      return bodies.presignTemporaryFile?.(id, expiresInSeconds, delivery, { objectKey: row.object_key }) ?? null;
    },
    async listUploads(asOf, options) {
      await reconcileArtifactOperations(bodies, sql, options);
      const rows = await sql<ArtifactRow[]>`
        select id, kind, filename, content_type, bytes::text, object_key, project,
               created_at, updated_at, expires_at
        from artifacts.objects where revoked_at is null
      `;
      return pageArtifactMetadata(rows.map(toSummary), asOf, options);
    },
    async updateHtmlProject(id, project) {
      await reconcileArtifactOperations(bodies, sql);
      const rows = await sql<{ id: string }[]>`
        update artifacts.objects set project = ${project}, updated_at = now()
        where id = ${id} and kind = 'html' and revoked_at is null returning id
      `;
      return rows.length === 1;
    },
    async updateFileExpiry(id, expiresAt, options) {
      await reconcileArtifactOperations(bodies, sql, options);
      const row = await find(sql, id, "file");
      if (!row) return false;
      const bodyUpdated = await bodies.updateFileExpiry(id, expiresAt, { ...options, objectKey: row.object_key });
      if (!bodyUpdated) return false;
      const rows = await sql<{ id: string }[]>`
        update artifacts.objects set expires_at = ${expiresAt}, updated_at = now()
        where id = ${id} and kind = 'file' and revoked_at is null returning id
      `;
      if (rows.length === 0) await bodies.deleteUpload(id, options);
      return rows.length === 1;
    },
    async deleteUpload(id, options) {
      await reconcileArtifactOperations(bodies, sql, options);
      const operation = await prepare(sql, id, "delete", null);
      await sql`update artifacts.objects set revoked_at = coalesce(revoked_at, now()) where id = ${id}`;
      try {
        await deleteArtifactBodies(bodies, sql, id, options);
      } catch (error) {
        // Keep the durable intent: a later read/list/cleanup retries the idempotent delete.
        throw error;
      }
      await finalizeDelete(sql, operation, id);
    },
    async deleteExpiredTemporaryFiles(expiresAtOrBefore, options) {
      await this.directUploads?.cleanup(options?.signal);
      const rows = await sql<{ id: string }[]>`
        select id from artifacts.objects
        where kind = 'file' and revoked_at is null and expires_at <= ${expiresAtOrBefore}
      `;
      let deleted = 0;
      for (const { id } of rows) {
        await this.deleteUpload(id, options);
        deleted += 1;
      }
      return deleted;
    },
    async close() {
      await this.directUploads?.close();
      await bodies.close?.();
      await sql.end();
    }
  };
}

type UpsertArtifact = {
  id: string; kind: "html" | "file"; filename: string; contentType: string;
  bytes: number; objectKey: string; project?: string; expiresAt?: Date; uploadLinkId?: string; sha256: string; now: Date;
  expectedObjectKey?: string; stagingId?: string;
};

export async function runDurableMutation(options: {
  prepare: () => Promise<OperationOwner>;
  mutate: () => Promise<void>;
  reconcile: (operation: OperationOwner) => Promise<void>;
  finalize: (operation: OperationOwner) => Promise<void>;
}) {
  const operation = await options.prepare();
  try { await options.mutate(); }
  catch (error) { await options.reconcile(operation); throw error; }
  await options.finalize(operation);
}

export type OperationOwner = Readonly<{ operationId: string; ownerId: string }>;

async function prepare(sql: Sql, artifactId: string, kind: PendingOperation["operation_kind"], payload: UpsertArtifact | null) {
  const operationId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  await sql`insert into artifacts.operations (operation_id, artifact_id, owner_id, lease_until, operation_kind, payload)
    values (${operationId}, ${artifactId}, ${ownerId}, now() + ${OPERATION_LEASE_MS} * interval '1 millisecond', ${kind}, ${payload ? sql.json(payload) : null})`;
  return { operationId, ownerId };
}

async function finalizePut(sql: Sql, operation: OperationOwner, value: UpsertArtifact) {
  try { return await sql.begin(async (tx) => {
    await requireOwnership(tx, operation);
    const finalized = value.uploadLinkId
      ? await lockActiveUploadLink(tx, value.uploadLinkId)
      : true;
    if (finalized) {
      if (value.kind === "html" && value.expectedObjectKey && value.stagingId) {
        const receipt = await commitHtmlVersion(tx, value.id, value.expectedObjectKey, {
          objectKey: value.objectKey, filename: value.filename, bytes: value.bytes,
          sha256: value.sha256, project: value.project
        }, operation.operationId);
        const description = { kind: "html", filename: value.filename, contentType: value.contentType,
          totalBytes: value.bytes, partBytes: 20 * 1024 * 1024, ...(value.project ? { project: value.project } : {}) };
        await tx`insert into artifacts.upload_sessions
          (session_id, artifact_id, target_id, expected_object_key, audience, description, state, sha256, receipt, expires_at)
          values (${operation.operationId}::uuid, ${value.stagingId}, ${value.id}, ${value.expectedObjectKey},
            'native', ${tx.json(description)}, 'completed', ${value.sha256}, ${tx.json(receipt)}, now())`;
      } else await upsert(tx, value);
      await tx`delete from artifacts.operations where operation_id = ${operation.operationId} and owner_id = ${operation.ownerId}`;
    } else {
      await tx`update artifacts.operations set operation_kind = 'delete', payload = null
        where operation_id = ${operation.operationId} and owner_id = ${operation.ownerId}`;
    }
    return finalized;
  }); } catch (error) {
    if (error instanceof DirectUploadError && ["replace_conflict", "upload_not_found"].includes(error.code)) {
      await sql`delete from artifacts.operations where operation_id = ${operation.operationId} and owner_id = ${operation.ownerId}`;
      throw new HtmlUpdateConflictError();
    }
    throw error;
  }
}

async function lockActiveUploadLink(sql: TransactionSql, uploadLinkId: string) {
  const rows = await sql<{ id: string }[]>`
    select id::text from artifacts.upload_links
    where id = ${uploadLinkId}::uuid and revoked_at is null and expires_at > now()
    for update`;
  return rows.length === 1;
}

async function finalizeDelete(sql: Sql, operation: OperationOwner, id: string) {
  await sql.begin(async (tx) => {
    await requireOwnership(tx, operation);
    await tx`update artifacts.objects set revoked_at = coalesce(revoked_at, now()) where id = ${id}`;
    await tx`delete from artifacts.operations where operation_id = ${operation.operationId} and owner_id = ${operation.ownerId}`;
  });
}

export async function reconcileArtifactOperations(bodies: UploadStorage, sql: Sql, options?: { signal?: AbortSignal }) {
  const expired = await sql<{ operation_id: string }[]>`select operation_id from artifacts.operations where lease_until <= now() order by created_at`;
  for (const { operation_id } of expired) {
    const ownerId = crypto.randomUUID();
    const [operation] = await sql<PendingOperation[]>`
      update artifacts.operations set owner_id = ${ownerId}, lease_until = now() + ${OPERATION_LEASE_MS} * interval '1 millisecond'
      where operation_id = ${operation_id} and lease_until <= now()
      returning operation_id, artifact_id, owner_id, operation_kind, payload`;
    if (operation) await reconcileOperation(bodies, sql, operation, options);
  }
}

async function reconcileOperation(bodies: UploadStorage, sql: Sql, operation: PendingOperation, options?: { signal?: AbortSignal }) {
  if (operation.operation_kind === "delete") {
    await sql`update artifacts.objects set revoked_at = coalesce(revoked_at, now()) where id = ${operation.artifact_id}`;
    await deleteArtifactBodies(bodies, sql, operation.artifact_id, options);
    await finalizeDelete(sql, owner(operation), operation.artifact_id);
    return;
  }
  if (!operation.payload) throw new Error(`Artifact operation ${operation.operation_id} has no payload`);
  const payload = hydratePayload(operation.payload);
  if (!payload.expectedObjectKey) {
    const [current] = await sql<{ object_key: string; revoked_at: Date | null; updated_at: Date }[]>`
      select object_key, revoked_at, updated_at from artifacts.objects where id = ${payload.id}`;
    if (current && (current.revoked_at || current.object_key !== payload.objectKey || current.updated_at > payload.now)) {
      await sql`delete from artifacts.operations where operation_id = ${operation.operation_id} and owner_id = ${operation.owner_id}`;
      return;
    }
    if (!current && ![htmlKey(payload.id), temporaryFileKey(payload.id)].includes(payload.objectKey)) {
      throw new Error("Legacy artifact operation needs an explicit recovery decision");
    }
  }
  if (await matchesStoredBody(bodies, payload, options)) {
    const operationOwner = owner(operation);
    const finalized = await finalizePut(sql, operationOwner, payload);
    if (!finalized) {
      await bodies.deleteUpload(operation.artifact_id, options);
      await finalizeDelete(sql, operationOwner, operation.artifact_id);
    }
  }
  else await sql`delete from artifacts.operations where operation_id = ${operation.operation_id} and owner_id = ${operation.owner_id}`;
}

async function deleteArtifactBodies(bodies: UploadStorage, sql: Sql, id: string, options?: { signal?: AbortSignal }) {
  const rows = await sql<{ object_key: string }[]>`select object_key from artifacts.objects where id = ${id}`;
  const versions = await sql<{ receipt: HtmlVersionReceipt | null }[]>`select receipt from artifacts.upload_sessions where target_id = ${id}`;
  const keys = new Set(rows.map(row => row.object_key));
  for (const { receipt } of versions) {
    if (!receipt) continue;
    if (receipt.format !== 1 || receipt.before.id !== id || receipt.after.id !== id) throw new Error("Invalid HTML version receipt");
    keys.add(receipt.before.object_key);
    keys.add(receipt.after.object_key);
  }
  for (const objectKey of keys) await bodies.deleteUpload(id, { ...options, objectKey });
  await bodies.deleteUpload(id, options);
}

async function matchesStoredBody(bodies: UploadStorage, value: UpsertArtifact, options?: { signal?: AbortSignal }) {
  const stored = value.kind === "html"
    ? await bodies.getHtml(value.id, { signal: options?.signal, objectKey: value.objectKey })
    : await bodies.getTemporaryFile(value.id, { signal: options?.signal, objectKey: value.objectKey });
  if (!stored) return false;
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of stored.body) {
      options?.signal?.throwIfAborted();
      bytes += chunk.length;
      if (bytes > value.bytes) return false;
      hash.update(chunk);
    }
    return bytes === value.bytes && hash.digest("hex") === value.sha256;
  } finally { stored.body.destroy(); }
}

function owner(operation: PendingOperation): OperationOwner { return { operationId: operation.operation_id, ownerId: operation.owner_id }; }

async function requireOwnership(sql: TransactionSql, operation: OperationOwner) {
  const rows = await sql<{ operation_id: string }[]>`select operation_id from artifacts.operations
    where operation_id = ${operation.operationId} and owner_id = ${operation.ownerId} for update`;
  assertOperationOwnership(rows.length === 1, operation.operationId);
}

export function assertOperationOwnership(owned: boolean, operationId: string) {
  if (!owned) throw new Error(`Artifact operation ${operationId} is no longer owned by this writer`);
}

function hydratePayload(payload: UpsertArtifact | string): UpsertArtifact {
  // Earlier writers encoded JSON twice. Retain reads for their pending recovery
  // records until those operations have been reconciled; new writes use sql.json.
  const value: unknown = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string"
    || !("kind" in value) || (value.kind !== "html" && value.kind !== "file")
    || !("filename" in value) || typeof value.filename !== "string"
    || !("contentType" in value) || typeof value.contentType !== "string"
    || !("bytes" in value) || typeof value.bytes !== "number"
    || !("objectKey" in value) || typeof value.objectKey !== "string"
    || !("sha256" in value) || typeof value.sha256 !== "string"
    || !("now" in value) || (typeof value.now !== "string" && !(value.now instanceof Date))
    || ("expectedObjectKey" in value && (typeof value.expectedObjectKey !== "string" || !("stagingId" in value) || typeof value.stagingId !== "string"))) {
    throw new Error("Invalid artifact recovery payload");
  }
  return { id: value.id, kind: value.kind, filename: value.filename, contentType: value.contentType,
    bytes: value.bytes, objectKey: value.objectKey, sha256: value.sha256, now: new Date(value.now),
    ...("expectedObjectKey" in value && typeof value.expectedObjectKey === "string" && "stagingId" in value && typeof value.stagingId === "string"
      ? { expectedObjectKey: value.expectedObjectKey, stagingId: value.stagingId } : {}),
    ...("project" in value && typeof value.project === "string" ? { project: value.project } : {}),
    ...("uploadLinkId" in value && typeof value.uploadLinkId === "string" ? { uploadLinkId: value.uploadLinkId } : {}),
    ...("expiresAt" in value && (typeof value.expiresAt === "string" || value.expiresAt instanceof Date) ? { expiresAt: new Date(value.expiresAt) } : {}) };
}

async function upsert(sql: Sql | TransactionSql, value: UpsertArtifact) {
  await sql`
    insert into artifacts.objects
      (id, kind, filename, content_type, bytes, object_key, project, created_at, updated_at, expires_at, upload_link_id, sha256)
    values (${value.id}, ${value.kind}, ${value.filename}, ${value.contentType}, ${value.bytes},
      ${value.objectKey}, ${value.project ?? null}, ${value.now}, ${value.now}, ${value.expiresAt ?? null}, ${value.uploadLinkId ?? null}, ${value.sha256})
    on conflict (id) do update set
      kind = excluded.kind, filename = excluded.filename, content_type = excluded.content_type,
      bytes = excluded.bytes, object_key = excluded.object_key, project = excluded.project,
      updated_at = excluded.updated_at, expires_at = excluded.expires_at,
      upload_link_id = excluded.upload_link_id, sha256 = excluded.sha256
    where artifacts.objects.revoked_at is null and artifacts.objects.object_key = excluded.object_key
      and artifacts.objects.updated_at <= excluded.updated_at`;
}

async function find(sql: Sql, id: string, kind: "html" | "file") {
  const [row] = await sql<ArtifactRow[]>`
    select id, kind, filename, content_type, bytes::text, object_key, project,
           created_at, updated_at, expires_at, sha256
    from artifacts.objects where id = ${id} and kind = ${kind} and revoked_at is null
  `;
  return row;
}

function toSummary(row: ArtifactRow): StoredUploadSummary & { key: string } {
  return {
    id: row.id, kind: row.kind, originalName: row.filename, contentType: row.content_type,
    bytes: Number(row.bytes), updatedAt: row.updated_at, key: row.object_key,
    ...(row.project ? { project: row.project } : {}),
    ...(row.expires_at ? { expiresAt: row.expires_at } : {})
  };
}

export function pageArtifactMetadata(
  uploads: Array<StoredUploadSummary & { key: string }>,
  asOf: Date,
  options: ListUploadsOptions
): StoredUploadPage {
  const active = uploads.filter((item) => !item.expiresAt || item.expiresAt > asOf);
  const query = options.q?.trim().normalize("NFKC").toLowerCase() ?? "";
  const expiry = options.expiry ?? "all";
  const sort = options.sort ?? "newest";
  const ordered = active
    .filter((item) => !options.kind || item.kind === options.kind)
    .filter((item) => !query || item.originalName.normalize("NFKC").toLowerCase().includes(query))
    .filter((item) => expiry === "all" || expiry === "persistent" ? expiry === "all" || !item.expiresAt : Boolean(item.expiresAt && item.expiresAt <= new Date(asOf.getTime() + (expiry === "24h" ? 86_400_000 : 604_800_000))))
    .sort(comparator(sort));
  const after = options.cursor ? ordered.filter((item) => comparator(sort)(item, cursorSummary(options.cursor!)) > 0) : ordered;
  const selected = after.slice(0, options.limit + 1);
  const visible = selected.slice(0, options.limit);
  const last = visible.at(-1);
  return {
    uploads: visible.map(({ key: _key, ...item }) => item),
    ...(options.includeSummary ? { summary: summarizeUploads(active, asOf) } : {}),
    ...(last && selected.length > options.limit ? { nextCursor: {
      version: 1, criteria: options.criteria ?? "legacy:newest", updatedAt: last.updatedAt,
      key: last.key, originalName: last.originalName, ...(last.expiresAt ? { expiresAt: last.expiresAt } : {})
    } } : {})
  };
}

function comparator(sort: NonNullable<ListUploadsOptions["sort"]>) {
  return (a: StoredUploadSummary & { key: string }, b: StoredUploadSummary & { key: string }) => {
    if (sort === "filename") return a.originalName.localeCompare(b.originalName) || a.key.localeCompare(b.key);
    if (sort === "expiry") return (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity) || a.key.localeCompare(b.key);
    const delta = a.updatedAt.getTime() - b.updatedAt.getTime();
    return (sort === "oldest" ? delta : -delta) || a.key.localeCompare(b.key);
  };
}

function cursorSummary(cursor: UploadListCursor): StoredUploadSummary & { key: string } {
  return { id: "", kind: "html", originalName: cursor.originalName ?? cursor.key,
    contentType: "", bytes: 0, updatedAt: cursor.updatedAt, key: cursor.key,
    ...(cursor.expiresAt ? { expiresAt: cursor.expiresAt } : {}) };
}
