import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import type { MoneyTrackerSnapshot } from "./money-tracker.js";
import {
  MONEY_CATEGORIES,
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

export type MoneyActivityItem = Readonly<{
  id: string; occurredAt: string; accountName: string; description: string; amountMinor: number; feeMinor: number;
  taxMinor: number; currency: string; status: MoneyLedgerTransaction["status"]; sourceType: string;
  flowKind: MoneyLedgerTransaction["flowKind"]; category: MoneyCategory; categoryOrigin: "source" | "rule" | "manual";
  transferGroupId?: string;
  transferDisposition?: MoneyTransferDisposition;
  needsTransferReview: boolean;
}>;
export type MoneySpendingAnalytics = Readonly<{
  months: readonly Readonly<{ month: string; spendMinor: number; refundsMinor: number; incomeMinor: number; feesMinor: number; taxesMinor: number; netCashFlowMinor: number }>[];
  categories: readonly Readonly<{ category: MoneyCategory; amountMinor: number; count: number }>[];
  uncategorizedCount: number;
}>;
export type MoneyInvestmentAnalytics = Readonly<{
  positions: readonly Readonly<{ symbol: string; name?: string; assetClass?: string; quantity: string; boughtMinor: number; soldMinor: number; incomeMinor: number; feesMinor: number; taxesMinor: number; currency: string }>[];
  totals: Readonly<{ eventCount: number; boughtMinor: number; soldMinor: number; incomeMinor: number; feesMinor: number; taxesMinor: number }>;
}>;
export type MoneyPlanningAnalytics = Readonly<{
  ready: boolean;
  unresolvedTransferCount: number;
  medianMonthlyNetMinor: number;
  observedMonthCount: number;
  projections: readonly Readonly<{ months: 6 | 12 | 24; changeMinor: number }>[];
}>;
export type MoneyLedgerSnapshot = MoneyTrackerSnapshot & Readonly<{
  imports: readonly MoneyImportSummary[]; activity: readonly MoneyActivityItem[]; transactionCount: number;
  transferReview: Readonly<{ linkedPairs: number; unlinkedCount: number; unresolvedPositiveCount: number; unresolvedNegativeCount: number }>;
  spending: MoneySpendingAnalytics; investments: MoneyInvestmentAnalytics; planning: MoneyPlanningAnalytics;
}>;
export type MoneyActivityPage = Readonly<{ items: readonly MoneyActivityItem[]; total: number; hasMore: boolean }>;

export interface MoneyRepository {
  existingSourceKeys(sourceKeys: readonly string[]): Promise<ReadonlySet<string>>;
  commitImport(input: MoneyImportCommitInput): Promise<MoneyImportReceipt>;
  readLedgerSnapshot(): Promise<MoneyLedgerSnapshot>;
  readActivityPage(input: Readonly<{ query: string; flow?: MoneyLedgerTransaction["flowKind"]; reviewOnly?: boolean; offset: number; limit: number }>): Promise<MoneyActivityPage>;
  setTransactionCategory(input: Readonly<{ transactionId: string; category: MoneyCategory; actor: string; createRule: boolean }>): Promise<Readonly<{ affectedCount: number }>>;
  setTransferDisposition(input: Readonly<{ transactionId: string; disposition: MoneyTransferDisposition }>): Promise<void>;
  addManualBalance(input: Readonly<{ accountName: string; role: "cash" | "investment"; date: string; valueMinor: number; currency: string }>): Promise<void>;
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
        if (existing) return receipt(existing, true);
        const importId = randomUUID();
        const committedAt = new Date();
        const created = await tx<{ id: string }[]>`
          insert into tools.money_imports (id, digest, format, filename, bytes, source_row_count, inserted_row_count, duplicate_row_count, warnings, committed_at, created_by)
          values (${importId}, ${input.digest}, ${input.format}, ${input.filename}, ${input.bytes}, 0, 0, 0, ${tx.json([...input.warnings])}, ${committedAt}, ${input.actor})
          on conflict (digest) do nothing returning id`;
        if (!created[0]) {
          const [raced] = await tx<ImportRow[]>`select id, digest, format, filename, bytes, source_row_count, inserted_row_count, duplicate_row_count, committed_at, created_by from tools.money_imports where digest = ${input.digest}`;
          if (!raced) throw new Error("Money import replay could not be read.");
          return receipt(raced, true);
        }

        const accountIds = new Map<string, string>();
        for (const account of uniqueAccounts(input.transactions)) {
          const [saved] = await tx<{ id: string }[]>`
            insert into tools.money_accounts (id, provider, external_ref, display_name, role, currency, created_at, updated_at)
            values (${randomUUID()}, ${account.provider}, ${account.externalRef}, ${account.name}, ${account.role}, ${account.currency}, ${committedAt}, ${committedAt})
            on conflict (provider, external_ref) do update set display_name = excluded.display_name, role = excluded.role, currency = excluded.currency, updated_at = excluded.updated_at returning id`;
          accountIds.set(account.externalRef, saved!.id);
        }

        const transactionIds = new Map<string, string>();
        let insertedCount = 0;
        for (const batch of chunks(input.transactions, 500)) {
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
        for (const batch of chunks(eventValues, 500)) if (batch.length) await tx`insert into tools.money_investment_events ${tx(batch)} on conflict (transaction_id) do nothing`;

        for (const batch of chunks(input.balanceSnapshots, 500)) {
          const values = batch.map((item) => ({ account_id: requiredAccountId(accountIds, item.accountExternalRef), snapshot_date: item.date,
            observed_at: item.observedAt, value_minor: item.valueMinor, currency: item.currency, origin: "import", import_id: importId }));
          if (values.length) await tx`insert into tools.money_balance_snapshots ${tx(values)} on conflict (account_id, snapshot_date, origin) do update set observed_at = excluded.observed_at, value_minor = excluded.value_minor, currency = excluded.currency, import_id = excluded.import_id where excluded.observed_at >= tools.money_balance_snapshots.observed_at`;
        }
        await applyCategoryRules(tx, [...transactionIds.values()]);
        await linkUnambiguousTransfers(tx);
        const duplicateCount = input.rowCount - insertedCount;
        const [saved] = await tx<ImportRow[]>`
          update tools.money_imports set source_row_count = ${input.rowCount}, inserted_row_count = ${insertedCount}, duplicate_row_count = ${duplicateCount}
          where id = ${importId} returning id, digest, format, filename, bytes, source_row_count, inserted_row_count, duplicate_row_count, committed_at, created_by`;
        return receipt(saved!, false);
      });
    },

    async readLedgerSnapshot() {
      const [imports, activity, count, transfers, monthly, categories, events, snapshotRows] = await Promise.all([
        sql<ImportRow[]>`select id, digest, format, filename, bytes, source_row_count, inserted_row_count, duplicate_row_count, committed_at, created_by from tools.money_imports order by committed_at desc limit 50`,
        sql<ActivityRow[]>`select t.id, t.occurred_at, a.display_name account_name, t.description, t.amount_minor, t.fee_minor, t.tax_minor, t.currency, t.status, t.source_type, t.flow_kind, t.category, t.category_origin, t.transfer_group_id, t.transfer_disposition from tools.money_transactions t join tools.money_accounts a on a.id = t.account_id order by t.occurred_at desc, t.source_row desc limit 500`,
        sql<{ count: string }[]>`select count(*)::text count from tools.money_transactions`,
        sql<TransferReviewRow[]>`select count(distinct transfer_group_id)::text linked_pairs,
          count(*) filter (where transfer_group_id is null)::text unlinked_count,
          count(*) filter (where transfer_group_id is null and transfer_disposition is null and amount_minor > 0)::text unresolved_positive_count,
          count(*) filter (where transfer_group_id is null and transfer_disposition is null and amount_minor < 0)::text unresolved_negative_count
          from tools.money_transactions where status = 'completed' and flow_kind = 'transfer'`,
        sql<MonthlyRow[]>`with recursive bounds as (
          select date_trunc('month', min(local_date))::date first_month, (date_trunc('month', current_date) - interval '1 month')::date last_month
          from tools.money_transactions where status = 'completed' and base_currency = 'EUR'
        ), calendar as (
          select generate_series(first_month, last_month, interval '1 month')::date as month_start from bounds where first_month <= last_month
        ), classified as (
          select local_date, base_amount_minor, base_fee_minor, base_tax_minor, flow_kind,
            case
              when flow_kind = 'transfer' and transfer_group_id is not null then 'internal_transfer'
              when flow_kind = 'transfer' then coalesce(transfer_disposition, 'unreviewed')
              else flow_kind
            end effective_flow
          from tools.money_transactions
          where status = 'completed' and base_currency = 'EUR' and local_date < date_trunc('month', current_date)
        ) select to_char(calendar.month_start, 'YYYY-MM') as month,
          coalesce(sum(case when effective_flow = 'spend' and flow_kind = 'transfer' then -base_amount_minor when effective_flow = 'spend' then abs(base_amount_minor) else 0 end), 0)::text spend_minor,
          coalesce(sum(base_amount_minor) filter (where effective_flow = 'refund'), 0)::text refunds_minor,
          coalesce(sum(base_amount_minor) filter (where effective_flow in ('income', 'investment_income')), 0)::text income_minor,
          coalesce(sum(base_fee_minor), 0)::text fees_minor, coalesce(sum(base_tax_minor), 0)::text taxes_minor
          from calendar left join classified on date_trunc('month', classified.local_date) = calendar.month_start group by calendar.month_start order by calendar.month_start`,
        sql<CategoryRow[]>`with classified as (
          select category, base_amount_minor, flow_kind, case
            when flow_kind = 'transfer' and transfer_group_id is not null then 'internal_transfer'
            when flow_kind = 'transfer' then coalesce(transfer_disposition, 'unreviewed') else flow_kind end effective_flow
          from tools.money_transactions where status = 'completed' and base_currency = 'EUR'
        ) select category, coalesce(sum(case when flow_kind = 'transfer' then -base_amount_minor else abs(base_amount_minor) end), 0)::text amount_minor, count(*)::text count from classified where effective_flow = 'spend' group by category order by sum(case when flow_kind = 'transfer' then -base_amount_minor else abs(base_amount_minor) end) desc`,
        sql<InvestmentRow[]>`select e.symbol, e.name, e.asset_class,
          coalesce(sum(case when e.event_kind in ('buy', 'split') then e.quantity when e.event_kind = 'sell' then -e.quantity else 0 end), 0)::text quantity,
          coalesce(sum(abs(t.base_amount_minor)) filter (where e.event_kind = 'buy'), 0)::text bought_minor,
          coalesce(sum(abs(t.base_amount_minor)) filter (where e.event_kind = 'sell'), 0)::text sold_minor,
          coalesce(sum(t.base_amount_minor) filter (where e.event_kind = 'dividend'), 0)::text income_minor,
          coalesce(sum(t.base_fee_minor), 0)::text fees_minor, coalesce(sum(t.base_tax_minor), 0)::text taxes_minor,
          count(*)::text event_count, t.base_currency currency
          from tools.money_investment_events e join tools.money_transactions t on t.id = e.transaction_id
          where t.status = 'completed' and t.base_currency = 'EUR'
          group by e.symbol, e.name, e.asset_class, t.base_currency order by sum(abs(t.base_amount_minor)) desc nulls last`,
        sql<SnapshotRow[]>`select account_id, snapshot_date, value_minor, currency, display_name, role, provider from (
          select distinct on (s.account_id, s.snapshot_date) s.account_id::text account_id, s.snapshot_date::text snapshot_date, s.value_minor::text value_minor, s.currency, a.display_name, a.role, a.provider
          from tools.money_balance_snapshots s join tools.money_accounts a on a.id = s.account_id
          order by s.account_id, s.snapshot_date, case when s.origin = 'manual' then 0 else 1 end, s.observed_at desc
        ) latest order by snapshot_date, display_name`
      ]);
      const spending = spendingAnalytics(monthly, categories);
      return {
        imports: imports.map(summary), activity: activity.map(activityItem), transactionCount: Number(count[0]?.count ?? 0),
        transferReview: transferReview(transfers[0]),
        spending, investments: investmentAnalytics(events), planning: planningAnalytics(spending.months, transferReview(transfers[0])), ...balanceSnapshot(snapshotRows)
      };
    },

    async readActivityPage(input) {
      const pattern = `%${input.query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const [rows, count] = await Promise.all([
        sql<ActivityRow[]>`select t.id, t.occurred_at, a.display_name account_name, t.description, t.amount_minor, t.fee_minor, t.tax_minor, t.currency, t.status, t.source_type, t.flow_kind, t.category, t.category_origin, t.transfer_group_id, t.transfer_disposition
          from tools.money_transactions t join tools.money_accounts a on a.id = t.account_id
          where (${input.query} = '' or t.description ilike ${pattern} escape '\\' or a.display_name ilike ${pattern} escape '\\' or t.source_type ilike ${pattern} escape '\\')
            and (${input.flow ?? null}::text is null or t.flow_kind = ${input.flow ?? null})
            and (${input.reviewOnly ?? false} = false or (t.status = 'completed' and t.flow_kind = 'transfer' and t.transfer_group_id is null and t.transfer_disposition is null))
          order by t.occurred_at desc, t.source_row desc limit ${input.limit} offset ${input.offset}`,
        sql<{ count: string }[]>`select count(*)::text count from tools.money_transactions t join tools.money_accounts a on a.id = t.account_id
          where (${input.query} = '' or t.description ilike ${pattern} escape '\\' or a.display_name ilike ${pattern} escape '\\' or t.source_type ilike ${pattern} escape '\\')
            and (${input.flow ?? null}::text is null or t.flow_kind = ${input.flow ?? null})
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

    async setTransferDisposition(input) {
      const updated = await sql<{ id: string }[]>`update tools.money_transactions set transfer_disposition = ${input.disposition}
        where id = ${input.transactionId} and status = 'completed' and flow_kind = 'transfer' and transfer_group_id is null returning id`;
      if (!updated[0]) throw new Error("Reviewable money transfer not found.");
    },

    addManualBalance(input) {
      return sql.begin(async (tx) => {
        const ref = `manual:${input.accountName.trim().toLocaleLowerCase("en-GB")}:${input.role}:${input.currency}`;
        const [account] = await tx<{ id: string }[]>`insert into tools.money_accounts (id, provider, external_ref, display_name, role, currency, created_at, updated_at)
          values (${randomUUID()}, 'manual', ${ref}, ${input.accountName.trim()}, ${input.role}, ${input.currency}, now(), now())
          on conflict (provider, external_ref) do update set display_name = excluded.display_name, role = excluded.role, updated_at = now() returning id`;
        await tx`insert into tools.money_balance_snapshots (account_id, snapshot_date, observed_at, value_minor, currency, origin, import_id)
          values (${account!.id}, ${input.date}, ${`${input.date}T12:00:00.000Z`}, ${input.valueMinor}, ${input.currency}, 'manual', null)
          on conflict (account_id, snapshot_date, origin) do update set observed_at = excluded.observed_at, value_minor = excluded.value_minor, currency = excluded.currency`;
      });
    },

    async readiness() { await sql`select 1 from tools.money_imports limit 1`; },
    close: () => sql.end()
  };
}

