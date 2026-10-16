import postgres from "postgres";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../database/postgres-push-guard.js";
import { parseMoneyImport, REVOLUT_CASH_FORMAT } from "../money/money-import-domain.js";
import { cashMovesSince } from "../money/money-checkin-domain.js";
import { createPostgresMoneyRepository, type MoneyRepository } from "../money/money-repository.js";
import { moneyTrackerTrendStats } from "../money/money-tracker-domain.js";
import { MoneyImportService } from "../money/money-import-service.js";
import { requireLoopbackPostgres } from "./runtime/postgres.js";
import { moneyWorkbookFixture } from "./money-workbook-fixture.js";

let repository: MoneyRepository | undefined;
let admin: ReturnType<typeof postgres> | undefined;

beforeAll(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || process.env.MONEY_TEST_DATABASE_CONFIRM !== "money-repository-test") {
    throw new Error("BLOCKED money-postgres. An owned disposable fixture is required. Run pnpm run verify from the repository root.");
  }
  requireLoopbackPostgres(url);
  repository = createPostgresMoneyRepository(url);
  admin = postgres(url, { max: 1 });
});

beforeEach(async () => {
  const database = admin;
  if (!database) throw new Error("Money PostgreSQL fixture was not initialized.");
  await withVerifiedDisposableDatabase({
    readRelationKind: async () => (await database<{ kind: string }[]>`
      select c.relkind::text kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${DISPOSABLE_DATABASE_SENTINEL.relation}`)[0]?.kind,
    readValue: async () => (await database<{ value: string }[]>`
      select sentinel_value value from public.tools_runtime_test_sentinel
      where sentinel_key = ${DISPOSABLE_DATABASE_SENTINEL.key}`)[0]?.value,
  }, async () => {
    await database`truncate tools.money_balance_snapshots, tools.money_category_rules, tools.money_transfer_rules, tools.money_transfer_pair_rules, tools.money_investment_events, tools.money_transactions, tools.money_imports, tools.money_accounts cascade`;
    // Transfer rules are data. These fixtures stand in for the owner's stored rules.
    const rule = (priority: number, disposition: string, sourceType: string | null, match = "any", value: string | null = null, sign = "any") =>
      database`insert into tools.money_transfer_rules (id, priority, provider, source_type, description_match, match_value, amount_sign, disposition, created_at, updated_at, created_by)
        values (gen_random_uuid(), ${priority}, ${sourceType === "Exchange" ? null : "revolut"}, ${sourceType}, ${match}, ${value}, ${sign}, ${disposition}, now(), now(), 'fixture')`;
    await rule(900, "excluded", "Exchange");
    await rule(800, "internal_transfer", "Card Payment", "equals", "hype");
    await rule(600, "income", "Topup", "contains", "provincia autonoma bolzano");
    await rule(100, "refund", "Topup", "any", null, "positive");
    await rule(100, "spend", "Topup", "any", null, "negative");
    await rule(100, "refund", "Transfer", "any", null, "positive");
    await rule(100, "spend", "Transfer", "any", null, "negative");
  });
});

afterAll(async () => {
  await repository?.close();
  await admin?.end();
});

it("commits savings CSV and Excel into one account without duplicate transactions", async () => {
  const headers = ["Date", "Description", "Gross Interest Rate Earned", "Money in", "Money out", "Balance"];
  const rows = [
    ["8 Aug 2026", "Deposit to 'Instant Access Savings'", "", "€10.00", "", "€10.00"],
    ["9 Aug 2026", "Net Interest Paid to 'Instant Access Savings' for 9 Aug 2026", "2.00%", "€0.01", "", "€10.01"]
  ];
  const csv = Buffer.from([headers, ...rows].map((row) => row.join(",")).join("\r\n"));
  const excel = moneyWorkbookFixture([headers,
    [{ date: 46242 }, rows[0]![1]!, "", "â_x0082_¬10.00", "", "â_x0082_¬10.00"],
    [{ date: 46243 }, rows[1]![1]!, 0.02, "â_x0082_¬0.01", "", "â_x0082_¬10.01"]
  ], { sharedStrings: true });
  const service = new MoneyImportService(repository!);
  const preview = await service.preview("savings.csv", csv);
  expect((await service.commit({ filename: "savings.csv", bytes: csv, expectedDigest: preview.digest, actor: "integration@example.test" })).insertedCount).toBe(2);
  const excelPreview = await service.preview("savings.xlsx", excel);
  expect(excelPreview.duplicateCount).toBe(2);
  expect(await service.commit({ filename: "savings.xlsx", bytes: excel, expectedDigest: excelPreview.digest, actor: "integration@example.test" })).toMatchObject({ insertedCount: 0, duplicateCount: 2 });
  const snapshot = await repository!.readLedgerSnapshot("all");
  expect(snapshot.transactionCount).toBe(2);
  expect(snapshot.accounts).toHaveLength(1);
  expect(snapshot.activity.find(({ sourceType }) => sourceType === "Interest")).toMatchObject({ amountMinor: 1, category: "income", flowKind: "investment_income" });
  expect((await repository!.readCashSince("2026-08-08")).snapshots.at(-1)?.valueMinor).toBe(1001);
});

it("recognizes raw-cell keys from older cash imports in previews and commits", async () => {
  const headers = ["Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State", "Balance"];
  const row = ["Interest", "Deposit", "2026-08-09 5:08:51", "2026-08-09 5:08:51", "Interest paid", "0.010", "0.00", "EUR", "COMPLETED", "10.01"];
  const csv = Buffer.from([headers, row].map((cells) => cells.join(",")).join("\r\n"));
  const date = { date: 46243 + (5 * 3600 + 8 * 60 + 51) / 86400 };
  const excel = moneyWorkbookFixture([headers, ["Interest", "Deposit", date, date, "Interest paid", 0.01, 0, "EUR", "COMPLETED", 10.01]]);
  const service = new MoneyImportService(repository!);
  const preview = await service.preview("old.csv", csv);
  await service.commit({ filename: "old.csv", bytes: csv, expectedDigest: preview.digest, actor: "integration@example.test" });
  const oldKey = createHash("sha256").update(JSON.stringify([REVOLUT_CASH_FORMAT, ...row])).digest("hex");
  await admin!`update tools.money_transactions set source_key = ${oldKey}`;
  const excelPreview = await service.preview("new.xlsx", excel);
  expect(excelPreview.duplicateCount).toBe(1);
  const duplicate = await service.commit({ filename: "new.xlsx", bytes: excel, expectedDigest: excelPreview.digest, actor: "integration@example.test" });
  expect(duplicate).toMatchObject({ insertedCount: 0, duplicateCount: 1 });
  expect((await repository!.readLedgerSnapshot("all")).transactionCount).toBe(1);
  await service.deleteImport(duplicate.id);
  expect((await repository!.readLedgerSnapshot("all")).months.at(-1)?.total).toBe(10.01);
});

it.each([false, true])("counts overlapping cash and savings once in either import order (cash first: %s)", async (cashFirst) => {
  const savings = Buffer.from([
    "Date,Description,Gross Interest Rate Earned,Money in,Money out,Balance",
    "8 Aug 2026,Deposit to 'Instant Access Savings',,€10.00,,€10.00",
    "9 Aug 2026,Net Interest Paid to 'Instant Access Savings' for 9 Aug 2026,2.00%,€0.01,,€10.01",
    "9 Aug 2026,Deposit to 'Instant Access Savings',,€5.00,,€15.01"
  ].join("\r\n"));
  const cashBytes = cash([
    "Transfer\tDeposit\t2026-08-08 12:00:00\t2026-08-08 12:00:00\tDeposit to Instant Access Savings\t10\t0\tEUR\tCOMPLETED\t10",
    "Interest\tDeposit\t2026-08-09 5:08:51\t2026-08-09 5:08:51\tInterest paid\t0.02\t0.01\tEUR\tCOMPLETED\t10.01"
  ]);
  const service = new MoneyImportService(repository!);
  let cashImportId = "";
  for (const bytes of cashFirst ? [cashBytes, savings] : [savings, cashBytes]) {
    const preview = await service.preview("statement.csv", bytes);
    const receipt = await service.commit({ filename: "statement.csv", bytes, expectedDigest: preview.digest, actor: "integration@example.test" });
    if (bytes === cashBytes) cashImportId = receipt.id;
  }
  const snapshot = await repository!.readLedgerSnapshot("all");
  expect(snapshot.accounts).toHaveLength(1);
  expect(snapshot.transactionCount).toBe(3);
  expect(snapshot.months.at(-1)?.total).toBe(15.01);
  expect(snapshot.activity.find(({ sourceType }) => sourceType === "Interest")).toMatchObject({ amountMinor: 2, feeMinor: 1 });
  await service.deleteImport(cashImportId);
  const afterDeletion = await repository!.readLedgerSnapshot("all");
  expect(afterDeletion.transactionCount).toBe(3);
  expect(afterDeletion.activity.find(({ sourceType }) => sourceType === "Interest")).toMatchObject({ amountMinor: 1, feeMinor: 0 });
});

