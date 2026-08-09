import postgres, { type Sql } from "postgres";
import {
  htmlKey,
  temporaryFileKey,
  type ListUploadsOptions,
  type S3UploadStorageConfig,
  type StoredUploadPage,
  type StoredUploadSummary,
  type UploadListCursor,
  type UploadStorage
} from "./storage.js";
import { createS3UploadStorage } from "./storage.js";

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
};

/** Keeps file bodies in S3 while making Postgres authoritative for metadata. */
export function createPostgresUploadStorage(
  s3Config: S3UploadStorageConfig,
  databaseUrl: string
): UploadStorage {
  const bodies = createS3UploadStorage(s3Config);
  const sql = postgres(databaseUrl, { max: 5 });
  return createMetadataBackedUploadStorage(bodies, sql);
}

export function createMetadataBackedUploadStorage(
  bodies: UploadStorage,
  sql: Sql
): UploadStorage {
  return {
    async putHtml(id, filePath, metadata, options) {
      await bodies.putHtml(id, filePath, metadata, options);
      const now = new Date();
      await upsert(sql, {
        id, kind: "html", filename: metadata.originalName,
        contentType: "text/html; charset=utf-8", bytes: metadata.bytes,
        objectKey: htmlKey(id), project: metadata.project, now
      });
    },
    async getHtml(id, options) {
      const row = await find(sql, id, "html");
      if (!row) return null;
      const object = await bodies.getHtml(id, options);
      if (!object) return null;
      const { project: _legacyProject, ...body } = object;
      return { ...body, bytes: Number(row.bytes), lastModified: row.updated_at, ...(row.project ? { project: row.project } : {}) };
    },
    async putTemporaryFile(id, filePath, metadata, options) {
      await bodies.putTemporaryFile(id, filePath, metadata, options);
      const now = new Date();
      await upsert(sql, {
        id, kind: "file", filename: metadata.originalName,
        contentType: metadata.contentType, bytes: metadata.bytes,
        objectKey: temporaryFileKey(id), expiresAt: metadata.expiresAt, now
      });
    },
    async getTemporaryFile(id, options) {
      const row = await find(sql, id, "file");
      if (!row || !row.expires_at) return null;
      const object = await bodies.getTemporaryFile(id, options);
      if (!object) return null;
      return {
        ...object,
        bytes: Number(row.bytes),
        contentType: row.content_type,
        originalName: row.filename,
        expiresAt: row.expires_at,
        lastModified: row.updated_at
      };
    },
    async listUploads(asOf, options) {
      const rows = await sql<ArtifactRow[]>`
        select id, kind, filename, content_type, bytes::text, object_key, project,
               created_at, updated_at, expires_at
        from artifacts.objects where revoked_at is null
      `;
      return pageArtifactMetadata(rows.map(toSummary), asOf, options);
    },
    async updateHtmlProject(id, project) {
      const rows = await sql<{ id: string }[]>`
        update artifacts.objects set project = ${project}, updated_at = now()
        where id = ${id} and kind = 'html' and revoked_at is null returning id
      `;
      return rows.length === 1;
    },
    async deleteUpload(id, options) {
      await bodies.deleteUpload(id, options);
      await sql`delete from artifacts.objects where id = ${id}`;
    },
    async deleteExpiredTemporaryFiles(expiresAtOrBefore, options) {
      const rows = await sql<{ id: string }[]>`
        select id from artifacts.objects
        where kind = 'file' and revoked_at is null and expires_at <= ${expiresAtOrBefore}
      `;
      let deleted = 0;
      for (const { id } of rows) {
        await bodies.deleteUpload(id, options);
        await sql`delete from artifacts.objects where id = ${id}`;
        deleted += 1;
      }
      return deleted;
    },
    async close() {
      await bodies.close?.();
      await sql.end();
    }
  };
}

type UpsertArtifact = {
  id: string; kind: "html" | "file"; filename: string; contentType: string;
  bytes: number; objectKey: string; project?: string; expiresAt?: Date; now: Date;
};

async function upsert(sql: Sql, value: UpsertArtifact) {
  await sql`
    insert into artifacts.objects
      (id, kind, filename, content_type, bytes, object_key, project, created_at, updated_at, expires_at)
    values (${value.id}, ${value.kind}, ${value.filename}, ${value.contentType}, ${value.bytes},
      ${value.objectKey}, ${value.project ?? null}, ${value.now}, ${value.now}, ${value.expiresAt ?? null})
    on conflict (id) do update set
      kind = excluded.kind, filename = excluded.filename, content_type = excluded.content_type,
      bytes = excluded.bytes, object_key = excluded.object_key, project = excluded.project,
      updated_at = excluded.updated_at, expires_at = excluded.expires_at, revoked_at = null
  `;
}

async function find(sql: Sql, id: string, kind: "html" | "file") {
  const [row] = await sql<ArtifactRow[]>`
    select id, kind, filename, content_type, bytes::text, object_key, project,
           created_at, updated_at, expires_at
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
  const query = options.q?.trim().normalize("NFKC").toLowerCase() ?? "";
  const expiry = options.expiry ?? "all";
  const sort = options.sort ?? "newest";
  const ordered = uploads
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
