import type { Sql, TransactionSql } from "postgres";
import { DirectUploadError } from "./multipart-storage.js";

type ArtifactRow = {
  id: string; kind: "html" | "file"; filename: string; content_type: string;
  bytes: string; object_key: string; project: string | null;
  created_at: Date; updated_at: Date; expires_at: Date | null;
  revoked_at: Date | null; upload_link_id: string | null; sha256: string | null;
};
export type ArtifactSnapshot = Omit<ArtifactRow, "created_at" | "updated_at" | "expires_at" | "revoked_at"> & {
  created_at: string; updated_at: string; expires_at: string | null; revoked_at: string | null;
};
export type HtmlVersionReceipt = { format: 1; before: ArtifactSnapshot; after: ArtifactSnapshot };
export type HtmlBody = { objectKey: string; filename: string; bytes: number; sha256: string; project?: string };

export async function lockHtmlVersion(tx: Sql | TransactionSql, id: string) {
  const [row] = await tx<ArtifactRow[]>`select *, bytes::text from artifacts.objects
    where id = ${id} and kind = 'html' and revoked_at is null for update`;
  if (!row) throw new DirectUploadError(404, "upload_not_found", "The HTML upload was not found or was revoked.");
  return row;
}

export async function commitHtmlVersion(tx: TransactionSql, id: string, expectedObjectKey: string,
  body: HtmlBody, journalId?: string): Promise<HtmlVersionReceipt> {
  const before = await lockHtmlVersion(tx, id);
  const pending = await tx`select operation_id from artifacts.operations where artifact_id = ${id}
    and (${journalId ?? null}::uuid is null or operation_id <> ${journalId ?? null}::uuid)`;
  if (pending.length) throw new DirectUploadError(409, "upload_busy", "The HTML page has a pending operation. Retry shortly.");
  if (before.object_key !== expectedObjectKey) {
    throw new DirectUploadError(409, "replace_conflict", "The HTML page changed after this replacement started. Start a new replacement.");
  }
  const [after] = await tx<ArtifactRow[]>`update artifacts.objects set
    object_key = ${body.objectKey}, filename = ${body.filename}, bytes = ${body.bytes},
    sha256 = ${body.sha256}, content_type = 'text/html; charset=utf-8',
    project = coalesce(${body.project ?? null}, project), updated_at = clock_timestamp()
    where id = ${id} returning *, bytes::text`;
  if (!after) throw new Error("HTML version commit returned no artifact");
  return { format: 1, before: snapshot(before), after: snapshot(after) };
}

function snapshot(row: ArtifactRow): ArtifactSnapshot {
  return { ...row, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(),
    expires_at: row.expires_at?.toISOString() ?? null, revoked_at: row.revoked_at?.toISOString() ?? null };
}

export function replacementKey(id: string, stagingId: string) {
  return `transfers/${id}/${stagingId}`;
}
