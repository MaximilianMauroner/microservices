import { randomUUID } from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { effectiveTransactions, ledgerContributions } from "./money-ledger-sql.js";
import type { MoneyTrackerSnapshot } from "./money-tracker.js";
import { fifoRealizedGains, type MoneyRealizedGainAnalytics } from "./money-investment-domain.js";
import { moneyDisplayDescription, moneyMerchantName, moneyTransferReviewDescription } from "./money-description.js";
import { moneyMarketInstrumentName } from "./money-market-data-catalog.js";
import {
  MONEY_CATEGORIES,
  SPARKASSE_TRANSFER_TYPES,
  MoneyImportValidationError,
  inferMoneyCategory,
  revolutCashSourceKey,
  REVOLUT_CASH_FORMAT,
  type MoneyBalanceSnapshotInput,
  type MoneyCategory,
  type MoneyImportFormat,
  type MoneyInvestmentEventInput,
  type MoneyLedgerTransaction,
  type MoneyTransferDisposition
} from "./money-import-domain.js";
import {
  inferTransferDisposition,
  isCardFundingDebit,
  isRuleTransferCandidate,
  matchCardFundingPairs,
  transferRuleMatches,
  type MoneyTransferPairRule,
  type MoneyTransferRule
} from "./money-transfer-inference.js";
import type { MoneyCashFlowDay, MoneyCashItemDay, MoneyCashSnapshotPoint, MoneySpendingRow } from "./money-checkin-domain.js";
import { categoryRuleMatcher, isRuleCategorized, normalizeCategoryRuleText, type MoneyCategoryRuleDefinition, type MoneyCategoryRuleField, type MoneyCategoryRuleOperator, type MoneyCategoryRuleSubject } from "./money-category-rules.js";

export type MoneyImportCommitInput = Readonly<{
  digest: string; format: MoneyImportFormat; filename: string; bytes: number; rowCount: number; actor: string;
  transactions: readonly MoneyLedgerTransaction[]; investmentEvents: readonly MoneyInvestmentEventInput[];
  balanceSnapshots: readonly MoneyBalanceSnapshotInput[]; warnings: readonly string[];
}>;

export type MoneyImportReceipt = Readonly<{
  id: string; digest: string; format: MoneyImportFormat; filename: string; rowCount: number;
  insertedCount: number; duplicateCount: number; committedAt: string; replay: boolean;
}>;
export type MoneyImportSummary = Omit<MoneyImportReceipt, "replay"> & Readonly<{ bytes: number; actor: string }>;
export type MoneyImportDeletion = Readonly<{ transactionCount: number; investmentEventCount: number; balanceSnapshotCount: number }>;
export type MoneyReimportResult = Readonly<{ importCount: number; transactionCount: number; linkedPairCount: number }>;

export type MoneyActivityItem = Readonly<{
  id: string; occurredAt: string; accountId?: string; accountName: string; description: string; amountMinor: number; feeMinor: number;
  taxMinor: number; currency: string; status: MoneyLedgerTransaction["status"]; sourceType: string;
  flowKind: MoneyLedgerTransaction["flowKind"]; category: MoneyCategory; categoryOrigin: "source" | "rule" | "manual";
  transferGroupId?: string;
  transferDisposition?: MoneyTransferDisposition;
  needsTransferReview: boolean;
  rawDescription?: string;
}>;
export type MoneyTransferReviewGroup = Readonly<{
  representativeId: string;
  accountName: string;
  description: string;
  sourceType: string;
  direction: "inflow" | "outflow";
  currency: string;
  count: number;
  totalMinor: number;
  items: readonly MoneyActivityItem[];
}>;
/** A stored category rule in match order, with the number of rows whose category it set. */
export type MoneyCategoryRule = MoneyCategoryRuleDefinition & Readonly<{
  id: string;
  accountName?: string;
  rowCount: number;
  updatedAt: string;
}>;
export type MoneyCategoryRuleInput = MoneyCategoryRuleDefinition;
/** A row a rule change touches: it matches the condition, or its category changes when the rules are applied. */
export type MoneyCategoryRuleChange = Readonly<{
  id: string; date: string; accountName: string; description: string; amountMinor: number; currency: string;
  category: MoneyCategory; categoryOrigin: "source" | "rule" | "manual"; nextCategory: MoneyCategory; matches: boolean;
}>;
export type MoneyCategoryRulePreview = Readonly<{
  /** Spending and refund rows that match the condition. */
  matchCount: number;
  /** Rows whose category changes when the rule is saved first in match order. */
  changeCount: number;
  /** Matching rows with a manual category. They keep it. */
  manualCount: number;
  /** The newest touched rows. */
  examples: readonly MoneyCategoryRuleChange[];
}>;
export type MoneyTransferRuleInput = Omit<MoneyTransferRule, "id" | "priority">;
export type MoneyTransferRulePreview = Readonly<{
  matchCount: number;
  examples: readonly Readonly<{ id: string; date: string; accountName: string; description: string; amountMinor: number; currency: string }>[];
}>;
/** A provider and statement type seen on transfer rows, offered as rule conditions. */
export type MoneyTransferRuleOption = Readonly<{ provider: string; sourceType: string; count: number; unresolvedCount: number }>;
export type MoneySpendingAnalytics = Readonly<{
  /** Spending is net of refunds. refundsMinor reports the amount already deducted. */
  months: readonly Readonly<{ month: string; observed: boolean; spendMinor: number; refundsMinor: number; incomeMinor: number; feesMinor: number; taxesMinor: number; netCashFlowMinor: number }>[];
  categories: readonly Readonly<{ category: MoneyCategory; amountMinor: number; count: number }>[];
  categoryMonths: readonly Readonly<{ month: string; category: MoneyCategory; amountMinor: number; count: number }>[];
  merchantMonths: readonly Readonly<{ month: string; category: MoneyCategory; description: string; amountMinor: number; count: number }>[];
  categoryActivity: readonly MoneyActivityItem[];
  uncategorizedCount: number;
}>;
export type MoneyInvestmentAnalytics = Readonly<{
  positions: readonly Readonly<{ symbol: string; name?: string; assetClass?: string; quantity: string; boughtMinor: number; soldMinor: number; incomeMinor: number; feesMinor: number; taxesMinor: number; currency: string }>[];
  trades: readonly Readonly<{ date: string; eventKind: "buy" | "sell"; symbol: string; name?: string; quantity: string; amountMinor: number; feeMinor: number; currency: string }>[];
  totals: Readonly<{ eventCount: number; boughtMinor: number; soldMinor: number; incomeMinor: number; feesMinor: number; taxesMinor: number }>;
  realized: MoneyRealizedGainAnalytics;
}>;
export type MoneyPlanningAnalytics = Readonly<{
  ready: boolean;
  unresolvedTransferCount: number;
  medianMonthlyNetMinor: number;
  observedMonthCount: number;
  projections: readonly Readonly<{ months: 6 | 12 | 60; changeMinor: number }>[];
}>;
/** An uncategorized spending row with the categories that earlier rows with the same description used. */
export type MoneyReviewCategoryItem = MoneyActivityItem & Readonly<{
  /** Other uncategorized rows in the same account with the same description. */
  similarCount: number;
  suggestions: readonly MoneyCategory[];
}>;
export type MoneyReviewQueue = Readonly<{
  items: readonly MoneyReviewCategoryItem[];
  /** The most used spending categories, offered when a row has no history. */
  commonCategories: readonly MoneyCategory[];
}>;
/** otherRows counts spending and refund rows that a rule, not a manual choice, put in Other. */
export type MoneyReviewCounts = Readonly<{ uncategorized: number; transfers: number; spendingRows?: number; otherRows?: number }>;
export type MoneyLedgerSnapshot = MoneyTrackerSnapshot & Readonly<{
  imports: readonly MoneyImportSummary[]; activity: readonly MoneyActivityItem[]; transactionCount: number; revertedCount: number;
  currentMonthTransactionAccounts: readonly string[];
  recentTransactionMonths?: readonly Readonly<{ accountId: string; month: string }>[];
  transferReview: Readonly<{ linkedPairs: number; unlinkedCount: number; unresolvedPositiveCount: number; unresolvedNegativeCount: number }>;
  transferReviewGroups: readonly MoneyTransferReviewGroup[];
  categoryRules: readonly MoneyCategoryRule[];
  transferRules: readonly MoneyTransferRule[];
  transferPairRules: readonly MoneyTransferPairRule[];
  transferRuleOptions: readonly MoneyTransferRuleOption[];
  spending: MoneySpendingAnalytics; investments: MoneyInvestmentAnalytics; planning: MoneyPlanningAnalytics;
  reviewCounts: MoneyReviewCounts; reviewQueue: MoneyReviewQueue;
}>;
export type MoneyActivityPage = Readonly<{ items: readonly MoneyActivityItem[]; total: number; hasMore: boolean }>;
export type MoneyActivitySortKey = "date" | "description" | "account" | "flow" | "category" | "costs" | "amount";
export type MoneyActivitySortDirection = "asc" | "desc";
export type MoneyActivityPageInput = Readonly<{ query: string; flow?: MoneyLedgerTransaction["flowKind"]; accountId?: string; category?: MoneyCategory; fromMonth?: string; toMonth?: string; reviewOnly?: boolean; sort?: MoneyActivitySortKey; direction?: MoneyActivitySortDirection; offset: number; limit: number }>;
export const MONEY_LEDGER_SCOPES = ["overview", "spending", "transactions", "accounts", "investments", "plan", "review"] as const;
export type MoneyLedgerViewScope = (typeof MONEY_LEDGER_SCOPES)[number];
export type MoneyLedgerScope = MoneyLedgerViewScope | "all";
const MONEY_LEDGER_QUERY_SCOPES = {
  imports: ["review"],
  currentMonthTransactions: ["review"],
  categoryRules: ["review"],
  transferRules: ["review"],
  transferRuleOptions: ["review"],
  activity: ["transactions"],
  counts: ["transactions", "review"],
  reviewCounts: ["overview", "spending", "transactions", "accounts", "investments", "plan", "review"],
  reviewQueue: ["review"],
  transferSummary: ["overview", "spending", "plan", "review"],
  transferReview: ["review"],
  monthlyCashFlow: ["overview", "spending", "plan"],
  categoryTotals: ["spending"],
  categoryMonths: ["overview", "spending"],
  merchantMonths: ["spending"],
  categoryActivity: ["spending"],
  investmentPositions: ["investments"],
  investmentTotals: ["investments"],
  tradeMarkers: ["investments"],
  realizedEvents: ["investments"],
  balanceSnapshots: ["overview", "transactions", "accounts", "plan", "review"]
} as const satisfies Record<string, readonly MoneyLedgerViewScope[]>;
export type MoneyLedgerQuery = keyof typeof MONEY_LEDGER_QUERY_SCOPES;

export function moneyLedgerQueriesFor(scope: MoneyLedgerScope): readonly MoneyLedgerQuery[] {
  const queries = Object.keys(MONEY_LEDGER_QUERY_SCOPES) as MoneyLedgerQuery[];
  return scope === "all"
    ? queries
    : queries.filter((query) => {
        const scopes = MONEY_LEDGER_QUERY_SCOPES[query] as readonly MoneyLedgerViewScope[];
        return scopes.includes(scope);
      });
}

// Keep each multi-row statement comfortably below PostgreSQL's 65,535 parameter limit.
const ACCOUNT_INSERT_CHUNK_SIZE = 1_000;
const TRANSACTION_INSERT_CHUNK_SIZE = 2_000;
const RELATED_INSERT_CHUNK_SIZE = 5_000;

