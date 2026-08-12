import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const toolsSchema = pgSchema("tools");
export const artifactsSchema = pgSchema("artifacts");

export const checkRuns = toolsSchema.table("check_runs", {
  id: text("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const observations = toolsSchema.table("observations", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => checkRuns.id),
  monitorId: text("monitor_id").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  success: boolean("success").notNull(),
  statusCode: integer("status_code"),
  latencyMs: integer("latency_ms").notNull(),
  errorCode: text("error_code"),
}, (table) => [index("observations_monitor_checked_idx").on(table.monitorId, table.checkedAt)]);

export const incidents = toolsSchema.table("incidents", {
  id: text("id").primaryKey(),
  monitorId: text("monitor_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  openingObservationId: text("opening_observation_id"),
  closingObservationId: text("closing_observation_id"),
}, (table) => [index("incidents_monitor_started_idx").on(table.monitorId, table.startedAt)]);

export const heartbeats = toolsSchema.table("heartbeats", {
  monitorId: text("monitor_id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
});

export const monitorOverrides = toolsSchema.table("monitor_overrides", {
  monitorId: text("monitor_id").primaryKey(),
  paused: boolean("paused").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const scheduledTaskRuns = toolsSchema.table("scheduled_task_runs", {
  taskId: text("task_id").notNull(),
  slot: timestamp("slot", { withTimezone: true }).notNull(),
  ownerId: text("owner_id").notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  result: jsonb("result").$type<Record<string, unknown>>(),
}, (table) => [primaryKey({ columns: [table.taskId, table.slot] })]);

export const moneyAccounts = toolsSchema.table("money_accounts", {
  id: uuid("id").primaryKey(),
  provider: text("provider").notNull(),
  externalRef: text("external_ref").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  currency: text("currency").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  check("money_accounts_provider_check", sql`${table.provider} in ('revolut', 'portfolio_export', 'manual', 'sparkasse')`),
  check("money_accounts_role_check", sql`${table.role} in ('cash', 'investment')`),
  check("money_accounts_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  uniqueIndex("money_accounts_provider_ref_idx").on(table.provider, table.externalRef),
]);

export const moneyImports = toolsSchema.table("money_imports", {
  id: uuid("id").primaryKey(),
  digest: text("digest").notNull().unique(),
  format: text("format").notNull(),
  filename: text("filename").notNull(),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  sourceRowCount: integer("source_row_count").notNull(),
  insertedRowCount: integer("inserted_row_count").notNull(),
  duplicateRowCount: integer("duplicate_row_count").notNull(),
  warnings: jsonb("warnings").$type<string[]>().notNull(),
  committedAt: timestamp("committed_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull(),
}, (table) => [
  check("money_imports_format_check", sql`${table.format} in ('revolut_cash_statement_v1', 'revolut_trading_statement_v1', 'portfolio_transaction_export_v1', 'money_balance_snapshot_v1', 'sparkasse_cash_statement_v1')`),
  check("money_imports_bytes_check", sql`${table.bytes} > 0`),
  check("money_imports_row_counts_check", sql`${table.sourceRowCount} >= 0 and ${table.insertedRowCount} >= 0 and ${table.duplicateRowCount} >= 0 and ${table.insertedRowCount} + ${table.duplicateRowCount} = ${table.sourceRowCount}`),
  index("money_imports_committed_idx").on(table.committedAt),
]);

export const moneyInstruments = toolsSchema.table("money_instruments", {
  id: uuid("id").primaryKey(),
  canonicalKey: text("canonical_key").notNull().unique(),
  name: text("name").notNull(),
  assetClass: text("asset_class").notNull(),
  isin: text("isin"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  check("money_instruments_asset_class_check", sql`${table.assetClass} in ('equity', 'etf', 'crypto')`),
  check("money_instruments_isin_check", sql`${table.isin} is null or ${table.isin} ~ '^[A-Z]{2}[A-Z0-9]{10}$'`),
  uniqueIndex("money_instruments_isin_idx").on(table.isin),
]);

export const moneyInstrumentAliases = toolsSchema.table("money_instrument_aliases", {
  sourceProvider: text("source_provider").notNull(),
  sourceSymbol: text("source_symbol").notNull(),
  instrumentId: uuid("instrument_id").notNull().references(() => moneyInstruments.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.sourceProvider, table.sourceSymbol] }),
  check("money_instrument_aliases_provider_check", sql`${table.sourceProvider} in ('revolut', 'portfolio_export')`),
  index("money_instrument_aliases_instrument_idx").on(table.instrumentId),
]);

export const moneyMarketSeries = toolsSchema.table("money_market_series", {
  id: uuid("id").primaryKey(),
  instrumentId: uuid("instrument_id").notNull().references(() => moneyInstruments.id),
  provider: text("provider").notNull(),
  providerKey: text("provider_key").notNull(),
  quoteCurrency: text("quote_currency").notNull(),
  timezone: text("timezone").notNull(),
  active: boolean("active").notNull().default(true),
  firstRequiredDate: date("first_required_date"),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  check("money_market_series_provider_check", sql`${table.provider} = 'yahoo_chart'`),
  check("money_market_series_currency_check", sql`${table.quoteCurrency} in ('EUR', 'USD')`),
  uniqueIndex("money_market_series_provider_key_idx").on(table.provider, table.providerKey),
  index("money_market_series_instrument_idx").on(table.instrumentId),
]);

export const moneyDailyPrices = toolsSchema.table("money_daily_prices", {
  seriesId: uuid("series_id").notNull().references(() => moneyMarketSeries.id),
  priceDate: date("price_date").notNull(),
  close: numeric("close", { precision: 30, scale: 12 }).notNull(),
  currency: text("currency").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.seriesId, table.priceDate] }),
  check("money_daily_prices_close_check", sql`${table.close} > 0`),
  check("money_daily_prices_currency_check", sql`${table.currency} in ('EUR', 'USD')`),
  index("money_daily_prices_date_idx").on(table.priceDate),
]);

export const moneyFxRates = toolsSchema.table("money_fx_rates", {
  rateDate: date("rate_date").notNull(),
  quoteCurrency: text("quote_currency").notNull(),
  quotePerEuro: numeric("quote_per_euro", { precision: 30, scale: 12 }).notNull(),
  provider: text("provider").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.rateDate, table.quoteCurrency] }),
  check("money_fx_rates_currency_check", sql`${table.quoteCurrency} = 'USD'`),
  check("money_fx_rates_provider_check", sql`${table.provider} = 'ecb'`),
  check("money_fx_rates_value_check", sql`${table.quotePerEuro} > 0`),
]);