it("executes import replay, transfer review, analytics, and stable duplicate-label snapshots", async () => {
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
    "Topup\tCurrent\t2026-02-02 12:00:00\t2026-02-02 12:00:00\tPayment from PROVINCIA AUTONOMA BOLZANO ALT\t50\t0\tEUR\tCOMPLETED\t140",
    "Transfer\tCurrent\t2026-02-03 12:00:00\t2026-02-03 12:00:00\tExternal payment\t-20\t0\tEUR\tCOMPLETED\t120"
  ]);
  const parsedExternal = parseMoneyImport(external);
  await repository!.commitImport({ ...input, digest: parsedExternal.digest, filename: "external.tsv", bytes: external.byteLength,
    rowCount: parsedExternal.rowCount, transactions: parsedExternal.transactions, balanceSnapshots: parsedExternal.balanceSnapshots });
  const review = await repository!.readActivityPage({ query: "", reviewOnly: true, offset: 0, limit: 10 });
  // The transfer reviewed as spending waits for a category like other spending.
  expect(review.items.map((item) => [item.description, item.category])).toEqual([["External payment", "uncategorized"]]);

  const beforeTargetedBalance = await repository!.readLedgerSnapshot("all");
  const currentAccount = beforeTargetedBalance.accounts.find((id) => beforeTargetedBalance.accountLabels[id]?.startsWith("Revolut Current"));
  expect(currentAccount).toBeDefined();
  await repository!.addManualBalance({ accountId: currentAccount!, date: "2026-02-28", valueMinor: 12_345, currency: "EUR" });
  const afterTargetedBalance = await repository!.readLedgerSnapshot("all");
  expect(afterTargetedBalance.accounts).toHaveLength(beforeTargetedBalance.accounts.length);
  expect(afterTargetedBalance.months.at(-1)?.values[currentAccount!]).toBe(123.45);

  await repository!.addManualBalance({ accountName: "Duplicate", date: "2026-02-28", valueMinor: 1_000, currency: "EUR" });
  const snapshot = await repository!.readLedgerSnapshot("all");
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

it("reads check-in days and explains cash changes since a check-in", async () => {
  await commitCash(repository!, cash([
    "Card Payment\tCurrent\t2026-08-10 12:00:00\t2026-08-10 12:00:00\tBakery\t-10\t0\tEUR\tCOMPLETED\t90",
    "Topup\tCurrent\t2026-08-20 12:00:00\t2026-08-20 12:00:00\tPayment from Employer\t100\t0\tEUR\tCOMPLETED\t190",
    "Card Payment\tCurrent\t2026-09-05 12:00:00\t2026-09-05 12:00:00\tGrocer\t-30\t0\tEUR\tCOMPLETED\t160",
    "Transfer\tCurrent\t2026-09-10 12:00:00\t2026-09-10 12:00:00\tExternal payment\t-20\t0\tEUR\tCOMPLETED\t140"
  ]), "check-in.tsv");
  const [employer] = (await repository!.readActivityPage({ query: "Payment from Employer", offset: 0, limit: 10 })).items;
  await repository!.setTransferDisposition({ transactionId: employer!.id, disposition: "income" });

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  expect(await repository!.readCheckInDays()).toEqual([today]);
  const result = cashMovesSince({ baseline: "2026-08-24", ...await repository!.readCashSince("2026-08-24") });
  expect(result).toEqual({
    moves: [expect.objectContaining({ baselineMinor: 19_000, currentMinor: 14_000, changeMinor: -5_000, incomeMinor: 0, spendingMinor: -5_000, transfersMinor: 0, tradesMinor: 0, otherMinor: 0, driver: { label: "Grocer", amountMinor: -3_000 } })],
    baselineTotalMinor: 19_000,
    currentTotalMinor: 14_000
  });

  const spending = await repository!.readSpendingSince("2026-08-01");
  expect(spending.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(6_000);
  expect(spending.filter((row) => row.date > "2026-08-24").reduce((sum, row) => sum + row.amountMinor, 0)).toBe(5_000);
  expect(spending).toContainEqual(expect.objectContaining({ date: "2026-09-05", merchant: "Grocer", amountMinor: 3_000 }));
});

it("nets card refunds and shared repayments into category spending without changing cash flow", async () => {
  await commitCash(repository!, cash([
    "Card Payment\tCurrent\t2026-06-01 12:00:00\t2026-06-01 12:00:00\tSpotify\t-100\t1\tEUR\tCOMPLETED\t899",
    "Card Refund\tCurrent\t2026-06-02 12:00:00\t2026-06-02 12:00:00\tSpotify\t30\t0\tEUR\tCOMPLETED\t929",
    "Transfer\tCurrent\t2026-06-03 12:00:00\t2026-06-03 12:00:00\tShared plan\t20\t0\tEUR\tCOMPLETED\t949",
    "Transfer\tCurrent\t2026-06-04 12:00:00\t2026-06-04 12:00:00\tRefund correction\t-5\t0\tEUR\tCOMPLETED\t944",
    "Topup\tCurrent\t2026-06-05 12:00:00\t2026-06-05 12:00:00\tEmployer\t200\t0\tEUR\tCOMPLETED\t1144",
    "Card Refund\tCurrent\t2026-06-06 12:00:00\t2026-06-06 12:00:00\tReturned ticket\t40\t0\tEUR\tCOMPLETED\t1184",
    "Transfer\tCurrent\t2026-06-07 12:00:00\t2026-06-07 12:00:00\tOwn move\t-7\t0\tEUR\tCOMPLETED\t1177",
    "Transfer\tSavings\t2026-06-07 12:00:00\t2026-06-07 12:00:00\tOwn move\t7\t0\tEUR\tCOMPLETED\t7",
    "Card Refund\tCurrent\t2026-06-08 12:00:00\t\tSpotify\t500\t0\tEUR\tREVERTED\t",
  ]), "net-refunds.tsv");
  const { items } = await repository!.readActivityPage({ query: "", offset: 0, limit: 20 });
  for (const item of items) {
    if (item.description === "Employer" || item.description === "Refund correction") {
      await repository!.setTransferDisposition({ transactionId: item.id, disposition: item.description === "Employer" ? "income" : "refund" });
    }
    if (["Spotify", "Shared plan", "Refund correction", "Returned ticket"].includes(item.description)) {
      await repository!.setTransactionCategory({ transactionId: item.id, category: item.description === "Returned ticket" ? "travel" : "subscriptions", actor: "integration@example.test", createRule: false });
    }
  }

  const { spending, transferReview } = await repository!.readLedgerSnapshot("all");
  expect(transferReview.linkedPairs).toBe(1);
  expect(spending.months).toEqual([expect.objectContaining({ month: "2026-06", spendMinor: 1_500, refundsMinor: 8_500, incomeMinor: 20_000, feesMinor: 100, netCashFlowMinor: 18_400 })]);
  expect(spending.categories).toEqual([
    { category: "subscriptions", amountMinor: 5_500, count: 4 },
    { category: "travel", amountMinor: -4_000, count: 1 },
  ]);
  expect(spending.categoryMonths).toEqual(spending.categories.map((row) => ({ month: "2026-06", ...row })));
  expect(spending.merchantMonths).toContainEqual({ month: "2026-06", category: "subscriptions", description: "Spotify", amountMinor: 7_000, count: 2 });
  expect(spending.merchantMonths.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(1_500);
  expect(spending.categoryActivity).toHaveLength(5);
  expect(spending.categoryActivity).toContainEqual(expect.objectContaining({ description: "Shared plan", transferDisposition: "refund", amountMinor: 2_000 }));

  const since = await repository!.readSpendingSince("2026-05-31");
  expect(since.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(1_500);
  expect(since).toContainEqual({ date: "2026-06-06", category: "travel", merchant: "Returned ticket", amountMinor: -4_000 });
  const cashSince = await repository!.readCashSince("2026-05-31");
  expect(cashSince.flows.reduce((sum, row) => sum + row.incomeMinor, 0)).toBe(20_000);
  expect(cashSince.flows.reduce((sum, row) => sum + row.spendingMinor, 0)).toBe(-1_600);
  expect(cashSince.items).toContainEqual(expect.objectContaining({ label: "Returned ticket", kind: "spending", amountMinor: 4_000 }));
});

it("classifies transfers with stored rules that change without a deploy", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-05-02 12:00:00\t2026-05-02 12:00:00\tTo My Savings\t-50\t0\tEUR\tCOMPLETED\t50"
  ]), "stored-rule.tsv");
  const disposition = async () => (await repository!.readActivityPage({ query: "To My Savings", offset: 0, limit: 10 })).items[0]?.transferDisposition;
  expect(await disposition()).toBe("spend");

  await admin!`insert into tools.money_transfer_rules (id, priority, provider, source_type, description_match, match_value, amount_sign, disposition, note, created_at, updated_at, created_by)
    values (gen_random_uuid(), 700, 'revolut', 'Transfer', 'equals', 'to my savings', 'any', 'internal_transfer', 'Own savings account', now(), now(), 'fixture')`;
  await repository!.reimportAll();
  expect(await disposition()).toBe("internal_transfer");
  expect((await repository!.readLedgerSnapshot("review")).transferRules).toContainEqual(expect.objectContaining({ matchValue: "to my savings", note: "Own savings account" }));
});

