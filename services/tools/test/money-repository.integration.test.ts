import postgres from "postgres";
import { afterAll, beforeEach, expect, it } from "vitest";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../field-guide/src/postgres-push-guard.js";
import { parseMoneyImport } from "../money/money-import-domain.js";
import { createPostgresMoneyRepository, type MoneyRepository } from "../money/money-repository.js";
import { moneyTrackerTrendStats } from "../money/money-tracker-domain.js";

// Opt in only with a disposable database after applying the guarded tools schema:
// TEST_DATABASE_URL=... MONEY_TEST_DATABASE_CONFIRM=money-repository-test pnpm test:money-postgres
const databaseUrl = process.env.TEST_DATABASE_URL;
const confirmed = process.env.MONEY_TEST_DATABASE_CONFIRM === "money-repository-test";
const repository = databaseUrl && confirmed ? createPostgresMoneyRepository(databaseUrl) : undefined;
const admin = databaseUrl && confirmed ? postgres(databaseUrl, { max: 1 }) : undefined;

beforeEach(async () => {
  if (!admin) return;
  await withVerifiedDisposableDatabase({
    readRelationKind: async () => (await admin<{ kind: string }[]>`
      select c.relkind::text kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${DISPOSABLE_DATABASE_SENTINEL.relation}`)[0]?.kind,
    readValue: async () => (await admin<{ value: string }[]>`
      select sentinel_value value from public.field_guide_review_test_sentinel
      where sentinel_key = ${DISPOSABLE_DATABASE_SENTINEL.key}`)[0]?.value,
  }, async () => {
    await admin`truncate tools.money_balance_snapshots, tools.money_category_rules, tools.money_investment_events, tools.money_transactions, tools.money_imports, tools.money_accounts cascade`;
  });
});

afterAll(async () => {
  await repository?.close();
  await admin?.end();
});

