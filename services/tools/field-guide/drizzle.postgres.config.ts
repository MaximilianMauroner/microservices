import { defineConfig } from "drizzle-kit";
import { consumePushHandoff } from "./src/postgres-push-guard.js";

const databaseUrl = consumePushHandoff(process.env);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/postgres-schema.ts",
  dbCredentials: { url: databaseUrl },
  schemaFilter: ["field_guide"],
  tablesFilter: ["candidates", "review_rounds", "verdict_events", "application_receipts", "field_guide_schema_migrations", "decision_records", "decision_feedback_events", "decision_promotions", "decision_promotion_records"],
});
