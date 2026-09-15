import { defineConfig } from "drizzle-kit";
import { consumePushHandoff } from "./postgres-push-guard.js";

const databaseUrl = consumePushHandoff(process.env);

export default defineConfig({
  dialect: "postgresql",
  schema: "./postgres-schema.ts",
  dbCredentials: { url: databaseUrl },
  schemaFilter: ["artifacts"],
  tablesFilter: ["objects", "operations", "upload_links"],
});