type ImportRow = { id: string; digest: string; format: MoneyImportFormat; filename: string; bytes: string; source_row_count: number; inserted_row_count: number; duplicate_row_count: number; committed_at: Date; created_by: string };
type ActivityRow = { id: string; occurred_at: Date; account_name: string; description: string; amount_minor: string; fee_minor: string; tax_minor: string; currency: string; status: MoneyLedgerTransaction["status"]; source_type: string; flow_kind: MoneyLedgerTransaction["flowKind"]; category: MoneyCategory; category_origin: "source" | "rule" | "manual"; transfer_group_id: string | null; transfer_disposition: MoneyTransferDisposition | null };
type MonthlyRow = { month: string; spend_minor: string; refunds_minor: string; income_minor: string; fees_minor: string; taxes_minor: string };
type CategoryRow = { category: MoneyCategory; amount_minor: string; count: string };
type InvestmentRow = { symbol: string | null; name: string | null; asset_class: string | null; quantity: string; bought_minor: string; sold_minor: string; income_minor: string; fees_minor: string; taxes_minor: string; event_count: string; currency: string };
type SnapshotRow = { account_id: string; snapshot_date: string; value_minor: string; currency: string; display_name: string; role: "cash" | "investment"; provider: string };
type TransferRow = { id: string; account_id: string; local_date: string; amount_minor: string; currency: string };
type TransferReviewRow = { linked_pairs: string; unlinked_count: string; unresolved_positive_count: string; unresolved_negative_count: string };

