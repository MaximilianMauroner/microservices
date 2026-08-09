import postgres from "postgres";
import { readFile } from "node:fs/promises";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 1 });
try {
  for (const filename of ["001_runtime_schemas.sql", "002_status_runtime.sql", "003_artifact_operations.sql"]) {
    const migration = await readFile(new URL(filename, import.meta.url), "utf8");
    await sql.unsafe(migration);
  }
} finally {
  await sql.end();
}