it.skipIf(!repository || !admin)("executes import replay, transfer review, analytics, and stable duplicate-label snapshots", async () => {
  const internal = cash([
    "Transfer\tCurrent\t2026-01-02 12:00:00\t2026-01-02 12:00:00\tOwn transfer\t-10\t0\tEUR\tCOMPLETED\t90",
    "Transfer\tSavings\t2026-01-02 12:00:00\t2026-01-02 12:00:00\tOwn transfer\t10\t0\tEUR\tCOMPLETED\t10"
  ]);
  const parsedInternal = parseMoneyImport(internal);
  const input = { digest: parsedInternal.digest, format: parsedInternal.format, filename: "internal.tsv", bytes: internal.byteLength,
    rowCount: parsedInternal.rowCount, actor: "integration@example.test", transactions: parsedInternal.transactions,
    investmentEvents: parsedInternal.investmentEvents, balanceSnapshots: parsedInternal.balanceSnapshots, warnings: parsedInternal.warnings };
  expect((await repository!.commitImport(input)).insertedCount).toBe(2);
  expect((await repository!.commitImport(input)).replay).toBe(true);

  const external = cash([
    "Transfer\tCurrent\t2026-02-02 12:00:00\t2026-02-02 12:00:00\tExternal funding\t50\t0\tEUR\tCOMPLETED\t140",
    "Transfer\tCurrent\t2026-02-03 12:00:00\t2026-02-03 12:00:00\tExternal payment\t-20\t0\tEUR\tCOMPLETED\t120"
  ]);
  const parsedExternal = parseMoneyImport(external);
  await repository!.commitImport({ ...input, digest: parsedExternal.digest, filename: "external.tsv", bytes: external.byteLength,
    rowCount: parsedExternal.rowCount, transactions: parsedExternal.transactions, balanceSnapshots: parsedExternal.balanceSnapshots });
  const review = await repository!.readActivityPage({ query: "", reviewOnly: true, offset: 0, limit: 10 });
  expect(review.items).toHaveLength(2);
  for (const item of review.items) await repository!.setTransferDisposition({ transactionId: item.id, disposition: item.amountMinor > 0 ? "income" : "spend" });

  const beforeTargetedBalance = await repository!.readLedgerSnapshot();
  const currentAccount = beforeTargetedBalance.accounts.find((id) => beforeTargetedBalance.accountLabels[id]?.startsWith("Current"));
  expect(currentAccount).toBeDefined();
  await repository!.addManualBalance({ accountId: currentAccount!, date: "2026-02-28", valueMinor: 12_345, currency: "EUR" });
  const afterTargetedBalance = await repository!.readLedgerSnapshot();
  expect(afterTargetedBalance.accounts).toHaveLength(beforeTargetedBalance.accounts.length);
  expect(afterTargetedBalance.months.at(-1)?.values[currentAccount!]).toBe(123.45);

  await repository!.addManualBalance({ accountName: "Duplicate", date: "2026-02-28", valueMinor: 1_000, currency: "EUR" });
  const snapshot = await repository!.readLedgerSnapshot();
  expect(snapshot.transferReview.unresolvedPositiveCount + snapshot.transferReview.unresolvedNegativeCount).toBe(0);
  expect(snapshot.planning).toMatchObject({ ready: false, observedMonthCount: 1 });
  expect(snapshot.spending.months.find((month) => month.month === "2026-02")).toMatchObject({ incomeMinor: 5_000, spendMinor: 2_000, netCashFlowMinor: 3_000 });
  expect(snapshot.spending.categoryMonths).toContainEqual(expect.objectContaining({ month: "2026-02", amountMinor: 2_000, count: 1 }));
  expect(snapshot.spending.merchantMonths).toContainEqual(expect.objectContaining({ month: "2026-02", description: "External payment", amountMinor: 2_000, count: 1 }));
  expect(snapshot.spending.categoryActivity).toContainEqual(expect.objectContaining({ description: "External payment", amountMinor: -2_000 }));
  const duplicateAccounts = snapshot.accounts.filter((id) => snapshot.accountLabels[id]?.startsWith("Duplicate"));
  expect(duplicateAccounts).toHaveLength(1);
  expect(duplicateAccounts.map((id) => snapshot.accountRoles[id])).toEqual(["cash"]);
  expect(snapshot.accountLastObserved).toEqual(expect.objectContaining(Object.fromEntries(duplicateAccounts.map((id) => [id, "2026-02-01"]))));
  expect(snapshot.months.at(-1)?.observedAccounts).toEqual(expect.arrayContaining(duplicateAccounts));
});

it.skipIf(!repository || !admin)("lists and removes account-scoped category rules without losing the direct edit", async () => {
  await commitCash(repository!, cash([
    "Card Payment\tCurrent\t2026-04-02 12:00:00\t2026-04-02 12:00:00\tRecurring merchant\t-10\t0\tEUR\tCOMPLETED\t90",
    "Card Payment\tCurrent\t2026-04-03 12:00:00\t2026-04-03 12:00:00\tRecurring merchant\t-15\t0\tEUR\tCOMPLETED\t75"
  ]), "category-rule.tsv");
  const rows = (await repository!.readActivityPage({ query: "Recurring merchant", offset: 0, limit: 10 })).items;
  await repository!.setTransactionCategory({ transactionId: rows[0]!.id, category: "groceries", actor: "integration@example.test", createRule: true });

  const withRule = await repository!.readLedgerSnapshot();
  expect(withRule.categoryRules).toEqual([expect.objectContaining({ description: "Recurring merchant", category: "groceries" })]);
  const deletion = await repository!.deleteCategoryRule(withRule.categoryRules[0]!.id);
  expect(deletion).toEqual({ affectedCount: 1 });

  const withoutRule = await repository!.readLedgerSnapshot();
  expect(withoutRule.categoryRules).toEqual([]);
  const updatedRows = (await repository!.readActivityPage({ query: "Recurring merchant", offset: 0, limit: 10 })).items;
  expect(updatedRows.filter((row) => row.categoryOrigin === "manual")).toHaveLength(1);
  expect(updatedRows.filter((row) => row.categoryOrigin === "source")).toEqual([expect.objectContaining({ category: "uncategorized" })]);
});

