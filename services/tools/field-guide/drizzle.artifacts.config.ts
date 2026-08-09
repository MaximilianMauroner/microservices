import { defineConfig } from "drizzle-kit";
import { consumePushHandoff } from "./src/postgres-push-guard.js";

const databaseUrl = consumePushHandoff(process.env);

export default defineConfig({
  dialect: "postgresql",
  schema: "../database/postgres-schema.ts",
  dbCredentials: { url: databaseUrl },
  schemaFilter: ["artifacts"],
  tablesFilter: ["objects", "operations"],
});