export interface MoneyRepository {
  existingSourceKeys(transactions: readonly MoneyLedgerTransaction[]): Promise<ReadonlySet<string>>;
  commitImport(input: MoneyImportCommitInput): Promise<MoneyImportReceipt>;
  reimportAll(): Promise<MoneyReimportResult>;
  deleteImport(importId: string): Promise<MoneyImportDeletion | undefined>;
  readLedgerSnapshot(scope: MoneyLedgerScope): Promise<MoneyLedgerSnapshot>;
  readReviewCounts(): Promise<MoneyReviewCounts>;
  readActivityPage(input: MoneyActivityPageInput): Promise<MoneyActivityPage>;
  setTransactionCategory(input: Readonly<{ transactionId: string; category: MoneyCategory; actor: string; createRule: boolean }>): Promise<Readonly<{ affectedCount: number }>>;
  /** Previews the rule first in match order. Pass ruleId to preview an edit of that rule. */
  previewCategoryRule(input: MoneyCategoryRuleInput & Readonly<{ ruleId?: string }>): Promise<MoneyCategoryRulePreview>;
  /** Creates or edits a rule, moves it first in match order, and applies all rules again. */
  saveCategoryRule(input: MoneyCategoryRuleInput & Readonly<{ ruleId?: string; actor: string; expectedMatchCount: number }>): Promise<Readonly<{ ruleId: string; affectedCount: number }>>;
  /** Removes the rule and applies the remaining rules again. */
  deleteCategoryRule(ruleId: string): Promise<Readonly<{ affectedCount: number }> | undefined>;
  previewTransferRule(input: MoneyTransferRuleInput): Promise<MoneyTransferRulePreview>;
  /** Stores the rule first in match order and applies the rule set to unresolved transfers only. */
  createTransferRule(input: MoneyTransferRuleInput & Readonly<{ actor: string; expectedMatchCount: number }>): Promise<Readonly<{ affectedCount: number }>>;
  /** Removes the rule. Transfers it already classified keep their disposition. */
  deleteTransferRule(ruleId: string): Promise<boolean>;
  setTransferDisposition(input: Readonly<{ transactionId: string; disposition: MoneyTransferDisposition }>): Promise<void>;
  setTransferDispositions(input: Readonly<{ transactionIds: readonly string[]; disposition: MoneyTransferDisposition }>): Promise<Readonly<{ affectedCount: number }>>;
  addManualBalance(input: Readonly<({ accountId: string } | { accountName: string }) & { date: string; valueMinor: number; currency: string }>): Promise<void>;
  /** Europe/Berlin days with at least one committed import, oldest first. */
  readCheckInDays(): Promise<readonly string[]>;
  readCashSince(baseline: string): Promise<Readonly<{ snapshots: readonly MoneyCashSnapshotPoint[]; flows: readonly MoneyCashFlowDay[]; items: readonly MoneyCashItemDay[] }>>;
  /** Spending rows after a day, with the same definition as the category totals. */
  readSpendingSince(from: string): Promise<readonly MoneySpendingRow[]>;
  readiness(): Promise<void>;
  close(): Promise<void>;
}

export function createPostgresMoneyRepository(databaseUrl: string, options: { readOnly?: boolean } = {}): MoneyRepository {
  // Money queries scan a few thousand rows. JIT compilation of the effective-row queries costs about a second; running them takes milliseconds.
  return postgresMoneyRepository(postgres(databaseUrl, { max: 4, idle_timeout: 120, connection: { jit: "off", ...(options.readOnly ? { default_transaction_read_only: true } : {}) } }));
}