it("creates a transfer rule that classifies only unresolved rows and keeps them after removal", async () => {
  await admin!`delete from tools.money_transfer_rules where source_type = 'Transfer'`;
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-05-04 12:00:00\t2026-05-04 12:00:00\tTo Broker Deposit\t-30\t0\tEUR\tCOMPLETED\t70",
    "Transfer\tCurrent\t2026-05-05 12:00:00\t2026-05-05 12:00:00\tFrom Friend\t40\t0\tEUR\tCOMPLETED\t110"
  ]), "rule-builder.tsv");
  const [reviewed] = (await repository!.readActivityPage({ query: "From Friend", offset: 0, limit: 10 })).items;
  await repository!.setTransferDisposition({ transactionId: reviewed!.id, disposition: "income" });
  const rule = { provider: "revolut", sourceType: "Transfer", descriptionMatch: "any", amountSign: "any", disposition: "excluded", note: "Broker deposits" } as const;

  expect(await repository!.previewTransferRule(rule)).toEqual({ matchCount: 1, examples: [expect.objectContaining({ description: "To Broker Deposit", amountMinor: -3_000 })] });
  await expect(repository!.createTransferRule({ ...rule, actor: "integration@example.test", expectedMatchCount: 0 })).rejects.toThrow("Preview the rule again");
  expect(await repository!.createTransferRule({ ...rule, actor: "integration@example.test", expectedMatchCount: 1 })).toEqual({ affectedCount: 1 });

  const disposition = async (query: string) => (await repository!.readActivityPage({ query, offset: 0, limit: 10 })).items[0]?.transferDisposition;
  expect(await disposition("To Broker Deposit")).toBe("excluded");
  expect(await disposition("From Friend")).toBe("income");
  const snapshot = await repository!.readLedgerSnapshot("review");
  expect(snapshot.transferRules[0]).toMatchObject({ priority: 910, note: "Broker deposits", disposition: "excluded" });
  expect(snapshot.transferRuleOptions).toContainEqual({ provider: "revolut", sourceType: "Transfer", count: 2, unresolvedCount: 0 });

  expect(await repository!.deleteTransferRule(snapshot.transferRules[0]!.id)).toBe(true);
  expect(await repository!.deleteTransferRule(snapshot.transferRules[0]!.id)).toBe(false);
  expect(await disposition("To Broker Deposit")).toBe("excluded");
});

it("lists and removes account-scoped category rules without losing the direct edit", async () => {
  await commitCash(repository!, cash([
    "Card Payment\tCurrent\t2026-04-02 12:00:00\t2026-04-02 12:00:00\tRecurring merchant\t-10\t0\tEUR\tCOMPLETED\t90",
    "Card Payment\tCurrent\t2026-04-03 12:00:00\t2026-04-03 12:00:00\tRecurring merchant\t-15\t0\tEUR\tCOMPLETED\t75"
  ]), "category-rule.tsv");
  const rows = (await repository!.readActivityPage({ query: "Recurring merchant", offset: 0, limit: 10 })).items;
  await repository!.setTransactionCategory({ transactionId: rows[0]!.id, category: "groceries", actor: "integration@example.test", createRule: true });

  const withRule = await repository!.readLedgerSnapshot("all");
  expect(withRule.categoryRules).toEqual([expect.objectContaining({ accountName: expect.stringMatching(/^Revolut Current/), matchField: "description", matchOperator: "equals", matchValue: "recurring merchant", category: "groceries", rowCount: 1 })]);
  await repository!.reimportAll();
  const afterReimport = (await repository!.readActivityPage({ query: "Recurring merchant", offset: 0, limit: 10 })).items;
  expect(afterReimport.filter((row) => row.categoryOrigin === "manual")).toHaveLength(1);
  expect(afterReimport.filter((row) => row.categoryOrigin === "rule")).toHaveLength(1);
  const deletion = await repository!.deleteCategoryRule(withRule.categoryRules[0]!.id);
  expect(deletion).toEqual({ affectedCount: 1 });

  const withoutRule = await repository!.readLedgerSnapshot("all");
  expect(withoutRule.categoryRules).toEqual([]);
  const updatedRows = (await repository!.readActivityPage({ query: "Recurring merchant", offset: 0, limit: 10 })).items;
  expect(updatedRows.filter((row) => row.categoryOrigin === "manual")).toHaveLength(1);
  expect(updatedRows.filter((row) => row.categoryOrigin === "source")).toEqual([expect.objectContaining({ category: "uncategorized" })]);
});

