import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

export type SQLiteHandle = {
  client: Database;
  checkpoint: () => void;
  close: () => void;
};

export function openSQLite(path: string): SQLiteHandle {
  mkdirSync(dirname(path), { recursive: true });
  const client = new Database(path, { create: true, readwrite: true });
  client.exec("PRAGMA foreign_keys=ON");
  client.exec("PRAGMA busy_timeout=5000");
  client.exec("PRAGMA journal_mode=WAL");
  client.exec("PRAGMA synchronous=NORMAL");
  migrate(drizzle({ client }), { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  if (Number(client.query<{ foreign_keys:number }, []>("PRAGMA foreign_keys").get()?.foreign_keys) !== 1) {
    client.close();
    throw new Error("SQLite foreign key enforcement is unavailable.");
  }
  const violations = client.query("PRAGMA foreign_key_check").all();
  if (violations.length) {
    client.close();
    throw new Error(`SQLite foreign key check failed (${violations.length} violations).`);
  }
  let closed = false;
  return {
    client,
    checkpoint: () => { if (!closed) client.exec("PRAGMA wal_checkpoint(TRUNCATE)"); },
    close: () => { if (!closed) { closed = true; client.close(); } },
  };
}
