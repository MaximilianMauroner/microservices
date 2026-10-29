import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import type { MarkdownAdminSnapshot } from "../dashboard/src/markdown-admin";
import { applySteps, sourceSnapshot } from "./protocol";
import { ShareError, type CheckpointBody, type CheckpointSummary, type CreateDocument, type DocumentSnapshot, type EditorContent, type PresenceIdentity, type PublicDocument, type SubmitSteps, type SyncUpdate } from "./types";

const DAY = 86_400_000;
type Row = { token: string; filename: string; format: "markdown" | "latex"; created_at: number; updated_at: number; expires_at: number; pinned: boolean; version: number; history_floor: number; content: EditorContent; source: string; request_hash: string };
const unavailable = () => new ShareError("DOCUMENT_UNAVAILABLE", "This document does not exist or has expired.");
const invalid = (message: string) => new ShareError("INVALID_EDITOR_PAYLOAD", message);
function document(row: Row): PublicDocument {
  return { token: row.token, filename: row.filename, format: row.format, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), expiresAt: Number(row.expires_at), pinned: row.pinned };
}
function summary(row: Record<string, unknown>): CheckpointSummary {
  return { _id: String(row.id), createdAt: Number(row.created_at), createdBy: String(row.created_by), charCount: Number(row.char_count), version: Number(row.version) };
}
function validateVersion(version: number) {
  if (!Number.isSafeInteger(version) || version < 0) throw invalid("Editor version must be a non-negative integer.");
}
export function documentChangeKey(token: string): string { return createHash("sha256").update(token).digest("hex"); }