export function postgresMoneyRepository(sql: Sql): MoneyRepository {
  return {
    existingSourceKeys(transactions) {
      return existingTransactionSourceKeys(sql, transactions);
    },

    commitImport(input) {
      return sql.begin(async (tx) => {
        await lockCategoryRules(tx);
        const [existing] = await tx<ImportRow[]>`select id, digest, format, filename, bytes, source_row_count, inserted_row_count, duplicate_row_count, committed_at, created_by from tools.money_imports where digest = ${input.digest}`;
        if (existing) {
          await refreshInferredTransactions(tx, input.transactions);
          await linkUnambiguousTransfers(tx);
          await applyCategoryRules(tx);
          return receipt(existing, true);
        }
        const importId = randomUUID();
        const committedAt = new Date();
        const created = await tx<{ id: string }[]>`
          insert into tools.money_imports (id, digest, format, filename, bytes, source_row_count, inserted_row_count, duplicate_row_count, warnings, committed_at, created_by)
          values (${importId}, ${input.digest}, ${input.format}, ${input.filename}, ${input.bytes}, 0, 0, 0, ${tx.json([...input.warnings])}, ${committedAt}, ${input.actor})
          on conflict (digest) do nothing returning id`;
        if (!created[0]) {
          const [raced] = await tx<ImportRow[]>`select id, digest, format, filename, bytes, source_row_count, inserted_row_count, duplicate_row_count, committed_at, created_by from tools.money_imports where digest = ${input.digest}`;
          if (!raced) throw new Error("Money import replay could not be read.");
          await refreshInferredTransactions(tx, input.transactions);
          await linkUnambiguousTransfers(tx);
          await applyCategoryRules(tx);
          return receipt(raced, true);
        }

        const accountIds = new Map<string, string>();
        for (const batch of chunks(uniqueAccounts(input.transactions), ACCOUNT_INSERT_CHUNK_SIZE)) {
          const saved = await tx<{ id: string; external_ref: string }[]>`
            insert into tools.money_accounts ${tx(batch.map((account) => ({ id: randomUUID(), provider: account.provider,
              external_ref: account.externalRef, display_name: account.name, role: account.role, currency: account.currency,
              created_at: committedAt, updated_at: committedAt })))}
            on conflict (provider, external_ref) do update set display_name = excluded.display_name, role = excluded.role,
              currency = excluded.currency, updated_at = excluded.updated_at returning id, external_ref`;
          for (const account of saved) accountIds.set(account.external_ref, account.id);
        }

        const existingKeys = await existingTransactionSourceKeys(tx, input.transactions);
        const transactionIds = new Map<string, string>();
        let insertedCount = 0;
        for (const batch of chunks(input.transactions.filter((item) => !existingKeys.has(item.sourceKey)), TRANSACTION_INSERT_CHUNK_SIZE)) {
          const values = batch.map((item) => ({
            id: randomUUID(), account_id: requiredAccountId(accountIds, item.accountExternalRef), import_id: importId,
            source_key: item.sourceKey, source_row: item.sourceRow, occurred_at: item.occurredAt, completed_at: item.completedAt ?? null,
            local_date: item.localDate, description: item.description, amount_minor: item.amountMinor, fee_minor: item.feeMinor,
            tax_minor: item.taxMinor, balance_after_minor: item.balanceAfterMinor ?? null, currency: item.currency, status: item.status,
            base_amount_minor: item.baseAmountMinor ?? null, base_fee_minor: item.baseFeeMinor ?? null,
            base_tax_minor: item.baseTaxMinor ?? null, base_currency: item.baseCurrency ?? null,
            source_type: item.sourceType, mcc: item.mcc ?? null, flow_kind: item.flowKind, category: item.category,
            category_origin: "source", transfer_group_id: null, transfer_disposition: null
          }));
          const inserted = await tx<{ id: string; source_key: string }[]>`insert into tools.money_transactions ${tx(values)} on conflict (source_key) do nothing returning id, source_key`;
          for (const row of inserted) transactionIds.set(row.source_key, row.id);
          insertedCount += inserted.length;
        }

        const eventValues = input.investmentEvents.flatMap((event) => {
          const transactionId = transactionIds.get(event.transactionSourceKey);
          return transactionId ? [{ id: randomUUID(), transaction_id: transactionId, event_kind: event.eventKind, symbol: event.symbol ?? null,
            name: event.name ?? null, asset_class: event.assetClass ?? null, quantity: event.quantity ?? null, unit_price: event.unitPrice ?? null,
            price_currency: event.priceCurrency ?? null, fx_rate: event.fxRate ?? null }] : [];
        });
        for (const batch of chunks(eventValues, RELATED_INSERT_CHUNK_SIZE)) if (batch.length) await tx`insert into tools.money_investment_events ${tx(batch)} on conflict (transaction_id) do nothing`;

        for (const batch of chunks(input.balanceSnapshots, RELATED_INSERT_CHUNK_SIZE)) {
          const values = batch.map((item) => ({ account_id: requiredAccountId(accountIds, item.accountExternalRef), snapshot_date: item.date,
            observed_at: item.observedAt, value_minor: item.valueMinor, currency: item.currency, origin: "import", import_id: importId }));
          if (values.length) await tx`insert into tools.money_balance_snapshots ${tx(values)} on conflict (account_id, snapshot_date, origin) do update set observed_at = excluded.observed_at, value_minor = excluded.value_minor, currency = excluded.currency, import_id = excluded.import_id
            where excluded.observed_at > tools.money_balance_snapshots.observed_at
              or (excluded.observed_at = tools.money_balance_snapshots.observed_at and excluded.value_minor <> tools.money_balance_snapshots.value_minor)`;
        }
        await refreshInferredTransactions(tx, input.transactions.filter((transaction) => !transactionIds.has(transaction.sourceKey)));
        await linkUnambiguousTransfers(tx);
        await applyCategoryRules(tx);
        const duplicateCount = input.rowCount - insertedCount;
        const [saved] = await tx<ImportRow[]>`
          update tools.money_imports set source_row_count = ${input.rowCount}, inserted_row_count = ${insertedCount}, duplicate_row_count = ${duplicateCount}
          where id = ${importId} returning id, digest, format, filename, bytes, source_row_count, inserted_row_count, duplicate_row_count, committed_at, created_by`;
        return receipt(saved!, false);
      });
    },

    reimportAll() {
      return sql.begin(async (tx) => {
        await lockCategoryRules(tx);
        const [count] = await tx<{ import_count: string }[]>`select count(*)::text import_count from tools.money_imports`;
        const rows = await tx<{ id: string }[]>`select id from tools.money_transactions where import_id is not null order by id for update`;
        await tx`update tools.money_accounts set display_name = case role
            when 'investment' then 'Trade Republic Investments'
            else 'Trade Republic Cash'
          end, updated_at = now()
          where provider = 'portfolio_export'`;
        // Existing transfer groups and dispositions may include manual review choices.
        // Reapply defaults only to unresolved rows instead of erasing those choices.
        await linkUnambiguousTransfers(tx);
        await applyCategoryRules(tx);
        const [linked] = await tx<{ linked_pair_count: string }[]>`select count(distinct transfer_group_id)::text linked_pair_count
          from tools.money_transactions where transfer_group_id is not null`;
        return { importCount: integer(count?.import_count ?? "0"), transactionCount: rows.length, linkedPairCount: integer(linked?.linked_pair_count ?? "0") };
      });
    },

    deleteImport(importId) {
      return sql.begin(async (tx) => {
        await lockCategoryRules(tx);
        const [moneyImport] = await tx<{ id: string }[]>`select id from tools.money_imports where id = ${importId} for update`;
        if (!moneyImport) return undefined;

        const linkedGroups = await tx<{ transfer_group_id: string }[]>`select distinct transfer_group_id
          from tools.money_transactions where import_id = ${importId} and transfer_group_id is not null`;
        const groupIds = linkedGroups.map((row) => row.transfer_group_id);
        if (groupIds.length) {
          await tx`update tools.money_transactions set transfer_group_id = null, transfer_disposition = null
            where transfer_group_id in ${tx(groupIds)}`;
        }

        const deletedEvents = await tx<{ id: string }[]>`delete from tools.money_investment_events
          where transaction_id in (select id from tools.money_transactions where import_id = ${importId}) returning id`;
        const deletedSnapshots = await tx<{ account_id: string }[]>`delete from tools.money_balance_snapshots
          where import_id = ${importId} returning account_id`;
        const deletedTransactions = await tx<{ id: string }[]>`delete from tools.money_transactions
          where import_id = ${importId} returning id`;
        await tx`delete from tools.money_imports where id = ${importId}`;
        await linkUnambiguousTransfers(tx);
        await applyCategoryRules(tx);

        return {
          transactionCount: deletedTransactions.length,
          investmentEventCount: deletedEvents.length,
          balanceSnapshotCount: deletedSnapshots.length
        };
      });
    },

    async readLedgerSnapshot(scope) {
      const queries = new Set(moneyLedgerQueriesFor(scope));
      const needs = (query: MoneyLedgerQuery) => queries.has(query);
      const [transferRuleSet, imports, currentMonthTransactions, categoryRules, activity, count, transfers, transferReviewItems, monthly, categories, categoryMonths, merchantMonths, categoryActivity, events, investmentTotals, tradeMarkers, realizedEvents, snapshotRows, transferRuleOptions, reviewCounts, reviewQueue] = await Promise.all([
        needs("transferRules") ? readTransferRules(sql) : { rules: [], pairRules: [] },
        needs("imports") ? sql<ImportRow[]>`select id, digest, format, filename, bytes, source_row_count, inserted_row_count, duplicate_row_count, committed_at, created_by from tools.money_imports order by committed_at desc limit 50` : emptyRows<ImportRow>(),
        needs("currentMonthTransactions") ? sql<{ account_id: string; month: string }[]>`select distinct account_id::text account_id, to_char(local_date, 'YYYY-MM') as month from tools.money_transactions
          where status = 'completed' and local_date >= date_trunc('month', current_date) - interval '1 month'
            and local_date < date_trunc('month', current_date) + interval '2 months'` : emptyRows<{ account_id: string; month: string }>(),
        needs("categoryRules") ? sql<CategoryRuleRow[]>`select r.id::text id, r.account_id::text account_id, a.display_name account_name,
          r.match_field, r.match_operator, r.match_value, r.category, r.updated_at, coalesce(used.row_count, 0)::text row_count
          from tools.money_category_rules r
          left join tools.money_accounts a on a.id = r.account_id
          left join (select category_rule_id, count(*) row_count from (${effectiveTransactions(sql)}) effective
            where category_rule_id is not null group by category_rule_id) used on used.category_rule_id = r.id
          where r.active order by r.priority desc, r.id` : emptyRows<CategoryRuleRow>(),
        needs("activity") ? sql<ActivityRow[]>`select t.id, t.occurred_at, t.account_id::text account_id, a.display_name account_name, t.description, t.amount_minor, t.fee_minor, t.tax_minor, t.currency, t.status, t.source_type, t.flow_kind, t.category, t.category_origin, t.transfer_group_id, t.transfer_disposition
          from (${effectiveTransactions(sql)}) t join tools.money_accounts a on a.id = t.account_id
          order by t.occurred_at desc, t.source_row desc limit 50` : emptyRows<ActivityRow>(),
        needs("counts") ? sql<{ count: string; reverted_count: string }[]>`select
          (select count(*)::text from (${effectiveTransactions(sql)}) effective) count,
          (select count(*)::text from tools.money_transactions where status = 'reverted') reverted_count` : emptyRows<{ count: string; reverted_count: string }>(),
        needs("transferSummary") ? sql<TransferReviewRow[]>`select count(distinct transfer_group_id)::text linked_pairs,
          count(*) filter (where transfer_group_id is null)::text unlinked_count,
          count(*) filter (where transfer_group_id is null and transfer_disposition is null and amount_minor > 0)::text unresolved_positive_count,
          count(*) filter (where transfer_group_id is null and transfer_disposition is null and amount_minor < 0)::text unresolved_negative_count
          from (${effectiveTransactions(sql)}) effective where flow_kind = 'transfer'` : emptyRows<TransferReviewRow>(),
        needs("transferReview") ? sql<ActivityRow[]>`select t.id, t.occurred_at, t.account_id::text account_id, a.display_name account_name,
          t.description, t.amount_minor, t.fee_minor, t.tax_minor, t.currency, t.status, t.source_type,
          t.flow_kind, t.category, t.category_origin, t.transfer_group_id, t.transfer_disposition
          from (${effectiveTransactions(sql)}) t join tools.money_accounts a on a.id = t.account_id
          where t.flow_kind = 'transfer'
            and t.transfer_group_id is null and t.transfer_disposition is null
          order by a.display_name, t.occurred_at desc, t.source_row desc, t.id desc` : emptyRows<ActivityRow>(),
        needs("monthlyCashFlow") ? sql<MonthlyRow[]>`with classified as (
          select local_date, base_amount_minor, base_fee_minor, base_tax_minor, flow_kind,
            case
              when flow_kind = 'transfer' and transfer_group_id is not null then 'internal_transfer'
              when flow_kind = 'transfer' then coalesce(transfer_disposition, 'unreviewed')
              else flow_kind
            end effective_flow
          from (${effectiveTransactions(sql)}) effective
          where base_currency = 'EUR' and local_date < date_trunc('month', current_date)
        ), contributors as (
          select * from classified where
            (effective_flow in ('spend', 'refund', 'income', 'investment_income') and base_amount_minor <> 0)
            or base_fee_minor <> 0 or base_tax_minor <> 0
        ), bounds as (
          select date_trunc('month', min(local_date))::date first_month, date_trunc('month', max(local_date))::date last_month
          from contributors
        ), calendar as (
          select generate_series(first_month, last_month, interval '1 month')::date as month_start from bounds where first_month <= last_month
        ), monthly_contributors as (
          select date_trunc('month', local_date)::date month_start,
            sum(case when effective_flow = 'spend' and flow_kind = 'transfer' then -base_amount_minor when effective_flow = 'spend' then abs(base_amount_minor) else 0 end) spend_minor,
            sum(base_amount_minor) filter (where effective_flow = 'refund') refunds_minor,
            sum(base_amount_minor) filter (where effective_flow in ('income', 'investment_income')) income_minor,
            sum(base_fee_minor) fees_minor, sum(base_tax_minor) taxes_minor
          from contributors group by date_trunc('month', local_date)
        ), coverage as (
          select distinct date_trunc('month', local_date)::date month_start from contributors
        ) select to_char(calendar.month_start, 'YYYY-MM') as month, coverage.month_start is not null observed,
          coalesce(monthly_contributors.spend_minor, 0)::text spend_minor,
          coalesce(monthly_contributors.refunds_minor, 0)::text refunds_minor,
          coalesce(monthly_contributors.income_minor, 0)::text income_minor,
          coalesce(monthly_contributors.fees_minor, 0)::text fees_minor, coalesce(monthly_contributors.taxes_minor, 0)::text taxes_minor
          from calendar left join monthly_contributors using (month_start) left join coverage using (month_start) order by calendar.month_start` : emptyRows<MonthlyRow>(),
        needs("categoryTotals") ? sql<CategoryRow[]>`select category, coalesce(sum(category_spend_minor), 0)::text amount_minor,
          count(*)::text count from (${ledgerContributions(sql)}) contributions
          where base_currency = 'EUR' and effective_flow in ('spend', 'refund') group by category
          order by sum(category_spend_minor) desc` : emptyRows<CategoryRow>(),
        needs("categoryMonths") ? sql<CategoryMonthRow[]>`select to_char(date_trunc('month', local_date), 'YYYY-MM') as month, category,
          sum(category_spend_minor)::text amount_minor, count(*)::text count
          from (${ledgerContributions(sql)}) contributions
          where base_currency = 'EUR' and local_date < date_trunc('month', current_date) and effective_flow in ('spend', 'refund')
          group by date_trunc('month', local_date), category order by date_trunc('month', local_date), category` : emptyRows<CategoryMonthRow>(),
        needs("merchantMonths") ? sql<MerchantMonthRow[]>`select to_char(date_trunc('month', local_date), 'YYYY-MM') as month, category, source_type,
          coalesce(nullif(trim(description), ''), 'Unknown merchant') description,
          sum(category_spend_minor)::text amount_minor, count(*)::text count
          from (${ledgerContributions(sql)}) contributions
          where base_currency = 'EUR' and local_date < date_trunc('month', current_date) and effective_flow in ('spend', 'refund')
          group by date_trunc('month', local_date), category, source_type, coalesce(nullif(trim(description), ''), 'Unknown merchant')
          order by date_trunc('month', local_date), category, sum(category_spend_minor) desc` : emptyRows<MerchantMonthRow>(),
        needs("categoryActivity") ? sql<ActivityRow[]>`select id, occurred_at, account_name, description, amount_minor, fee_minor, tax_minor, currency, status, source_type, flow_kind, category, category_origin, transfer_group_id, transfer_disposition from (
          select t.id, t.occurred_at, a.display_name account_name, t.description, t.amount_minor, t.fee_minor, t.tax_minor, t.currency, t.status, t.source_type, t.flow_kind, t.category, t.category_origin, t.transfer_group_id, t.transfer_disposition,
            row_number() over (partition by t.category order by t.occurred_at desc, t.source_row desc) category_rank
          from (${effectiveTransactions(sql)}) t join tools.money_accounts a on a.id = t.account_id
          where t.base_currency = 'EUR'
            and t.local_date < date_trunc('month', current_date) and (
            t.flow_kind in ('spend', 'refund') or (t.flow_kind = 'transfer' and t.transfer_group_id is null and t.transfer_disposition in ('spend', 'refund'))
          )
        ) ranked where category_rank <= 12 order by occurred_at desc` : emptyRows<ActivityRow>(),
        needs("investmentPositions") ? sql<InvestmentRow[]>`select upper(trim(e.symbol)) symbol,
          (array_agg(e.name order by t.occurred_at desc, t.id desc) filter (where e.name is not null and trim(e.name) <> ''))[1] name,
          (array_agg(e.asset_class order by t.occurred_at desc, t.id desc) filter (where e.asset_class is not null and trim(e.asset_class) <> ''))[1] asset_class,
          coalesce(sum(case when e.event_kind in ('buy', 'split') then e.quantity when e.event_kind = 'sell' then -e.quantity else 0 end), 0)::text quantity,
          coalesce(sum(abs(t.base_amount_minor)) filter (where e.event_kind = 'buy'), 0)::text bought_minor,
          coalesce(sum(abs(t.base_amount_minor)) filter (where e.event_kind = 'sell'), 0)::text sold_minor,
          coalesce(sum(t.base_amount_minor) filter (where e.event_kind = 'dividend'), 0)::text income_minor,
          coalesce(sum(t.base_fee_minor), 0)::text fees_minor, coalesce(sum(t.base_tax_minor), 0)::text taxes_minor,
          count(*)::text event_count, t.base_currency currency
          from tools.money_investment_events e join (${effectiveTransactions(sql)}) t on t.id = e.transaction_id
          where t.base_currency = 'EUR' and e.symbol is not null and trim(e.symbol) <> ''
          group by upper(trim(e.symbol)), t.base_currency order by sum(abs(t.base_amount_minor)) desc nulls last` : emptyRows<InvestmentRow>(),
        needs("investmentTotals") ? sql<InvestmentTotalsRow[]>`select count(*)::text event_count,
          coalesce(sum(abs(t.base_amount_minor)) filter (where e.event_kind = 'buy'), 0)::text bought_minor,
          coalesce(sum(abs(t.base_amount_minor)) filter (where e.event_kind = 'sell'), 0)::text sold_minor,
          coalesce(sum(t.base_amount_minor) filter (where e.event_kind = 'dividend'), 0)::text income_minor,
          coalesce(sum(t.base_fee_minor), 0)::text fees_minor, coalesce(sum(t.base_tax_minor), 0)::text taxes_minor
          from tools.money_investment_events e join (${effectiveTransactions(sql)}) t on t.id = e.transaction_id
          where t.base_currency = 'EUR'` : emptyRows<InvestmentTotalsRow>(),
        needs("tradeMarkers") ? sql<TradeMarkerRow[]>`select t.local_date::text local_date, e.event_kind, upper(trim(e.symbol)) symbol,
          e.name, e.quantity::text quantity, t.base_amount_minor::text base_amount_minor,
          t.base_fee_minor::text base_fee_minor, t.base_currency currency
          from tools.money_investment_events e join (${effectiveTransactions(sql)}) t on t.id = e.transaction_id
          where t.base_currency = 'EUR' and e.event_kind in ('buy', 'sell')
            and e.symbol is not null and trim(e.symbol) <> '' and e.quantity is not null
          order by t.local_date, t.occurred_at, t.source_row, t.source_key` : emptyRows<TradeMarkerRow>(),
        needs("realizedEvents") ? sql<RealizedEventRow[]>`select t.account_id::text account_id, t.occurred_at, t.source_row, t.source_key, e.event_kind, e.symbol, e.quantity::text quantity,
          t.base_amount_minor::text base_amount_minor, t.base_fee_minor::text base_fee_minor
          from tools.money_investment_events e join (${effectiveTransactions(sql)}) t on t.id = e.transaction_id
          where t.base_currency = 'EUR'
          order by t.occurred_at, t.source_row, t.source_key` : emptyRows<RealizedEventRow>(),
        needs("balanceSnapshots") ? balanceSnapshotRows(sql) : emptyRows<SnapshotRow>(),
        needs("transferRuleOptions") ? sql<TransferRuleOptionRow[]>`select a.provider, t.source_type, count(*)::text count,
            count(*) filter (where t.transfer_group_id is null and t.transfer_disposition is null)::text unresolved_count
          from (${effectiveTransactions(sql)}) t join tools.money_accounts a on a.id = t.account_id
          where t.flow_kind = 'transfer' group by a.provider, t.source_type order by a.provider, t.source_type` : emptyRows<TransferRuleOptionRow>(),
        needs("reviewCounts") ? reviewCountRows(sql) : emptyRows<ReviewCountRow>(),
        needs("reviewQueue") ? readReviewQueue(sql) : { items: [], commonCategories: [] }
      ]);
      const spending = spendingAnalytics(monthly, categories, categoryMonths, merchantMonths, categoryActivity);
      return {
        imports: imports.map(summary), currentMonthTransactionAccounts: currentMonthTransactions.filter((row) => row.month === new Date().toISOString().slice(0, 7)).map((row) => row.account_id), recentTransactionMonths: currentMonthTransactions.map((row) => ({ accountId: row.account_id, month: row.month })), categoryRules: categoryRules.map(categoryRule), transferRules: transferRuleSet.rules, transferPairRules: transferRuleSet.pairRules,
        transferRuleOptions: transferRuleOptions.map((row) => ({ provider: row.provider, sourceType: row.source_type, count: integer(row.count), unresolvedCount: integer(row.unresolved_count) })), activity: activity.map(activityItem), transactionCount: Number(count[0]?.count ?? 0), revertedCount: Number(count[0]?.reverted_count ?? 0),
        transferReview: transferReview(transfers[0]), transferReviewGroups: transferReviewGroups(transferReviewItems),
        spending, investments: investmentAnalytics(events, investmentTotals[0], tradeMarkers, realizedEvents), planning: planningAnalytics(spending.months, transferReview(transfers[0])), ...balanceSnapshot(snapshotRows),
        reviewCounts: reviewCountsFrom(reviewCounts), reviewQueue
      };
    },

    async readReviewCounts() {
      return reviewCountsFrom(await reviewCountRows(sql));
    },
    async readActivityPage(input) {
      const pattern = `%${input.query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const accountName = sql`case when a.provider = 'portfolio_export' then case a.role when 'investment' then 'Trade Republic Investments' else 'Trade Republic Cash' end else a.display_name end`;
      const order = input.sort === "description" ? sql`t.description`
        : input.sort === "account" ? accountName
        : input.sort === "flow" ? sql`t.flow_kind`
        : input.sort === "category" ? sql`t.category`
        : input.sort === "costs" ? sql`(t.fee_minor + t.tax_minor)`
        : input.sort === "amount" ? sql`t.amount_minor`
        : sql`t.occurred_at`;
      const direction = input.direction === "asc" ? sql`asc` : sql`desc`;
      // Review work: transfers without a treatment, and spending without a category.
      const needsReview = sql`(t.status = 'completed' and ((t.flow_kind = 'transfer' and t.transfer_group_id is null and t.transfer_disposition is null)
        or (t.category = 'uncategorized' and (t.flow_kind = 'spend' or (t.flow_kind = 'transfer' and t.transfer_group_id is null and t.transfer_disposition = 'spend')))))`;
      const [rows, count] = await Promise.all([
        sql<ActivityRow[]>`select t.id, t.occurred_at, t.account_id::text account_id, ${accountName} account_name, t.description, t.amount_minor, t.fee_minor, t.tax_minor, t.currency, t.status, t.source_type, t.flow_kind, t.category, t.category_origin, t.transfer_group_id, t.transfer_disposition
          from (${effectiveTransactions(sql)}) t join tools.money_accounts a on a.id = t.account_id
          where (${input.query} = '' or t.description ilike ${pattern} escape '\\' or ${accountName} ilike ${pattern} escape '\\' or t.source_type ilike ${pattern} escape '\\')
            and (${input.flow ?? null}::text is null or t.flow_kind = ${input.flow ?? null})
            and (${input.accountId ?? null}::uuid is null or t.account_id = ${input.accountId ?? null}::uuid)
            and (${input.category ?? null}::text is null or t.category = ${input.category ?? null})
            and (${input.fromMonth ? `${input.fromMonth}-01` : null}::date is null or t.local_date >= ${input.fromMonth ? `${input.fromMonth}-01` : null}::date)
            and (${input.toMonth ? `${input.toMonth}-01` : null}::date is null or t.local_date < (${input.toMonth ? `${input.toMonth}-01` : null}::date + interval '1 month'))
            and (${input.reviewOnly ?? false} = false or ${needsReview})
          order by ${order} ${direction}, t.occurred_at desc, t.source_row desc, t.id desc limit ${input.limit} offset ${input.offset}`,
        sql<{ count: string }[]>`select count(*)::text count from (${effectiveTransactions(sql)}) t join tools.money_accounts a on a.id = t.account_id
          where (${input.query} = '' or t.description ilike ${pattern} escape '\\' or ${accountName} ilike ${pattern} escape '\\' or t.source_type ilike ${pattern} escape '\\')
            and (${input.flow ?? null}::text is null or t.flow_kind = ${input.flow ?? null})
            and (${input.accountId ?? null}::uuid is null or t.account_id = ${input.accountId ?? null}::uuid)
            and (${input.category ?? null}::text is null or t.category = ${input.category ?? null})
            and (${input.fromMonth ? `${input.fromMonth}-01` : null}::date is null or t.local_date >= ${input.fromMonth ? `${input.fromMonth}-01` : null}::date)
            and (${input.toMonth ? `${input.toMonth}-01` : null}::date is null or t.local_date < (${input.toMonth ? `${input.toMonth}-01` : null}::date + interval '1 month'))
            and (${input.reviewOnly ?? false} = false or ${needsReview})`
      ]);
      const total = Number(count[0]?.count ?? 0);
      return { items: rows.map(activityItem), total, hasMore: input.offset + rows.length < total };
    },

    setTransactionCategory(input) {
      if (!MONEY_CATEGORIES.includes(input.category)) throw new Error("Unsupported money category.");
      return sql.begin(async (tx) => {
        await lockCategoryRules(tx);
        const [row] = await tx<{ description: string; account_id: string; flow_kind: MoneyLedgerTransaction["flowKind"]; transfer_group_id: string | null; transfer_disposition: MoneyTransferDisposition | null }[]>`update tools.money_transactions
          set category = ${input.category}, category_origin = 'manual', category_rule_id = null
          where id = ${input.transactionId} returning description, account_id::text account_id, flow_kind, transfer_group_id::text transfer_group_id, transfer_disposition`;
        if (!row) throw new Error("Money transaction not found.");
        if (input.createRule && !isRuleCategorized({ flowKind: row.flow_kind, transferGroupId: row.transfer_group_id, transferDisposition: row.transfer_disposition })) throw new Error('Category rules can only be created for spending and refund rows.');
        const matchValue = normalizeCategoryRuleText(row.description);
        if (!input.createRule || !matchValue) return { affectedCount: 1 };
        await saveCategoryRuleRow(tx, { accountId: row.account_id, matchField: "description", matchOperator: "equals", matchValue, category: input.category }, input.actor);
        return { affectedCount: 1 + await applyCategoryRules(tx) };
      });
    },

    async previewCategoryRule(input) {
      const [rules, targets] = await Promise.all([readCategoryRules(sql), readCategoryRuleTargets(sql)]);
      return categoryRulePreview(rules, targets, input);
    },

    saveCategoryRule(input) {
      return sql.begin(async (tx) => {
        await lockCategoryRules(tx);
        const rules = await readCategoryRules(tx);
        if (input.ruleId && !rules.some((rule) => rule.id === input.ruleId)) throw new MoneyImportValidationError('rule_not_found', 'The rule no longer exists. Reload the rules.');
        const preview = categoryRulePreview(rules, await readCategoryRuleTargets(tx), input);
        if (preview.matchCount !== input.expectedMatchCount) throw new MoneyImportValidationError('rule_preview_stale', 'The matching transactions changed. Preview the rule again.');
        const ruleId = await saveCategoryRuleRow(tx, input, input.actor, input.ruleId);
        return { ruleId, affectedCount: await applyCategoryRules(tx) };
      });
    },

    deleteCategoryRule(ruleId) {
      return sql.begin(async (tx) => {
        await lockCategoryRules(tx);
        const [rule] = await tx<{ id: string }[]>`delete from tools.money_category_rules where id = ${ruleId} returning id`;
        if (!rule) return undefined;
        return { affectedCount: await applyCategoryRules(tx) };
      });
    },

    async previewTransferRule(input) {
      const rows = await unresolvedTransferRuleMatches(sql, input);
      return {
        matchCount: rows.length,
        examples: rows.slice(0, 20).map((row) => ({ id: row.id, date: row.local_date, accountName: row.account_name, description: row.description, amountMinor: integer(row.amount_minor), currency: row.currency }))
      };
    },

    createTransferRule(input) {
      return sql.begin(async (tx) => {
        await lockCategoryRules(tx);
        const matches = await unresolvedTransferRuleMatches(tx, input);
        if (matches.length !== input.expectedMatchCount) throw new MoneyImportValidationError("rule_preview_stale", "The unresolved transfers changed. Preview the rule again.");
        const [priority] = await tx<{ next_priority: number }[]>`select coalesce(max(priority), 90) + 10 next_priority from tools.money_transfer_rules`;
        await tx`insert into tools.money_transfer_rules (id, priority, provider, source_type, description_match, match_value, amount_sign, disposition, note, active, created_at, updated_at, created_by)
          values (${randomUUID()}, ${priority!.next_priority}, ${input.provider ?? null}, ${input.sourceType ?? null}, ${input.descriptionMatch},
            ${input.matchValue ?? null}, ${input.amountSign}, ${input.disposition}, ${input.note ?? null}, true, now(), now(), ${input.actor})`;
        const before = await unresolvedTransferCount(tx);
        await linkUnambiguousTransfers(tx);
        const affectedCount = before - await unresolvedTransferCount(tx);
        await applyCategoryRules(tx);
        return { affectedCount };
      });
    },

    async deleteTransferRule(ruleId) {
      const deleted = await sql`delete from tools.money_transfer_rules where id = ${ruleId} returning id`;
      return deleted.length === 1;
    },

    async setTransferDisposition(input) {
      await sql.begin(async (tx) => {
        await lockCategoryRules(tx);
        await updateTransferDisposition(tx, input);
        await applyCategoryRules(tx);
      });
    },

    setTransferDispositions(input) {
      return sql.begin(async (tx) => {
        await lockCategoryRules(tx);
        const updated = await tx<{ id: string }[]>`update tools.money_transactions set transfer_disposition = ${input.disposition}
          where id in ${tx(input.transactionIds)} and status = 'completed' and flow_kind = 'transfer'
            and transfer_group_id is null and transfer_disposition is null returning id`;
        await applyCategoryRules(tx);
        return { affectedCount: updated.length };
      });
    },

    addManualBalance(input) {
      return sql.begin(async (tx) => {
        const account = "accountId" in input
          ? (await tx<{ id: string }[]>`select id from tools.money_accounts where id = ${input.accountId} and role = 'cash' and currency = ${input.currency}`)[0]
          : await createManualAccount(tx, input.accountName, input.currency);
        if (!account) throw new Error("Cash account not found.");
        await tx`insert into tools.money_balance_snapshots (account_id, snapshot_date, observed_at, value_minor, currency, origin, import_id)
          values (${account.id}, ${input.date}, ${`${input.date}T12:00:00.000Z`}, ${input.valueMinor}, ${input.currency}, 'manual', null)
          on conflict (account_id, snapshot_date, origin) do update set observed_at = excluded.observed_at, value_minor = excluded.value_minor, currency = excluded.currency`;
      });
    },

    async readCheckInDays() {
      const rows = await sql<{ day: string }[]>`select distinct (committed_at at time zone 'Europe/Berlin')::date::text as day
        from tools.money_imports order by day`;
      return rows.map((row) => row.day);
    },

    async readCashSince(baseline) {
      const snapshots = (await balanceSnapshotRows(sql)).flatMap((row): MoneyCashSnapshotPoint[] =>
        row.role === "cash" && row.currency === "EUR" && row.snapshot_date !== null && row.value_minor !== null
          ? [{ accountId: row.account_id, date: row.snapshot_date, valueMinor: integer(row.value_minor) }]
          : []);
      // Each account's flows start after its last snapshot on or before the baseline, or at its first transaction.
      const starts = new Map<string, string | undefined>();
      for (const point of snapshots) {
        const start = starts.get(point.accountId);
        if (point.date <= baseline && (start === undefined || point.date > start)) starts.set(point.accountId, point.date);
        else if (!starts.has(point.accountId)) starts.set(point.accountId, undefined);
      }
      let from = baseline;
      for (const start of starts.values()) if (start === undefined || start < from) from = start ?? "0001-01-01";
      const [rows, items] = await Promise.all([
        sql<CashFlowRow[]>`with classified as (${classifiedCashTransactions(sql, from)})
          select cash_id account_id, local_date::text local_date,
            sum(case when effective_flow in ('income', 'investment_income') then base_amount_minor else 0 end)::text income_minor,
            sum(case when effective_flow in ('spend', 'refund', 'fee', 'tax') then base_amount_minor else 0 end - base_fee_minor - base_tax_minor)::text spending_minor,
            sum(case when flow_kind = 'trade' then base_amount_minor else 0 end)::text trades_minor,
            sum(case when flow_kind <> 'trade' and effective_flow not in ('income', 'investment_income', 'refund', 'spend', 'fee', 'tax') then base_amount_minor else 0 end)::text transfers_minor
          from classified group by cash_id, local_date order by local_date`,
        sql<CashItemRow[]>`with classified as (${classifiedCashTransactions(sql, from)})
          select cash_id account_id, local_date::text local_date,
            case when effective_flow in ('income', 'investment_income') then 'income' else 'spending' end kind,
            description, source_type,
            sum(case when effective_flow in ('income', 'investment_income') then base_amount_minor else base_amount_minor - base_fee_minor - base_tax_minor end)::text amount_minor
          from classified where effective_flow in ('income', 'investment_income', 'refund', 'spend', 'fee', 'tax')
          group by cash_id, local_date, 3, description, source_type`
      ]);
      return {
        snapshots,
        flows: rows.map((row) => ({
          accountId: row.account_id,
          date: row.local_date,
          incomeMinor: integer(row.income_minor),
          spendingMinor: integer(row.spending_minor),
          transfersMinor: integer(row.transfers_minor),
          tradesMinor: integer(row.trades_minor)
        })),
        items: items.map((row) => ({
          accountId: row.account_id,
          date: row.local_date,
          kind: row.kind,
          label: moneyMerchantName(row.description, row.source_type),
          amountMinor: integer(row.amount_minor)
        }))
      };
    },

    async readSpendingSince(from) {
      const rows = await sql<SpendingRow[]>`select local_date::text local_date, category, description, source_type,
          sum(category_spend_minor)::text amount_minor
        from (${ledgerContributions(sql)}) contributions
        where base_currency = 'EUR' and local_date > ${from} and effective_flow in ('spend', 'refund')
        group by local_date, category, description, source_type`;
      return rows.map((row) => ({
        date: row.local_date,
        category: row.category,
        merchant: moneyMerchantName(row.description, row.source_type),
        amountMinor: integer(row.amount_minor)
      }));
    },

    async readiness() { await sql`select 1 from tools.money_imports limit 1`; },
    close: () => sql.end()
  };
}

type ImportRow = { id: string; digest: string; format: MoneyImportFormat; filename: string; bytes: string; source_row_count: number; inserted_row_count: number; duplicate_row_count: number; committed_at: Date; created_by: string };
type ActivityRow = { id: string; occurred_at: Date; account_id?: string; account_name: string; description: string; amount_minor: string; fee_minor: string; tax_minor: string; currency: string; status: MoneyLedgerTransaction["status"]; source_type: string; flow_kind: MoneyLedgerTransaction["flowKind"]; category: MoneyCategory; category_origin: "source" | "rule" | "manual"; transfer_group_id: string | null; transfer_disposition: MoneyTransferDisposition | null };
type MonthlyRow = { month: string; observed: boolean; spend_minor: string; refunds_minor: string; income_minor: string; fees_minor: string; taxes_minor: string };
type CategoryRow = { category: MoneyCategory; amount_minor: string; count: string };
type CategoryMonthRow = CategoryRow & { month: string };
type MerchantMonthRow = CategoryMonthRow & { description: string; source_type: string };
type InvestmentRow = { symbol: string | null; name: string | null; asset_class: string | null; quantity: string; bought_minor: string; sold_minor: string; income_minor: string; fees_minor: string; taxes_minor: string; event_count: string; currency: string };
type InvestmentTotalsRow = { event_count: string; bought_minor: string; sold_minor: string; income_minor: string; fees_minor: string; taxes_minor: string };
type CategoryRuleRow = { id: string; account_id: string | null; account_name: string | null; match_field: MoneyCategoryRuleField; match_operator: MoneyCategoryRuleOperator; match_value: string; category: MoneyCategory; updated_at: Date; row_count: string };
type ActiveCategoryRuleRow = Pick<CategoryRuleRow, "id" | "account_id" | "match_field" | "match_operator" | "match_value" | "category">;
type CategoryRuleTargetRow = { id: string; account_id: string; account_name: string; local_date: string; flow_kind: MoneyLedgerTransaction["flowKind"]; transfer_group_id: string | null; transfer_disposition: MoneyTransferDisposition | null; description: string; mcc: string | null; source_type: string; amount_minor: string; currency: string; category: MoneyCategory; category_origin: "source" | "rule" | "manual"; category_rule_id: string | null; visible: boolean };
type RealizedEventRow = { account_id: string; occurred_at: Date; source_row: number; source_key: string; event_kind: MoneyInvestmentEventInput["eventKind"]; symbol: string | null; quantity: string | null; base_amount_minor: string; base_fee_minor: string };
type TradeMarkerRow = { local_date: string; event_kind: "buy" | "sell"; symbol: string; name: string | null; quantity: string; base_amount_minor: string; base_fee_minor: string; currency: string };
type CashItemRow = { account_id: string; local_date: string; kind: "income" | "spending"; description: string; source_type: string; amount_minor: string };
type SpendingRow = { local_date: string; category: MoneyCategory; description: string; source_type: string; amount_minor: string };
type CashFlowRow = { account_id: string; local_date: string; income_minor: string; spending_minor: string; transfers_minor: string; trades_minor: string };
type SnapshotRow = { account_id: string; snapshot_date: string | null; value_minor: string | null; currency: string; display_name: string; role: "cash" | "investment"; provider: string };
type TransferRow = { id: string; account_id: string; provider: string; source_type: string; occurred_at: Date; local_date: string; description: string; amount_minor: string; currency: string };
type TransferInferenceRow = { id: string; provider: string; source_type: string; description: string; amount_minor: string };
type TransferRuleOptionRow = { provider: string; source_type: string; count: string; unresolved_count: string };
type TransferRulePreviewRow = TransferInferenceRow & { local_date: string; account_name: string; currency: string };
type TransferRuleRow = { id: string; priority: number; provider: string | null; source_type: string | null; description_match: MoneyTransferRule["descriptionMatch"]; match_value: string | null; amount_sign: MoneyTransferRule["amountSign"]; disposition: MoneyTransferDisposition; note: string | null };
type TransferPairRuleRow = { id: string; debit_provider: string; debit_source_type: string; debit_match_value: string; credit_provider: string; credit_source_type: string; note: string | null };
type ReviewCountRow = { uncategorized: string; transfers: string; spending_rows: string; other_rows: string };
type ReviewQueueRow = ActivityRow & { similar_count: string; suggestions: MoneyCategory[] };
type TransferReviewRow = { linked_pairs: string; unlinked_count: string; unresolved_positive_count: string; unresolved_negative_count: string };

function receipt(row: ImportRow, replay: boolean): MoneyImportReceipt { return { id: row.id, digest: row.digest, format: row.format, filename: row.filename, rowCount: row.source_row_count, insertedCount: row.inserted_row_count, duplicateCount: row.duplicate_row_count, committedAt: row.committed_at.toISOString(), replay }; }
function summary(row: ImportRow): MoneyImportSummary { const { replay: _, ...item } = receipt(row, false); return { ...item, bytes: Number(row.bytes), actor: row.created_by }; }
function categoryRule(row: CategoryRuleRow): MoneyCategoryRule { return { ...categoryRuleDefinition(row), ...(row.account_name ? { accountName: row.account_name } : {}), rowCount: integer(row.row_count), updatedAt: row.updated_at.toISOString() }; }
function categoryRuleDefinition(row: ActiveCategoryRuleRow): MoneyCategoryRuleDefinition & Readonly<{ id: string }> { return { id: row.id, ...(row.account_id ? { accountId: row.account_id } : {}), matchField: row.match_field, matchOperator: row.match_operator, matchValue: row.match_value, category: row.category }; }
function activityItem(row: ActivityRow): MoneyActivityItem {
  const description = moneyDisplayDescription(row.description);
  const category = activityCategory(row);
  return { id: row.id, occurredAt: row.occurred_at.toISOString(), ...(row.account_id ? { accountId: row.account_id } : {}), accountName: row.account_name, description, ...(description === row.description ? {} : { rawDescription: row.description }), amountMinor: integer(row.amount_minor), feeMinor: integer(row.fee_minor), taxMinor: integer(row.tax_minor), currency: row.currency, status: row.status, sourceType: row.source_type, flowKind: row.flow_kind, category, categoryOrigin: category === row.category ? row.category_origin : "source", needsTransferReview: row.status === "completed" && row.flow_kind === "transfer" && !row.transfer_group_id && !row.transfer_disposition, ...(row.transfer_group_id ? { transferGroupId: row.transfer_group_id } : {}), ...(row.transfer_disposition ? { transferDisposition: row.transfer_disposition } : {}) };
}
function activityCategory(row: ActivityRow): MoneyCategory {
  if (row.flow_kind === "transfer" && (!row.transfer_disposition || row.transfer_disposition === "internal_transfer" || row.transfer_disposition === "excluded")) return "transfer";
  if (row.flow_kind === "balance_adjustment") return "adjustment";
  if (row.category !== "uncategorized") return row.category;
  if (row.flow_kind === "tax") return "taxes";
  if (row.flow_kind === "fee") return "fees";
  if (row.flow_kind === "income" || row.flow_kind === "investment_income") return "income";
  return row.category;
}

/** The newest uncategorized spending with category suggestions from other rows with the same description. */
async function readReviewQueue(sql: Sql): Promise<MoneyReviewQueue> {
  const [rows, common] = await Promise.all([
    sql<ReviewQueueRow[]>`with effective as materialized (${effectiveTransactions(sql)}), queue as (
        select t.id, t.occurred_at, t.account_id::text account_id, a.display_name account_name, t.description, t.amount_minor, t.fee_minor, t.tax_minor,
          t.currency, t.status, t.source_type, t.flow_kind, t.category, t.category_origin, t.transfer_group_id, t.transfer_disposition, t.account_id account_uuid
        from effective t join tools.money_accounts a on a.id = t.account_id
        where t.category = 'uncategorized' and t.base_currency = 'EUR'
          and (t.flow_kind in ('spend', 'refund') or (t.flow_kind = 'transfer' and t.transfer_group_id is null and t.transfer_disposition in ('spend', 'refund')))
        order by t.occurred_at desc, t.source_row desc limit 40
      ) select queue.*,
        (select count(*) from effective other where other.account_id = queue.account_uuid and other.id <> queue.id
          and lower(other.description) = lower(queue.description) and other.category = 'uncategorized'
          and (other.flow_kind in ('spend', 'refund') or (other.flow_kind = 'transfer' and other.transfer_group_id is null and other.transfer_disposition in ('spend', 'refund'))))::text similar_count,
        coalesce((select array_agg(used.category order by used.uses desc, used.category) from (
          select other.category, count(*) uses from effective other
          where lower(other.description) = lower(queue.description)
            and (other.flow_kind in ('spend', 'refund') or (other.flow_kind = 'transfer' and other.transfer_group_id is null and other.transfer_disposition in ('spend', 'refund')))
            and other.category not in ('uncategorized', 'transfer', 'income', 'adjustment')
          group by other.category order by count(*) desc, other.category limit 3
        ) used), '{}') suggestions
      from queue order by queue.occurred_at desc`,
    sql<{ category: MoneyCategory }[]>`select category from (${effectiveTransactions(sql)}) t
      where t.flow_kind = 'spend' and t.category not in ('uncategorized', 'transfer', 'income', 'adjustment') and t.local_date >= current_date - interval '1 year'
      group by category order by count(*) desc, category limit 6`
  ]);
  return {
    items: rows.map((row) => ({ ...activityItem(row), similarCount: integer(row.similar_count), suggestions: row.suggestions })),
    commonCategories: common.map((row) => row.category)
  };
}

function spendingAnalytics(monthly: MonthlyRow[], categories: CategoryRow[], categoryMonths: CategoryMonthRow[], merchantMonths: MerchantMonthRow[], categoryActivity: ActivityRow[]): MoneySpendingAnalytics {
  const months = monthly.map((row) => {
    const refundsMinor = integer(row.refunds_minor);
    const spendMinor = integer(row.spend_minor) - refundsMinor;
    const incomeMinor = integer(row.income_minor);
    const feesMinor = integer(row.fees_minor);
    const taxesMinor = integer(row.taxes_minor);
    return { month: row.month, observed: row.observed, spendMinor, refundsMinor, incomeMinor, feesMinor, taxesMinor, netCashFlowMinor: incomeMinor - spendMinor - feesMinor - taxesMinor };
  });
  return {
    months,
    categories: categories.map(categoryTotal),
    categoryMonths: categoryMonths.map((row) => ({ month: row.month, ...categoryTotal(row) })),
    merchantMonths: aggregateMerchantMonths(merchantMonths),
    categoryActivity: categoryActivity.map(activityItem),
    uncategorizedCount: integer(categories.find((row) => row.category === "uncategorized")?.count ?? "0")
  };
}

function aggregateMerchantMonths(rows: MerchantMonthRow[]): MoneySpendingAnalytics["merchantMonths"] {
  const totals = new Map<string, { month: string; category: MoneyCategory; description: string; amountMinor: number; count: number }>();
  for (const row of rows) {
    const description = moneyMerchantName(row.description, row.source_type);
    const key = `${row.month}\0${row.category}\0${description.toLocaleLowerCase("en-GB")}`;
    const total = totals.get(key) ?? { month: row.month, category: row.category, description, amountMinor: 0, count: 0 };
    total.amountMinor += integer(row.amount_minor);
    total.count += integer(row.count);
    totals.set(key, total);
  }
  return [...totals.values()];
}

function categoryTotal(row: CategoryRow) { return { category: row.category, amountMinor: integer(row.amount_minor), count: integer(row.count) }; }

function investmentAnalytics(rows: InvestmentRow[], totals: InvestmentTotalsRow | undefined, tradeMarkers: TradeMarkerRow[], realizedEvents: RealizedEventRow[]): MoneyInvestmentAnalytics {
  const items = rows.map((row) => { const symbol = row.symbol ?? "—"; const name = moneyMarketInstrumentName(symbol, row.name); return ({ symbol, ...(name ? { name } : {}), ...(row.asset_class ? { assetClass: row.asset_class } : {}),
    quantity: normalizeDatabaseDecimal(row.quantity), boughtMinor: integer(row.bought_minor), soldMinor: integer(row.sold_minor),
    incomeMinor: integer(row.income_minor), feesMinor: integer(row.fees_minor), taxesMinor: integer(row.taxes_minor), currency: row.currency }); });
  const trades = tradeMarkers.map((event) => { const name = moneyMarketInstrumentName(event.symbol, event.name); return ({ date: event.local_date, eventKind: event.event_kind, symbol: event.symbol, ...(name ? { name } : {}), quantity: normalizeDatabaseDecimal(event.quantity), amountMinor: Math.abs(integer(event.base_amount_minor)), feeMinor: integer(event.base_fee_minor), currency: event.currency }); });
  return { positions: items, trades, totals: { eventCount: integer(totals?.event_count ?? "0"), boughtMinor: integer(totals?.bought_minor ?? "0"), soldMinor: integer(totals?.sold_minor ?? "0"), incomeMinor: integer(totals?.income_minor ?? "0"), feesMinor: integer(totals?.fees_minor ?? "0"), taxesMinor: integer(totals?.taxes_minor ?? "0") },
    realized: fifoRealizedGains(realizedEvents.map((event) => ({ accountKey: event.account_id, occurredAt: event.occurred_at.toISOString(), sourceOrder: `${String(event.source_row).padStart(10, "0")}\0${event.source_key}`, eventKind: event.event_kind, ...(event.symbol ? { symbol: event.symbol.trim().toLocaleUpperCase("en-GB") } : {}), ...(event.quantity ? { quantity: event.quantity } : {}), baseAmountMinor: integer(event.base_amount_minor), baseFeeMinor: integer(event.base_fee_minor) }))) };
}

function planningAnalytics(months: MoneySpendingAnalytics["months"], review: MoneyLedgerSnapshot["transferReview"]): MoneyPlanningAnalytics {
  const calendar = months.slice(-12);
  let firstConsecutive = calendar.length;
  while (firstConsecutive > 0 && calendar[firstConsecutive - 1]!.observed) firstConsecutive -= 1;
  const recent = calendar.slice(firstConsecutive).map((item) => item.netCashFlowMinor).sort((a, b) => a - b);
  const middle = Math.floor(recent.length / 2);
  const median = recent.length ? recent.length % 2 ? recent[middle]! : Math.round((recent[middle - 1]! + recent[middle]!) / 2) : 0;
  const unresolvedTransferCount = review.unresolvedPositiveCount + review.unresolvedNegativeCount;
  const ready = recent.length >= 6;
  return { ready, unresolvedTransferCount, medianMonthlyNetMinor: median, observedMonthCount: recent.length,
    projections: ready ? ([6, 12, 60] as const).map((projectionMonths) => ({ months: projectionMonths, changeMinor: median * projectionMonths })) : [] };
}

/** Cash-account transactions after a day. Trade Republic rows count toward its derived cash account. */
function classifiedCashTransactions(sql: Sql, from: string) {
  return sql`select c.cash_id, t.local_date, t.flow_kind, t.description, t.source_type, t.base_amount_minor, t.base_fee_minor, t.base_tax_minor,
      case
        when t.flow_kind = 'transfer' and t.transfer_group_id is not null then 'internal_transfer'
        when t.flow_kind = 'transfer' then coalesce(t.transfer_disposition, 'unreviewed')
        else t.flow_kind
      end effective_flow
    from (${effectiveTransactions(sql)}) t
    join (
      select source.id source_id, coalesce(trade_republic_cash.id, source.id)::text cash_id
      from tools.money_accounts source
      left join tools.money_accounts trade_republic_cash
        on source.provider = 'portfolio_export' and trade_republic_cash.provider = 'portfolio_export' and trade_republic_cash.role = 'cash'
        and regexp_replace(trade_republic_cash.external_ref, ':(cash|investment)$', '') = regexp_replace(source.external_ref, ':(cash|investment)$', '')
        and not exists (select 1 from tools.money_balance_snapshots s where s.account_id = trade_republic_cash.id)
    ) c on c.source_id = t.account_id
    where t.base_currency = 'EUR' and t.flow_kind <> 'balance_adjustment' and t.local_date > ${from}`;
}

/** Explicit balance snapshots, monthly Trade Republic cash derived from its ledger, and unobserved accounts. */
function balanceSnapshotRows(sql: Sql) {
  return sql<SnapshotRow[]>`with explicit_snapshots as (
    select distinct on (s.account_id, s.snapshot_date) s.account_id::text account_id, s.snapshot_date::text snapshot_date,
      s.value_minor::text value_minor, s.currency, a.display_name, a.role, a.provider
    from tools.money_balance_snapshots s join tools.money_accounts a on a.id = s.account_id
    order by s.account_id, s.snapshot_date, case when s.origin = 'manual' then 0 else 1 end, s.observed_at desc
  ), trade_republic_cash_snapshots as (
    select monthly.account_id, monthly.snapshot_date,
      sum(monthly.change_minor) over (partition by monthly.account_id order by monthly.snapshot_date)::text value_minor,
      monthly.currency, monthly.display_name, monthly.role, monthly.provider
    from (
      select cash_account.id::text account_id, max(t.local_date)::text snapshot_date,
        sum(t.amount_minor - t.fee_minor - t.tax_minor) change_minor,
        cash_account.currency, cash_account.display_name, cash_account.role, cash_account.provider
      from (${effectiveTransactions(sql)}) t
      join tools.money_accounts source_account on source_account.id = t.account_id
      join tools.money_accounts cash_account
        on cash_account.provider = 'portfolio_export' and cash_account.role = 'cash'
        and regexp_replace(cash_account.external_ref, ':(cash|investment)$', '') = regexp_replace(source_account.external_ref, ':(cash|investment)$', '')
      where source_account.provider = 'portfolio_export' and t.currency = 'EUR'
        and not exists (select 1 from tools.money_balance_snapshots s where s.account_id = cash_account.id)
      group by cash_account.id, date_trunc('month', t.local_date), cash_account.currency,
        cash_account.display_name, cash_account.role, cash_account.provider
    ) monthly
  )
  select * from explicit_snapshots
  union all
  select * from trade_republic_cash_snapshots
  union all
  select a.id::text, null, null, a.currency, a.display_name, a.role, a.provider
  from tools.money_accounts a
  where a.currency = 'EUR'
    and not (a.provider = 'portfolio_export' and a.role = 'cash')
    and not exists (select 1 from tools.money_balance_snapshots s where s.account_id = a.id)
    and exists (select 1 from tools.money_transactions t where t.account_id = a.id and t.status = 'completed')
  order by snapshot_date nulls last, display_name`;
}

function balanceSnapshot(rows: SnapshotRow[]): MoneyTrackerSnapshot {
  const byDate = new Map<string, Record<string, number>>(); const labels: Record<string, string> = {}; const roles: Record<string, "cash" | "investment"> = {}; const accountLastObserved: Record<string, string> = {}; const accounts = new Set<string>();
  const labelsByAccount = new Map(rows.map((row) => [row.account_id, accountDisplayName(row)]));
  const labelCounts = new Map<string, number>();
  for (const label of labelsByAccount.values()) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  for (const row of rows) {
    if (row.currency !== "EUR") continue;
    const baseName = labelsByAccount.get(row.account_id)!;
    const name = (labelCounts.get(baseName) ?? 0) > 1 ? `${baseName} · ${row.provider} ${row.account_id.slice(0, 6)}` : baseName;
    accounts.add(row.account_id); labels[row.account_id] = name; roles[row.account_id] = row.role;
    if (row.snapshot_date === null || row.value_minor === null) continue;
    const month = `${row.snapshot_date.slice(0, 7)}-01`;
    accountLastObserved[row.account_id] = month; const values = byDate.get(month) ?? {}; values[row.account_id] = integer(row.value_minor) / 100; byDate.set(month, values);
  }
  const carried: Record<string, number> = {};
  const observedDates = [...byDate.keys()].sort();
  const calendarDates = observedDates.length ? monthRange(observedDates[0]!, observedDates.at(-1)!) : [];
  const months = calendarDates.map((date) => {
    const updates = byDate.get(date) ?? {};
    Object.assign(carried, updates);
    const values = { ...carried };
    return { date, values, observedAccounts: Object.keys(updates), total: Object.values(values).reduce((sum, value) => sum + value, 0) };
  });
  return { accounts: [...accounts].sort((left, right) => labels[left]!.localeCompare(labels[right]!)), accountLabels: labels, accountRoles: roles, accountLastObserved, months, latestDate: months.at(-1)?.date };
}

function accountDisplayName(row: Pick<SnapshotRow, "display_name" | "provider" | "role">) {
  if (row.provider !== "portfolio_export") return row.display_name;
  return `Trade Republic ${row.role === "investment" ? "Investments" : "Cash"}`;
}

function monthRange(first: string, last: string) { const result: string[] = []; const current = new Date(`${first}T00:00:00Z`); const end = new Date(`${last}T00:00:00Z`); while (current <= end) { result.push(current.toISOString().slice(0, 10)); current.setUTCMonth(current.getUTCMonth() + 1); } return result; }

function transferReview(row?: TransferReviewRow): MoneyLedgerSnapshot["transferReview"] {
  return { linkedPairs: Number(row?.linked_pairs ?? 0), unlinkedCount: Number(row?.unlinked_count ?? 0),
    unresolvedPositiveCount: Number(row?.unresolved_positive_count ?? 0), unresolvedNegativeCount: Number(row?.unresolved_negative_count ?? 0) };
}

function transferReviewGroups(rows: ActivityRow[]): MoneyTransferReviewGroup[] {
  const groups = new Map<string, MoneyTransferReviewGroup>();
  for (const row of rows) {
    const amountMinor = integer(row.amount_minor);
    const direction = amountMinor > 0 ? "inflow" : "outflow";
    const description = moneyTransferReviewDescription(row.description, row.source_type);
    const key = `${row.account_id}\0${description.toLocaleLowerCase("en-GB")}\0${row.source_type}\0${direction}\0${row.currency}`;
    const item = activityItem(row);
    const current = groups.get(key);
    groups.set(key, current ? { ...current, count: current.count + 1, totalMinor: current.totalMinor + amountMinor, items: [...current.items, item] } : {
      representativeId: row.id,
      accountName: row.account_name,
      description,
      sourceType: row.source_type,
      direction,
      currency: row.currency,
      count: 1,
      totalMinor: amountMinor,
      items: [item]
    });
  }
  return [...groups.values()].sort((left, right) => right.count - left.count || Math.abs(right.totalMinor) - Math.abs(left.totalMinor) || left.description.localeCompare(right.description));
}

/** Serializes rule changes with the writes that apply rules, so each write sees one complete rule set. Take it before other locks. */
async function lockCategoryRules(tx: postgres.TransactionSql) {
  await tx`lock table tools.money_category_rules in share row exclusive mode`;
}

async function readCategoryRules(sql: Sql | postgres.TransactionSql) {
  const rows = await sql<ActiveCategoryRuleRow[]>`select id::text id, account_id::text account_id, match_field, match_operator, match_value, category
    from tools.money_category_rules where active order by priority desc, id`;
  return rows.map(categoryRuleDefinition);
}

/** Every row: rules decide the rule-categorized rows, and the others take the category their flow implies. */
function readCategoryRuleTargets(sql: Sql | postgres.TransactionSql) {
  return sql<CategoryRuleTargetRow[]>`select t.id::text id, t.account_id::text account_id, a.display_name account_name, t.local_date::text local_date, t.flow_kind,
      t.transfer_group_id::text transfer_group_id, t.transfer_disposition, t.description, t.mcc, t.source_type, t.amount_minor::text amount_minor,
      t.currency, t.category, t.category_origin, t.category_rule_id::text category_rule_id, effective.id is not null visible
    from tools.money_transactions t
    join tools.money_accounts a on a.id = t.account_id
    left join (select id from (${effectiveTransactions(sql)}) effective_rows) effective on effective.id = t.id
    order by t.occurred_at desc, t.source_row desc, t.id`;
}

type CategoryRuleOutcome = Readonly<{ category: MoneyCategory; origin: "source" | "rule"; ruleId: string | null }>;

function categoryRuleOutcome(target: CategoryRuleTargetRow, match: (subject: MoneyCategoryRuleSubject) => (MoneyCategoryRuleDefinition & Readonly<{ id: string }>) | undefined): CategoryRuleOutcome {
  if (!isRuleCategorizedTarget(target)) return { category: inferMoneyCategory(target.flow_kind), origin: "source", ruleId: null };
  const rule = match(categoryRuleSubject(target));
  return rule ? { category: rule.category, origin: "rule", ruleId: rule.id } : { category: "uncategorized", origin: "source", ruleId: null };
}

function isRuleCategorizedTarget(target: CategoryRuleTargetRow) {
  return isRuleCategorized({ flowKind: target.flow_kind, transferGroupId: target.transfer_group_id, transferDisposition: target.transfer_disposition });
}

function categoryRuleSubject(target: CategoryRuleTargetRow): MoneyCategoryRuleSubject {
  return { accountId: target.account_id, description: target.description, mcc: target.mcc, sourceType: target.source_type };
}

/** Puts the proposed rule first, as saving does, and compares the result with the stored categories of visible rows. */
function categoryRulePreview(rules: readonly (MoneyCategoryRuleDefinition & Readonly<{ id: string }>)[], targets: readonly CategoryRuleTargetRow[], input: MoneyCategoryRuleInput & Readonly<{ ruleId?: string }>): MoneyCategoryRulePreview {
  const proposed = { ...input, id: input.ruleId ?? "proposed" };
  const matchesProposed = categoryRuleMatcher([proposed]);
  const match = categoryRuleMatcher([proposed, ...rules.filter((rule) => rule.id !== input.ruleId)]);
  const changes: MoneyCategoryRuleChange[] = [];
  let matchCount = 0;
  let manualCount = 0;
  for (const target of targets) {
    if (!target.visible || !isRuleCategorizedTarget(target)) continue;
    const matches = matchesProposed(categoryRuleSubject(target)) !== undefined;
    const nextCategory = target.category_origin === "manual" ? target.category : categoryRuleOutcome(target, match).category;
    if (matches) matchCount += 1;
    if (matches && target.category_origin === "manual") manualCount += 1;
    if (matches || nextCategory !== target.category) changes.push({ id: target.id, date: target.local_date, accountName: target.account_name, description: moneyDisplayDescription(target.description), amountMinor: integer(target.amount_minor), currency: target.currency, category: target.category, categoryOrigin: target.category_origin, nextCategory, matches });
  }
  const changed = changes.filter((change) => change.nextCategory !== change.category);
  return {
    matchCount,
    changeCount: changed.length,
    manualCount,
    examples: [...changed, ...changes.filter((change) => change.nextCategory === change.category)].slice(0, 25)
  };
}

/** Stores a rule first in match order. It replaces another rule with the same condition. */
async function saveCategoryRuleRow(tx: postgres.TransactionSql, rule: MoneyCategoryRuleDefinition, actor: string, ruleId: string = randomUUID()) {
  const accountId = rule.accountId ?? null;
  await tx`delete from tools.money_category_rules where id <> ${ruleId} and account_id is not distinct from ${accountId}::uuid
    and match_field = ${rule.matchField} and match_operator = ${rule.matchOperator} and match_value = ${rule.matchValue}`;
  const [priority] = await tx<{ next_priority: number }[]>`select coalesce(max(priority), 0) + 1 next_priority from tools.money_category_rules`;
  await tx`insert into tools.money_category_rules (id, account_id, priority, match_field, match_operator, match_value, category, active, created_at, updated_at, created_by)
    values (${ruleId}, ${accountId}, ${priority!.next_priority}, ${rule.matchField}, ${rule.matchOperator}, ${rule.matchValue}, ${rule.category}, true, now(), now(), ${actor})
    on conflict (id) do update set account_id = excluded.account_id, priority = excluded.priority, match_field = excluded.match_field,
      match_operator = excluded.match_operator, match_value = excluded.match_value, category = excluded.category, active = true, updated_at = now()`;
  return ruleId;
}

/**
 * Applies the active rules in match order to every row without a manual category. Every call computes the same
 * result from the rules and rows alone. Returns how many visible rows changed category. Callers hold the rule lock.
 */
async function applyCategoryRules(tx: postgres.TransactionSql) {
  const match = categoryRuleMatcher(await readCategoryRules(tx));
  const updates = new Map<string, { outcome: CategoryRuleOutcome; ids: string[] }>();
  let affectedCount = 0;
  for (const target of await readCategoryRuleTargets(tx)) {
    if (target.category_origin === "manual") continue;
    const outcome = categoryRuleOutcome(target, match);
    if (outcome.category === target.category && outcome.origin === target.category_origin && outcome.ruleId === target.category_rule_id) continue;
    if (target.visible && outcome.category !== target.category) affectedCount += 1;
    const key = `${outcome.category}:${outcome.origin}:${outcome.ruleId}`;
    const update = updates.get(key) ?? { outcome, ids: [] };
    update.ids.push(target.id);
    updates.set(key, update);
  }
  const changes = [...updates.values()].flatMap(({ outcome, ids }) => ids.map((id) => ({ id, ...outcome })));
  for (const batch of chunks(changes, RELATED_INSERT_CHUNK_SIZE)) {
    // A manual choice made while the rows were read wins over the rule result.
    await tx`update tools.money_transactions t set category = changes.category, category_origin = changes.origin, category_rule_id = changes.rule_id
      from unnest(${tx.array(batch.map((change) => change.id))}::uuid[], ${tx.array(batch.map((change) => change.category))}::text[],
        ${tx.array(batch.map((change) => change.origin))}::text[], ${tx.array(batch.map((change) => change.ruleId))}::uuid[]) as changes(id, category, origin, rule_id)
      where t.id = changes.id and t.category_origin <> 'manual'`;
  }
  return affectedCount;
}

async function createManualAccount(tx: postgres.TransactionSql, accountName: string, currency: string) {
  const name = accountName.trim();
  const ref = `manual:${name.toLocaleLowerCase("en-GB")}:cash:${currency}`;
  const [account] = await tx<{ id: string }[]>`insert into tools.money_accounts (id, provider, external_ref, display_name, role, currency, created_at, updated_at)
    values (${randomUUID()}, 'manual', ${ref}, ${name}, 'cash', ${currency}, now(), now())
    on conflict (provider, external_ref) do update set display_name = excluded.display_name, role = excluded.role, updated_at = now() returning id`;
  return account;
}

/** Re-imports pick up improved defaults without overwriting category or transfer review choices. */
async function refreshInferredTransactions(tx: postgres.TransactionSql, transactions: readonly MoneyLedgerTransaction[]) {
  const sourceKeysByFlow = new Map<MoneyLedgerTransaction["flowKind"], string[]>();
  for (const transaction of transactions) {
    const sourceKeys = sourceKeysByFlow.get(transaction.flowKind) ?? [];
    sourceKeys.push(transaction.sourceKey);
    sourceKeysByFlow.set(transaction.flowKind, sourceKeys);
  }
  for (const [flowKind, sourceKeys] of sourceKeysByFlow) {
    for (const keys of chunks(sourceKeys, 1_000)) {
      if (keys.length) await tx`update tools.money_transactions set flow_kind = ${flowKind}
        where source_key in ${tx(keys)} and transfer_group_id is null and transfer_disposition is null and flow_kind <> ${flowKind}`;
    }
  }
  for (const category of MONEY_CATEGORIES) {
    const sourceKeys = transactions.filter((item) => item.category === category).map((item) => item.sourceKey);
    for (const keys of chunks(sourceKeys, 1_000)) {
      if (keys.length) await tx`update tools.money_transactions set category = ${category}
        where source_key in ${tx(keys)} and category_origin = 'source' and category <> ${category}`;
    }
  }
}

async function linkUnambiguousTransfers(tx: postgres.TransactionSql) {
  await tx`update tools.money_transactions set transfer_disposition = 'excluded'
    where status = 'completed' and flow_kind = 'transfer' and source_type = 'Exchange'
      and transfer_group_id is null and transfer_disposition is null`;
  const { rules, pairRules } = await readTransferRules(tx);
  const unresolved = await tx<TransferRow[]>`select t.id, t.account_id, a.provider, t.source_type, t.occurred_at, t.local_date::text, lower(trim(t.description)) description, t.amount_minor::text, t.currency
    from (${effectiveTransactions(tx)}) t join tools.money_accounts a on a.id = t.account_id
    where t.flow_kind = 'transfer' and t.amount_minor <> 0
      and t.transfer_group_id is null and t.transfer_disposition is null`;
  const inference = (row: TransferRow) => ({ provider: row.provider, sourceType: row.source_type, description: row.description, amountMinor: integer(row.amount_minor) });
  const rows = unresolved.filter((row) => isStatementTransfer(row) || isRuleTransferCandidate(inference(row), rules, pairRules));
  const used = new Set<string>();
  const pairs: Array<readonly [string, string]> = [];
  for (const pair of matchCardFundingPairs(rows.map((row) => ({
    id: row.id, accountId: row.account_id, provider: row.provider, sourceType: row.source_type,
    description: row.description, localDate: row.local_date, amountMinor: integer(row.amount_minor), currency: row.currency
  })), pairRules)) {
    pairs.push(pair);
    used.add(pair[0]);
    used.add(pair[1]);
  }
  const genericRows = rows.filter((row) => !isCardFundingDebit(inference(row), pairRules));
  collectExactTransferPairs(genericRows, used, pairs);
  collectDateTransferPairs(genericRows, used, pairs);
  if (pairs.length) {
    const candidateIds = pairs.flatMap((pair) => pair).sort();
    const lockedIds = new Set<string>();
    for (const batch of chunks(candidateIds, RELATED_INSERT_CHUNK_SIZE)) {
      const locked = await tx<{ id: string }[]>`select raw.id from tools.money_transactions raw
        join (${effectiveTransactions(tx)}) effective on effective.id = raw.id
        where raw.id in ${tx(batch)} and raw.flow_kind = 'transfer'
          and raw.transfer_group_id is null and raw.transfer_disposition is null
        order by raw.id for update of raw`;
      for (const row of locked) lockedIds.add(row.id);
    }
    const assignments = pairs.flatMap((pair) => {
      if (!pair.every((id) => lockedIds.has(id))) return [];
      const groupId = randomUUID();
      return pair.map((id) => ({ id, groupId }));
    });
    for (const batch of chunks(assignments, RELATED_INSERT_CHUNK_SIZE)) {
      const ids = batch.map((assignment) => assignment.id);
      const groupIds = batch.map((assignment) => assignment.groupId);
      await tx`update tools.money_transactions t set transfer_group_id = assignments.group_id,
        transfer_disposition = 'internal_transfer'
        from unnest(${tx.array(ids)}::uuid[], ${tx.array(groupIds)}::uuid[]) as assignments(id, group_id)
        where t.id = assignments.id and t.transfer_group_id is null and t.transfer_disposition is null`;
    }
  }
  await inferUnlinkedTransferDispositions(tx, rules);
}

const SPARKASSE_TRANSFER_TYPE_SET = new Set<string>(SPARKASSE_TRANSFER_TYPES);

/** Statement types that always describe money moving between accounts. Owner-specific evidence lives in transfer rules. */
function isStatementTransfer(row: TransferRow) {
  return ["Transfer", "Topup", "CASH TOP-UP", "CASH WITHDRAWAL", "CUSTOMER_INBOUND", "CUSTOMER_INPAYMENT"].includes(row.source_type)
    || row.source_type.startsWith("TRANSFER")
    || (row.provider === "sparkasse" && SPARKASSE_TRANSFER_TYPE_SET.has(row.source_type));
}

async function readTransferRules(sql: Sql | TransactionSql) {
  const [rules, pairRules] = await Promise.all([
    sql<TransferRuleRow[]>`select id, priority, provider, source_type, description_match, match_value, amount_sign, disposition, note
      from tools.money_transfer_rules where active order by priority desc, created_at, id`,
    sql<TransferPairRuleRow[]>`select id, debit_provider, debit_source_type, debit_match_value, credit_provider, credit_source_type, note
      from tools.money_transfer_pair_rules where active order by created_at, id`
  ]);
  return {
    rules: rules.map((row): MoneyTransferRule => ({
      id: row.id,
      priority: row.priority,
      ...(row.provider === null ? {} : { provider: row.provider }),
      ...(row.source_type === null ? {} : { sourceType: row.source_type }),
      descriptionMatch: row.description_match,
      ...(row.match_value === null ? {} : { matchValue: row.match_value }),
      amountSign: row.amount_sign,
      disposition: row.disposition,
      ...(row.note === null ? {} : { note: row.note })
    })),
    pairRules: pairRules.map((row): MoneyTransferPairRule => ({
      id: row.id,
      debitProvider: row.debit_provider,
      debitSourceType: row.debit_source_type,
      debitMatchValue: row.debit_match_value,
      creditProvider: row.credit_provider,
      creditSourceType: row.credit_source_type,
      ...(row.note === null ? {} : { note: row.note })
    }))
  };
}

/** Sets one transfer's disposition. A disposition other than internal_transfer splits a linked pair. */
async function updateTransferDisposition(tx: TransactionSql, input: Readonly<{ transactionId: string; disposition: MoneyTransferDisposition }>) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [snapshot] = await tx<{ transfer_group_id: string | null }[]>`select transfer_group_id from tools.money_transactions
      where id = ${input.transactionId} and status = 'completed' and flow_kind = 'transfer'`;
    if (!snapshot) throw new Error("Reviewable money transfer not found.");
    if (snapshot.transfer_group_id) {
      const locked = await tx<{ id: string }[]>`select id from tools.money_transactions
        where transfer_group_id = ${snapshot.transfer_group_id} order by id for update`;
      if (!locked.some((row) => row.id === input.transactionId)) continue;
      if (input.disposition === "internal_transfer") return;
      await tx`update tools.money_transactions set transfer_group_id = null,
        transfer_disposition = case when id = ${input.transactionId} then ${input.disposition} else null end
        where transfer_group_id = ${snapshot.transfer_group_id}`;
      return;
    }
    const updated = await tx<{ id: string }[]>`update tools.money_transactions set transfer_disposition = ${input.disposition}
      where id = ${input.transactionId} and status = 'completed' and flow_kind = 'transfer'
        and transfer_group_id is null returning id`;
    if (updated[0]) return;
  }
  throw new Error("The transfer changed while it was being reviewed. Try again.");
}

async function unresolvedTransferRuleMatches(sql: Sql | TransactionSql, input: MoneyTransferRuleInput) {
  const rule: MoneyTransferRule = { ...input, id: "preview", priority: 0 };
  const rows = await sql<TransferRulePreviewRow[]>`select t.id, a.provider, a.display_name account_name, t.source_type, t.description,
      t.amount_minor::text, t.currency, t.local_date::text
    from tools.money_transactions t join tools.money_accounts a on a.id = t.account_id
    where t.status = 'completed' and t.flow_kind = 'transfer'
      and t.transfer_group_id is null and t.transfer_disposition is null
    order by t.local_date desc, t.id`;
  return rows.filter((row) => transferRuleMatches(rule, { provider: row.provider, sourceType: row.source_type, description: row.description, amountMinor: integer(row.amount_minor) }));
}

async function unresolvedTransferCount(tx: TransactionSql) {
  const [row] = await tx<{ count: string }[]>`select count(*)::text count from tools.money_transactions
    where status = 'completed' and flow_kind = 'transfer' and transfer_group_id is null and transfer_disposition is null`;
  return integer(row?.count ?? "0");
}

async function inferUnlinkedTransferDispositions(tx: postgres.TransactionSql, rules: readonly MoneyTransferRule[]) {
  const rows = await tx<TransferInferenceRow[]>`select t.id, a.provider,
      t.source_type, t.description, t.amount_minor::text
    from tools.money_transactions t join tools.money_accounts a on a.id = t.account_id
    where t.status = 'completed' and t.flow_kind = 'transfer'
      and t.transfer_group_id is null and t.transfer_disposition is null`;
  const dispositions = new Map<MoneyTransferDisposition, string[]>();
  for (const row of rows) {
    const disposition = inferTransferDisposition({
      provider: row.provider,
      sourceType: row.source_type,
      description: row.description,
      amountMinor: integer(row.amount_minor),
    }, rules);
    if (!disposition) continue;
    dispositions.set(disposition, [...(dispositions.get(disposition) ?? []), row.id]);
  }
  for (const [disposition, ids] of dispositions) {
    for (const batch of chunks(ids, RELATED_INSERT_CHUNK_SIZE)) {
      await tx`update tools.money_transactions set transfer_disposition = ${disposition}
        where id in ${tx(batch)} and transfer_group_id is null and transfer_disposition is null`;
    }
  }
}

function collectExactTransferPairs(rows: readonly TransferRow[], used: Set<string>, pairs: Array<readonly [string, string]>) {
  const available = rows.filter((row) => !used.has(row.id));
  const buckets = transferBuckets(available, (row) => `${row.currency}:${integer(row.amount_minor)}:${row.occurred_at.getTime()}:${row.description}`);
  collectMutuallyUnique(available, used, pairs, (row) => buckets.get(`${row.currency}:${-integer(row.amount_minor)}:${row.occurred_at.getTime()}:${row.description}`) ?? []);
}

function collectDateTransferPairs(rows: readonly TransferRow[], used: Set<string>, pairs: Array<readonly [string, string]>) {
  const available = rows.filter((row) => !used.has(row.id));
  const buckets = transferBuckets(available, (row) => `${row.currency}:${integer(row.amount_minor)}:${Math.floor(day(row.local_date))}`);
  collectMutuallyUnique(available, used, pairs, (row) => Array.from({ length: 7 }, (_, index) => buckets.get(`${row.currency}:${-integer(row.amount_minor)}:${Math.floor(day(row.local_date)) + index - 3}`) ?? []).flat());
}

function transferBuckets(rows: readonly TransferRow[], key: (row: TransferRow) => string) {
  const buckets = new Map<string, TransferRow[]>();
  for (const row of rows) {
    const bucketKey = key(row);
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(row);
    else buckets.set(bucketKey, [row]);
  }
  return buckets;
}

function collectMutuallyUnique(rows: readonly TransferRow[], used: Set<string>, pairs: Array<readonly [string, string]>, candidatesFor: (row: TransferRow) => readonly TransferRow[]) {
  const candidates = new Map(rows.map((row) => [row.id, candidatesFor(row).filter((other) => other.account_id !== row.account_id)]));
  for (const row of rows) {
    const rowMatches = candidates.get(row.id) ?? [];
    const other = rowMatches[0];
    if (rowMatches.length !== 1 || !other || (candidates.get(other.id)?.length ?? 0) !== 1 || used.has(row.id) || used.has(other.id)) continue;
    used.add(row.id); used.add(other.id);
    pairs.push([row.id, other.id]);
  }
}

async function existingTransactionSourceKeys(sql: Sql | TransactionSql, transactions: readonly MoneyLedgerTransaction[]) {
  const sourceKeys = new Set(transactions.map((item) => item.sourceKey));
  const existing = new Set<string>();
  for (const keys of chunks([...sourceKeys], 1_000)) {
    const rows = await sql<{ source_key: string }[]>`select source_key from tools.money_transactions where source_key in ${sql(keys)}`;
    for (const row of rows) existing.add(row.source_key);
  }
  const cash = transactions.filter((item) => item.provider === "revolut" && item.accountRole === "cash"
    && !existing.has(item.sourceKey) && item.sourceKey === revolutCashSourceKey(item));
  if (!cash.length) return existing;

  // Older imports hashed the file's raw cells. Match their parsed values until those rows are removed.
  const dates = cash.map((item) => item.localDate).sort();
  const rows = await sql<{
    external_ref: string; source_type: string; occurred_at: Date; completed_at: Date | null; description: string;
    amount_minor: string; fee_minor: string; currency: string; status: MoneyLedgerTransaction["status"]; balance_after_minor: string | null;
  }[]>`select a.external_ref, t.source_type, t.occurred_at, t.completed_at, t.description,
      t.amount_minor::text, t.fee_minor::text, t.currency, t.status, t.balance_after_minor::text
    from tools.money_transactions t join tools.money_accounts a on a.id = t.account_id
    join tools.money_imports i on i.id = t.import_id
    where a.provider = 'revolut' and a.role = 'cash' and i.format = ${REVOLUT_CASH_FORMAT}
      and t.local_date between ${dates[0]!} and ${dates.at(-1)!}`;
  for (const row of rows) {
    const key = revolutCashSourceKey({ accountExternalRef: row.external_ref, sourceType: row.source_type,
      occurredAt: row.occurred_at.toISOString(), ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
      description: row.description, amountMinor: integer(row.amount_minor), feeMinor: integer(row.fee_minor),
      currency: row.currency, status: row.status,
      ...(row.balance_after_minor === null ? {} : { balanceAfterMinor: integer(row.balance_after_minor) }) });
    if (sourceKeys.has(key)) existing.add(key);
  }
  return existing;
}

function uniqueAccounts(transactions: readonly MoneyLedgerTransaction[]) { return [...new Map(transactions.map((item) => [item.accountExternalRef, { externalRef: item.accountExternalRef, name: item.accountName, currency: item.accountRole === "investment" ? "EUR" : item.currency, provider: item.provider, role: item.accountRole }])).values()]; }
function requiredAccountId(ids: ReadonlyMap<string, string>, ref: string) { const id = ids.get(ref); if (!id) throw new Error("Money import account mapping is incomplete."); return id; }
function integer(value: string) { const parsed = Number(value); if (!Number.isSafeInteger(parsed)) throw new Error("Money amount is outside the supported application range."); return parsed; }
function normalizeDatabaseDecimal(value: string) { return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""); }
function day(value: string) { return Date.parse(`${value}T00:00:00Z`) / 86_400_000; }
function chunks<Value>(values: readonly Value[], size: number): Value[][] { return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size)); }
function emptyRows<Row>(): Promise<Row[]> { return Promise.resolve([]); }

function reviewCountRows(sql: Sql) {
  return sql<ReviewCountRow[]>`select
      count(*) filter (where category = 'uncategorized' and (flow_kind in ('spend', 'refund') or (flow_kind = 'transfer' and transfer_group_id is null and transfer_disposition in ('spend', 'refund'))) and base_currency = 'EUR')::text uncategorized,
      count(*) filter (where (flow_kind in ('spend', 'refund') or (flow_kind = 'transfer' and transfer_group_id is null and transfer_disposition in ('spend', 'refund'))) and base_currency = 'EUR')::text spending_rows,
      count(*) filter (where category = 'other' and category_origin = 'rule' and flow_kind in ('spend', 'refund') and base_currency = 'EUR')::text other_rows,
      count(*) filter (where flow_kind = 'transfer' and transfer_group_id is null and transfer_disposition is null)::text transfers
    from (${effectiveTransactions(sql)}) effective`;
}

function reviewCountsFrom(rows: readonly ReviewCountRow[]): MoneyReviewCounts {
  return { uncategorized: integer(rows[0]?.uncategorized ?? "0"), transfers: integer(rows[0]?.transfers ?? "0"), spendingRows: integer(rows[0]?.spending_rows ?? "0"), otherRows: integer(rows[0]?.other_rows ?? "0") };
}