it.skipIf(!repository || !admin)("preserves a reviewed transfer when its possible counterpart arrives later", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-03-02 12:00:00\t2026-03-02 12:00:00\tReviewed first\t50\t0\tEUR\tCOMPLETED\t150",
  ]), "reviewed-first.tsv");
  const [reviewed] = (await repository!.readActivityPage({ query: "Reviewed first", reviewOnly: true, offset: 0, limit: 10 })).items;
  expect(reviewed).toBeDefined();
  await repository!.setTransferDisposition({ transactionId: reviewed!.id, disposition: "income" });

  await commitCash(repository!, cash([
    "Transfer\tSavings\t2026-03-03 12:00:00\t2026-03-03 12:00:00\tLate counterpart\t-50\t0\tEUR\tCOMPLETED\t50",
  ]), "late-counterpart.tsv");
  const rows = (await repository!.readActivityPage({ query: "", offset: 0, limit: 10 })).items;
  expect(rows.find((row) => row.description === "Reviewed first")).toMatchObject({ transferDisposition: "income", needsTransferReview: false });
  expect(rows.find((row) => row.description === "Reviewed first")?.transferGroupId).toBeUndefined();
  expect(rows.find((row) => row.description === "Late counterpart")).toMatchObject({ needsTransferReview: true });
});

it.skipIf(!repository || !admin)("refreshes inferred flows and transfer links when an import is replayed", async () => {
  const source = cash([
    "Card Payment\tCurrent\t2026-03-02 12:00:00\t2026-03-02 12:00:00\tHYPE\t-25\t0\tEUR\tCOMPLETED\t75",
    "Transfer\tSavings\t2026-03-02 12:00:00\t2026-03-02 12:00:00\tHYPE recharge\t25\t0\tEUR\tCOMPLETED\t25"
  ]);
  const first = await commitCash(repository!, source, "hype.tsv");
  expect(first.replay).toBe(false);

  await admin!`update tools.money_transactions set transfer_group_id = null, transfer_disposition = null
    where description in ('HYPE', 'HYPE recharge')`;
  await admin!`update tools.money_transactions set flow_kind = 'spend' where description = 'HYPE'`;

  const replay = await commitCash(repository!, source, "hype.tsv");
  expect(replay.replay).toBe(true);
  const rows = (await repository!.readActivityPage({ query: "HYPE", offset: 0, limit: 10 })).items;
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.description === "HYPE")).toMatchObject({ flowKind: "transfer", needsTransferReview: false });
  expect(new Set(rows.map((row) => row.transferGroupId)).size).toBe(1);
});

it.skipIf(!repository || !admin)("deletes an import cascade and repairs a cross-import transfer link", async () => {
  const removed = await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-03-02 12:00:00\t2026-03-02 12:00:00\tMove to savings\t-50\t0\tEUR\tCOMPLETED\t50",
  ]), "outflow.tsv");
  await commitCash(repository!, cash([
    "Transfer\tSavings\t2026-03-03 12:00:00\t2026-03-03 12:00:00\tMove from current\t50\t0\tEUR\tCOMPLETED\t50",
  ]), "inflow.tsv");
  const linked = (await repository!.readActivityPage({ query: "Move", offset: 0, limit: 10 })).items;
  expect(linked).toHaveLength(2);
  expect(new Set(linked.map((row) => row.transferGroupId)).size).toBe(1);

  await expect(repository!.deleteImport(removed.id)).resolves.toEqual({
    transactionCount: 1,
    investmentEventCount: 0,
    balanceSnapshotCount: 1
  });

  const remaining = (await repository!.readActivityPage({ query: "Move", offset: 0, limit: 10 })).items;
  expect(remaining).toEqual([expect.objectContaining({ description: "Move from current", needsTransferReview: true })]);
  expect(remaining[0]?.transferGroupId).toBeUndefined();
  expect(remaining[0]?.transferDisposition).toBeUndefined();
  expect((await repository!.readLedgerSnapshot()).imports.map((item) => item.id)).not.toContain(removed.id);
  await expect(repository!.deleteImport(removed.id)).resolves.toBeUndefined();
});

