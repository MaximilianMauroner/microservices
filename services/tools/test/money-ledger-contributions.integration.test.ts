import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../database/postgres-push-guard.js";
import { parseMoneyImport, type MoneyCategory, type MoneyTransferDisposition } from "../money/money-import-domain.js";
import { createPostgresMoneyRepository } from "../money/money-repository.js";
import { requireLoopbackPostgres } from "./runtime/postgres.ts";

let repository: ReturnType<typeof createPostgresMoneyRepository>;
let admin: ReturnType<typeof postgres>;
const actor = "ledger-contributions@example.test";

beforeAll(() => {
  if (!process.env.TEST_DATABASE_URL || process.env.MONEY_TEST_DATABASE_CONFIRM !== "money-repository-test") {
    throw new Error("Run the required Money PostgreSQL runner with its owned disposable fixture.");
  }
  const databaseUrl = requireLoopbackPostgres(process.env.TEST_DATABASE_URL);
  repository = createPostgresMoneyRepository(databaseUrl);
  admin = postgres(databaseUrl, { max: 1 });
});

beforeEach(async () => {
  await withVerifiedDisposableDatabase({
    readRelationKind: async () => (await admin<{ kind: string }[]>`
      select c.relkind::text kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${DISPOSABLE_DATABASE_SENTINEL.relation}`)[0]?.kind,
    readValue: async () => (await admin<{ value: string }[]>`
      select sentinel_value value from public.tools_runtime_test_sentinel
      where sentinel_key = ${DISPOSABLE_DATABASE_SENTINEL.key}`)[0]?.value,
  }, async () => {
    await admin`truncate tools.money_balance_snapshots, tools.money_category_rules, tools.money_transfer_rules, tools.money_transfer_pair_rules, tools.money_investment_events, tools.money_transactions, tools.money_imports, tools.money_accounts cascade`;
  });
});

afterAll(async () => {
  await repository?.close();
  await admin?.end();
});

it("keeps a completed charge after its released authorization in every spending consumer", async () => {
  await commit(cash([
    "Card Payment\tCurrent\t2025-06-12 12:00:00\t\tLate charge\t-5\t0\tEUR\tREVERTED\t",
    "Card Payment\tCurrent\t2025-06-12 12:00:00\t2025-06-20 12:00:00\tLate charge\t-5\t0\tEUR\tCOMPLETED\t95",
  ]), "late-charge.tsv");

  const activity = await repository.readActivityPage({ query: "Late charge", offset: 0, limit: 10 });
  expect(activity.total).toBe(1);
  expect(activity.items).toEqual([expect.objectContaining({ status: "completed", amountMinor: -500 })]);
  const { spending, revertedCount } = await repository.readLedgerSnapshot("all");
  expect(revertedCount).toBe(1);
  expect(spending.categories).toEqual([{ category: "uncategorized", amountMinor: 500, count: 1 }]);
  expect(spending.categoryMonths).toEqual([{ month: "2025-06", category: "uncategorized", amountMinor: 500, count: 1 }]);
  expect(spending.merchantMonths).toEqual([{ month: "2025-06", category: "uncategorized", description: "Late charge", amountMinor: 500, count: 1 }]);
  expect(await repository.readSpendingSince("2025-05-31")).toEqual([
    { date: "2025-06-20", category: "uncategorized", merchant: "Late charge", amountMinor: 500 },
  ]);
  expect(spending.months).toEqual([expect.objectContaining({ month: "2025-06", spendMinor: 500, refundsMinor: 0, netCashFlowMinor: -500 })]);
});