it("applies ordered category rules to every account and to later imports", async () => {
  await commitCash(repository!, cash([
    "Card Payment\tCurrent\t2026-04-02 12:00:00\t2026-04-02 12:00:00\tCorner Market 12\t-10\t0\tEUR\tCOMPLETED\t90",
    "Card Payment\tCurrent\t2026-04-03 12:00:00\t2026-04-03 12:00:00\tMarket Pay 4\t-5\t0\tEUR\tCOMPLETED\t85",
    "Card Payment\tCurrent\t2026-04-04 12:00:00\t2026-04-04 12:00:00\tSupermarket Hall\t-3\t0\tEUR\tCOMPLETED\t82",
    "Card Payment\tCurrent\t2026-04-05 12:00:00\t2026-04-05 12:00:00\tCorner Market 13\t-7\t0\tEUR\tCOMPLETED\t75"
  ]), "rules.tsv");
  const row = async (description: string) => (await repository!.readActivityPage({ query: description, offset: 0, limit: 10 })).items.find((item) => item.description === description)!;
  await repository!.setTransactionCategory({ transactionId: (await row("Corner Market 13")).id, category: "gifts", actor: "integration@example.test", createRule: false });

  const market = { matchField: "description", matchOperator: "word", matchValue: "market", category: "shopping" } as const;
  const preview = await repository!.previewCategoryRule(market);
  expect(preview).toMatchObject({ matchCount: 3, changeCount: 2, manualCount: 1 });
  expect(preview.examples.map((example) => [example.description, example.nextCategory])).toEqual([["Market Pay 4", "shopping"], ["Corner Market 12", "shopping"], ["Corner Market 13", "gifts"]]);
  await expect(repository!.saveCategoryRule({ ...market, actor: "integration@example.test", expectedMatchCount: 2 })).rejects.toThrow("Preview the rule again");
  expect(await repository!.saveCategoryRule({ ...market, actor: "integration@example.test", expectedMatchCount: 3 })).toMatchObject({ affectedCount: 2 });

  // A later rule goes first. "Uncategorized" keeps its rows in review and stops the rules below it.
  const pay = { matchField: "description", matchOperator: "contains", matchValue: "market pay", category: "uncategorized" } as const;
  expect(await repository!.previewCategoryRule(pay)).toMatchObject({ matchCount: 1, changeCount: 1 });
  await repository!.saveCategoryRule({ ...pay, actor: "integration@example.test", expectedMatchCount: 1 });
  expect(await row("Market Pay 4")).toMatchObject({ category: "uncategorized", categoryOrigin: "rule" });
  expect(await row("Supermarket Hall")).toMatchObject({ category: "uncategorized", categoryOrigin: "source" });
  expect(await row("Corner Market 13")).toMatchObject({ category: "gifts", categoryOrigin: "manual" });

  let { categoryRules } = await repository!.readLedgerSnapshot("review");
  expect(categoryRules.map((rule) => [rule.matchValue, rule.category, rule.rowCount])).toEqual([["market pay", "uncategorized", 1], ["market", "shopping", 1]]);

  await commitCash(repository!, cash(["Card Payment\tCurrent\t2026-04-06 12:00:00\t2026-04-06 12:00:00\tCORNER MARKET 14\t-4\t0\tEUR\tCOMPLETED\t71"]), "later.tsv");
  expect(await row("CORNER MARKET 14")).toMatchObject({ category: "shopping", categoryOrigin: "rule" });

  // Editing a rule moves it to the top; rows it no longer matches fall back to the next rule or to review.
  const edited = { ruleId: categoryRules[1]!.id, matchField: "description", matchOperator: "starts_with", matchValue: "corner market 12", category: "groceries" } as const;
  const editPreview = await repository!.previewCategoryRule(edited);
  expect(editPreview).toMatchObject({ matchCount: 1, changeCount: 2 });
  expect(editPreview.examples.find((example) => !example.matches)).toMatchObject({ description: "CORNER MARKET 14", nextCategory: "uncategorized" });
  expect(await repository!.saveCategoryRule({ ...edited, actor: "integration@example.test", expectedMatchCount: 1 })).toEqual({ ruleId: edited.ruleId, affectedCount: 2 });
  ({ categoryRules } = await repository!.readLedgerSnapshot("review"));
  expect(categoryRules.map((rule) => rule.matchValue)).toEqual(["corner market 12", "market pay"]);

  expect(await repository!.deleteCategoryRule(edited.ruleId)).toEqual({ affectedCount: 1 });
  expect(await row("Corner Market 12")).toMatchObject({ category: "uncategorized", categoryOrigin: "source" });
  await repository!.reimportAll();
  expect(await row("Market Pay 4")).toMatchObject({ category: "uncategorized", categoryOrigin: "rule" });
  expect(await row("Corner Market 13")).toMatchObject({ category: "gifts", categoryOrigin: "manual" });
});

it("preserves a reviewed transfer when its possible counterpart arrives later", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-03-02 12:00:00\t2026-03-02 12:00:00\tReviewed first\t50\t0\tEUR\tCOMPLETED\t150",
  ]), "reviewed-first.tsv");
  const [reviewed] = (await repository!.readActivityPage({ query: "Reviewed first", offset: 0, limit: 10 })).items;
  expect(reviewed).toBeDefined();
  await repository!.setTransferDisposition({ transactionId: reviewed!.id, disposition: "income" });
  await repository!.reimportAll();
  expect((await repository!.readActivityPage({ query: "Reviewed first", offset: 0, limit: 10 })).items[0]).toMatchObject({ transferDisposition: "income" });

  await commitCash(repository!, cash([
    "Transfer\tSavings\t2026-03-03 12:00:00\t2026-03-03 12:00:00\tLate counterpart\t-50\t0\tEUR\tCOMPLETED\t50",
  ]), "late-counterpart.tsv");
  const rows = (await repository!.readActivityPage({ query: "", offset: 0, limit: 10 })).items;
  expect(rows.find((row) => row.description === "Reviewed first")).toMatchObject({ transferDisposition: "income", needsTransferReview: false });
  expect(rows.find((row) => row.description === "Reviewed first")?.transferGroupId).toBeUndefined();
  expect(rows.find((row) => row.description === "Late counterpart")).toMatchObject({ transferDisposition: "spend", needsTransferReview: false });
});

it("refreshes inferred flows and transfer links when an import is replayed", async () => {
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

it("prefers exact transfer identity when repeated amounts make the date window ambiguous", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-03-04 12:00:00\t2026-03-04 12:00:00\tPocket A\t-10\t0\tEUR\tCOMPLETED\t90",
    "Transfer\tSavings\t2026-03-04 12:00:00\t2026-03-04 12:00:00\tPocket A\t10\t0\tEUR\tCOMPLETED\t10",
    "Transfer\tCurrent\t2026-03-04 13:00:00\t2026-03-04 13:00:00\tPocket B\t-10\t0\tEUR\tCOMPLETED\t80",
    "Transfer\tSavings\t2026-03-04 13:00:00\t2026-03-04 13:00:00\tPocket B\t10\t0\tEUR\tCOMPLETED\t20"
  ]), "repeated-pocket-amounts.tsv");
  await admin!`update tools.money_transactions set category = 'subscriptions', category_origin = 'source' where description in ('Pocket A', 'Pocket B')`;
  const rows = (await repository!.readActivityPage({ query: "Pocket", offset: 0, limit: 10 })).items;
  expect(rows).toHaveLength(4);
  expect(rows.every((row) => row.category === "transfer" && row.transferDisposition === "internal_transfer")).toBe(true);
  expect(new Set(rows.map((row) => row.transferGroupId)).size).toBe(2);
});

it("re-imports all normalized documents and rebuilds derived review state", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-03-05 12:00:00\t2026-03-05 12:00:00\tPocket rebuild\t-10\t0\tEUR\tCOMPLETED\t90",
    "Transfer\tSavings\t2026-03-05 12:00:00\t2026-03-05 12:00:00\tPocket rebuild\t10\t0\tEUR\tCOMPLETED\t10",
    "Transfer\tCurrent\t2026-03-20 12:00:00\t2026-03-20 12:00:00\tKept review\t25\t0\tEUR\tCOMPLETED\t115"
  ]), "rebuild.tsv");
  await admin!`update tools.money_transactions set category = 'subscriptions', category_origin = 'manual', transfer_group_id = null, transfer_disposition = 'excluded'
    where description = 'Pocket rebuild'`;
  const [kept] = (await repository!.readActivityPage({ query: "Kept review", offset: 0, limit: 10 })).items;
  await repository!.setTransferDisposition({ transactionId: kept!.id, disposition: "spend" });
  await repository!.setTransactionCategory({ transactionId: kept!.id, category: "gifts", actor: "integration@example.test", createRule: false });
  await storeTransferRule(700, "equals", "kept review", "excluded");

  await expect(repository!.reimportAll()).resolves.toEqual({ importCount: 1, transactionCount: 3, linkedPairCount: 1 });
  const rows = (await repository!.readActivityPage({ query: "Pocket rebuild", offset: 0, limit: 10 })).items;
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.category === "transfer" && row.categoryOrigin === "source" && row.transferDisposition === "internal_transfer")).toBe(true);
  expect(new Set(rows.map((row) => row.transferGroupId)).size).toBe(1);
  expect((await repository!.readActivityPage({ query: "Kept review", offset: 0, limit: 10 })).items).toEqual([
    expect.objectContaining({ transferDisposition: "spend", category: "gifts", categoryOrigin: "manual", needsTransferReview: false })
  ]);
});

