import crypto from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import {
  createMultipartStorage, DirectUploadError, partCount, partSize,
  type DirectUploadDescription, type UploadPartDigest, type VerifiedPart
} from "./multipart-storage.js";

export const DIRECT_PART_BYTES = 20 * 1024 * 1024;
export const DIRECT_SESSION_MS = 2 * 60 * 60 * 1000;
const SIGNED_PART_SECONDS = 300;
const COMPLETION_TIMEOUT_MS = 15 * 60 * 1000;

export type DirectUploadOwner = { audience: "browser" | "native" | "drop"; uploadLinkId?: string };
type Session = {
  session_id: string;
  artifact_id: string;
  audience: DirectUploadOwner["audience"];
  upload_link_id: string | null;
  description: DirectUploadDescription;
  upload_id: string | null;
  state: "creating" | "uploading" | "completing" | "completed" | "aborted" | "failed";
  parts: UploadPartDigest[];
  manifest: VerifiedPart[] | null;
  sha256: string | null;
  expires_at: Date;
};

export type DirectUploadResult = DirectUploadDescription & { id: string; sha256: string };
export type DirectUploadSession = { sessionId: string; partBytes: number; totalParts: number;
  expiresAt: string; state: Session["state"]; uploaded: number[] };
export type DirectUploads = ReturnType<typeof createDirectUploads>;

/** Postgres owns sessions and canonical commits. Session advisory locks serialize
 * all writers across web processes and disappear on restart. Durable manifests
 * precede S3 completion, so its ambiguous outcome can always be verified again. */
