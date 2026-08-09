import { defineConfig } from "drizzle-kit";
import { consumePushHandoff } from "./src/postgres-push-guard.js";

const databaseUrl = consumePushHandoff(process.env);

export default defineConfig({
  dialect: "postgresql",
  schema: "../database/postgres-schema.ts",
  dbCredentials: { url: databaseUrl },
  schemaFilter: ["tools"],
  tablesFilter: [
    "check_runs",
    "observations",
    "incidents",
    "heartbeats",
    "monitor_overrides",
    "scheduled_task_runs",
    "checker_states",
    "history_partitions",
  ],
});