function receipt(row: ImportRow, replay: boolean): MoneyImportReceipt { return { id: row.id, digest: row.digest, format: row.format, filename: row.filename, rowCount: row.source_row_count, insertedCount: row.inserted_row_count, duplicateCount: row.duplicate_row_count, committedAt: row.committed_at.toISOString(), replay }; }
function summary(row: ImportRow): MoneyImportSummary { const { replay: _, ...item } = receipt(row, false); return { ...item, bytes: Number(row.bytes), actor: row.created_by }; }
function activityItem(row: ActivityRow): MoneyActivityItem { return { id: row.id, occurredAt: row.occurred_at.toISOString(), accountName: row.account_name, description: row.description, amountMinor: integer(row.amount_minor), feeMinor: integer(row.fee_minor), taxMinor: integer(row.tax_minor), currency: row.currency, status: row.status, sourceType: row.source_type, flowKind: row.flow_kind, category: row.category, categoryOrigin: row.category_origin, needsTransferReview: row.status === "completed" && row.flow_kind === "transfer" && !row.transfer_group_id && !row.transfer_disposition, ...(row.transfer_group_id ? { transferGroupId: row.transfer_group_id } : {}), ...(row.transfer_disposition ? { transferDisposition: row.transfer_disposition } : {}) }; }