it.skipIf(!repository || !admin)("deletes investment events while preserving rows owned by another import", async () => {
  const shared = "Card Payment\tCurrent\t2026-04-01 12:00:00\t2026-04-01 12:00:00\tShared row\t-5\t0\tEUR\tCOMPLETED\t95";
  const original = await commitCash(repository!, cash([shared]), "original.tsv");
  const later = await commitCash(repository!, cash([
    shared,
    "Card Payment\tCurrent\t2026-04-02 12:00:00\t2026-04-02 12:00:00\tLater row\t-7\t0\tEUR\tCOMPLETED\t88",
  ]), "later.tsv");
  expect(later).toMatchObject({ insertedCount: 1, duplicateCount: 1 });

  await repository!.deleteImport(later.id);
  const cashRows = (await repository!.readActivityPage({ query: "row", offset: 0, limit: 10 })).items;
  expect(cashRows.map((row) => row.description)).toEqual(["Shared row"]);
  expect((await repository!.readLedgerSnapshot()).imports.map((item) => item.id)).toContain(original.id);

  const trading = Buffer.from([
    "Date\tTicker\tType\tQuantity\tPrice per share\tTotal Amount\tCurrency\tFX Rate",
    "2026-04-03T12:00:00.000Z\tVWCE\tBUY - MARKET\t1\tEUR 100\tEUR -100\tEUR\t1",
  ].join("\r\n"));
  const tradeImport = await commitCash(repository!, trading, "trade.tsv");
  await expect(repository!.deleteImport(tradeImport.id)).resolves.toEqual({
    transactionCount: 1,
    investmentEventCount: 1,
    balanceSnapshotCount: 0
  });
  expect((await repository!.readLedgerSnapshot()).investments.totals.eventCount).toBe(0);
});

it.skipIf(!repository || !admin)("keeps review authoritative when a counterpart import races it", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-04-02 12:00:00\t2026-04-02 12:00:00\tRacing review\t75\t0\tEUR\tCOMPLETED\t175",
  ]), "racing-review.tsv");
  const [reviewed] = (await repository!.readActivityPage({ query: "Racing review", reviewOnly: true, offset: 0, limit: 10 })).items;
  expect(reviewed).toBeDefined();
  await Promise.all([
    repository!.setTransferDisposition({ transactionId: reviewed!.id, disposition: "income" }),
    commitCash(repository!, cash([
      "Transfer\tSavings\t2026-04-03 12:00:00\t2026-04-03 12:00:00\tRacing counterpart\t-75\t0\tEUR\tCOMPLETED\t25",
    ]), "racing-counterpart.tsv"),
  ]);
  const rows = (await repository!.readActivityPage({ query: "Racing", offset: 0, limit: 10 })).items;
  expect(rows.find((row) => row.description === "Racing review")).toMatchObject({ transferDisposition: "income", needsTransferReview: false });
  expect(rows.every((row) => row.transferGroupId === undefined)).toBe(true);
});

it.skipIf(!repository || !admin)("allows a user to correct an automatic transfer match", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-05-02 12:00:00\t2026-05-02 12:00:00\tFalse match inflow\t90\t0\tEUR\tCOMPLETED\t190",
    "Transfer\tSavings\t2026-05-03 12:00:00\t2026-05-03 12:00:00\tFalse match outflow\t-90\t0\tEUR\tCOMPLETED\t10",
  ]), "false-match.tsv");
  const linked = (await repository!.readActivityPage({ query: "False match", offset: 0, limit: 10 })).items;
  expect(new Set(linked.map((row) => row.transferGroupId)).size).toBe(1);
  const inflow = linked.find((row) => row.amountMinor > 0)!;
  await repository!.setTransferDisposition({ transactionId: inflow.id, disposition: "refund" });
  const corrected = (await repository!.readActivityPage({ query: "False match", offset: 0, limit: 10 })).items;
  expect(corrected.find((row) => row.id === inflow.id)).toMatchObject({ transferDisposition: "refund", needsTransferReview: false });
  expect(corrected.every((row) => row.transferGroupId === undefined)).toBe(true);
  expect(corrected.find((row) => row.id !== inflow.id)).toMatchObject({ needsTransferReview: true });
});

