import { randomUUID } from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";
import type { MoneyTrackerSnapshot } from "./money-tracker.js";
import { fifoRealizedGains, type MoneyRealizedGainAnalytics } from "./money-investment-domain.js";
import { moneyDisplayDescription, moneyMerchantName, moneyTransferReviewDescription } from "./money-description.js";
import { moneyMarketInstrumentName } from "./money-market-data-catalog.js";
import {
  MONEY_CATEGORIES,
  SPARKASSE_TRANSFER_TYPES,
  inferMoneyCategory,
  type MoneyBalanceSnapshotInput,
  type MoneyCategory,
  type MoneyImportFormat,
  type MoneyInvestmentEventInput,
  type MoneyLedgerTransaction,
  type MoneyTransferDisposition
} from "./money-import-domain.js";

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
export type MoneyCategoryRule = Readonly<{
  id: string;
  accountName: string;
  description: string;
  category: MoneyCategory;
  updatedAt: string;
}>;
export type MoneySpendingAnalytics = Readonly<{
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
  projections: readonly Readonly<{ months: 6 | 12; changeMinor: number }>[];
}>;
export type MoneyLedgerSnapshot = MoneyTrackerSnapshot & Readonly<{
  imports: readonly MoneyImportSummary[]; activity: readonly MoneyActivityItem[]; transactionCount: number; revertedCount: number;
  transferReview: Readonly<{ linkedPairs: number; unlinkedCount: number; unresolvedPositiveCount: number; unresolvedNegativeCount: number }>;
  transferReviewGroups: readonly MoneyTransferReviewGroup[];
  categoryRules: readonly MoneyCategoryRule[];
  spending: MoneySpendingAnalytics; investments: MoneyInvestmentAnalytics; planning: MoneyPlanningAnalytics;
}>;
export type MoneyActivityPage = Readonly<{ items: readonly MoneyActivityItem[]; total: number; hasMore: boolean }>;
export type MoneyActivitySortKey = "date" | "description" | "account" | "flow" | "category" | "costs" | "amount";
export type MoneyActivitySortDirection = "asc" | "desc";
export type MoneyActivityPageInput = Readonly<{ query: string; flow?: MoneyLedgerTransaction["flowKind"]; accountId?: string; category?: MoneyCategory; reviewOnly?: boolean; sort?: MoneyActivitySortKey; direction?: MoneyActivitySortDirection; offset: number; limit: number }>;

// Keep each multi-row statement comfortably below PostgreSQL's 65,535 parameter limit.
const ACCOUNT_INSERT_CHUNK_SIZE = 1_000;
const TRANSACTION_INSERT_CHUNK_SIZE = 2_000;
const RELATED_INSERT_CHUNK_SIZE = 5_000;

// A reverted source row cancels one matching completed row. Ranking prevents a
// single revert from hiding multiple otherwise-identical legitimate payments.
export function effectiveTransactions(sql: Sql | TransactionSql) {
  return sql`select candidate.* from (
    select ledger.*, row_number() over (
      partition by ledger.account_id, ledger.occurred_at, ledger.source_type,
        ledger.description, ledger.amount_minor, ledger.currency, ledger.status
      order by ledger.source_row, ledger.source_key, ledger.id
    ) undo_rank
    from tools.money_transactions ledger
    where ledger.status in ('completed', 'reverted')
  ) candidate
  where candidate.status = 'completed' and not exists (
    select 1 from (
      select reverted.*, row_number() over (
        partition by reverted.account_id, reverted.occurred_at, reverted.source_type,
          reverted.description, reverted.amount_minor, reverted.currency, reverted.status
        order by reverted.source_row, reverted.source_key, reverted.id
      ) undo_rank
      from tools.money_transactions reverted where reverted.status = 'reverted'
    ) undone
    where undone.account_id = candidate.account_id and undone.occurred_at = candidate.occurred_at
      and undone.source_type = candidate.source_type and undone.description = candidate.description
      and undone.amount_minor = candidate.amount_minor and undone.currency = candidate.currency
      and undone.undo_rank = candidate.undo_rank
  )`;
}