it("links top-ups and excludes one-sided currency exchanges from transfer review", async () => {
  await commitCash(repository!, cash([
    "Topup\tCurrent\t2026-03-06 12:00:00\t2026-03-06 12:00:00\tExternal top-up\t25\t0\tEUR\tCOMPLETED\t125",
    "Transfer\tSavings\t2026-03-07 12:00:00\t2026-03-07 12:00:00\tFunding source\t-25\t0\tEUR\tCOMPLETED\t75",
    "Exchange\tCurrent\t2026-03-08 12:00:00\t2026-03-08 12:00:00\tExchanged to USD\t-10\t0\tEUR\tCOMPLETED\t115"
  ]), "cash-movements.tsv");

  const rows = (await repository!.readActivityPage({ query: "", offset: 0, limit: 10 })).items;
  const linked = rows.filter((row) => row.description !== "Exchanged to USD");
  expect(linked).toHaveLength(2);
  expect(linked.every((row) => row.transferDisposition === "internal_transfer")).toBe(true);
  expect(new Set(linked.map((row) => row.transferGroupId)).size).toBe(1);
  expect(rows.find((row) => row.description === "Exchanged to USD")).toMatchObject({ category: "transfer", transferDisposition: "excluded", needsTransferReview: false });
});

it("deletes an import cascade and repairs a cross-import transfer link", async () => {
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
  expect(remaining).toEqual([expect.objectContaining({ description: "Move from current", transferDisposition: "refund", needsTransferReview: false })]);
  expect(remaining[0]?.transferGroupId).toBeUndefined();
  expect(remaining[0]?.transferDisposition).toBe("refund");
  expect((await repository!.readLedgerSnapshot("all")).imports.map((item) => item.id)).not.toContain(removed.id);
  await expect(repository!.deleteImport(removed.id)).resolves.toBeUndefined();
});

it("deletes investment events while preserving rows owned by another import", async () => {
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
  expect((await repository!.readLedgerSnapshot("all")).imports.map((item) => item.id)).toContain(original.id);

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
  expect((await repository!.readLedgerSnapshot("all")).investments.totals.eventCount).toBe(0);
});

it("keeps review authoritative when a counterpart import races it", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-04-02 12:00:00\t2026-04-02 12:00:00\tRacing review\t75\t0\tEUR\tCOMPLETED\t175",
  ]), "racing-review.tsv");
  const [reviewed] = (await repository!.readActivityPage({ query: "Racing review", offset: 0, limit: 10 })).items;
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

it("allows a user to correct an automatic transfer match", async () => {
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

it("starts planning history only when a classified cash-flow contributor exists", async () => {
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

  const withoutCashFlow = await repository!.readLedgerSnapshot("all");
  expect(withoutCashFlow.spending.months).toEqual([]);
  expect(withoutCashFlow.planning).toMatchObject({ ready: false, observedMonthCount: 0 });

  await commitCash(repository!, cash([
    `Card Payment\tCurrent\t${period!.day_4} 12:00:00\t${period!.day_4} 12:00:00\tReal spend\t-12.50\t0\tEUR\tCOMPLETED\t462.50`,
  ]), "real-spend.tsv");
  const withCashFlow = await repository!.readLedgerSnapshot("all");
  expect(withCashFlow.spending.months).toEqual([expect.objectContaining({ month: period!.month_key, spendMinor: 1_250, netCashFlowMinor: -1_250 })]);
  expect(withCashFlow.planning).toMatchObject({ ready: false, observedMonthCount: 1 });
});

it("normalizes investment positions while retaining symbol-less costs in totals", async () => {
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
  const { investments } = await repository!.readLedgerSnapshot("all");
  expect(investments.positions).toEqual([expect.objectContaining({ symbol: "VWCE", name: "Latest Fund", assetClass: "ETF", quantity: "3" })]);
  expect(investments.totals).toMatchObject({ eventCount: 3, boughtMinor: 30_000, feesMinor: 300 });
});

it("derives Trade Republic cash snapshots from its unified ledger", async () => {
  const headers = "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code";
  const rows = [
    "2026-01-05T12:00:00.000Z,2026-01-05,DEFAULT,CASH,CUSTOMER_INBOUND,,,,,,1000,,,EUR,,,,Funding,tr-cash-1,,,,",
    "2026-02-10T12:00:00.000Z,2026-02-10,DEFAULT,TRADING,BUY,ETF,Fund,VWCE,2,100,-200,-1,,EUR,,,,Buy,tr-buy-1,,,,",
  ];
  await commitCash(repository!, Buffer.from([headers, ...rows].join("\r\n")), "trade-republic.csv");

  const snapshot = await repository!.readLedgerSnapshot("accounts");
  const account = snapshot.accounts.find((id) => snapshot.accountLabels[id] === "Trade Republic Cash");
  expect(account).toBeDefined();
  expect(snapshot.accountLastObserved[account!]).toBe("2026-02-01");
  expect(snapshot.months.find((month) => month.date === "2026-01-01")?.values[account!]).toBe(1_000);
  expect(snapshot.months.find((month) => month.date === "2026-02-01")?.values[account!]).toBe(799);

  const { moves } = cashMovesSince({ baseline: "2026-01-31", ...await repository!.readCashSince("2026-01-31") });
  expect(moves).toEqual([expect.objectContaining({ accountId: account, baselineMinor: 100_000, currentMinor: 79_900, changeMinor: -20_100, tradesMinor: -20_000, spendingMinor: -100, otherMinor: 0 })]);
});

it("reports reverted rows beyond the initial activity page", async () => {
  const rows = Array.from({ length: 501 }, (_, index) => {
    const day = String(index % 28 + 1).padStart(2, "0");
    const hour = String(Math.floor(index / 28) % 24).padStart(2, "0");
    return `Card Payment\tCurrent\t2026-06-${day} ${hour}:00:00\t2026-06-${day} ${hour}:00:00\tRow ${index}\t-1\t0\tEUR\t${index === 0 ? "REVERTED" : "COMPLETED"}\t${1000 - index}`;
  });
  await commitCash(repository!, cash(rows), "many-rows.tsv");
  const snapshot = await repository!.readLedgerSnapshot("all");
  expect(snapshot.activity).toHaveLength(50);
  expect(snapshot.activity.some((row) => row.status === "reverted")).toBe(false);
  expect(snapshot.revertedCount).toBe(1);
});

it("keeps a later charge that shares its start with a reverted authorization", async () => {
  await commitCash(repository!, cash([
    "Card Payment\tCurrent\t2026-06-12 12:00:00\t\tLate charge\t-5\t0\tEUR\tREVERTED\t",
    "Card Payment\tCurrent\t2026-06-12 12:00:00\t2026-06-20 12:00:00\tLate charge\t-5\t0\tEUR\tCOMPLETED\t95"
  ]), "late-charge.tsv");
  const activity = await repository!.readActivityPage({ query: "Late charge", offset: 0, limit: 10 });
  expect(activity).toEqual(expect.objectContaining({ total: 1, hasMore: false }));
  expect(activity.items).toHaveLength(1);
  const snapshot = await repository!.readLedgerSnapshot("all");
  expect(snapshot.spending.categories).toContainEqual(expect.objectContaining({ amountMinor: 500, count: 1 }));
  expect(snapshot.spending.months.find((month) => month.month === "2026-06")).toMatchObject({ spendMinor: 500, netCashFlowMinor: -500 });
});

it("does not link a transfer to a reverted row", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-06-15 12:00:00\t\tReverted funding\t50\t0\tEUR\tREVERTED\t",
    "Transfer\tSavings\t2026-06-15 12:00:00\t2026-06-15 12:00:00\tLegitimate opposite\t-50\t0\tEUR\tCOMPLETED\t50"
  ]), "reverted-transfer.tsv");
  const snapshot = await repository!.readLedgerSnapshot("all");
  expect(snapshot.transferReview.linkedPairs).toBe(0);
  expect(snapshot.transferReview.unresolvedNegativeCount).toBe(0);
  expect(snapshot.transferReviewGroups).toEqual([]);
  expect((await repository!.readActivityPage({ query: "Legitimate opposite", offset: 0, limit: 10 })).items[0]).toMatchObject({ transferDisposition: "spend", needsTransferReview: false });
});