it.skipIf(!repository || !admin)("starts planning history only when a classified cash-flow contributor exists", async () => {
  const [period] = await admin!<{ month_key: string; day_1: string; day_2: string; day_3: string; day_4: string }[]>`with period as (
    select (date_trunc('month', current_date) - interval '1 month')::date month_start
  ) select to_char(month_start, 'YYYY-MM') as month_key, month_start::text day_1,
    (month_start + 1)::date::text day_2, (month_start + 2)::date::text day_3,
    (month_start + 3)::date::text day_4 from period`;
  expect(period).toBeDefined();
  await commitCash(repository!, Buffer.from([
    "Date,Account,Value,Role,Currency",
    `${period!.day_1},Cash snapshot,500,cash,EUR`,
  ].join("\r\n")), "balance-only.csv");
  await commitCash(repository!, Buffer.from([
    "Date\tTicker\tType\tQuantity\tPrice per share\tTotal Amount\tCurrency\tFX Rate",
    `${period!.day_2}T12:00:00.000Z\tVWCE\tBUY - MARKET\t1\tEUR 100\tEUR -100\tEUR\t1`,
  ].join("\r\n")), "fee-free-trade.tsv");
  await commitCash(repository!, cash([
    `Transfer\tCurrent\t${period!.day_3} 12:00:00\t${period!.day_3} 12:00:00\tInternal only\t-25\t0\tEUR\tCOMPLETED\t475`,
    `Transfer\tSavings\t${period!.day_3} 12:00:00\t${period!.day_3} 12:00:00\tInternal only\t25\t0\tEUR\tCOMPLETED\t25`,
  ]), "internal-only.tsv");

  const withoutCashFlow = await repository!.readLedgerSnapshot();
  expect(withoutCashFlow.spending.months).toEqual([]);
  expect(withoutCashFlow.planning).toMatchObject({ ready: false, observedMonthCount: 0 });

  await commitCash(repository!, cash([
    `Card Payment\tCurrent\t${period!.day_4} 12:00:00\t${period!.day_4} 12:00:00\tReal spend\t-12.50\t0\tEUR\tCOMPLETED\t462.50`,
  ]), "real-spend.tsv");
  const withCashFlow = await repository!.readLedgerSnapshot();
  expect(withCashFlow.spending.months).toEqual([expect.objectContaining({ month: period!.month_key, spendMinor: 1_250, netCashFlowMinor: -1_250 })]);
  expect(withCashFlow.planning).toMatchObject({ ready: false, observedMonthCount: 1 });
});

it.skipIf(!repository || !admin)("normalizes investment positions while retaining symbol-less costs in totals", async () => {
  const headers = "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code";
  const rows = [
    "2026-06-01T12:00:00.000Z,2026-06-01,DEFAULT,TRADING,BUY,FUND,Old Fund,vwce,1,100,-100,,,EUR,,,,Buy,meta-1,,,,",
    "2026-06-02T12:00:00.000Z,2026-06-02,DEFAULT,TRADING,BUY,ETF,Latest Fund,VWCE,2,100,-200,,,EUR,,,,Buy,meta-2,,,,",
  ];
  await commitCash(repository!, Buffer.from([headers, ...rows].join("\r\n")), "metadata.csv");
  await commitCash(repository!, Buffer.from([
    "Date\tTicker\tType\tQuantity\tPrice per share\tTotal Amount\tCurrency\tFX Rate",
    "2026-06-03T12:00:00.000Z\t\tCUSTODY FEE\t\t\tEUR -3\tEUR\t1",
  ].join("\r\n")), "symbol-less-fee.tsv");
  const { investments } = await repository!.readLedgerSnapshot();
  expect(investments.positions).toEqual([expect.objectContaining({ symbol: "VWCE", name: "Latest Fund", assetClass: "ETF", quantity: "3" })]);
  expect(investments.totals).toMatchObject({ eventCount: 3, boughtMinor: 30_000, feesMinor: 300 });
});

