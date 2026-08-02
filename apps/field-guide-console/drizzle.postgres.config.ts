import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for disposable PostgreSQL tests.");
const parsed = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname === '/') throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/postgres-schema.ts",
  dbCredentials: { url: databaseUrl },
  schemaFilter: ["public"],
  tablesFilter: ["candidates", "review_rounds", "verdict_events", "application_receipts", "field_guide_schema_migrations", "decision_records", "decision_feedback_events", "decision_promotions", "decision_promotion_records"],
});