export const moneyInflationIndices = toolsSchema.table("money_inflation_indices", {
  indexDate: date("index_date").primaryKey(),
  value: numeric("value", { precision: 30, scale: 12 }).notNull(),
  provider: text("provider").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
}, (table) => [
  check("money_inflation_indices_provider_check", sql`${table.provider} = 'ecb_hicp'`),
  check("money_inflation_indices_value_check", sql`${table.value} > 0`),
]);

export const moneyTransactions = toolsSchema.table("money_transactions", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id").notNull().references(() => moneyAccounts.id),
  importId: uuid("import_id").notNull().references(() => moneyImports.id),
  sourceKey: text("source_key").notNull().unique(),
  sourceRow: integer("source_row").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  localDate: date("local_date").notNull(),
  description: text("description").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  feeMinor: bigint("fee_minor", { mode: "number" }).notNull(),
  taxMinor: bigint("tax_minor", { mode: "number" }).notNull(),
  baseAmountMinor: bigint("base_amount_minor", { mode: "number" }),
  baseFeeMinor: bigint("base_fee_minor", { mode: "number" }),
  baseTaxMinor: bigint("base_tax_minor", { mode: "number" }),
  baseCurrency: text("base_currency"),
  balanceAfterMinor: bigint("balance_after_minor", { mode: "number" }),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  sourceType: text("source_type").notNull(),
  mcc: text("mcc"),
  flowKind: text("flow_kind").notNull(),
  category: text("category").notNull(),
  categoryOrigin: text("category_origin").notNull(),
  transferGroupId: uuid("transfer_group_id"),
  transferDisposition: text("transfer_disposition"),
}, (table) => [
  check("money_transactions_source_row_check", sql`${table.sourceRow} > 1`),
  check("money_transactions_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check("money_transactions_base_currency_check", sql`${table.baseCurrency} is null or ${table.baseCurrency} = 'EUR'`),
  check("money_transactions_status_check", sql`${table.status} in ('completed', 'reverted')`),
  check("money_transactions_flow_kind_check", sql`${table.flowKind} in ('spend', 'income', 'refund', 'transfer', 'trade', 'investment_income', 'fee', 'tax', 'balance_adjustment')`),
  check("money_transactions_category_check", sql`${table.category} in ('housing', 'groceries', 'dining', 'transport', 'shopping', 'health', 'personal_care', 'travel', 'subscriptions', 'education', 'entertainment', 'gifts', 'taxes', 'fees', 'cash', 'investments', 'income', 'transfer', 'adjustment', 'other', 'uncategorized')`),
  check("money_transactions_category_origin_check", sql`${table.categoryOrigin} in ('source', 'rule', 'manual')`),
  check("money_transactions_transfer_disposition_check", sql`${table.transferDisposition} is null or (${table.flowKind} = 'transfer' and ${table.transferDisposition} in ('internal_transfer', 'income', 'spend', 'refund', 'excluded'))`),
  index("money_transactions_occurred_idx").on(table.occurredAt),
  index("money_transactions_account_date_idx").on(table.accountId, table.localDate),
  index("money_transactions_flow_date_idx").on(table.flowKind, table.localDate),
  index("money_transactions_category_date_idx").on(table.category, table.localDate),
  index("money_transactions_transfer_group_idx").on(table.transferGroupId),
]);

