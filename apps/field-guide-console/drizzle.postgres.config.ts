import { defineConfig } from "drizzle-kit";
import { PUSH_AUTHORIZATION } from "./src/postgres-push-guard.js";

if (process.env.FIELD_GUIDE_SCHEMA_PUSH_AUTHORIZATION !== PUSH_AUTHORIZATION) {
  throw new Error("PostgreSQL schema push must run through the guarded db:push-postgres command.");
}
const databaseUrl = process.env.FIELD_GUIDE_SCHEMA_PUSH_URL?.trim();
if (!databaseUrl) throw new Error("Guarded PostgreSQL schema push URL is missing.");
const parsed = new URL(databaseUrl);
if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname === "/") throw new Error("Guarded PostgreSQL schema push URL is invalid.");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/postgres-schema.ts",
  dbCredentials: { url: databaseUrl },
  schemaFilter: ["public"],
  tablesFilter: ["candidates", "review_rounds", "verdict_events", "application_receipts", "field_guide_schema_migrations", "decision_records", "decision_feedback_events", "decision_promotions", "decision_promotion_records"],
});
