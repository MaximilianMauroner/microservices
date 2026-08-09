import postgres from "postgres";
import { afterAll, beforeEach, expect, it } from "vitest";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../field-guide/src/postgres-push-guard.js";
import { parseMoneyImport } from "../money/money-import-domain.js";
import { createPostgresMoneyRepository, type MoneyRepository } from "../money/money-repository.js";

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

it.skipIf(!repository || !admin)("starts the planning calendar only when a classified cash-flow contributor exists", async () => {
  await commitCash(repository!, Buffer.from([
    "Date,Account,Value,Role,Currency",
    "2026-07-01,Cash snapshot,500,cash,EUR",
  ].join("\r\n")), "balance-only.csv");
  await commitCash(repository!, Buffer.from([
    "Date\tTicker\tType\tQuantity\tPrice per share\tTotal Amount\tCurrency\tFX Rate",
    "2026-07-02T12:00:00.000Z\tVWCE\tBUY - MARKET\t1\tEUR 100\tEUR -100\tEUR\t1",
  ].join("\r\n")), "fee-free-trade.tsv");
  await commitCash(repository!, cash([
    "Transfer\tCurrent\t2026-07-03 12:00:00\t2026-07-03 12:00:00\tInternal only\t-25\t0\tEUR\tCOMPLETED\t475",
    "Transfer\tSavings\t2026-07-03 12:00:00\t2026-07-03 12:00:00\tInternal only\t25\t0\tEUR\tCOMPLETED\t25",
  ]), "internal-only.tsv");

  const withoutCashFlow = await repository!.readLedgerSnapshot();
  expect(withoutCashFlow.spending.months).toEqual([]);
  expect(withoutCashFlow.planning).toMatchObject({ ready: false, observedMonthCount: 0 });

  await commitCash(repository!, cash([
    "Card Payment\tCurrent\t2026-07-04 12:00:00\t2026-07-04 12:00:00\tReal spend\t-12.50\t0\tEUR\tCOMPLETED\t462.50",
  ]), "real-spend.tsv");
  const withCashFlow = await repository!.readLedgerSnapshot();
  expect(withCashFlow.spending.months).toEqual([expect.objectContaining({ month: "2026-07", spendMinor: 1_250, netCashFlowMinor: -1_250 })]);
  expect(withCashFlow.planning).toMatchObject({ ready: true, observedMonthCount: 1 });
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