export interface MoneyRepository {
  existingSourceKeys(sourceKeys: readonly string[]): Promise<ReadonlySet<string>>;
  commitImport(input: MoneyImportCommitInput): Promise<MoneyImportReceipt>;
  reimportAll(): Promise<MoneyReimportResult>;
  deleteImport(importId: string): Promise<MoneyImportDeletion | undefined>;
  readLedgerSnapshot(): Promise<MoneyLedgerSnapshot>;
  readActivityPage(input: MoneyActivityPageInput): Promise<MoneyActivityPage>;
  setTransactionCategory(input: Readonly<{ transactionId: string; category: MoneyCategory; actor: string; createRule: boolean }>): Promise<Readonly<{ affectedCount: number }>>;
  deleteCategoryRule(ruleId: string): Promise<Readonly<{ affectedCount: number }> | undefined>;
  setTransferDisposition(input: Readonly<{ transactionId: string; disposition: MoneyTransferDisposition }>): Promise<void>;
  setTransferDispositions(input: Readonly<{ transactionIds: readonly string[]; disposition: MoneyTransferDisposition }>): Promise<Readonly<{ affectedCount: number }>>;
  addManualBalance(input: Readonly<({ accountId: string } | { accountName: string }) & { date: string; valueMinor: number; currency: string }>): Promise<void>;
  readiness(): Promise<void>;
  close(): Promise<void>;
}

export function createPostgresMoneyRepository(databaseUrl: string, options: { readOnly?: boolean } = {}): MoneyRepository {
  return postgresMoneyRepository(postgres(databaseUrl, { max: 4, connection: options.readOnly ? { default_transaction_read_only: true } : undefined }));
}