it.skipIf(!repository || !admin)("reports reverted rows beyond the initial activity page", async () => {
  const rows = Array.from({ length: 501 }, (_, index) => {
    const day = String(index % 28 + 1).padStart(2, "0");
    const hour = String(Math.floor(index / 28) % 24).padStart(2, "0");
    return `Card Payment\tCurrent\t2026-06-${day} ${hour}:00:00\t2026-06-${day} ${hour}:00:00\tRow ${index}\t-1\t0\tEUR\t${index === 0 ? "REVERTED" : "COMPLETED"}\t${1000 - index}`;
  });
  await commitCash(repository!, cash(rows), "many-rows.tsv");
  const snapshot = await repository!.readLedgerSnapshot();
  expect(snapshot.activity).toHaveLength(500);
  expect(snapshot.activity.some((row) => row.status === "reverted")).toBe(false);
  expect(snapshot.revertedCount).toBe(1);
});

it.skipIf(!repository || !admin)("materializes carried balance months for monthly trend intervals", async () => {
  await repository!.addManualBalance({ accountName: "Calendar", date: "2026-01-31", valueMinor: 10_000, currency: "EUR" });
  await repository!.addManualBalance({ accountName: "Calendar", date: "2026-03-31", valueMinor: 12_100, currency: "EUR" });
  const snapshot = await repository!.readLedgerSnapshot();
  expect(snapshot.months.map((month) => [month.date, month.total])).toEqual([["2026-01-01", 100], ["2026-02-01", 100], ["2026-03-01", 121]]);
  const points = snapshot.months.map((month) => ({ date: month.date, total: month.total, money: month.total, stocks: 0 }));
  expect(moneyTrackerTrendStats(points).geometricAverageMonthlyPercent).toBeCloseTo(10);
});

it.skipIf(!repository || !admin)("preserves signed transfer corrections in monthly net cash flow", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-06-10 12:00:00\t2026-06-10 12:00:00\tSpend correction\t10\t0\tEUR\tCOMPLETED\t10",
    "Transfer\tCurrent\t2026-06-11 12:00:00\t2026-06-11 12:00:00\tIncome correction\t-5\t0\tEUR\tCOMPLETED\t5",
    "Transfer\tCurrent\t2026-06-12 12:00:00\t2026-06-12 12:00:00\tRefund correction\t-2\t0\tEUR\tCOMPLETED\t3",
  ]), "signed-corrections.tsv");
  const review = await repository!.readActivityPage({ query: "correction", reviewOnly: true, offset: 0, limit: 10 });
  for (const row of review.items) await repository!.setTransferDisposition({ transactionId: row.id, disposition: row.description.startsWith("Spend") ? "spend" : row.description.startsWith("Income") ? "income" : "refund" });
  const month = (await repository!.readLedgerSnapshot()).spending.months.find((item) => item.month === "2026-06");
  expect(month).toMatchObject({ spendMinor: -1_000, incomeMinor: -500, refundsMinor: -200, netCashFlowMinor: 300 });
});

function cash(rows: string[]) {
  return Buffer.from(["Type\tProduct\tStarted Date\tCompleted Date\tDescription\tAmount\tFee\tCurrency\tState\tBalance", ...rows].join("\r\n"));
}

async function commitCash(target: MoneyRepository, source: Buffer, filename: string) {
  const parsed = parseMoneyImport(source);
  return target.commitImport({ digest: parsed.digest, format: parsed.format, filename, bytes: source.byteLength,
    rowCount: parsed.rowCount, actor: "integration@example.test", transactions: parsed.transactions,
    investmentEvents: parsed.investmentEvents, balanceSnapshots: parsed.balanceSnapshots, warnings: parsed.warnings });
}
