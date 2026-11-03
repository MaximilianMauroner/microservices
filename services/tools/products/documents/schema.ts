import type { Sql } from "postgres";

/**
 * Creates or upgrades the Document Share tables. A document belongs to the person in
 * `owner_subject`. Documents from before that column belong to the admin. A second run changes nothing.
 */
export async function applyMarkdownShareSchema(sql: Sql, adminSubject: string | undefined): Promise<void> {
  await sql.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(728431905)`;
    await transaction.unsafe(`
    CREATE SCHEMA IF NOT EXISTS tools;
    CREATE TABLE IF NOT EXISTS tools.markdown_documents (
      token text PRIMARY KEY, request_id text NOT NULL, request_hash text NOT NULL,
      owner_subject text NOT NULL,
      filename text NOT NULL, format text NOT NULL CHECK (format IN ('markdown', 'latex')),
      created_at bigint NOT NULL, updated_at bigint NOT NULL, expires_at bigint NOT NULL,
      pinned boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 0,
      history_floor integer NOT NULL DEFAULT 0,
      content jsonb NOT NULL, source text NOT NULL
    );
    ALTER TABLE tools.markdown_documents ADD COLUMN IF NOT EXISTS history_floor integer NOT NULL DEFAULT 0;
    ALTER TABLE tools.markdown_documents ADD COLUMN IF NOT EXISTS owner_subject text;
    CREATE INDEX IF NOT EXISTS markdown_expiry ON tools.markdown_documents (expires_at);
    CREATE INDEX IF NOT EXISTS markdown_owner_token ON tools.markdown_documents (owner_subject, token);
    CREATE TABLE IF NOT EXISTS tools.markdown_steps (
      token text NOT NULL REFERENCES tools.markdown_documents(token) ON DELETE CASCADE,
      version integer NOT NULL, step jsonb NOT NULL, client_id text NOT NULL,
      PRIMARY KEY (token, version)
    );
    CREATE TABLE IF NOT EXISTS tools.markdown_checkpoints (
      id uuid PRIMARY KEY, token text NOT NULL REFERENCES tools.markdown_documents(token) ON DELETE CASCADE,
      version integer NOT NULL, created_at bigint NOT NULL, created_by text NOT NULL, source text NOT NULL
    );
    ALTER TABLE tools.markdown_checkpoints DROP CONSTRAINT IF EXISTS markdown_checkpoints_token_version_key;
    CREATE INDEX IF NOT EXISTS markdown_checkpoint_versions ON tools.markdown_checkpoints (token, version);
    CREATE TABLE IF NOT EXISTS tools.markdown_presence (
      token text NOT NULL REFERENCES tools.markdown_documents(token) ON DELETE CASCADE,
      session_id text NOT NULL, user_id text NOT NULL, name text NOT NULL,
      touched_at bigint NOT NULL, disconnected_at bigint,
      PRIMARY KEY (token, session_id)
    );
  `);
    const [{ unowned }] = await transaction<{ unowned: number }[]>`SELECT count(*)::int unowned FROM tools.markdown_documents WHERE owner_subject IS NULL`;
    if (unowned > 0) {
      if (!adminSubject) throw new Error(`AUTH_ALLOWED_GOOGLE_SUBJECT is required to give ${unowned} existing tools.markdown_documents rows to the admin.`);
      await transaction`UPDATE tools.markdown_documents SET owner_subject=${adminSubject} WHERE owner_subject IS NULL`;
    }
    await transaction`ALTER TABLE tools.markdown_documents ALTER COLUMN owner_subject SET NOT NULL`;
    // A creation request is unique per person, so a replay never returns another person's document.
    await transaction`CREATE UNIQUE INDEX IF NOT EXISTS markdown_owner_request ON tools.markdown_documents (owner_subject, request_id)`;
    await transaction`ALTER TABLE tools.markdown_documents DROP CONSTRAINT IF EXISTS markdown_documents_request_id_key`;
  });
}