it("materializes carried balance months for monthly trend intervals", async () => {
  await repository!.addManualBalance({ accountName: "Calendar", date: "2026-01-31", valueMinor: 10_000, currency: "EUR" });
  await repository!.addManualBalance({ accountName: "Calendar", date: "2026-03-31", valueMinor: 12_100, currency: "EUR" });
  const snapshot = await repository!.readLedgerSnapshot("all");
  expect(snapshot.months.map((month) => [month.date, month.total])).toEqual([["2026-01-01", 100], ["2026-02-01", 100], ["2026-03-01", 121]]);
  const points = snapshot.months.map((month) => ({ date: month.date, total: month.total, money: month.total, stocks: 0 }));
  expect(moneyTrackerTrendStats(points).geometricAverageMonthlyPercent).toBeCloseTo(10);
});

it("preserves signed transfer corrections in monthly net cash flow", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-06-10 12:00:00\t2026-06-10 12:00:00\tSpend correction\t10\t0\tEUR\tCOMPLETED\t10",
    "Transfer\tCurrent\t2026-06-11 12:00:00\t2026-06-11 12:00:00\tIncome correction\t-5\t0\tEUR\tCOMPLETED\t5",
    "Transfer\tCurrent\t2026-06-12 12:00:00\t2026-06-12 12:00:00\tRefund correction\t-2\t0\tEUR\tCOMPLETED\t3",
  ]), "signed-corrections.tsv");
  const review = await repository!.readActivityPage({ query: "correction", offset: 0, limit: 10 });
  for (const row of review.items) await repository!.setTransferDisposition({ transactionId: row.id, disposition: row.description.startsWith("Spend") ? "spend" : row.description.startsWith("Income") ? "income" : "refund" });
  const month = (await repository!.readLedgerSnapshot("all")).spending.months.find((item) => item.month === "2026-06");
  expect(month).toMatchObject({ spendMinor: -800, incomeMinor: -500, refundsMinor: -200, netCashFlowMinor: 300 });
});

it("queues uncategorized spending with suggestions from earlier rows with the same description", async () => {
  await commitCash(repository!, cash([
    "Card Payment\tCurrent\t2026-07-01 12:00:00\t2026-07-01 12:00:00\tStall 7\t-10\t0\tEUR\tCOMPLETED\t90",
    "Card Payment\tCurrent\t2026-07-02 12:00:00\t2026-07-02 12:00:00\tStall 7\t-12\t0\tEUR\tCOMPLETED\t78",
    "Card Payment\tCurrent\t2026-07-03 12:00:00\t2026-07-03 12:00:00\tStall 7\t-8\t0\tEUR\tCOMPLETED\t70",
    "Card Payment\tCurrent\t2026-07-04 12:00:00\t2026-07-04 12:00:00\tKiosk 12\t-5\t0\tEUR\tCOMPLETED\t65",
  ]), "queue.tsv");
  const first = (await repository!.readActivityPage({ query: "Stall 7", sort: "date", direction: "asc", offset: 0, limit: 10 })).items[0]!;
  await repository!.setTransactionCategory({ transactionId: first.id, category: "groceries", actor: "integration@example.test", createRule: false });

  const { reviewCounts, reviewQueue } = await repository!.readLedgerSnapshot("review");
  expect(reviewCounts.uncategorized).toBe(3);
  const stall = reviewQueue.items.filter((item) => item.description === "Stall 7");
  expect(stall).toHaveLength(2);
  expect(stall.map((item) => item.similarCount)).toEqual([1, 1]);
  expect(stall[0]!.suggestions).toEqual(["groceries"]);
  expect(reviewQueue.items.find((item) => item.description === "Kiosk 12")).toMatchObject({ similarCount: 0, suggestions: [] });

  const review = await repository!.readActivityPage({ query: "", reviewOnly: true, offset: 0, limit: 10 });
  expect(review.items.map((item) => item.description).sort()).toEqual(["Kiosk 12", "Stall 7", "Stall 7"]);
});

it("categorizes transfers reviewed as spending and follows later review changes", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-07-05 12:00:00\t2026-07-05 12:00:00\tTo Landlord\t-500\t0\tEUR\tCOMPLETED\t500",
    "Transfer\tCurrent\t2026-08-05 12:00:00\t2026-08-05 12:00:00\tTo Landlord\t-500\t0\tEUR\tCOMPLETED\t0"
  ]), "transfer-spending.tsv");
  const stored = async () => admin!<{ category: string; category_origin: string }[]>`select category, category_origin
    from tools.money_transactions where description = 'To Landlord' order by local_date`;
  const { reviewQueue } = await repository!.readLedgerSnapshot("review");
  expect(reviewQueue.items.filter((item) => item.description === "To Landlord").map((item) => item.similarCount)).toEqual([1, 1]);

  const rent = { matchField: "description", matchOperator: "equals", matchValue: "to landlord", category: "housing" } as const;
  expect(await repository!.previewCategoryRule(rent)).toMatchObject({ matchCount: 2, changeCount: 2 });
  await repository!.saveCategoryRule({ ...rent, actor: "integration@example.test", expectedMatchCount: 2 });
  expect(await stored()).toEqual([{ category: "housing", category_origin: "rule" }, { category: "housing", category_origin: "rule" }]);

  // An own-account transfer is not spending, so it leaves the rule and returns when reviewed as spending again.
  const [first] = (await repository!.readActivityPage({ query: "To Landlord", sort: "date", direction: "asc", offset: 0, limit: 10 })).items;
  await repository!.setTransferDisposition({ transactionId: first!.id, disposition: "internal_transfer" });
  expect(await stored()).toEqual([{ category: "transfer", category_origin: "source" }, { category: "housing", category_origin: "rule" }]);
  await repository!.setTransferDisposition({ transactionId: first!.id, disposition: "spend" });
  expect((await stored())[0]).toEqual({ category: "housing", category_origin: "rule" });
});

it("records transfer results that the rules write as automatic", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-07-01 12:00:00\t2026-07-01 12:00:00\tOrigin pair\t-12\t0\tEUR\tCOMPLETED\t88",
    "Transfer\tSavings\t2026-07-01 12:00:00\t2026-07-01 12:00:00\tOrigin pair\t12\t0\tEUR\tCOMPLETED\t12",
    "Transfer\tCurrent\t2026-07-10 12:00:00\t2026-07-10 12:00:00\tOrigin rule\t-30\t0\tEUR\tCOMPLETED\t58",
    "Transfer\tCurrent\t2026-07-11 12:00:00\t2026-07-11 12:00:00\tOrigin zero\t0\t0\tEUR\tCOMPLETED\t58",
    "Exchange\tCurrent\t2026-07-12 12:00:00\t2026-07-12 12:00:00\tOrigin exchange\t-8\t0\tEUR\tCOMPLETED\t50"
  ]), "origins.tsv");
  const state = await transferState("Origin");
  expect(state).toEqual([
    { description: "Origin exchange", amount: -800, groupId: null, disposition: "excluded", origin: "automatic" },
    { description: "Origin pair", amount: -1_200, groupId: expect.any(String), disposition: "internal_transfer", origin: "automatic" },
    { description: "Origin pair", amount: 1_200, groupId: state[1]?.groupId, disposition: "internal_transfer", origin: "automatic" },
    { description: "Origin rule", amount: -3_000, groupId: null, disposition: "spend", origin: "automatic" },
    { description: "Origin zero", amount: 0, groupId: null, disposition: "excluded", origin: "automatic" }
  ]);
});

