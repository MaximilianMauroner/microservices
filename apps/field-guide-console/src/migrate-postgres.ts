import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";

const migrations = [
  {
    name: "20260802120000_decision_records_postgres",
    url: new URL("../postgres-migrations/20260802120000_decision_records.sql", import.meta.url),
  },
] as const;

export async function migratePostgres(sql: Sql) {
  for (const migration of migrations) {
    const source = await readFile(migration.url, "utf8");
    const checksum = crypto.createHash("sha256").update(source).digest("hex");
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(682310904292014)`;
      await tx`CREATE TABLE IF NOT EXISTS field_guide_schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL,
        adopted boolean NOT NULL
      )`;
      const rows = await tx<{ checksum: string }[]>`
        SELECT checksum FROM field_guide_schema_migrations WHERE name=${migration.name}`;
      if (rows[0]) {
        if (rows[0].checksum !== checksum)
          throw new Error(`PostgreSQL migration checksum mismatch: ${migration.name}`);
        return;
      }
      await tx.unsafe(source);
      await tx`INSERT INTO field_guide_schema_migrations(name,checksum,applied_at,adopted)
        VALUES(${migration.name},${checksum},now(),false)`;
    });
  }
}

if (import.meta.main) {
  const url = process.env.FIELD_GUIDE_DATABASE_URL?.trim();
  if (!url) throw new Error("FIELD_GUIDE_DATABASE_URL is required.");
  const sql = postgres(url, { max: 1, connection: { search_path: "public" } });
  try {
    await migratePostgres(sql);
  } finally {
    await sql.end();
  }
}
