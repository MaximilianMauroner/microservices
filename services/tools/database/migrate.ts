import postgres from "postgres";
import { readFile } from "node:fs/promises";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 1 });
try {
  const migration = await readFile(new URL("001_runtime_schemas.sql", import.meta.url), "utf8");
  await sql.unsafe(migration);
} finally {
  await sql.end();
}
