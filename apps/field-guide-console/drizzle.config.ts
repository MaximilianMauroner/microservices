import { defineConfig } from "drizzle-kit";
import { consumeSQLitePushHandoff } from "./src/sqlite-push-guard.js";

const sqlitePath = consumeSQLitePushHandoff(process.env);

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  dbCredentials: { url: sqlitePath },
});