export function createDirectUploads(sql: Sql, bucket: ReturnType<typeof createMultipartStorage>, locks: Sql) {
  // Keep new bodies outside the legacy metadata backfill prefixes. Only a
  // verified Postgres commit can make these objects publicly retrievable.
  const key = (session: Session) => `transfers/${session.artifact_id}`;

  async function load(id: string, owner: DirectUploadOwner) {
    const [session] = await sql<Session[]>`select * from artifacts.upload_sessions where session_id = ${id}::uuid`;
    if (!session || session.audience !== owner.audience || session.upload_link_id !== (owner.uploadLinkId ?? null)) {
      throw unavailable();
    }
    return session;
  }

  async function active(session: Session, tx: Sql | TransactionSql = sql) {
    if (session.expires_at <= new Date() || ["aborted", "failed"].includes(session.state)) throw unavailable();
    if (!session.upload_link_id) return;
    const rows = await tx`select id from artifacts.upload_links where id = ${session.upload_link_id}::uuid
      and revoked_at is null and expires_at > clock_timestamp()`;
    if (rows.length === 0) throw unavailable();
  }

  async function locked<T>(id: string, work: (tx: TransactionSql) => Promise<T>): Promise<T> {
    const result = await locks.begin(async tx => {
      const [row] = await tx<{ locked: boolean }[]>`select pg_try_advisory_xact_lock(hashtextextended(${'publisher:session:' + id}, 0)) locked`;
      if (!row?.locked) throw new DirectUploadError(409, "upload_busy", "The upload is processing another request. Retry shortly.");
      return { value: await work(tx) };
    });
    return result.value;
  }

  async function sessionView(session: Session, signal: AbortSignal): Promise<DirectUploadSession> {
    const parts = session.state === "uploading" && session.upload_id
      ? await bucket.parts(key(session), session.upload_id, signal) : [];
    return { sessionId: session.session_id, partBytes: session.description.partBytes,
      totalParts: partCount(session.description), expiresAt: session.expires_at.toISOString(),
      state: session.state, uploaded: parts.filter(part => part.bytes === partSize(session.description, part.number)
        && session.parts.some(digest => digest.number === part.number)).map(part => part.number) };
  }

  return {
    async create(id: string, owner: DirectUploadOwner, description: DirectUploadDescription, maxSessions: number, signal: AbortSignal) {
      // Commit the reservation before touching S3. Lost create responses remain
      // discoverable by this unique key and are removed by bounded cleanup.
      await sql.begin(async tx => {
        await tx`select pg_advisory_xact_lock(hashtextextended('publisher:session-capacity', 0))`;
        const existing = await tx`select session_id from artifacts.upload_sessions where session_id = ${id}::uuid`;
        if (existing.length) return;
        const [count] = await tx<{ count: number }[]>`select count(*)::int count from artifacts.upload_sessions
          where expires_at > now() and state in ('creating', 'uploading', 'completing')`;
        if ((count?.count ?? 0) >= maxSessions) throw new DirectUploadError(503, "upload_capacity_reached", "Too many uploads are pending. Retry shortly.");
        if (owner.uploadLinkId) {
          const [linkCount] = await tx<{ count: number }[]>`select count(*)::int count from artifacts.upload_sessions
            where upload_link_id = ${owner.uploadLinkId}::uuid and expires_at > now()
            and state in ('creating', 'uploading', 'completing')`;
          if ((linkCount?.count ?? 0) >= 3) throw new DirectUploadError(429, "upload_capacity_reached", "This link already has three pending uploads.");
        }
        await tx`insert into artifacts.upload_sessions
          (session_id, artifact_id, audience, upload_link_id, description, state, expires_at)
          values (${id}::uuid, ${crypto.randomBytes(24).toString("base64url")}, ${owner.audience},
            ${owner.uploadLinkId ?? null}::uuid, ${tx.json(description)}, 'creating',
            now() + ${DIRECT_SESSION_MS} * interval '1 millisecond')`;
      });
      return locked(id, async () => {
        const session = await load(id, owner);
        await active(session);
        for (const name of ["kind", "filename", "contentType", "totalBytes", "partBytes", "project"] as const) {
          if (session.description[name] !== description[name]) throw new DirectUploadError(409, "upload_conflict", "The upload request ID was already used for another file.");
        }
        if (session.state === "creating") {
          await bucket.remove(key(session), signal);
          const uploadId = await bucket.create(key(session), session.description, signal);
          await sql`update artifacts.upload_sessions set upload_id = ${uploadId}, state = 'uploading' where session_id = ${id}::uuid`;
          session.upload_id = uploadId;
          session.state = "uploading";
        }
        return sessionView(session, signal);
      });
    },

    async status(id: string, owner: DirectUploadOwner, signal: AbortSignal) {
      return locked(id, async () => {
        const session = await load(id, owner);
        await active(session);
        return sessionView(session, signal);
      });
    },

    async sign(id: string, owner: DirectUploadOwner, number: number, sha256: string, signal: AbortSignal) {
      return locked(id, async () => {
        const session = await load(id, owner);
        await active(session);
        if (session.state !== "uploading" || !session.upload_id) throw new DirectUploadError(409, "upload_conflict", "The upload no longer accepts parts.");
        if (!Number.isInteger(number) || number < 1 || number > partCount(session.description) || !/^[a-f0-9]{64}$/.test(sha256)) {
          throw new DirectUploadError(400, "invalid_part", "Part number or SHA-256 is invalid.");
        }
        const previous = session.parts.find(part => part.number === number);
        if (previous && previous.sha256 !== sha256) throw new DirectUploadError(409, "upload_conflict", "A resumed part must contain the same bytes.");
        if (!previous) await sql`update artifacts.upload_sessions set parts = ${sql.json([...session.parts, { number, sha256 }])} where session_id = ${id}::uuid`;
        const seconds = Math.min(SIGNED_PART_SECONDS, Math.floor((session.expires_at.getTime() - Date.now()) / 1000));
        if (seconds < 1) throw unavailable();
        return { url: await bucket.sign(key(session), session.upload_id, number, partSize(session.description, number), seconds), expiresIn: seconds };
      });
    },

    async complete(id: string, owner: DirectUploadOwner, maxConcurrent: number, signal: AbortSignal): Promise<DirectUploadResult> {
      return locked(id, async tx => {
        const session = await load(id, owner);
        await active(session);
        if (session.state === "completed") {
          const [object] = await tx`select id from artifacts.objects where id = ${session.artifact_id}
            and revoked_at is null and (expires_at is null or expires_at > now())`;
          if (!object || !session.sha256) throw unavailable();
          return { ...session.description, id: session.artifact_id, sha256: session.sha256 };
        }
        await completionSlot(tx, maxConcurrent);
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(COMPLETION_TIMEOUT_MS)]);
        try {
          if (!session.upload_id) throw new DirectUploadError(409, "upload_not_ready", "Upload initialization must finish first.");
          if (session.state === "uploading") {
            const stored = await bucket.parts(key(session), session.upload_id, deadline);
            session.manifest = validateParts(session.description, session.parts, stored);
            await sql`update artifacts.upload_sessions set state = 'completing', manifest = ${sql.json(session.manifest)} where session_id = ${id}::uuid`;
          }
          if (!session.manifest) throw new Error("Completing upload has no durable manifest");
          if (await bucket.exists(key(session), deadline) === undefined) {
            await bucket.complete(key(session), session.upload_id, session.manifest, deadline);
          }
          const sha256 = await bucket.verify(key(session), session.description, session.manifest, deadline);
          deadline.throwIfAborted();
          await active(session, tx);
          if (session.upload_link_id) {
            const links = await tx`select id from artifacts.upload_links where id = ${session.upload_link_id}::uuid
              and revoked_at is null and expires_at > clock_timestamp() for update`;
            if (!links.length) throw unavailable();
          }
          const description = { ...session.description,
            ...(session.description.kind === "file" ? { fileExpiresAt: new Date(Math.max(
              Date.now() + (session.description.retentionMs ?? 0),
              Date.parse(session.description.fileExpiresAt ?? "")
            )).toISOString() } : {}) };
          await tx`insert into artifacts.objects
            (id, kind, filename, content_type, bytes, object_key, project, created_at, updated_at, expires_at, upload_link_id, sha256)
            values (${session.artifact_id}, ${description.kind}, ${description.filename}, ${description.contentType},
              ${description.totalBytes}, ${key(session)}, ${description.project ?? null}, now(), now(),
              ${description.fileExpiresAt ?? null}, ${session.upload_link_id}::uuid, ${sha256})`;
          await tx`update artifacts.upload_sessions set state = 'completed', sha256 = ${sha256},
            description = ${tx.json(description)} where session_id = ${id}::uuid`;
          return { ...description, id: session.artifact_id, sha256 };
        } catch (error) {
          if (error instanceof DirectUploadError && [404, 422].includes(error.status)) {
            await sql`update artifacts.upload_sessions set state = 'failed' where session_id = ${id}::uuid`;
          }
          // Keep storage and manifest after network/process failures. A retry
          // checks HEAD, verifies actual bytes, and performs the one canonical commit.
          throw error;
        }
      });
    },

    async abort(id: string, owner: DirectUploadOwner, signal: AbortSignal) {
      await locked(id, async () => {
        const session = await load(id, owner);
        if (session.state === "completed") return;
        await sql`update artifacts.upload_sessions set state = 'aborted' where session_id = ${id}::uuid`;
        await bucket.remove(key(session), signal);
        await sql`update artifacts.upload_sessions set cleaned_at = now() where session_id = ${id}::uuid`;
      });
    },

    async cleanup(signal: AbortSignal = AbortSignal.timeout(60_000)) {
      const sessions = await sql<Session[]>`select s.* from artifacts.upload_sessions s
        left join artifacts.upload_links l on l.id = s.upload_link_id
        where s.state <> 'completed' and s.cleaned_at is null and (s.expires_at <= now() or s.state in ('aborted', 'failed')
          or (s.upload_link_id is not null and (l.revoked_at is not null or l.expires_at <= now())))
        order by s.expires_at limit 20`;
      for (const candidate of sessions) {
        try {
          await locked(candidate.session_id, async () => {
            const session = await load(candidate.session_id, { audience: candidate.audience, uploadLinkId: candidate.upload_link_id ?? undefined });
            if (session.state !== "completed") {
              await sql`update artifacts.upload_sessions set state = 'aborted' where session_id = ${session.session_id}::uuid`;
              await bucket.remove(key(session), signal);
            }
            await sql`update artifacts.upload_sessions set cleaned_at = now() where session_id = ${session.session_id}::uuid`;
          });
        } catch (error) {
          if (error instanceof DirectUploadError && error.code === "upload_busy") continue;
          signal.throwIfAborted();
          // Keep the reservation for the next sweep and continue other cleanup,
          // including the existing published-file retention work.
          console.error(JSON.stringify({ event: "publisher.upload_cleanup_failed",
            errorType: error instanceof Error ? error.name : "UnknownError" }));
        }
      }
      await sql`delete from artifacts.upload_sessions where session_id in (
        select session_id from artifacts.upload_sessions where (cleaned_at is not null or state = 'completed')
        and expires_at < now() - interval '1 day' order by expires_at limit 500)`;
    },
    async close() { bucket.close(); await locks.end(); }
  };
}