export function createMarkdownShareRepository(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 4, idle_timeout: 120, connection: { jit: "off" } });
  async function live(tx: Sql, token: string, lock = false): Promise<Row> {
    const rows = lock
      ? await tx<Row[]>`SELECT * FROM tools.markdown_documents WHERE token=${token} FOR UPDATE`
      : await tx<Row[]>`SELECT * FROM tools.markdown_documents WHERE token=${token}`;
    const row = rows[0];
    if (!row || Number(row.expires_at) <= Date.now()) throw unavailable();
    return row;
  }
  async function notify(tx: Sql, token: string) { await tx`SELECT pg_notify('markdown_share', ${documentChangeKey(token)})`; }
  async function update(tx: Sql, row: Row, version: number): Promise<SyncUpdate> {
    validateVersion(version);
    if (version < row.history_floor) throw new ShareError("HISTORY_UNAVAILABLE", "Reload this document to get its current snapshot.");
    if (version > row.version) throw invalid("Editor version is ahead of this document.");
    const steps = await tx`SELECT step, client_id FROM tools.markdown_steps WHERE token=${row.token} AND version>${version} AND version<=${row.version} ORDER BY version LIMIT 1000`;
    const checkpoints = await tx`SELECT id, version, created_at, created_by, char_length(source) AS char_count FROM tools.markdown_checkpoints WHERE token=${row.token} ORDER BY created_at DESC, version DESC`;
    const now = Date.now();
    const presence = await tx`SELECT user_id, (array_agg(name ORDER BY touched_at DESC))[1] AS name,
      bool_or(disconnected_at IS NULL AND touched_at>${now - 45_000}) AS online,
      max(COALESCE(disconnected_at, touched_at+45000)) AS last_disconnected
      FROM tools.markdown_presence WHERE token=${row.token} GROUP BY user_id`;
    return { document: document(row), version: version + steps.length, steps: steps.map(s => s.step), clientIds: steps.map(s => String(s.client_id)), checkpoints: checkpoints.map(summary), presence: presence.map(p => ({ userId: String(p.user_id), name: String(p.name), online: Boolean(p.online), lastDisconnected: p.online ? 0 : Number(p.last_disconnected) })) };
  }
  return {
    async create(input: CreateDocument): Promise<PublicDocument> {
      if (typeof input.requestId !== "string" || input.requestId.length < 1 || input.requestId.length > 128) throw invalid("A creation request identifier is required.");
      if ((input.format !== "markdown" && input.format !== "latex") || typeof input.filename !== "string" || input.filename.length > 80 || !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\.(?:md|tex)$/.test(input.filename) || !input.filename.endsWith(input.format === "latex" ? ".tex" : ".md")) throw new ShareError("INVALID_FILENAME", "Use a short URL-safe filename matching the document format.");
      if (typeof input.markdown !== "string") throw invalid("Document source must be text.");
      const content = sourceSnapshot(input.markdown);
      const hash = createHash("sha256").update(JSON.stringify([input.filename, input.format, input.markdown])).digest("hex");
      return sql.begin(async transaction => {
        const tx = transaction as unknown as Sql;
        const now = Date.now();
        const token = randomBytes(32).toString("hex");
        await tx`INSERT INTO tools.markdown_documents (token,request_id,request_hash,filename,format,created_at,updated_at,expires_at,content,source)
          VALUES (${token},${input.requestId},${hash},${input.filename},${input.format},${now},${now},${now+7*DAY},${tx.json(content as never)},${input.markdown}) ON CONFLICT (request_id) DO NOTHING`;
        const [row] = await tx<Row[]>`SELECT * FROM tools.markdown_documents WHERE request_id=${input.requestId} FOR UPDATE`;
        if (row.request_hash !== hash) throw invalid("Creation request was already used for different content.");
        if (Number(row.expires_at) <= Date.now()) throw unavailable();
        return document(row);
      });
    },
    async open(token: string): Promise<DocumentSnapshot | null> {
      try { const row = await live(sql, token); return { document: document(row), content: row.content, version: row.version }; }
      catch (error) { if (error instanceof ShareError && error.data.code === "DOCUMENT_UNAVAILABLE") return null; throw error; }
    },
    async updates(token: string, version: number): Promise<SyncUpdate> {
      return sql.begin(async transaction => { const tx = transaction as unknown as Sql; return update(tx, await live(tx, token), version); });
    },
    async submit(token: string, input: SubmitSteps) {
      validateVersion(input.version);
      if (typeof input.clientId !== "string" || !input.clientId.length || input.clientId.length > 128 || !Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 1000) throw invalid("Submit between 1 and 1,000 editor steps with a client identifier.");
      return sql.begin(async transaction => {
        const tx = transaction as unknown as Sql;
        let row = await live(tx, token, true);
        if (input.version > row.version) throw invalid("Editor version is ahead of this document.");
        const status = input.version === row.version ? "synced" as const : "rebase" as const;
        if (status === "synced") {
          const accepted = applySteps(row.content, input.steps);
          for (let i=0; i<input.steps.length; i++) await tx`INSERT INTO tools.markdown_steps (token,version,step,client_id) VALUES (${token},${row.version+i+1},${tx.json(input.steps[i] as never)},${input.clientId})`;
          const now = Date.now();
          const [saved] = await tx<Row[]>`UPDATE tools.markdown_documents SET version=${row.version+input.steps.length}, content=${tx.json(accepted.content as never)}, source=${accepted.markdown}, updated_at=${now}, expires_at=${now+(row.pinned?30:7)*DAY} WHERE token=${token} RETURNING *`;
          row = saved;
          await notify(tx, token);
        }
        return { ...await update(tx, row, input.version), status };
      });
    },
    async setPinned(token: string, pinned: boolean): Promise<PublicDocument> {
      if (typeof pinned !== "boolean") throw invalid("Pinned must be a boolean.");
      return sql.begin(async transaction => {
        const tx = transaction as unknown as Sql; const row = await live(tx, token, true);
        const expires = pinned ? Math.max(Number(row.expires_at), Number(row.updated_at)+30*DAY) : Number(row.expires_at);
        const [saved] = await tx<Row[]>`UPDATE tools.markdown_documents SET pinned=${pinned}, expires_at=${expires} WHERE token=${token} RETURNING *`;
        await notify(tx, token); return document(saved);
      });
    },
    async checkpoint(token: string, createdBy: string): Promise<CheckpointSummary> {
      if (typeof createdBy !== "string" || !createdBy.trim() || createdBy.trim().length > 48) throw new ShareError("INVALID_CHECKPOINT", "Checkpoint author must contain 1 to 48 characters.");
      return sql.begin(async transaction => {
        const tx = transaction as unknown as Sql; const row = await live(tx, token, true);
        const existing = await tx`SELECT id, version, created_at, created_by, char_length(source) AS char_count FROM tools.markdown_checkpoints WHERE token=${token} ORDER BY version DESC`;
        const same = existing.find(c => c.version === row.version); if (same) return summary(same);
        if (existing.length >= 20) throw new ShareError("CHECKPOINT_LIMIT_REACHED", "This document already has 20 checkpoints.");
        const [saved] = await tx`INSERT INTO tools.markdown_checkpoints (id,token,version,created_at,created_by,source) VALUES (${randomUUID()},${token},${row.version},${Date.now()},${createdBy.trim()},${row.source}) RETURNING id, version, created_at, created_by, char_length(source) AS char_count`;
        await notify(tx, token); return summary(saved);
      });
    },
    async compare(token: string, olderId: string, newerId: string) {
      await live(sql, token);
      if (olderId === newerId) throw new ShareError("INVALID_CHECKPOINT", "Choose two different checkpoints.");
      const rows = await sql`SELECT * FROM tools.markdown_checkpoints WHERE token=${token} AND id::text IN (${olderId},${newerId})`;
      const body = (id: string): CheckpointBody => { const row = rows.find(r => r.id === id); if (!row) throw new ShareError("INVALID_CHECKPOINT", "A selected checkpoint is unavailable."); return { _id: String(row.id), createdAt: Number(row.created_at), createdBy: String(row.created_by), version: Number(row.version), markdown: String(row.source) }; };
      return { older: body(olderId), newer: body(newerId) };
    },
    async touch(token: string, identity: PresenceIdentity): Promise<void> {
      if (![identity.sessionId, identity.userId, identity.name].every(v => typeof v === "string" && v.trim().length > 0 && v.length <= 128) || identity.name.trim().length > 48) throw new ShareError("INVALID_DISPLAY_NAME", "Use a name with 1 to 48 characters and valid session identifiers.");
      await sql.begin(async transaction => {
        const tx = transaction as unknown as Sql; await live(tx, token, true);
        await tx`INSERT INTO tools.markdown_presence (token,session_id,user_id,name,touched_at) VALUES (${token},${identity.sessionId},${identity.userId},${identity.name.trim()},${Date.now()}) ON CONFLICT (token,session_id) DO UPDATE SET user_id=EXCLUDED.user_id,name=EXCLUDED.name,touched_at=EXCLUDED.touched_at,disconnected_at=NULL`;
        await notify(tx, token);
      });
    },
    async leave(token: string, sessionId: string): Promise<void> {
      await sql.begin(async transaction => {
        const tx = transaction as unknown as Sql; await live(tx, token, true);
        await tx`UPDATE tools.markdown_presence SET disconnected_at=${Date.now()} WHERE token=${token} AND session_id=${sessionId} AND disconnected_at IS NULL`;
        await notify(tx, token);
      });
    },
    async list(cursor?: string, asOf = Date.now()): Promise<MarkdownAdminSnapshot> {
      if (!Number.isSafeInteger(asOf) || asOf < 0 || (cursor !== undefined && !/^[A-Za-z0-9_-]{20,128}$/.test(cursor))) throw invalid("Invalid document list cursor.");
      const rows = await sql`SELECT d.token, d.filename, d.format, d.created_at, d.updated_at, d.expires_at, d.pinned, (SELECT count(*)::int FROM tools.markdown_checkpoints c WHERE c.token=d.token) AS checkpoint_count FROM tools.markdown_documents d WHERE expires_at>${Date.now()} AND created_at<=${asOf} AND token>${cursor ?? ""} ORDER BY token LIMIT 201`;
      return { generatedAt: asOf, documents: rows.slice(0,200).map(r => ({ ...document(r as Row), checkpointCount: Number(r.checkpoint_count) })), truncated: rows.length>200, ...(rows.length>200 ? { nextCursor: String(rows[199].token) } : {}) };
    },
    async expire(limit = 100): Promise<number> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw invalid("Expiry batch must contain 1 to 1,000 documents.");
      return sql.begin(async transaction => {
        const tx = transaction as unknown as Sql;
        const rows = await tx`WITH expired AS (SELECT token FROM tools.markdown_documents WHERE expires_at<=${Date.now()} ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT ${limit}) DELETE FROM tools.markdown_documents d USING expired e WHERE d.token=e.token RETURNING d.token`;
        for (const row of rows) await notify(tx, String(row.token));
        await tx`DELETE FROM tools.markdown_presence WHERE ctid IN (SELECT ctid FROM tools.markdown_presence WHERE greatest(touched_at, COALESCE(disconnected_at,0))<${Date.now()-DAY} LIMIT 1000 FOR UPDATE SKIP LOCKED)`;
        return rows.length;
      });
    },
    async readiness(): Promise<void> { await sql`SELECT token FROM tools.markdown_documents LIMIT 0`; },
    async close(): Promise<void> { await sql.end({ timeout: 5 }); },
  };
}
