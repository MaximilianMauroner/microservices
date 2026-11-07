import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
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

export const feedbackForms = toolsSchema.table("feedback_forms", {
  id: uuid("id").primaryKey(),
  ownerSubject: text("owner_subject").notNull(),
  publicToken: text("public_token").notNull().unique(),
  language: text("language").notNull().default("en"),
  title: text("title").notNull(),
  introduction: text("introduction").notNull(),
  questions: jsonb("questions").$type<readonly Record<string, unknown>[]>().notNull(),
  translations: jsonb("translations").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  check("feedback_forms_language_check", sql`${table.language} in ('en', 'de')`),
  check("feedback_forms_status_check", sql`${table.status} in ('draft', 'active', 'closed')`),
  index("feedback_forms_updated_idx").on(table.ownerSubject, table.updatedAt),
]);

export const feedbackSubmissions = toolsSchema.table("feedback_submissions", {
  id: uuid("id").primaryKey(),
  formId: uuid("form_id").notNull().references(() => feedbackForms.id, { onDelete: "cascade" }),
  questionSnapshot: jsonb("question_snapshot").$type<readonly Record<string, unknown>[]>().notNull(),
  answers: jsonb("answers").$type<Record<string, string>>().notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
  reviewState: text("review_state").notNull(),
  followUpState: text("follow_up_state").notNull(),
  shareTokenHash: text("share_token_hash").unique(),
  shareExpiresAt: timestamp("share_expires_at", { withTimezone: true }),
}, (table) => [
  check("feedback_submissions_review_check", sql`${table.reviewState} in ('unread', 'reviewed', 'archived')`),
  check("feedback_submissions_follow_up_check", sql`${table.followUpState} in ('none', 'wanted', 'done')`),
  index("feedback_submissions_form_date_idx").on(table.formId, table.submittedAt),
]);

export const moneyAccounts = toolsSchema.table("money_accounts", {
  id: uuid("id").primaryKey(),
  ownerSubject: text("owner_subject").notNull(),
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
  uniqueIndex("money_accounts_provider_ref_idx").on(table.ownerSubject, table.provider, table.externalRef),
]);