function spendingAnalytics(monthly: MonthlyRow[], categories: CategoryRow[]): MoneySpendingAnalytics {
  const months = monthly.map((row) => { const spendMinor = integer(row.spend_minor); const refundsMinor = integer(row.refunds_minor); const incomeMinor = integer(row.income_minor); const feesMinor = integer(row.fees_minor); const taxesMinor = integer(row.taxes_minor); return { month: row.month, spendMinor, refundsMinor, incomeMinor, feesMinor, taxesMinor, netCashFlowMinor: incomeMinor + refundsMinor - spendMinor - feesMinor - taxesMinor }; });
  return { months, categories: categories.map((row) => ({ category: row.category, amountMinor: integer(row.amount_minor), count: integer(row.count) })), uncategorizedCount: categories.find((row) => row.category === "uncategorized") ? integer(categories.find((row) => row.category === "uncategorized")!.count) : 0 };
}

function investmentAnalytics(rows: InvestmentRow[]): MoneyInvestmentAnalytics {
  const items = rows.map((row) => ({ symbol: row.symbol ?? "—", ...(row.name ? { name: row.name } : {}), ...(row.asset_class ? { assetClass: row.asset_class } : {}),
    quantity: normalizeDatabaseDecimal(row.quantity), boughtMinor: integer(row.bought_minor), soldMinor: integer(row.sold_minor),
    incomeMinor: integer(row.income_minor), feesMinor: integer(row.fees_minor), taxesMinor: integer(row.taxes_minor), currency: row.currency }));
  return { positions: items, totals: { eventCount: rows.reduce((sum, row) => sum + integer(row.event_count), 0), boughtMinor: items.reduce((s, x) => s + x.boughtMinor, 0), soldMinor: items.reduce((s, x) => s + x.soldMinor, 0), incomeMinor: items.reduce((s, x) => s + x.incomeMinor, 0), feesMinor: items.reduce((s, x) => s + x.feesMinor, 0), taxesMinor: items.reduce((s, x) => s + x.taxesMinor, 0) } };
}

