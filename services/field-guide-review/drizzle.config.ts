import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be a non-empty PostgreSQL URL.");
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
}
if (
  !["postgres:", "postgresql:"].includes(parsedUrl.protocol) ||
  !parsedUrl.hostname ||
  parsedUrl.pathname === "/"
) {
  throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: { url: databaseUrl },
  schemaFilter: ["public"],
  tablesFilter: [
    "candidates",
    "review_rounds",
    "verdict_events",
    "application_receipts",
  ],
});
