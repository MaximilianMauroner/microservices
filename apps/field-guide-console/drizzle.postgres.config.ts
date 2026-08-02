import { defineConfig } from "drizzle-kit";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || undefined;
const databaseUrl = testDatabaseUrl ?? (process.env.DATABASE_URL?.trim() || undefined);
const source = testDatabaseUrl ? "TEST_DATABASE_URL" : "DATABASE_URL";
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for PostgreSQL schema push.");
if (!testDatabaseUrl && process.env.FIELD_GUIDE_SCHEMA_PUSH_CONFIRM !== "field-guide-console-production") {
  throw new Error("Production schema push requires FIELD_GUIDE_SCHEMA_PUSH_CONFIRM=field-guide-console-production.");
}
const parsed = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname === '/') throw new Error(`${source} must be a valid PostgreSQL URL.`);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/postgres-schema.ts",
  dbCredentials: { url: databaseUrl },
  schemaFilter: ["public"],
  tablesFilter: ["candidates", "review_rounds", "verdict_events", "application_receipts", "field_guide_schema_migrations", "decision_records", "decision_feedback_events", "decision_promotions", "decision_promotion_records"],
});