function planningAnalytics(months: MoneySpendingAnalytics["months"], review: MoneyLedgerSnapshot["transferReview"]): MoneyPlanningAnalytics {
  const recent = months.slice(-12).map((item) => item.netCashFlowMinor).sort((a, b) => a - b);
  const middle = Math.floor(recent.length / 2);
  const median = recent.length ? recent.length % 2 ? recent[middle]! : Math.round((recent[middle - 1]! + recent[middle]!) / 2) : 0;
  const unresolvedTransferCount = review.unresolvedPositiveCount + review.unresolvedNegativeCount;
  const ready = unresolvedTransferCount === 0 && recent.length > 0;
  return { ready, unresolvedTransferCount, medianMonthlyNetMinor: median, observedMonthCount: recent.length,
    projections: ready ? ([6, 12, 24] as const).map((projectionMonths) => ({ months: projectionMonths, changeMinor: median * projectionMonths })) : [] };
}

function balanceSnapshot(rows: SnapshotRow[]): MoneyTrackerSnapshot {
  const byDate = new Map<string, Record<string, number>>(); const labels: Record<string, string> = {}; const roles: Record<string, "cash" | "investment"> = {}; const accounts = new Set<string>();
  const labelsByAccount = new Map(rows.map((row) => [row.account_id, row.display_name]));
  const labelCounts = new Map<string, number>();
  for (const label of labelsByAccount.values()) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  for (const row of rows) {
    if (row.currency !== "EUR") continue;
    const baseName = labelsByAccount.get(row.account_id)!;
    const name = (labelCounts.get(baseName) ?? 0) > 1 ? `${baseName} · ${row.provider} ${row.account_id.slice(0, 6)}` : baseName;
    const month = `${row.snapshot_date.slice(0, 7)}-01`;
    accounts.add(row.account_id); labels[row.account_id] = name; roles[row.account_id] = row.role; const values = byDate.get(month) ?? {}; values[row.account_id] = integer(row.value_minor) / 100; byDate.set(month, values);
  }
  const carried: Record<string, number> = {};
  const months = [...byDate].sort(([left], [right]) => left.localeCompare(right)).map(([date, updates]) => {
    Object.assign(carried, updates);
    const values = { ...carried };
    return { date, values, total: Object.values(values).reduce((sum, value) => sum + value, 0) };
  });
  return { accounts: [...accounts].sort((left, right) => labels[left]!.localeCompare(labels[right]!)), accountLabels: labels, accountRoles: roles, months, latestDate: months.at(-1)?.date };
}