function unavailable() { return new DirectUploadError(404, "upload_not_found", "The upload was not found, expired, or revoked."); }

async function completionSlot(tx: TransactionSql, maximum: number) {
  for (let slot = 0; slot < maximum; slot += 1) {
    const [row] = await tx<{ locked: boolean }[]>`select pg_try_advisory_xact_lock(hashtextextended(${'publisher:completion:' + slot}, 0)) locked`;
    if (row?.locked) return;
  }
  throw new DirectUploadError(503, "upload_capacity_reached", "The service is processing its maximum number of uploads.");
}

function validateParts(description: DirectUploadDescription, digests: UploadPartDigest[], stored: Array<{ number: number; bytes: number; etag: string }>): VerifiedPart[] {
  const manifest: VerifiedPart[] = [];
  for (let number = 1; number <= partCount(description); number += 1) {
    const part = stored.find(part => part.number === number);
    const digest = digests.find(part => part.number === number);
    if (!part || !digest) throw new DirectUploadError(409, "incomplete_upload", "Some upload parts are missing. Resume the upload.");
    if (part.bytes !== partSize(description, number)) throw new DirectUploadError(422, "size_mismatch", "Stored part size does not match the upload.");
    manifest.push({ ...part, sha256: digest.sha256 });
  }
  if (stored.length !== manifest.length) throw new DirectUploadError(422, "size_mismatch", "The upload has unexpected parts.");
  return manifest;
}
