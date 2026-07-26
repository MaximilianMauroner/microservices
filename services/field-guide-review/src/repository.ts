import type { Config } from "./config.js";
import { openSQLite, type SQLiteHandle } from "./db/sqlite.js";
import { importPostgresToSQLite } from "./db/transfer.js";
import { PostgresReviewRepository } from "./postgres-repository.js";
import { SQLiteReviewRepository } from "./sqlite-repository.js";
import type { ReviewRepository } from "./types.js";

export type RepositoryHandle = { repository:ReviewRepository; checkpoint:()=>void; close:()=>Promise<void> };
export async function createRepository(config:Config):Promise<RepositoryHandle> {
  if(config.backend==="postgres") { const repository=new PostgresReviewRepository(config.databaseUrl); return {repository,checkpoint:()=>undefined,close:()=>repository.close()}; }
  const sqlite=openSQLite(config.sqlitePath);
  try {
    if(config.importOnStart){if(!config.databaseUrl)throw new Error("IMPORT_POSTGRES_ON_START requires DATABASE_URL.");await importPostgresToSQLite(sqlite.client,config.databaseUrl);}
    const repository=new SQLiteReviewRepository(sqlite.client,sqlite.close);
    return {repository,checkpoint:sqlite.checkpoint,close:()=>repository.close()};
  } catch(error){sqlite.close();throw error;}
}