function transferReview(row?: TransferReviewRow): MoneyLedgerSnapshot["transferReview"] {
  return { linkedPairs: Number(row?.linked_pairs ?? 0), unlinkedCount: Number(row?.unlinked_count ?? 0),
    unresolvedPositiveCount: Number(row?.unresolved_positive_count ?? 0), unresolvedNegativeCount: Number(row?.unresolved_negative_count ?? 0) };
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

async function linkUnambiguousTransfers(tx: postgres.TransactionSql) {
  const rows = await tx<TransferRow[]>`select id, account_id, local_date::text, amount_minor::text, currency from tools.money_transactions where status = 'completed' and flow_kind = 'transfer' and amount_minor <> 0 and transfer_group_id is null and (source_type = 'Transfer' or source_type like 'TRANSFER%')`;
  const buckets = new Map<string, TransferRow[]>();
  for (const row of rows) {
    const key = `${row.currency}:${-integer(row.amount_minor)}:${Math.floor(day(row.local_date))}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  const candidates = new Map<string, TransferRow[]>();
  for (const row of rows) {
    const rowDay = Math.floor(day(row.local_date));
    const matches = Array.from({ length: 7 }, (_, index) => buckets.get(`${row.currency}:${integer(row.amount_minor)}:${rowDay + index - 3}`) ?? [])
      .flat().filter((other) => other.account_id !== row.account_id);
    candidates.set(row.id, matches);
  }
  const used = new Set<string>();
  const updates: Array<{ id: string; groupId: string }> = [];
  for (const row of rows) {
    const matches = candidates.get(row.id) ?? [];
    const other = matches[0];
    if (matches.length !== 1 || !other || (candidates.get(other.id)?.length ?? 0) !== 1 || used.has(row.id) || used.has(other.id)) continue;
    const group = randomUUID(); used.add(row.id); used.add(other.id);
    updates.push({ id: row.id, groupId: group }, { id: other.id, groupId: group });
  }
  for (const batch of chunks(updates, 500)) await tx`update tools.money_transactions t set transfer_group_id = linked.group_id, transfer_disposition = 'internal_transfer'
    from unnest(${tx.array(batch.map((item) => item.id))}::uuid[], ${tx.array(batch.map((item) => item.groupId))}::uuid[]) linked(id, group_id)
    where t.id = linked.id`;
}

function uniqueAccounts(transactions: readonly MoneyLedgerTransaction[]) { return [...new Map(transactions.map((item) => [item.accountExternalRef, { externalRef: item.accountExternalRef, name: item.accountName, currency: item.accountRole === "investment" ? "EUR" : item.currency, provider: item.provider, role: item.accountRole }])).values()]; }
function requiredAccountId(ids: ReadonlyMap<string, string>, ref: string) { const id = ids.get(ref); if (!id) throw new Error("Money import account mapping is incomplete."); return id; }
function integer(value: string) { const parsed = Number(value); if (!Number.isSafeInteger(parsed)) throw new Error("Money amount is outside the supported application range."); return parsed; }
function normalizeDatabaseDecimal(value: string) { return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""); }
function day(value: string) { return Date.parse(`${value}T00:00:00Z`) / 86_400_000; }
function chunks<Value>(values: readonly Value[], size: number): Value[][] { return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size)); }
