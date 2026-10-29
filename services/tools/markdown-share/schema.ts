import type { Sql } from "postgres";

export async function applyMarkdownShareSchema(sql: Sql): Promise<void> {
  await sql.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(728431905)`;
    await transaction.unsafe(`
    CREATE SCHEMA IF NOT EXISTS tools;
    CREATE TABLE IF NOT EXISTS tools.markdown_documents (
      token text PRIMARY KEY, request_id text UNIQUE NOT NULL, request_hash text NOT NULL,
      filename text NOT NULL, format text NOT NULL CHECK (format IN ('markdown', 'latex')),
      created_at bigint NOT NULL, updated_at bigint NOT NULL, expires_at bigint NOT NULL,
      pinned boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 0,
      history_floor integer NOT NULL DEFAULT 0,
      content jsonb NOT NULL, source text NOT NULL
    );
    ALTER TABLE tools.markdown_documents ADD COLUMN IF NOT EXISTS history_floor integer NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS markdown_expiry ON tools.markdown_documents (expires_at);
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
  });
}