export const moneyImports = toolsSchema.table("money_imports", {
  id: uuid("id").primaryKey(),
  ownerSubject: text("owner_subject").notNull(),
  digest: text("digest").notNull(),
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
  check("money_imports_format_check", sql`${table.format} in ('revolut_cash_statement_v1', 'revolut_savings_statement_v1', 'revolut_trading_statement_v1', 'portfolio_transaction_export_v1', 'money_balance_snapshot_v1', 'sparkasse_cash_statement_v1')`),
  check("money_imports_bytes_check", sql`${table.bytes} > 0`),
  check("money_imports_row_counts_check", sql`${table.sourceRowCount} >= 0 and ${table.insertedRowCount} >= 0 and ${table.duplicateRowCount} >= 0 and ${table.insertedRowCount} + ${table.duplicateRowCount} = ${table.sourceRowCount}`),
  uniqueIndex("money_imports_owner_digest_idx").on(table.ownerSubject, table.digest),
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
  ownerSubject: text("owner_subject").notNull(),
  accountId: uuid("account_id").notNull().references(() => moneyAccounts.id),
  importId: uuid("import_id").notNull().references(() => moneyImports.id),
  sourceKey: text("source_key").notNull(),
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
  /** The rule that set the category when the origin is "rule". */
  categoryRuleId: uuid("category_rule_id").references(() => moneyCategoryRules.id, { onDelete: "set null" }),
  transferGroupId: uuid("transfer_group_id"),
  transferDisposition: text("transfer_disposition"),
  transferOrigin: text("transfer_origin").$type<"automatic" | "manual">(),
}, (table) => [
  check("money_transactions_source_row_check", sql`${table.sourceRow} > 1`),
  check("money_transactions_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check("money_transactions_base_currency_check", sql`${table.baseCurrency} is null or ${table.baseCurrency} = 'EUR'`),
  check("money_transactions_status_check", sql`${table.status} in ('completed', 'reverted')`),
  check("money_transactions_flow_kind_check", sql`${table.flowKind} in ('spend', 'income', 'refund', 'transfer', 'trade', 'investment_income', 'fee', 'tax', 'balance_adjustment')`),
  check("money_transactions_category_check", sql`${table.category} in ('housing', 'groceries', 'dining', 'transport', 'shopping', 'health', 'personal_care', 'travel', 'subscriptions', 'software', 'education', 'entertainment', 'recreation', 'gifts', 'taxes', 'fees', 'cash', 'investments', 'income', 'transfer', 'adjustment', 'other', 'uncategorized')`),
  check("money_transactions_category_origin_check", sql`${table.categoryOrigin} in ('source', 'rule', 'manual')`),
  check("money_transactions_transfer_disposition_check", sql`${table.transferDisposition} is null or (${table.flowKind} = 'transfer' and ${table.transferDisposition} in ('internal_transfer', 'income', 'spend', 'refund', 'excluded'))`),
  check("money_transactions_transfer_origin_check", sql`${table.transferOrigin} is null or ${table.transferOrigin} in ('automatic', 'manual')`),
  uniqueIndex("money_transactions_owner_source_key_idx").on(table.ownerSubject, table.sourceKey),
  index("money_transactions_occurred_idx").on(table.occurredAt),
  index("money_transactions_account_date_idx").on(table.accountId, table.localDate),
  index("money_transactions_flow_date_idx").on(table.flowKind, table.localDate),
  index("money_transactions_category_date_idx").on(table.category, table.localDate),
  index("money_transactions_transfer_group_idx").on(table.transferGroupId),
  index("money_transactions_category_rule_idx").on(table.categoryRuleId),
]);

export const moneyImportTransactions = toolsSchema.table("money_import_transactions", {
  importId: uuid("import_id").notNull().references(() => moneyImports.id, { onDelete: "cascade" }),
  transactionId: uuid("transaction_id").notNull().references(() => moneyTransactions.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.importId, table.transactionId] }),
  index("money_import_transactions_transaction_idx").on(table.transactionId),
]);

