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
    "money_accounts",
    "money_imports",
    "money_instruments",
    "money_instrument_aliases",
    "money_market_series",
    "money_daily_prices",
    "money_fx_rates",
    "money_transactions",
    "money_investment_events",
    "money_category_rules",
    "money_balance_snapshots",
  ],
});
