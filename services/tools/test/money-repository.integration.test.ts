import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { parseMoneyImport } from "../money/money-import-domain.js";
import { createPostgresMoneyRepository } from "../money/money-repository.js";

// Opt in only with a disposable database after applying the guarded tools schema:
// TEST_DATABASE_URL=... MONEY_TEST_DATABASE_CONFIRM=money-repository-test pnpm test:money-postgres
const databaseUrl = process.env.TEST_DATABASE_URL;
const confirmed = process.env.MONEY_TEST_DATABASE_CONFIRM === "money-repository-test";
const repository = databaseUrl && confirmed ? createPostgresMoneyRepository(databaseUrl) : undefined;
const admin = databaseUrl && confirmed ? postgres(databaseUrl, { max: 1 }) : undefined;

beforeAll(async () => {
  if (!admin) return;
  const [database] = await admin<{ name: string }[]>`select current_database() name`;
  if (!database || !/test/i.test(database.name)) throw new Error("Money integration tests require a disposable database whose name contains 'test'.");
  await admin`truncate tools.money_balance_snapshots, tools.money_category_rules, tools.money_investment_events, tools.money_transactions, tools.money_imports, tools.money_accounts cascade`;
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

  await repository!.addManualBalance({ accountName: "Duplicate", role: "cash", date: "2026-02-28", valueMinor: 1_000, currency: "EUR" });
  await repository!.addManualBalance({ accountName: "Duplicate", role: "investment", date: "2026-02-28", valueMinor: 2_000, currency: "EUR" });
  const snapshot = await repository!.readLedgerSnapshot();
  expect(snapshot.transferReview.unresolvedPositiveCount + snapshot.transferReview.unresolvedNegativeCount).toBe(0);
  expect(snapshot.planning.ready).toBe(true);
  expect(snapshot.spending.months.find((month) => month.month === "2026-02")).toMatchObject({ incomeMinor: 5_000, spendMinor: 2_000, netCashFlowMinor: 3_000 });
  const duplicateAccounts = snapshot.accounts.filter((id) => snapshot.accountLabels[id]?.startsWith("Duplicate"));
  expect(duplicateAccounts).toHaveLength(2);
  expect(new Set(duplicateAccounts.map((id) => snapshot.accountRoles[id]))).toEqual(new Set(["cash", "investment"]));
});

function cash(rows: string[]) {
  return Buffer.from(["Type\tProduct\tStarted Date\tCompleted Date\tDescription\tAmount\tFee\tCurrency\tState\tBalance", ...rows].join("\r\n"));
}