export const moneyInvestmentEvents = toolsSchema.table("money_investment_events", {
  id: uuid("id").primaryKey(),
  ownerSubject: text("owner_subject").notNull(),
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

/** Ordered category rules for spending and refunds; the highest-priority match wins. A null account means every account. */
export const moneyCategoryRules = toolsSchema.table("money_category_rules", {
  id: uuid("id").primaryKey(),
  ownerSubject: text("owner_subject").notNull(),
  accountId: uuid("account_id").references(() => moneyAccounts.id),
  priority: integer("priority").notNull(),
  matchField: text("match_field").notNull(),
  matchOperator: text("match_operator").notNull().default("equals"),
  matchValue: text("match_value").notNull(),
  category: text("category").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull(),
}, (table) => [
  check("money_category_rules_field_check", sql`${table.matchField} in ('description', 'mcc', 'source_type')`),
  check("money_category_rules_operator_check", sql`${table.matchOperator} in ('equals', 'starts_with', 'contains', 'word') and (${table.matchField} = 'description' or ${table.matchOperator} = 'equals')`),
  check("money_category_rules_category_check", sql`${table.category} in ('housing', 'groceries', 'dining', 'transport', 'shopping', 'health', 'personal_care', 'travel', 'subscriptions', 'software', 'education', 'entertainment', 'recreation', 'gifts', 'taxes', 'fees', 'cash', 'investments', 'income', 'transfer', 'adjustment', 'other', 'uncategorized')`),
  unique("money_category_rules_condition_unique").on(table.ownerSubject, table.accountId, table.matchField, table.matchOperator, table.matchValue).nullsNotDistinct(),
  index("money_category_rules_priority_idx").on(table.priority),
]);

/** Ordered transfer disposition rules; owner-specific evidence stays in data, not code. */
export const moneyTransferRules = toolsSchema.table("money_transfer_rules", {
  id: uuid("id").primaryKey(),
  ownerSubject: text("owner_subject").notNull(),
  priority: integer("priority").notNull(),
  provider: text("provider"),
  sourceType: text("source_type"),
  descriptionMatch: text("description_match").notNull(),
  matchValue: text("match_value"),
  amountSign: text("amount_sign").notNull().default("any"),
  disposition: text("disposition").notNull(),
  note: text("note"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull(),
}, (table) => [
  check("money_transfer_rules_match_check", sql`${table.descriptionMatch} in ('any', 'equals', 'starts_with', 'contains', 'word')`),
  check("money_transfer_rules_value_check", sql`(${table.descriptionMatch} = 'any') = (${table.matchValue} is null)`),
  check("money_transfer_rules_value_case_check", sql`${table.matchValue} = lower(${table.matchValue})`),
  check("money_transfer_rules_sign_check", sql`${table.amountSign} in ('any', 'positive', 'negative')`),
  check("money_transfer_rules_disposition_check", sql`${table.disposition} in ('internal_transfer', 'income', 'spend', 'refund', 'excluded')`),
  index("money_transfer_rules_priority_idx").on(table.priority),
]);

/** Card debits that name a destination, paired with that provider's top-ups on the purchase date. */
export const moneyTransferPairRules = toolsSchema.table("money_transfer_pair_rules", {
  id: uuid("id").primaryKey(),
  ownerSubject: text("owner_subject").notNull(),
  debitProvider: text("debit_provider").notNull(),
  debitSourceType: text("debit_source_type").notNull(),
  debitMatchValue: text("debit_match_value").notNull(),
  creditProvider: text("credit_provider").notNull(),
  creditSourceType: text("credit_source_type").notNull(),
  note: text("note"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull(),
}, (table) => [
  check("money_transfer_pair_rules_value_case_check", sql`${table.debitMatchValue} = lower(${table.debitMatchValue})`),
  uniqueIndex("money_transfer_pair_rules_unique_idx").on(table.ownerSubject, table.debitProvider, table.debitSourceType, table.debitMatchValue),
]);

export const moneyBalanceSnapshots = toolsSchema.table("money_balance_snapshots", {
  ownerSubject: text("owner_subject").notNull(),
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

export const authUsers = toolsSchema.table("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const authSessions = toolsSchema.table("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [index("auth_sessions_user_idx").on(table.userId)]);

export const authAccounts = toolsSchema.table("auth_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("auth_accounts_provider_account_idx").on(table.providerId, table.accountId),
  index("auth_accounts_user_idx").on(table.userId),
]);

export const authVerifications = toolsSchema.table("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [index("auth_verifications_identifier_idx").on(table.identifier)]);

export const oauthClients = toolsSchema.table("oauth_clients", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  disabled: boolean("disabled").default(false),
  skipConsent: boolean("skip_consent"),
  enableEndSession: boolean("enable_end_session"),
  subjectType: text("subject_type"),
  scopes: text("scopes").array(),
  userId: text("user_id").references(() => authUsers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  name: text("name"),
  uri: text("uri"),
  icon: text("icon"),
  contacts: text("contacts").array(),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("software_id"),
  softwareVersion: text("software_version"),
  softwareStatement: text("software_statement"),
  redirectUris: text("redirect_uris").array().notNull(),
  postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
  grantTypes: text("grant_types").array(),
  responseTypes: text("response_types").array(),
  public: boolean("public"),
  type: text("type"),
  requirePKCE: boolean("require_pkce"),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata"),
}, (table) => [index("oauth_clients_user_idx").on(table.userId)]);

export const oauthRefreshTokens = toolsSchema.table("oauth_refresh_tokens", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => authSessions.id, { onDelete: "set null" }),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }),
  revoked: timestamp("revoked", { withTimezone: true }),
  authTime: timestamp("auth_time", { withTimezone: true }),
  scopes: text("scopes").array().notNull(),
}, (table) => [
  index("oauth_refresh_tokens_client_idx").on(table.clientId),
  index("oauth_refresh_tokens_session_idx").on(table.sessionId),
  index("oauth_refresh_tokens_user_idx").on(table.userId),
]);

export const oauthAccessTokens = toolsSchema.table("oauth_access_tokens", {
  id: text("id").primaryKey(),
  token: text("token").unique(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => authSessions.id, { onDelete: "set null" }),
  userId: text("user_id").references(() => authUsers.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  refreshId: text("refresh_id").references(() => oauthRefreshTokens.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }),
  scopes: text("scopes").array().notNull(),
}, (table) => [
  index("oauth_access_tokens_client_idx").on(table.clientId),
  index("oauth_access_tokens_session_idx").on(table.sessionId),
  index("oauth_access_tokens_user_idx").on(table.userId),
  index("oauth_access_tokens_refresh_idx").on(table.refreshId),
]);

export const oauthConsents = toolsSchema.table("oauth_consents", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId, { onDelete: "cascade" }),
  userId: text("user_id").references(() => authUsers.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  scopes: text("scopes").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
}, (table) => [
  index("oauth_consents_client_idx").on(table.clientId),
  index("oauth_consents_user_idx").on(table.userId),
]);

export const people = toolsSchema.table("people", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  googleSubject: text("google_subject").unique(),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull(),
  boundAt: timestamp("bound_at", { withTimezone: true }),
}, (table) => [check("people_email_lowercase_check", sql`${table.email} = lower(${table.email})`)]);