it("keeps transfer results of unknown origin through a reimport", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-08-01 12:00:00\t2026-08-01 12:00:00\tLegacy pair\t-40\t0\tEUR\tCOMPLETED\t60",
    "Transfer\tSavings\t2026-08-01 12:00:00\t2026-08-01 12:00:00\tLegacy pair\t40\t0\tEUR\tCOMPLETED\t40",
    "Transfer\tCurrent\t2026-08-10 12:00:00\t2026-08-10 12:00:00\tLegacy mixed\t-15\t0\tEUR\tCOMPLETED\t45",
    "Transfer\tSavings\t2026-08-10 12:00:00\t2026-08-10 12:00:00\tLegacy mixed\t15\t0\tEUR\tCOMPLETED\t55",
    "Transfer\tCurrent\t2026-08-20 12:00:00\t2026-08-20 12:00:00\tLegacy single\t-20\t0\tEUR\tCOMPLETED\t25"
  ]), "legacy.tsv");
  await admin!`update tools.money_transactions set transfer_origin = null
    where description in ('Legacy pair', 'Legacy single') or (description = 'Legacy mixed' and amount_minor > 0)`;
  await storeTransferRule(700, "starts_with", "legacy", "income");
  const before = await transferState("Legacy");
  expect(before.map(({ groupId, ...row }) => ({ ...row, grouped: groupId !== null }))).toEqual([
    { description: "Legacy mixed", amount: -1_500, disposition: "internal_transfer", origin: "automatic", grouped: true },
    { description: "Legacy mixed", amount: 1_500, disposition: "internal_transfer", origin: null, grouped: true },
    { description: "Legacy pair", amount: -4_000, disposition: "internal_transfer", origin: null, grouped: true },
    { description: "Legacy pair", amount: 4_000, disposition: "internal_transfer", origin: null, grouped: true },
    { description: "Legacy single", amount: -2_000, disposition: "spend", origin: null, grouped: false }
  ]);

  await repository!.reimportAll();
  expect(await transferState("Legacy")).toEqual(before);
});

it.each([false, true])("keeps a confirmed pair that a reimport would no longer link (confirmed: %s)", async (confirmed) => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-09-01 12:00:00\t2026-09-01 12:00:00\tConfirm in\t90\t0\tEUR\tCOMPLETED\t190",
    "Transfer\tSavings\t2026-09-02 12:00:00\t2026-09-02 12:00:00\tConfirm out\t-90\t0\tEUR\tCOMPLETED\t10"
  ]), "confirm.tsv");
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-09-03 12:00:00\t2026-09-03 12:00:00\tConfirm other in\t90\t0\tEUR\tCOMPLETED\t280"
  ]), "confirm-other.tsv");
  const [linkedIn, other, linkedOut] = await transferState("Confirm");
  expect(linkedIn).toMatchObject({ groupId: expect.any(String), disposition: "internal_transfer", origin: "automatic" });
  expect(linkedOut).toMatchObject({ groupId: linkedIn!.groupId, disposition: "internal_transfer", origin: "automatic" });
  expect(other).toMatchObject({ groupId: null, disposition: "refund", origin: "automatic" });
  if (confirmed) await repository!.setTransferDisposition({ transactionId: await transactionId("Confirm out"), disposition: "internal_transfer" });

  await repository!.reimportAll();
  const confirmedPair = { groupId: linkedIn!.groupId, disposition: "internal_transfer", origin: "manual" };
  expect(await transferState("Confirm")).toEqual([
    { description: "Confirm in", amount: 9_000, ...(confirmed ? confirmedPair : { groupId: null, disposition: "refund", origin: "automatic" }) },
    { description: "Confirm other in", amount: 9_000, groupId: null, disposition: "refund", origin: "automatic" },
    { description: "Confirm out", amount: -9_000, ...(confirmed ? confirmedPair : { groupId: null, disposition: "spend", origin: "automatic" }) }
  ]);
});

it("records a split as manual, resets its counterpart, and keeps the split through a reimport", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-10-01 12:00:00\t2026-10-01 12:00:00\tSplit inflow\t60\t0\tEUR\tCOMPLETED\t160",
    "Transfer\tSavings\t2026-10-02 12:00:00\t2026-10-02 12:00:00\tSplit outflow\t-60\t0\tEUR\tCOMPLETED\t40"
  ]), "split.tsv");
  const [inflow, outflow] = await transferState("Split");
  expect(inflow).toMatchObject({ groupId: expect.any(String), disposition: "internal_transfer", origin: "automatic" });
  expect(outflow).toMatchObject({ groupId: inflow!.groupId, disposition: "internal_transfer", origin: "automatic" });

  await repository!.setTransferDisposition({ transactionId: await transactionId("Split inflow"), disposition: "refund" });
  const split = { description: "Split inflow", amount: 6_000, groupId: null, disposition: "refund", origin: "manual" };
  expect(await transferState("Split")).toEqual([split, { description: "Split outflow", amount: -6_000, groupId: null, disposition: null, origin: null }]);
  await repository!.reimportAll();
  expect(await transferState("Split")).toEqual([split, { description: "Split outflow", amount: -6_000, groupId: null, disposition: "spend", origin: "automatic" }]);
});

it("clears a confirmed pair when an import deletion removes one of its rows", async () => {
  await admin!`delete from tools.money_transfer_rules where source_type = 'Transfer'`;
  const removed = await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-11-01 12:00:00\t2026-11-01 12:00:00\tMove out\t-50\t0\tEUR\tCOMPLETED\t50"
  ]), "move-out.tsv");
  await commitCash(repository!, cash([
    "Transfer\tSavings\t2026-11-02 12:00:00\t2026-11-02 12:00:00\tMove in\t50\t0\tEUR\tCOMPLETED\t50"
  ]), "move-in.tsv");
  await repository!.setTransferDisposition({ transactionId: await transactionId("Move in"), disposition: "internal_transfer" });
  const [moveIn, moveOut] = await transferState("Move");
  expect(moveIn).toMatchObject({ groupId: expect.any(String), disposition: "internal_transfer", origin: "manual" });
  expect(moveOut).toMatchObject({ groupId: moveIn!.groupId, disposition: "internal_transfer", origin: "manual" });

  await repository!.deleteImport(removed.id);
  expect(await transferState("Move")).toEqual([{ description: "Move in", amount: 5_000, groupId: null, disposition: null, origin: null }]);
  await storeTransferRule(700, "equals", "move in", "income");
  await repository!.reimportAll();
  expect(await transferState("Move")).toEqual([{ description: "Move in", amount: 5_000, groupId: null, disposition: "income", origin: "automatic" }]);
});

it("records bulk transfer review as manual and keeps it through a reimport", async () => {
  await admin!`delete from tools.money_transfer_rules where source_type = 'Transfer'`;
  await storeTransferRule(700, "equals", "bulk three", "spend");
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-12-01 12:00:00\t2026-12-01 12:00:00\tBulk one\t-6\t0\tEUR\tCOMPLETED\t94",
    "Transfer\tCurrent\t2026-12-02 12:00:00\t2026-12-02 12:00:00\tBulk two\t-7\t0\tEUR\tCOMPLETED\t87",
    "Transfer\tCurrent\t2026-12-03 12:00:00\t2026-12-03 12:00:00\tBulk three\t-8\t0\tEUR\tCOMPLETED\t79"
  ]), "bulk.tsv");
  const transactionIds = [await transactionId("Bulk one"), await transactionId("Bulk two"), await transactionId("Bulk three")];
  expect(await repository!.setTransferDispositions({ transactionIds, disposition: "excluded" })).toEqual({ affectedCount: 2 });
  const one = { description: "Bulk one", amount: -600, groupId: null, disposition: "excluded", origin: "manual" };
  const two = { description: "Bulk two", amount: -700, groupId: null, disposition: "excluded", origin: "manual" };
  expect(await transferState("Bulk")).toEqual([one, { description: "Bulk three", amount: -800, groupId: null, disposition: "spend", origin: "automatic" }, two]);

  await storeTransferRule(800, "starts_with", "bulk", "income");
  await repository!.reimportAll();
  expect(await transferState("Bulk")).toEqual([one, { description: "Bulk three", amount: -800, groupId: null, disposition: "income", origin: "automatic" }, two]);
});