export const moneyInvestmentEvents = toolsSchema.table("money_investment_events", {
  id: uuid("id").primaryKey(),
  transactionId: uuid("transaction_id").notNull().references(() => moneyTransactions.id).unique(),
  instrumentId: uuid("instrument_id").references(() => moneyInstruments.id),
  eventKind: text("event_kind").notNull(),
  symbol: text("symbol"),
  name: text("name"),
  assetClass: text("asset_class"),
  quantity: numeric("quantity", { precision: 30, scale: 12 }),
  unitPrice: numeric("unit_price", { precision: 30, scale: 12 }),
  priceCurrency: text("price_currency"),
  fxRate: numeric("fx_rate", { precision: 30, scale: 12 }),
}, (table) => [
  check("money_investment_events_kind_check", sql`${table.eventKind} in ('buy', 'sell', 'dividend', 'fee', 'tax', 'split', 'cash_transfer', 'position_transfer', 'delivery')`),
  check("money_investment_events_price_currency_check", sql`${table.priceCurrency} is null or ${table.priceCurrency} ~ '^[A-Z]{3}$'`),
  index("money_investment_events_symbol_idx").on(table.symbol),
  index("money_investment_events_instrument_idx").on(table.instrumentId),
]);

export const moneyCategoryRules = toolsSchema.table("money_category_rules", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id").notNull().references(() => moneyAccounts.id),
  priority: integer("priority").notNull(),
  matchField: text("match_field").notNull(),
  matchValue: text("match_value").notNull(),
  category: text("category").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull(),
}, (table) => [
  check("money_category_rules_field_check", sql`${table.matchField} in ('description', 'mcc', 'source_type')`),
  check("money_category_rules_category_check", sql`${table.category} in ('housing', 'groceries', 'dining', 'transport', 'shopping', 'health', 'personal_care', 'travel', 'subscriptions', 'education', 'entertainment', 'gifts', 'taxes', 'fees', 'cash', 'investments', 'income', 'transfer', 'adjustment', 'other', 'uncategorized')`),
  uniqueIndex("money_category_rules_unique_idx").on(table.accountId, table.matchField, table.matchValue),
  index("money_category_rules_priority_idx").on(table.priority),
]);

export const moneyBalanceSnapshots = toolsSchema.table("money_balance_snapshots", {
  accountId: uuid("account_id").notNull().references(() => moneyAccounts.id),
  snapshotDate: date("snapshot_date").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  valueMinor: bigint("value_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  origin: text("origin").notNull(),
  importId: uuid("import_id").references(() => moneyImports.id),
}, (table) => [
  primaryKey({ columns: [table.accountId, table.snapshotDate, table.origin] }),
  check("money_balance_snapshots_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check("money_balance_snapshots_origin_check", sql`${table.origin} in ('import', 'manual')`),
  index("money_balance_snapshots_date_idx").on(table.snapshotDate),
]);

export const checkerStates = toolsSchema.table("checker_states", {
  environment: text("environment").primaryKey(),
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const historyPartitions = toolsSchema.table("history_partitions", {
  environment: text("environment").notNull(),
  day: date("day").notNull(),
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [primaryKey({ columns: [table.environment, table.day] })]);

export const objects = artifactsSchema.table("objects", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  objectKey: text("object_key").notNull().unique(),
  project: text("project"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  check("objects_kind_check", sql`${table.kind} in ('html', 'file')`),
  check("objects_bytes_check", sql`${table.bytes} >= 0`),
]);

export const operations = artifactsSchema.table("operations", {
  operationId: uuid("operation_id").primaryKey(),
  artifactId: text("artifact_id").notNull(),
  ownerId: text("owner_id").notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
  operationKind: text("operation_kind").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("operations_operation_kind_check", sql`${table.operationKind} in ('put_html', 'put_file', 'delete')`),
  index("artifact_operations_created_idx").on(table.createdAt),
  uniqueIndex("artifact_operations_artifact_idx").on(table.artifactId),
]);