export function postgresMoneyRepository(sql: Sql): MoneyRepository {
  return {
    async existingSourceKeys(sourceKeys) {
      const existing = new Set<string>();
      for (const keys of chunks(sourceKeys, 1_000)) {
        if (!keys.length) continue;
        const rows = await sql<{ source_key: string }[]>`select source_key from tools.money_transactions where source_key in ${sql(keys)}`;
        for (const row of rows) existing.add(row.source_key);
      }
      return existing;
    },

    commitImport(input) {
      return sql.begin(async (tx) => {
        const [existing] = await tx<ImportRow[]>`select id, digest, format, filename, bytes, source_row_count, inserted_row_count, duplicate_row_count, committed_at, created_by from tools.money_imports where digest = ${input.digest}`;
        if (existing) {
          await refreshInferredTransactions(tx, input.transactions);
          await linkUnambiguousTransfers(tx);
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

        const transactionIds = new Map<string, string>();
        let insertedCount = 0;
        for (const batch of chunks(input.transactions, TRANSACTION_INSERT_CHUNK_SIZE)) {
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
          if (values.length) await tx`insert into tools.money_balance_snapshots ${tx(values)} on conflict (account_id, snapshot_date, origin) do update set observed_at = excluded.observed_at, value_minor = excluded.value_minor, currency = excluded.currency, import_id = excluded.import_id where excluded.observed_at >= tools.money_balance_snapshots.observed_at`;
        }
        await refreshInferredTransactions(tx, input.transactions.filter((transaction) => !transactionIds.has(transaction.sourceKey)));
        await applyCategoryRules(tx, [...transactionIds.values()]);
        await linkUnambiguousTransfers(tx);
        const duplicateCount = input.rowCount - insertedCount;
        const [saved] = await tx<ImportRow[]>`
          update tools.money_imports set source_row_count = ${input.rowCount}, inserted_row_count = ${insertedCount}, duplicate_row_count = ${duplicateCount}
          where id = ${importId} returning id, digest, format, filename, bytes, source_row_count, inserted_row_count, duplicate_row_count, committed_at, created_by`;
        return receipt(saved!, false);
      });
    },

    reimportAll() {
      return sql.begin(async (tx) => {
        const [count] = await tx<{ import_count: string }[]>`select count(*)::text import_count from tools.money_imports`;
        const rows = await tx<ReimportRow[]>`select id, source_key, flow_kind, source_type, description, mcc
          from tools.money_transactions where import_id is not null order by id for update`;
        await tx`update tools.money_accounts set display_name = case role
            when 'investment' then 'Trade Republic Investments'
            else 'Trade Republic Cash'
          end, updated_at = now()
          where provider = 'portfolio_export'`;
        const linkedGroups = await tx<{ transfer_group_id: string }[]>`select distinct transfer_group_id
          from tools.money_transactions where import_id is not null and transfer_group_id is not null`;
        const groupIds = linkedGroups.map((row) => row.transfer_group_id);
        if (groupIds.length) await tx`update tools.money_transactions set transfer_group_id = null, transfer_disposition = null
          where transfer_group_id in ${tx(groupIds)}`;
        await tx`update tools.money_transactions set transfer_disposition = null where import_id is not null and transfer_disposition is not null`;
        for (const category of MONEY_CATEGORIES) {
          const ids = rows.filter((row) => inferMoneyCategory(row.flow_kind, row.source_type, row.description, row.mcc ?? undefined) === category).map((row) => row.id);
          for (const batch of chunks(ids, 1_000)) if (batch.length) await tx`update tools.money_transactions
            set category = ${category}, category_origin = 'source' where id in ${tx(batch)}`;
        }
        for (const batch of chunks(rows.map((row) => row.id), 1_000)) await applyCategoryRules(tx, batch);
        await linkUnambiguousTransfers(tx);
        const [linked] = await tx<{ linked_pair_count: string }[]>`select count(distinct transfer_group_id)::text linked_pair_count
          from tools.money_transactions where transfer_group_id is not null`;
        return { importCount: integer(count?.import_count ?? "0"), transactionCount: rows.length, linkedPairCount: integer(linked?.linked_pair_count ?? "0") };
      });
    },

    deleteImport(importId) {
      return sql.begin(async (tx) => {
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

        return {
          transactionCount: deletedTransactions.length,
          investmentEventCount: deletedEvents.length,
          balanceSnapshotCount: deletedSnapshots.length
        };
      });
    },

    async readLedgerSnapshot() {
      const [imports, categoryRules, activity, count, transfers, transferReviewItems, monthly, categories, categoryMonths, merchantMonths, categoryActivity, events, investmentTotals, tradeMarkers, realizedEvents, snapshotRows] = await Promise.all([
        sql<ImportRow[]>`select id, digest, format, filename, bytes, source_row_count, inserted_row_count, duplicate_row_count, committed_at, created_by from tools.money_imports order by committed_at desc limit 50`,
        sql<CategoryRuleRow[]>`select r.id, a.display_name account_name,
          coalesce((select t.description from tools.money_transactions t
            where t.account_id = r.account_id and lower(t.description) = r.match_value
            order by t.occurred_at desc, t.source_row desc limit 1), r.match_value) match_value,
          r.category, r.updated_at
          from tools.money_category_rules r join tools.money_accounts a on a.id = r.account_id
          where r.active and r.match_field = 'description' order by r.updated_at desc, r.id`,
        sql<ActivityRow[]>`select t.id, t.occurred_at, t.account_id::text account_id, a.display_name account_name, t.description, t.amount_minor, t.fee_minor, t.tax_minor, t.currency, t.status, t.source_type, t.flow_kind, t.category, t.category_origin, t.transfer_group_id, t.transfer_disposition
          from (${effectiveTransactions(sql)}) t join tools.money_accounts a on a.id = t.account_id
          order by t.occurred_at desc, t.source_row desc limit 50`,
        sql<{ count: string; reverted_count: string }[]>`select count(*)::text count, count(*) filter (where status = 'reverted')::text reverted_count from tools.money_transactions`,
        sql<TransferReviewRow[]>`select count(distinct transfer_group_id)::text linked_pairs,
          count(*) filter (where transfer_group_id is null)::text unlinked_count,
          count(*) filter (where transfer_group_id is null and transfer_disposition is null and amount_minor > 0)::text unresolved_positive_count,
          count(*) filter (where transfer_group_id is null and transfer_disposition is null and amount_minor < 0)::text unresolved_negative_count
          from (${effectiveTransactions(sql)}) effective where flow_kind = 'transfer'`,
        sql<ActivityRow[]>`select t.id, t.occurred_at, t.account_id::text account_id, a.display_name account_name,
          t.description, t.amount_minor, t.fee_minor, t.tax_minor, t.currency, t.status, t.source_type,
          t.flow_kind, t.category, t.category_origin, t.transfer_group_id, t.transfer_disposition
          from (${effectiveTransactions(sql)}) t join tools.money_accounts a on a.id = t.account_id
          where t.flow_kind = 'transfer'
            and t.transfer_group_id is null and t.transfer_disposition is null
          order by a.display_name, t.occurred_at desc, t.source_row desc, t.id desc`,
        sql<MonthlyRow[]>`with classified as (
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
          from calendar left join monthly_contributors using (month_start) left join coverage using (month_start) order by calendar.month_start`,
        sql<CategoryRow[]>`with classified as (
          select category, base_amount_minor, flow_kind, case
            when flow_kind = 'transfer' and transfer_group_id is not null then 'internal_transfer'
            when flow_kind = 'transfer' then coalesce(transfer_disposition, 'unreviewed') else flow_kind end effective_flow
          from (${effectiveTransactions(sql)}) effective where base_currency = 'EUR'
        ) select category, coalesce(sum(case when flow_kind = 'transfer' then -base_amount_minor else abs(base_amount_minor) end), 0)::text amount_minor, count(*)::text count from classified where effective_flow = 'spend' group by category order by sum(case when flow_kind = 'transfer' then -base_amount_minor else abs(base_amount_minor) end) desc`,
        sql<CategoryMonthRow[]>`with classified as (
          select local_date, category, base_amount_minor, flow_kind, case
            when flow_kind = 'transfer' and transfer_group_id is not null then 'internal_transfer'
            when flow_kind = 'transfer' then coalesce(transfer_disposition, 'unreviewed') else flow_kind end effective_flow
          from (${effectiveTransactions(sql)}) effective
          where base_currency = 'EUR' and local_date < date_trunc('month', current_date)
        ) select to_char(date_trunc('month', local_date), 'YYYY-MM') as month, category,
          sum(case when flow_kind = 'transfer' then -base_amount_minor else abs(base_amount_minor) end)::text amount_minor,
          count(*)::text count from classified where effective_flow = 'spend'
          group by date_trunc('month', local_date), category order by date_trunc('month', local_date), category`,
        sql<MerchantMonthRow[]>`with classified as (
          select local_date, category, description, source_type, base_amount_minor, flow_kind, case
            when flow_kind = 'transfer' and transfer_group_id is not null then 'internal_transfer'
            when flow_kind = 'transfer' then coalesce(transfer_disposition, 'unreviewed') else flow_kind end effective_flow
          from (${effectiveTransactions(sql)}) effective
          where base_currency = 'EUR' and local_date < date_trunc('month', current_date)
        ) select to_char(date_trunc('month', local_date), 'YYYY-MM') as month, category, source_type,
          coalesce(nullif(trim(description), ''), 'Unknown merchant') description,
          sum(case when flow_kind = 'transfer' then -base_amount_minor else abs(base_amount_minor) end)::text amount_minor,
          count(*)::text count from classified where effective_flow = 'spend'
          group by date_trunc('month', local_date), category, source_type, coalesce(nullif(trim(description), ''), 'Unknown merchant')
          order by date_trunc('month', local_date), category, sum(case when flow_kind = 'transfer' then -base_amount_minor else abs(base_amount_minor) end) desc`,
        sql<ActivityRow[]>`select id, occurred_at, account_name, description, amount_minor, fee_minor, tax_minor, currency, status, source_type, flow_kind, category, category_origin, transfer_group_id, transfer_disposition from (
          select t.id, t.occurred_at, a.display_name account_name, t.description, t.amount_minor, t.fee_minor, t.tax_minor, t.currency, t.status, t.source_type, t.flow_kind, t.category, t.category_origin, t.transfer_group_id, t.transfer_disposition,
            row_number() over (partition by t.category order by t.occurred_at desc, t.source_row desc) category_rank
          from (${effectiveTransactions(sql)}) t join tools.money_accounts a on a.id = t.account_id
          where t.base_currency = 'EUR'
            and t.local_date < date_trunc('month', current_date) and (
            t.flow_kind = 'spend' or (t.flow_kind = 'transfer' and t.transfer_group_id is null and t.transfer_disposition = 'spend')
          )
        ) ranked where category_rank <= 12 order by occurred_at desc`,
        sql<InvestmentRow[]>`select upper(trim(e.symbol)) symbol,
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
          group by upper(trim(e.symbol)), t.base_currency order by sum(abs(t.base_amount_minor)) desc nulls last`,
        sql<InvestmentTotalsRow[]>`select count(*)::text event_count,
          coalesce(sum(abs(t.base_amount_minor)) filter (where e.event_kind = 'buy'), 0)::text bought_minor,
          coalesce(sum(abs(t.base_amount_minor)) filter (where e.event_kind = 'sell'), 0)::text sold_minor,
          coalesce(sum(t.base_amount_minor) filter (where e.event_kind = 'dividend'), 0)::text income_minor,
          coalesce(sum(t.base_fee_minor), 0)::text fees_minor, coalesce(sum(t.base_tax_minor), 0)::text taxes_minor
          from tools.money_investment_events e join (${effectiveTransactions(sql)}) t on t.id = e.transaction_id
          where t.base_currency = 'EUR'`,
        sql<TradeMarkerRow[]>`select t.local_date::text local_date, e.event_kind, upper(trim(e.symbol)) symbol,
          e.name, e.quantity::text quantity, t.base_amount_minor::text base_amount_minor,
          t.base_fee_minor::text base_fee_minor, t.base_currency currency
          from tools.money_investment_events e join (${effectiveTransactions(sql)}) t on t.id = e.transaction_id
          where t.base_currency = 'EUR' and e.event_kind in ('buy', 'sell')
            and e.symbol is not null and trim(e.symbol) <> '' and e.quantity is not null
          order by t.local_date, t.occurred_at, t.source_row, t.source_key`,
        sql<RealizedEventRow[]>`select t.account_id::text account_id, t.occurred_at, t.source_row, t.source_key, e.event_kind, e.symbol, e.quantity::text quantity,
          t.base_amount_minor::text base_amount_minor, t.base_fee_minor::text base_fee_minor
          from tools.money_investment_events e join (${effectiveTransactions(sql)}) t on t.id = e.transaction_id
          where t.base_currency = 'EUR'
          order by t.occurred_at, t.source_row, t.source_key`,
        sql<SnapshotRow[]>`select account_id, snapshot_date, value_minor, currency, display_name, role, provider from (
          select distinct on (s.account_id, s.snapshot_date) s.account_id::text account_id, s.snapshot_date::text snapshot_date, s.value_minor::text value_minor, s.currency, a.display_name, a.role, a.provider
          from tools.money_balance_snapshots s join tools.money_accounts a on a.id = s.account_id
          order by s.account_id, s.snapshot_date, case when s.origin = 'manual' then 0 else 1 end, s.observed_at desc
        ) latest
        union all
        select a.id::text, null, null, a.currency, a.display_name, a.role, a.provider
        from tools.money_accounts a
        where a.currency = 'EUR'
          and not exists (select 1 from tools.money_balance_snapshots s where s.account_id = a.id)
          and exists (select 1 from tools.money_transactions t where t.account_id = a.id and t.status = 'completed')
        order by snapshot_date nulls last, display_name`
      ]);
      const spending = spendingAnalytics(monthly, categories, categoryMonths, merchantMonths, categoryActivity);
      return {
        imports: imports.map(summary), categoryRules: categoryRules.map(categoryRule), activity: activity.map(activityItem), transactionCount: Number(count[0]?.count ?? 0), revertedCount: Number(count[0]?.reverted_count ?? 0),
        transferReview: transferReview(transfers[0]), transferReviewGroups: transferReviewGroups(transferReviewItems),
        spending, investments: investmentAnalytics(events, investmentTotals[0], tradeMarkers, realizedEvents), planning: planningAnalytics(spending.months, transferReview(transfers[0])), ...balanceSnapshot(snapshotRows)
      };
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
      const [rows, count] = await Promise.all([
        sql<ActivityRow[]>`select t.id, t.occurred_at, t.account_id::text account_id, ${accountName} account_name, t.description, t.amount_minor, t.fee_minor, t.tax_minor, t.currency, t.status, t.source_type, t.flow_kind, t.category, t.category_origin, t.transfer_group_id, t.transfer_disposition
          from (${effectiveTransactions(sql)}) t join tools.money_accounts a on a.id = t.account_id
          where (${input.query} = '' or t.description ilike ${pattern} escape '\\' or ${accountName} ilike ${pattern} escape '\\' or t.source_type ilike ${pattern} escape '\\')
            and (${input.flow ?? null}::text is null or t.flow_kind = ${input.flow ?? null})
            and (${input.accountId ?? null}::uuid is null or t.account_id = ${input.accountId ?? null}::uuid)
            and (${input.category ?? null}::text is null or t.category = ${input.category ?? null})
            and (${input.reviewOnly ?? false} = false or (t.status = 'completed' and t.flow_kind = 'transfer' and t.transfer_group_id is null and t.transfer_disposition is null))
          order by ${order} ${direction}, t.occurred_at desc, t.source_row desc, t.id desc limit ${input.limit} offset ${input.offset}`,
        sql<{ count: string }[]>`select count(*)::text count from (${effectiveTransactions(sql)}) t join tools.money_accounts a on a.id = t.account_id
          where (${input.query} = '' or t.description ilike ${pattern} escape '\\' or ${accountName} ilike ${pattern} escape '\\' or t.source_type ilike ${pattern} escape '\\')
            and (${input.flow ?? null}::text is null or t.flow_kind = ${input.flow ?? null})
            and (${input.accountId ?? null}::uuid is null or t.account_id = ${input.accountId ?? null}::uuid)
            and (${input.category ?? null}::text is null or t.category = ${input.category ?? null})
            and (${input.reviewOnly ?? false} = false or (t.status = 'completed' and t.flow_kind = 'transfer' and t.transfer_group_id is null and t.transfer_disposition is null))`
      ]);
      const total = Number(count[0]?.count ?? 0);
      return { items: rows.map(activityItem), total, hasMore: input.offset + rows.length < total };
    },

    setTransactionCategory(input) {
      if (!MONEY_CATEGORIES.includes(input.category)) throw new Error("Unsupported money category.");
      return sql.begin(async (tx) => {
        const [row] = await tx<{ description: string; account_id: string }[]>`update tools.money_transactions set category = ${input.category}, category_origin = 'manual' where id = ${input.transactionId} returning description, account_id`;
        if (!row) throw new Error("Money transaction not found.");
        if (!input.createRule || !row.description) return { affectedCount: 1 };
        const value = row.description.toLocaleLowerCase("en-GB");
        await tx`insert into tools.money_category_rules (id, account_id, priority, match_field, match_value, category, active, created_at, updated_at, created_by)
          values (${randomUUID()}, ${row.account_id}, 100, 'description', ${value}, ${input.category}, true, now(), now(), ${input.actor})
          on conflict (account_id, match_field, match_value) do update set category = excluded.category, active = true, updated_at = now(), created_by = excluded.created_by`;
        const updated = await tx<{ id: string }[]>`update tools.money_transactions set category = ${input.category}, category_origin = 'rule'
          where account_id = ${row.account_id} and lower(description) = ${value} and category_origin <> 'manual' returning id`;
        return { affectedCount: updated.length + 1 };
      });
    },

    deleteCategoryRule(ruleId) {
      return sql.begin(async (tx) => {
        const [rule] = await tx<{ account_id: string; match_field: string; match_value: string }[]>`delete from tools.money_category_rules
          where id = ${ruleId} returning account_id::text account_id, match_field, match_value`;
        if (!rule) return undefined;
        const reset = await tx<{ id: string }[]>`update tools.money_transactions set category = 'uncategorized', category_origin = 'source'
          where account_id = ${rule.account_id} and category_origin = 'rule' and (
            (${rule.match_field} = 'description' and lower(description) = ${rule.match_value}) or
            (${rule.match_field} = 'mcc' and mcc = ${rule.match_value}) or
            (${rule.match_field} = 'source_type' and lower(source_type) = ${rule.match_value})
          ) returning id`;
        await applyCategoryRules(tx, reset.map((row) => row.id));
        return { affectedCount: reset.length };
      });
    },

    async setTransferDisposition(input) {
      await sql.begin(async (tx) => {
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
      });
    },

    async setTransferDispositions(input) {
      const updated = await sql<{ id: string }[]>`update tools.money_transactions set transfer_disposition = ${input.disposition}
        where id in ${sql(input.transactionIds)} and status = 'completed' and flow_kind = 'transfer'
          and transfer_group_id is null and transfer_disposition is null returning id`;
      return { affectedCount: updated.length };
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
type CategoryRuleRow = { id: string; account_name: string; match_value: string; category: MoneyCategory; updated_at: Date };
type RealizedEventRow = { account_id: string; occurred_at: Date; source_row: number; source_key: string; event_kind: MoneyInvestmentEventInput["eventKind"]; symbol: string | null; quantity: string | null; base_amount_minor: string; base_fee_minor: string };
type TradeMarkerRow = { local_date: string; event_kind: "buy" | "sell"; symbol: string; name: string | null; quantity: string; base_amount_minor: string; base_fee_minor: string; currency: string };
type SnapshotRow = { account_id: string; snapshot_date: string | null; value_minor: string | null; currency: string; display_name: string; role: "cash" | "investment"; provider: string };
type TransferRow = { id: string; account_id: string; occurred_at: Date; local_date: string; description: string; amount_minor: string; currency: string };
type TransferReviewRow = { linked_pairs: string; unlinked_count: string; unresolved_positive_count: string; unresolved_negative_count: string };
type ReimportRow = { id: string; source_key: string; flow_kind: MoneyLedgerTransaction["flowKind"]; source_type: string; description: string; mcc: string | null };

function receipt(row: ImportRow, replay: boolean): MoneyImportReceipt { return { id: row.id, digest: row.digest, format: row.format, filename: row.filename, rowCount: row.source_row_count, insertedCount: row.inserted_row_count, duplicateCount: row.duplicate_row_count, committedAt: row.committed_at.toISOString(), replay }; }
function summary(row: ImportRow): MoneyImportSummary { const { replay: _, ...item } = receipt(row, false); return { ...item, bytes: Number(row.bytes), actor: row.created_by }; }
function categoryRule(row: CategoryRuleRow): MoneyCategoryRule { return { id: row.id, accountName: row.account_name, description: moneyDisplayDescription(row.match_value), category: row.category, updatedAt: row.updated_at.toISOString() }; }
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

function spendingAnalytics(monthly: MonthlyRow[], categories: CategoryRow[], categoryMonths: CategoryMonthRow[], merchantMonths: MerchantMonthRow[], categoryActivity: ActivityRow[]): MoneySpendingAnalytics {
  const months = monthly.map((row) => { const spendMinor = integer(row.spend_minor); const refundsMinor = integer(row.refunds_minor); const incomeMinor = integer(row.income_minor); const feesMinor = integer(row.fees_minor); const taxesMinor = integer(row.taxes_minor); return { month: row.month, observed: row.observed, spendMinor, refundsMinor, incomeMinor, feesMinor, taxesMinor, netCashFlowMinor: incomeMinor + refundsMinor - spendMinor - feesMinor - taxesMinor }; });
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
  const ready = unresolvedTransferCount === 0 && recent.length >= 6;
  return { ready, unresolvedTransferCount, medianMonthlyNetMinor: median, observedMonthCount: recent.length,
    projections: ready ? ([6, 12] as const).map((projectionMonths) => ({ months: projectionMonths, changeMinor: median * projectionMonths })) : [] };
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

async function applyCategoryRules(tx: postgres.TransactionSql, transactionIds: string[]) {
  if (!transactionIds.length) return;
  await tx`with matches as (
    select t.id, r.category, row_number() over (partition by t.id order by r.priority desc, r.id) rank
    from tools.money_transactions t join tools.money_category_rules r on r.active and r.account_id = t.account_id and (
      (r.match_field = 'description' and r.match_value = lower(t.description)) or
      (r.match_field = 'mcc' and r.match_value = t.mcc) or
      (r.match_field = 'source_type' and r.match_value = lower(t.source_type)))
    where t.id in ${tx(transactionIds)} and t.category_origin <> 'manual'
  ) update tools.money_transactions t set category = matches.category, category_origin = 'rule'
    from matches where matches.id = t.id and matches.rank = 1`;
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
  const rows = await tx<TransferRow[]>`select t.id, t.account_id, t.occurred_at, t.local_date::text, lower(trim(t.description)) description, t.amount_minor::text, t.currency
    from (${effectiveTransactions(tx)}) t join tools.money_accounts a on a.id = t.account_id
    where t.flow_kind = 'transfer' and t.amount_minor <> 0
      and t.transfer_group_id is null and t.transfer_disposition is null and (
        t.source_type in ('Transfer', 'Topup', 'CASH TOP-UP', 'CASH WITHDRAWAL', 'CUSTOMER_INBOUND', 'CUSTOMER_INPAYMENT')
        or t.source_type like 'TRANSFER%'
        or (a.provider = 'sparkasse' and (
          t.source_type in ${tx([...SPARKASSE_TRANSFER_TYPES])}
          or (t.source_type = 'BEZAHLUNG EU LAENDER' and lower(t.description) ~ '\\m(revolut|trade republic)\\M')
        ))
        or (a.provider = 'revolut' and t.source_type = 'Card Payment' and lower(trim(t.description)) = 'hype')
      )`;
  const used = new Set<string>();
  const pairs: Array<readonly [string, string]> = [];
  collectExactTransferPairs(rows, used, pairs);
  collectDateTransferPairs(rows, used, pairs);
  if (!pairs.length) return;
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

function uniqueAccounts(transactions: readonly MoneyLedgerTransaction[]) { return [...new Map(transactions.map((item) => [item.accountExternalRef, { externalRef: item.accountExternalRef, name: item.accountName, currency: item.accountRole === "investment" ? "EUR" : item.currency, provider: item.provider, role: item.accountRole }])).values()]; }
function requiredAccountId(ids: ReadonlyMap<string, string>, ref: string) { const id = ids.get(ref); if (!id) throw new Error("Money import account mapping is incomplete."); return id; }
function integer(value: string) { const parsed = Number(value); if (!Number.isSafeInteger(parsed)) throw new Error("Money amount is outside the supported application range."); return parsed; }
function normalizeDatabaseDecimal(value: string) { return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""); }
function day(value: string) { return Date.parse(`${value}T00:00:00Z`) / 86_400_000; }
function chunks<Value>(values: readonly Value[], size: number): Value[][] { return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size)); }
