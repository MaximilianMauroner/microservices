import crypto from "node:crypto";
import postgres from "postgres";

export const MIN_UPLOAD_LINK_DURATION_MS = 5 * 60 * 1000;
export const MAX_UPLOAD_LINK_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const UPLOAD_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type UploadLink = Readonly<{
  id: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  fileCount: number;
}>;

export type CreatedUploadLink = UploadLink & Readonly<{ token: string }>;
export type UploadLinkFile = Readonly<{ id: string; filename: string; bytes: number }>;

export interface UploadLinkRepository {
  create(expiresAt: Date): Promise<CreatedUploadLink>;
  list(): Promise<readonly UploadLink[]>;
  findActive(token: string, now: Date): Promise<UploadLink | null>;
  listFiles(id: string, now: Date): Promise<readonly UploadLinkFile[] | null>;
  revoke(id: string, now: Date): Promise<boolean>;
  close?(): void | Promise<void>;
}

export function uploadLinkTokenHash(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function createPostgresUploadLinkRepository(databaseUrl: string): UploadLinkRepository {
  const sql = postgres(databaseUrl, { max: 3, idle_timeout: 120 });
  return {
    async create(expiresAt) {
      const id = crypto.randomUUID();
      const token = crypto.randomBytes(32).toString("base64url");
      const rows = await sql<UploadLinkRow[]>`
        insert into artifacts.upload_links (id, token_hash, expires_at)
        values (${id}, ${uploadLinkTokenHash(token)}, ${expiresAt})
        returning id::text, created_at, expires_at, revoked_at`;
      return { ...toUploadLink(rows[0]!), token };
    },
    async list() {
      const rows = await sql<UploadLinkRow[]>`
        select id::text, created_at, expires_at, revoked_at,
          (select count(*)::int from artifacts.objects o where o.upload_link_id = l.id
            and o.kind = 'file' and o.revoked_at is null and (o.expires_at is null or o.expires_at > now())) file_count
        from artifacts.upload_links l
        order by created_at desc`;
      return rows.map(toUploadLink);
    },
    async findActive(token, now) {
      if (!UPLOAD_LINK_TOKEN_PATTERN.test(token)) return null;
      const rows = await sql<UploadLinkRow[]>`
        select id::text, created_at, expires_at, revoked_at
        from artifacts.upload_links
        where token_hash = ${uploadLinkTokenHash(token)}
          and revoked_at is null and expires_at > ${now}`;
      return rows[0] ? toUploadLink(rows[0]) : null;
    },
    async listFiles(id, now) {
      const links = await sql<{ id: string }[]>`select id::text from artifacts.upload_links where id = ${id}::uuid`;
      if (links.length === 0) return null;
      const rows = await sql<{ id: string; filename: string; bytes: string }[]>`
        select id, filename, bytes::text
        from artifacts.objects
        where upload_link_id = ${id}::uuid and kind = 'file' and revoked_at is null
          and (expires_at is null or expires_at > ${now})
        order by created_at, id`;
      return rows.map((row) => ({ id: row.id, filename: row.filename, bytes: Number(row.bytes) }));
    },
    async revoke(id, now) {
      const rows = await sql<{ id: string }[]>`
        update artifacts.upload_links set revoked_at = coalesce(revoked_at, ${now})
        where id = ${id}::uuid returning id::text`;
      return rows.length === 1;
    },
    close: () => sql.end()
  };
}

type UploadLinkRow = {
  id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  file_count?: number;
};

function toUploadLink(row: UploadLinkRow): UploadLink {
  return {
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    fileCount: row.file_count ?? 0,
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {})
  };
}