it("agrees across category, merchant, and check-in spending with signed refunds and reviewed transfers", async () => {
  await commit(cash([
    "Card Payment\tCurrent\t2025-06-01 12:00:00\t2025-06-01 12:00:00\tSpotify\t-100\t1\tEUR\tCOMPLETED\t899",
    "Card Refund\tCurrent\t2025-06-02 12:00:00\t2025-06-02 12:00:00\tSpotify\t30\t0\tEUR\tCOMPLETED\t929",
    "Transfer\tCurrent\t2025-06-03 12:00:00\t2025-06-03 12:00:00\tShared plan\t20\t0\tEUR\tCOMPLETED\t949",
    "Transfer\tCurrent\t2025-06-04 12:00:00\t2025-06-04 12:00:00\tRefund correction\t-5\t0\tEUR\tCOMPLETED\t944",
    "Topup\tCurrent\t2025-06-05 12:00:00\t2025-06-05 12:00:00\tEmployer\t200\t0\tEUR\tCOMPLETED\t1144",
    "Card Refund\tCurrent\t2025-06-06 12:00:00\t2025-06-06 12:00:00\tReturned ticket\t40\t0\tEUR\tCOMPLETED\t1184",
    "Transfer\tCurrent\t2025-06-07 12:00:00\t2025-06-07 12:00:00\tOwn move\t-7\t0\tEUR\tCOMPLETED\t1177",
    "Transfer\tSavings\t2025-06-07 12:00:00\t2025-06-07 12:00:00\tOwn move\t7\t0\tEUR\tCOMPLETED\t7",
    "Transfer\tCurrent\t2025-06-08 12:00:00\t2025-06-08 12:00:00\tSpend correction\t8\t0\tEUR\tCOMPLETED\t1185",
    "Transfer\tCurrent\t2025-06-09 12:00:00\t2025-06-09 12:00:00\tExcluded\t-9\t0.25\tEUR\tCOMPLETED\t1175.75",
    "Transfer\tCurrent\t2025-06-10 12:00:00\t2025-06-10 12:00:00\tUnreviewed\t11\t0\tEUR\tCOMPLETED\t1186.75",
    "Card Refund\tCurrent\t2025-06-11 12:00:00\t\tSpotify\t500\t0\tEUR\tREVERTED\t",
  ]), "refunds.tsv");
  await commit(portfolio([
    ["2025-06-12", "CARD_TRANSACTION", "-12", "-2", "-3", "Grocer", "card-1"],
    ["2025-06-13", "INTEREST_PAYMENT", "10", "-0.50", "-1", "Interest", "interest-1"],
  ]), "costs.csv");

  const dispositions = new Map<string, MoneyTransferDisposition>([
    ["Shared plan", "refund"], ["Refund correction", "refund"], ["Employer", "income"],
    ["Spend correction", "spend"], ["Excluded", "excluded"],
  ]);
  const categories = new Map<string, MoneyCategory>([
    ["Spotify", "subscriptions"], ["Shared plan", "subscriptions"], ["Refund correction", "subscriptions"],
    ["Returned ticket", "travel"], ["Spend correction", "other"], ["Grocer", "groceries"],
  ]);
  const { items } = await repository.readActivityPage({ query: "", offset: 0, limit: 30 });
  for (const item of items) {
    const disposition = dispositions.get(item.description);
    if (disposition) await repository.setTransferDisposition({ transactionId: item.id, disposition });
    const category = categories.get(item.description);
    if (category) await repository.setTransactionCategory({ transactionId: item.id, category, actor, createRule: false });
  }

  const { spending, transferReview } = await repository.readLedgerSnapshot("all");
  expect(transferReview.linkedPairs).toBe(1);
  expect(transferReview.unresolvedPositiveCount).toBe(1);
  expect(spending.categories).toEqual([
    { category: "subscriptions", amountMinor: 5_500, count: 4 },
    { category: "groceries", amountMinor: 1_200, count: 1 },
    { category: "other", amountMinor: -800, count: 1 },
    { category: "travel", amountMinor: -4_000, count: 1 },
  ]);
  expect(spending.merchantMonths).toContainEqual({ month: "2025-06", category: "subscriptions", description: "Spotify", amountMinor: 7_000, count: 2 });
  const since = await repository.readSpendingSince("2025-05-31");
  expect(since).toHaveLength(7);
  for (const category of spending.categories) {
    expect(spending.categoryMonths.find((row) => row.category === category.category)).toEqual({ month: "2025-06", ...category });
    expect(spending.merchantMonths.filter((row) => row.category === category.category).reduce((sum, row) => sum + row.amountMinor, 0)).toBe(category.amountMinor);
    expect(since.filter((row) => row.category === category.category).reduce((sum, row) => sum + row.amountMinor, 0)).toBe(category.amountMinor);
  }
  expect(since.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(1_900);
  expect(spending.months).toEqual([{
    month: "2025-06", observed: true, spendMinor: 1_900, refundsMinor: 8_500,
    incomeMinor: 21_000, feesMinor: 375, taxesMinor: 400, netCashFlowMinor: 18_325,
  }]);
  const cashSince = await repository.readCashSince("2025-05-31");
  expect(cashSince.flows.reduce((sum, row) => sum + row.incomeMinor, 0)).toBe(21_000);
  expect(cashSince.flows.reduce((sum, row) => sum + row.spendingMinor, 0)).toBe(-2_675);
});

it("keeps monthly coverage distinct from all-time and current-month spending", async () => {
  const [period] = await admin<{ day: string }[]>`
    select to_char(current_date, 'YYYY-MM-DD') as day`;
  await commit(cash([
    "Card Payment\tCurrent\t2025-01-02 12:00:00\t2025-01-02 12:00:00\tOld purchase\t-1\t0\tEUR\tCOMPLETED\t99",
    "Transfer\tCurrent\t2025-03-02 12:00:00\t2025-03-02 12:00:00\tFee only\t0\t2\tEUR\tCOMPLETED\t97",
    "Transfer\tCurrent\t2025-05-02 12:00:00\t2025-05-02 12:00:00\tNo coverage\t20\t0\tEUR\tCOMPLETED\t117",
    `Card Payment\tCurrent\t${period!.day} 12:00:00\t${period!.day} 12:00:00\tCurrent purchase\t-3\t0\tEUR\tCOMPLETED\t114`,
  ]), "coverage.tsv");
  const { spending } = await repository.readLedgerSnapshot("all");
  expect(spending.categories).toEqual([{ category: "uncategorized", amountMinor: 400, count: 2 }]);
  expect(spending.categoryMonths).toEqual([{ month: "2025-01", category: "uncategorized", amountMinor: 100, count: 1 }]);
  expect(spending.merchantMonths).toEqual([{ month: "2025-01", category: "uncategorized", description: "Old purchase", amountMinor: 100, count: 1 }]);
  expect(spending.months).toEqual([
    expect.objectContaining({ month: "2025-01", observed: true, spendMinor: 100, feesMinor: 0, netCashFlowMinor: -100 }),
    expect.objectContaining({ month: "2025-02", observed: false, spendMinor: 0, feesMinor: 0, netCashFlowMinor: 0 }),
    expect.objectContaining({ month: "2025-03", observed: true, spendMinor: 0, feesMinor: 200, netCashFlowMinor: -200 }),
  ]);
  expect(await repository.readSpendingSince("2025-01-02")).toEqual([
    { date: period!.day, category: "uncategorized", merchant: "Current purchase", amountMinor: 300 },
  ]);
});

function cash(rows: readonly string[]) {
  return Buffer.from(["Type\tProduct\tStarted Date\tCompleted Date\tDescription\tAmount\tFee\tCurrency\tState\tBalance", ...rows].join("\r\n"));
}

function portfolio(rows: readonly (readonly string[])[]) {
  const header = "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code";
  return Buffer.from([header, ...rows.map(([date, type, amount, fee, tax, description, id]) =>
    [`${date}T12:00:00.000Z`, date, "DEFAULT", "CASH", type, "", "", "", "", "", amount, fee, tax, "EUR", "", "", "", description, id, "", "", "", ""].join(","))].join("\r\n"));
}

async function commit(source: Buffer, filename: string) {
  const parsed = parseMoneyImport(source);
  return repository.commitImport({ digest: parsed.digest, format: parsed.format, filename, bytes: source.byteLength,
    rowCount: parsed.rowCount, actor, transactions: parsed.transactions, investmentEvents: parsed.investmentEvents,
    balanceSnapshots: parsed.balanceSnapshots, warnings: parsed.warnings });
}
