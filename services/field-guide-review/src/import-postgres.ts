import { loadConfig } from "./config.js";
import { openSQLite } from "./db/sqlite.js";
import { importPostgresToSQLite } from "./db/transfer.js";
const config=loadConfig();
if(config.backend!=="sqlite"||!config.databaseUrl)throw new Error("SQLite import requires DATABASE_BACKEND=sqlite, SQLITE_PATH, and DATABASE_URL.");
const handle=openSQLite(config.sqlitePath);
try{console.log(JSON.stringify(await importPostgresToSQLite(handle.client,config.databaseUrl,process.env.FIELD_GUIDE_IMPORT_ALLOW_OVERWRITE==="yes")));}finally{handle.checkpoint();handle.close();}