it("keeps a removed rule's results through imports and replays until a reimport", async () => {
  await admin!`delete from tools.money_transfer_rules where source_type = 'Transfer'`;
  const broker = cash(["Transfer\tCurrent\t2027-01-04 12:00:00\t2027-01-04 12:00:00\tTo Broker Account\t-30\t0\tEUR\tCOMPLETED\t70"]);
  await commitCash(repository!, broker, "broker.tsv");
  const rule = { provider: "revolut", sourceType: "Transfer", descriptionMatch: "starts_with", matchValue: "to broker", amountSign: "negative", disposition: "excluded", note: "Broker deposits" } as const;
  expect(await repository!.previewTransferRule(rule)).toMatchObject({ matchCount: 1 });
  expect(await repository!.createTransferRule({ ...rule, actor: "integration@example.test", expectedMatchCount: 1 })).toEqual({ affectedCount: 1 });
  const [stored] = (await repository!.readLedgerSnapshot("review")).transferRules;
  expect(stored).toMatchObject({ note: "Broker deposits" });
  const excluded = { description: "To Broker Account", amount: -3_000, groupId: null, disposition: "excluded", origin: "automatic" };

  const preview = await repository!.previewTransferRule(rule);
  expect(preview.matchCount).toBe(0);
  await repository!.reimportAll();
  expect(await transferState("To Broker")).toEqual([excluded]);
  expect(await repository!.previewTransferRule(rule)).toEqual(preview);

  expect(await repository!.deleteTransferRule(stored!.id)).toBe(true);
  await commitCash(repository!, cash(["Transfer\tCurrent\t2027-01-05 12:00:00\t2027-01-05 12:00:00\tTo Broker Later\t-10\t0\tEUR\tCOMPLETED\t60"]), "broker-later.tsv");
  expect((await commitCash(repository!, broker, "broker.tsv")).replay).toBe(true);
  const later = { description: "To Broker Later", amount: -1_000, groupId: null, disposition: null, origin: null };
  expect(await transferState("To Broker")).toEqual([excluded, later]);
  expect(await repository!.previewTransferRule(rule)).toMatchObject({ matchCount: 1 });

  await repository!.reimportAll();
  expect(await transferState("To Broker")).toEqual([{ ...excluded, disposition: null, origin: null }, later]);
  expect(await repository!.previewTransferRule(rule)).toMatchObject({ matchCount: 2 });
  await expect(repository!.createTransferRule({ ...rule, actor: "integration@example.test", expectedMatchCount: 1 })).rejects.toThrow("Preview the rule again");
  expect(await repository!.createTransferRule({ ...rule, actor: "integration@example.test", expectedMatchCount: 2 })).toEqual({ affectedCount: 2 });
});

it("leaves stored state unchanged when reimports repeat under unchanged rules", async () => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2027-02-01 12:00:00\t2027-02-01 12:00:00\tRepeat pair\t-70\t0\tEUR\tCOMPLETED\t30",
    "Transfer\tSavings\t2027-02-01 12:00:00\t2027-02-01 12:00:00\tRepeat pair\t70\t0\tEUR\tCOMPLETED\t70",
    "Transfer\tCurrent\t2027-02-10 12:00:00\t2027-02-10 12:00:00\tRepeat rule\t-15\t0\tEUR\tCOMPLETED\t15",
    "Transfer\tCurrent\t2027-02-11 12:00:00\t2027-02-11 12:00:00\tRepeat manual\t20\t0\tEUR\tCOMPLETED\t35",
    "Card Payment\tCurrent\t2027-02-12 12:00:00\t2027-02-12 12:00:00\tRepeat shop\t-5\t0\tEUR\tCOMPLETED\t30",
    "Card Payment\tCurrent\t2027-02-13 12:00:00\t2027-02-13 12:00:00\tRepeat shop\t-4\t0\tEUR\tCOMPLETED\t26"
  ]), "repeat.tsv");
  await repository!.setTransferDisposition({ transactionId: await transactionId("Repeat manual"), disposition: "income" });
  await repository!.setTransactionCategory({ transactionId: await transactionId("Repeat shop"), category: "groceries", actor: "integration@example.test", createRule: true });
  const stored = () => admin!`select id, transfer_group_id::text transfer_group_id, transfer_disposition, transfer_origin, category, category_origin, category_rule_id::text category_rule_id
    from tools.money_transactions order by id`;
  const before = await stored();
  const [pairOut, pairIn] = await transferState("Repeat pair");
  expect(pairOut).toMatchObject({ groupId: expect.any(String), origin: "automatic" });
  expect(pairIn).toMatchObject({ groupId: pairOut!.groupId, origin: "automatic" });
  expect(await transferState("Repeat manual")).toEqual([{ description: "Repeat manual", amount: 2_000, groupId: null, disposition: "income", origin: "manual" }]);
  expect(before.map((row) => row.category_origin).sort()).toEqual(["manual", "rule", "source", "source", "source", "source"]);

  await repository!.reimportAll();
  const first = await stored();
  await repository!.reimportAll();
  expect(await stored()).toEqual(first);
  expect(first).toEqual(before);
});

it.each(["review", "reimport"] as const)("keeps a manual review that serializes with a reimport (%s first)", async (first) => {
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2027-03-01 12:00:00\t2027-03-01 12:00:00\tOrdered review\t-20\t0\tEUR\tCOMPLETED\t80"
  ]), "ordered.tsv");
  await storeTransferRule(700, "equals", "ordered review", "internal_transfer");
  const id = await transactionId("Ordered review");
  const review = () => repository!.setTransferDisposition({ transactionId: id, disposition: "excluded" });
  const reimport = () => repository!.reimportAll();
  await inCategoryRuleLockOrder(first === "review" ? [review, reimport] : [reimport, review]);
  expect(await transferState("Ordered review")).toEqual([{ description: "Ordered review", amount: -2_000, groupId: null, disposition: "excluded", origin: "manual" }]);
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

function storeTransferRule(priority: number, match: string, value: string, disposition: string) {
  return admin!`insert into tools.money_transfer_rules (id, priority, provider, source_type, description_match, match_value, amount_sign, disposition, created_at, updated_at, created_by)
    values (gen_random_uuid(), ${priority}, 'revolut', 'Transfer', ${match}, ${value}, 'any', ${disposition}, now(), now(), 'fixture')`;
}

async function transactionId(description: string) {
  const [row] = await admin!<{ id: string }[]>`select id::text id from tools.money_transactions where description = ${description} order by local_date, id limit 1`;
  if (!row) throw new Error(`No transaction is described as ${description}.`);
  return row.id;
}

function transferState(descriptionPrefix: string) {
  return admin!<{ description: string; amount: number; groupId: string | null; disposition: string | null; origin: string | null }[]>`select description,
      amount_minor::int amount, transfer_group_id::text "groupId", transfer_disposition disposition, transfer_origin origin
    from tools.money_transactions where description like ${`${descriptionPrefix}%`} order by description collate "C", amount_minor`;
}

async function inCategoryRuleLockOrder(operations: readonly (() => Promise<unknown>)[]) {
  const started: Promise<unknown>[] = [];
  await admin!.begin(async (tx) => {
    await tx`lock table tools.money_category_rules in share row exclusive mode`;
    const queued = async () => (await tx<{ count: number }[]>`select count(*)::int count from pg_locks
      where locktype = 'relation' and relation = 'tools.money_category_rules'::regclass and not granted
        and database = (select oid from pg_database where datname = current_database())`)[0]!.count;
    for (const operation of operations) {
      started.push(operation());
      for (let attempt = 0; await queued() < started.length; attempt += 1) {
        if (attempt === 500) throw new Error("A Money writer did not queue on the category rule lock.");
        await delay(10);
      }
    }
  });
  await Promise.all(started);
}
