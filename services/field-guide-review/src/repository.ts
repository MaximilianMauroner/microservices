import type { Config } from "./config.js";
import { openSQLite, type SQLiteHandle } from "./db/sqlite.js";
import { importPostgresToSQLite } from "./db/transfer.js";
import { PostgresReviewRepository } from "./postgres-repository.js";
import { SQLiteReviewRepository } from "./sqlite-repository.js";
import type { ReviewRepository } from "./types.js";
import type { SnapshotReport } from "./db/logical-snapshot.js";

export type RepositoryHandle = { repository:ReviewRepository; checkpoint:()=>void; close:()=>Promise<void>; startupReport?:SnapshotReport };
export async function createRepository(config:Config,dependencies:{openSQLite?:typeof openSQLite;importPostgresToSQLite?:typeof importPostgresToSQLite}={}):Promise<RepositoryHandle> {
  if(config.backend==="postgres") { const repository=new PostgresReviewRepository(config.databaseUrl); return {repository,checkpoint:()=>undefined,close:()=>repository.close()}; }
  const sqlite=(dependencies.openSQLite??openSQLite)(config.sqlitePath);
  try {
    let startupReport:SnapshotReport|undefined;
    if(config.importOnStart){if(!config.databaseUrl)throw new Error("IMPORT_POSTGRES_ON_START requires DATABASE_URL.");startupReport=await (dependencies.importPostgresToSQLite??importPostgresToSQLite)(sqlite.client,config.databaseUrl,config.importAllowOverwrite);}
    const repository=new SQLiteReviewRepository(sqlite.client,sqlite.close);
    return {repository,checkpoint:sqlite.checkpoint,close:()=>repository.close(),...(startupReport?{startupReport}:{})};
  } catch(error){sqlite.close();throw error;}
}
