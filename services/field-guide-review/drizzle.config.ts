import { defineConfig } from "drizzle-kit";

const sqlitePath = process.env.SQLITE_PATH?.trim() ?? "/app/data/field-guide.sqlite";
if (!sqlitePath.startsWith("/")) throw new Error("SQLITE_PATH must be absolute.");

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: sqlitePath },
});