export const productGrants = toolsSchema.table("product_grants", {
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
}, (table) => [primaryKey({ columns: [table.personId, table.productId] })]);

export const kitchens = toolsSchema.table("kitchens", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  groups: text("groups").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const kitchenPersonSettings = toolsSchema.table("kitchen_person_settings", {
  kitchenId: uuid("kitchen_id").notNull().references(() => kitchens.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  mcpEnabled: boolean("mcp_enabled").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
}, (table) => [primaryKey({ columns: [table.kitchenId, table.subject] })]);

export const kitchenMembers = toolsSchema.table("kitchen_members", {
  kitchenId: uuid("kitchen_id").notNull().references(() => kitchens.id, { onDelete: "cascade" }),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
}, (table) => [primaryKey({ columns: [table.kitchenId, table.personId] }), index("kitchen_members_person_idx").on(table.personId)]);

export const kitchenIngredients = toolsSchema.table("kitchen_ingredients", {
  id: uuid("id").primaryKey(),
  kitchenId: uuid("kitchen_id").notNull().references(() => kitchens.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  section: text("section").notNull(),
  /** More groups the ingredient also belongs to. `section` stays its main group, where the shopping list shows it. */
  otherGroups: text("other_groups").array().notNull().default(sql`'{}'::text[]`),
  kcal: doublePrecision("kcal"),
  protein: doublePrecision("protein"),
  carbs: doublePrecision("carbs"),
  fat: doublePrecision("fat"),
  notes: text("notes").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  check("kitchen_ingredients_unit_check", sql`${table.unit} in ('g', 'ml', 'piece', 'can')`),
  unique("kitchen_ingredients_kitchen_id_unique").on(table.kitchenId, table.id),
  unique("kitchen_ingredients_name_unique").on(table.kitchenId, table.name),
]);

export const kitchenRecipes = toolsSchema.table("kitchen_recipes", {
  id: uuid("id").primaryKey(),
  kitchenId: uuid("kitchen_id").notNull().references(() => kitchens.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  servings: integer("servings").notNull(),
  minutes: integer("minutes"),
  instructions: text("instructions").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  check("kitchen_recipes_servings_check", sql`${table.servings} > 0`),
  unique("kitchen_recipes_kitchen_id_unique").on(table.kitchenId, table.id),
  unique("kitchen_recipes_name_unique").on(table.kitchenId, table.name),
]);

export const kitchenRecipeLines = toolsSchema.table("kitchen_recipe_lines", {
  kitchenId: uuid("kitchen_id").notNull(),
  recipeId: uuid("recipe_id").notNull(),
  ingredientId: uuid("ingredient_id").notNull(),
  position: integer("position").notNull(),
  amount: doublePrecision("amount").notNull(),
  note: text("note").notNull().default(""),
}, (table) => [
  primaryKey({ columns: [table.recipeId, table.ingredientId] }),
  check("kitchen_recipe_lines_amount_check", sql`${table.amount} > 0`),
  foreignKey({ name: "kitchen_recipe_lines_recipe_fk", columns: [table.kitchenId, table.recipeId], foreignColumns: [kitchenRecipes.kitchenId, kitchenRecipes.id] }).onDelete("cascade"),
  foreignKey({ name: "kitchen_recipe_lines_ingredient_fk", columns: [table.kitchenId, table.ingredientId], foreignColumns: [kitchenIngredients.kitchenId, kitchenIngredients.id] }),
  index("kitchen_recipe_lines_ingredient_idx").on(table.kitchenId, table.ingredientId),
]);

export const kitchenPlanEntries = toolsSchema.table("kitchen_plan_entries", {
  id: uuid("id").primaryKey(),
  kitchenId: uuid("kitchen_id").notNull(),
  day: date("day", { mode: "string" }).notNull(),
  meal: text("meal").notNull(),
  recipeId: uuid("recipe_id").notNull(),
  servings: integer("servings").notNull(),
  /** Set when this one meal has its own ingredients in kitchen_plan_lines, written for this many servings. */
  customServings: integer("custom_servings"),
  cookedAt: timestamp("cooked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  check("kitchen_plan_entries_meal_check", sql`${table.meal} in ('breakfast', 'lunch', 'dinner', 'snack')`),
  check("kitchen_plan_entries_servings_check", sql`${table.servings} > 0`),
  check("kitchen_plan_entries_custom_servings_check", sql`${table.customServings} > 0`),
  foreignKey({ name: "kitchen_plan_entries_recipe_fk", columns: [table.kitchenId, table.recipeId], foreignColumns: [kitchenRecipes.kitchenId, kitchenRecipes.id] }).onDelete("cascade"),
  index("kitchen_plan_entries_day_idx").on(table.kitchenId, table.day),
]);

/** The ingredients of one planned meal that differs from its recipe. The recipe stays as it is. */
export const kitchenPlanLines = toolsSchema.table("kitchen_plan_lines", {
  kitchenId: uuid("kitchen_id").notNull(),
  entryId: uuid("entry_id").notNull().references(() => kitchenPlanEntries.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id").notNull(),
  position: integer("position").notNull(),
  amount: doublePrecision("amount").notNull(),
  note: text("note").notNull().default(""),
}, (table) => [
  primaryKey({ columns: [table.entryId, table.ingredientId] }),
  check("kitchen_plan_lines_amount_check", sql`${table.amount} > 0`),
  foreignKey({ name: "kitchen_plan_lines_ingredient_fk", columns: [table.kitchenId, table.ingredientId], foreignColumns: [kitchenIngredients.kitchenId, kitchenIngredients.id] }).onDelete("cascade"),
  index("kitchen_plan_lines_ingredient_idx").on(table.kitchenId, table.ingredientId),
]);

export const kitchenStock = toolsSchema.table("kitchen_stock", {
  kitchenId: uuid("kitchen_id").notNull(),
  ingredientId: uuid("ingredient_id").notNull(),
  amount: doublePrecision("amount").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.kitchenId, table.ingredientId] }),
  check("kitchen_stock_amount_check", sql`${table.amount} >= 0`),
  foreignKey({ name: "kitchen_stock_ingredient_fk", columns: [table.kitchenId, table.ingredientId], foreignColumns: [kitchenIngredients.kitchenId, kitchenIngredients.id] }).onDelete("cascade"),
]);

export const kitchenLeftovers = toolsSchema.table("kitchen_leftovers", {
  id: uuid("id").primaryKey(),
  kitchenId: uuid("kitchen_id").notNull().references(() => kitchens.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  servings: doublePrecision("servings").notNull(),
  useBy: date("use_by", { mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [check("kitchen_leftovers_servings_check", sql`${table.servings} > 0`), index("kitchen_leftovers_kitchen_idx").on(table.kitchenId, table.useBy)]);

export const kitchenExtras = toolsSchema.table("kitchen_extras", {
  id: uuid("id").primaryKey(),
  kitchenId: uuid("kitchen_id").notNull().references(() => kitchens.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  everyWeek: boolean("every_week").notNull().default(false),
  boughtWeek: date("bought_week", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [index("kitchen_extras_kitchen_idx").on(table.kitchenId, table.createdAt)]);

/** Each change the Kitchen app sent, so a resent batch applies it once. Rows older than 30 days are removed. */
export const kitchenAppliedActions = toolsSchema.table("kitchen_applied_actions", {
  subject: text("subject").notNull(),
  clientActionId: uuid("client_action_id").notNull(),
  outcome: jsonb("outcome").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull(),
}, (table) => [primaryKey({ columns: [table.subject, table.clientActionId] }), index("kitchen_applied_actions_applied_idx").on(table.appliedAt)]);

/** Packaged foods from Open Food Facts and Billa that a new ingredient can start from. Nutrition is per 100 g or 100 ml. */
export const kitchenCatalogProducts = toolsSchema.table("kitchen_catalog_products", {
  source: text("source").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  brand: text("brand").notNull(),
  quantity: text("quantity").notNull(),
  unit: text("unit").notNull(),
  kcal: doublePrecision("kcal"),
  protein: doublePrecision("protein"),
  carbs: doublePrecision("carbs"),
  fat: doublePrecision("fat"),
  /** Name and brand in lower case, for search. */
  search: text("search").notNull(),
  /** The same for one product in every source, so search shows it once. */
  matchKey: text("match_key").notNull(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.source, table.code] }),
  check("kitchen_catalog_products_source_check", sql`${table.source} in ('open-food-facts', 'billa')`),
  check("kitchen_catalog_products_unit_check", sql`${table.unit} in ('g', 'ml')`),
]);

/** Where the catalog refresh is. `nextPage` is set while a refresh runs, so a restart goes on from that page. */
export const kitchenCatalogRefresh = toolsSchema.table("kitchen_catalog_refresh", {
  source: text("source").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  nextPage: integer("next_page"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/** Bug reports and ideas about each app, for the developer. Not the Feedback product. An anonymous report has no author. */
export const devFeedback = toolsSchema.table("dev_feedback", {
  id: uuid("id").primaryKey(),
  app: text("app").notNull().default("tools"),
  authorSubject: text("author_subject"),
  authorEmail: text("author_email"),
  contactEmail: text("contact_email"),
  kind: text("kind").notNull(),
  page: text("page").notNull(),
  /** The app version and device that sent the report. */
  context: text("context"),
  message: text("message").notNull(),
  /** How to make a bug happen again, or why an idea helps. Optional. */
  details: text("details"),
  state: text("state").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  check("dev_feedback_app_check", sql`${table.app} in ('tools', 'pantrino', 'dotally')`),
  check("dev_feedback_kind_check", sql`${table.kind} in ('bug', 'feature')`),
  check("dev_feedback_state_check", sql`${table.state} in ('open', 'tracked', 'done')`),
  index("dev_feedback_created_idx").on(table.createdAt),
]);

export const objects = artifactsSchema.table("objects", {
  id: text("id").primaryKey(),
  ownerSubject: text("owner_subject").notNull(),
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
  uploadLinkId: uuid("upload_link_id"),
  sha256: text("sha256"),
}, (table) => [
  check("objects_kind_check", sql`${table.kind} in ('html', 'file')`),
  check("objects_bytes_check", sql`${table.bytes} >= 0`),
  index("objects_upload_link_idx").on(table.uploadLinkId),
  index("objects_owner_updated_idx").on(table.ownerSubject, table.updatedAt),
]);

export const operations = artifactsSchema.table("operations", {
  operationId: uuid("operation_id").primaryKey(),
  artifactId: text("artifact_id").notNull(),
  ownerId: text("owner_id").notNull(),
  ownerSubject: text("owner_subject").notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
  operationKind: text("operation_kind").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("operations_operation_kind_check", sql`${table.operationKind} in ('put_html', 'put_file', 'delete')`),
  index("artifact_operations_created_idx").on(table.createdAt),
  uniqueIndex("artifact_operations_artifact_idx").on(table.artifactId),
]);

export const uploadLinks = artifactsSchema.table("upload_links", {
  id: uuid("id").primaryKey(),
  ownerSubject: text("owner_subject").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  check("upload_links_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  index("upload_links_active_idx").on(table.expiresAt, table.revokedAt),
  index("upload_links_history_idx").on(table.ownerSubject, table.createdAt.desc(), table.id.desc()),
]);

export const uploadSessions = artifactsSchema.table("upload_sessions", {
  sessionId: uuid("session_id").primaryKey(),
  ownerSubject: text("owner_subject").notNull(),
  artifactId: text("artifact_id").notNull().unique(),
  targetId: text("target_id"),
  expectedObjectKey: text("expected_object_key"),
  receipt: jsonb("receipt"),
  audience: text("audience").notNull(),
  uploadLinkId: uuid("upload_link_id"),
  description: jsonb("description").notNull(),
  uploadId: text("upload_id"),
  state: text("state").notNull(),
  parts: jsonb("parts").notNull().default(sql`'[]'::jsonb`),
  manifest: jsonb("manifest"),
  sha256: text("sha256"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cleanedAt: timestamp("cleaned_at", { withTimezone: true }),
}, (table) => [
  check("upload_sessions_audience_check", sql`${table.audience} in ('browser', 'native', 'drop')`),
  check("upload_sessions_state_check", sql`${table.state} in ('creating', 'uploading', 'completing', 'completed', 'aborted', 'failed')`),
  check("upload_sessions_target_check", sql`(${table.targetId} is null and ${table.expectedObjectKey} is null) or
    (${table.targetId} is not null and ${table.expectedObjectKey} is not null and ${table.targetId} <> ${table.artifactId})`),
  index("upload_sessions_target_idx").on(table.targetId).where(sql`${table.targetId} is not null`),
  index("upload_sessions_cleanup_idx").on(table.expiresAt).where(sql`${table.cleanedAt} is null`),
]);

/**
 * Bodyshop keeps one person's food, weight, and check-ins. Only the owner, kind, day, and bookkeeping
 * columns are readable. Everything a person logged sits in `payload`, sealed with BODYSHOP_ENCRYPTION_KEY.
 * Each change adds a revision; `current` marks the latest one of each record.
 */
export const bodyshopRecords = toolsSchema.table("bodyshop_records", {
  id: uuid("id").primaryKey(),
  ownerSubject: text("owner_subject").notNull(),
  kind: text("kind").notNull(),
  recordId: uuid("record_id").notNull(),
  revision: integer("revision").notNull(),
  current: boolean("current").notNull(),
  removed: boolean("removed").notNull().default(false),
  day: date("day", { mode: "string" }),
  payload: text("payload").notNull(),
  importId: uuid("import_id"),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  check("bodyshop_records_kind_check", sql`${table.kind} in ('food', 'entry', 'template', 'weight', 'checkin', 'allocation', 'setting')`),
  check("bodyshop_records_revision_check", sql`${table.revision} > 0`),
  uniqueIndex("bodyshop_records_revision_idx").on(table.ownerSubject, table.recordId, table.revision),
  uniqueIndex("bodyshop_records_one_current_idx").on(table.ownerSubject, table.recordId).where(sql`${table.current}`),
  index("bodyshop_records_current_idx").on(table.ownerSubject, table.kind, table.current, table.day),
]);

/** One committed workbook import. The digest makes a repeated import of the same file a replay. */
export const bodyshopImports = toolsSchema.table("bodyshop_imports", {
  id: uuid("id").primaryKey(),
  ownerSubject: text("owner_subject").notNull(),
  digest: text("digest").notNull(),
  payload: text("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("bodyshop_imports_digest_idx").on(table.ownerSubject, table.digest)]);
