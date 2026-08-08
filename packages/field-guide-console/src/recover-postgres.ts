import { loadConfig } from "./config.js";
import { openSQLite } from "./db/sqlite.js";
import { recoverSQLiteToPostgres } from "./db/transfer.js";
const config=loadConfig();
const target=process.env.RECOVERY_DATABASE_URL?.trim();
if(config.backend!=="sqlite"||!target||process.env.FIELD_GUIDE_RECOVERY_CONFIRM!=="field-guide-console-recovery")throw new Error("Recovery requires SQLite config, RECOVERY_DATABASE_URL, and FIELD_GUIDE_RECOVERY_CONFIRM=field-guide-console-recovery.");
const handle=openSQLite(config.sqlitePath);
try{console.log(JSON.stringify(await recoverSQLiteToPostgres(handle.client,target,process.env.FIELD_GUIDE_RECOVERY_ALLOW_NONEMPTY==="yes")));}finally{handle.close();}
