import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyActivityView, MoneyDataView, MoneyInvestmentsView, MoneyPlanningCard, MoneySpendingView } from "../money/money-ledger-views.js";
import { groupMonth, History } from "../money/money-tracker-page.js";

const activity = [
  {
    id: "transaction-1",
    occurredAt: "2026-08-09T03:08:51.000Z",
    accountName: "Revolut Current",
    description: "Coffee",
    amountMinor: -350,
    feeMinor: 10,
    taxMinor: 0,
    currency: "EUR",
    status: "completed" as const,
    sourceType: "Card Payment",
    flowKind: "spend" as const,
    category: "uncategorized" as const,
    categoryOrigin: "source" as const,
    needsTransferReview: false
  },
  {
    id: "transaction-2",
    occurredAt: "2026-08-09T04:08:51.000Z",
    accountName: "Revolut Current",
    description: "Own account transfer",
    amountMinor: 1_000,
    feeMinor: 0,
    taxMinor: 0,
    currency: "EUR",
    status: "reverted" as const,
    sourceType: "Transfer",
    flowKind: "transfer" as const,
    category: "uncategorized" as const,
    categoryOrigin: "source" as const,
    needsTransferReview: false
  },
  {
    id: "transaction-3",
    occurredAt: "2026-08-09T05:08:51.000Z",
    accountName: "Revolut Current",
    description: "External funding",
    amountMinor: 2_000,
    feeMinor: 0,
    taxMinor: 0,
    currency: "EUR",
    status: "completed" as const,
    sourceType: "Transfer",
    flowKind: "transfer" as const,
    category: "uncategorized" as const,
    categoryOrigin: "source" as const,
    transferGroupId: "00000000-0000-4000-8000-000000000001",
    transferDisposition: "internal_transfer" as const,
    needsTransferReview: false
  }
];

const emptyMarketData = {
  asOf: "2026-08-10T12:00:00.000Z",
  positions: [],
  history: [],
  totals: { costBasisMinor: 0, knownMarketValueMinor: 0, knownUnrealizedGainMinor: 0, complete: true }
} as const;

describe("Option A money ledger views", () => {
  it("renders auditable activity with sortable ledger controls", () => {
    const accountIds = ["00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"];
    const html = renderToStaticMarkup(<MoneyActivityView activity={activity} accounts={accountIds} accountLabels={{ [accountIds[0]!]: "Savings", [accountIds[1]!]: "Savings" }} transactionCount={8_030} revertedCount={17} transferReview={{ linkedPairs: 12, unlinkedCount: 4, unresolvedPositiveCount: 1, unresolvedNegativeCount: 1 }} transferReviewGroups={[]} />);

    expect(html).toContain("Transaction activity");
    expect(html).toContain("8,030");
    expect(html).toContain("17");
    expect(html).toContain("Coffee");
    expect(html).toContain("Revolut Current");
    expect(html).toContain("Needs category");
    expect(html).toContain("17 reverted excluded");
    expect(html).toContain('aria-sort="descending"');
    expect(html).not.toContain(">Status</button>");
    expect(html).toContain("Matched transfer pairs");
    expect(html).toContain("Unresolved transfer rows");
    expect(html).toContain("Show transfer review rows");
    expect(html).toContain(`value="${accountIds[0]}"`);
    expect(html).toContain(`value="${accountIds[1]}"`);
    expect(html).not.toContain("Transfer treatment");
  });

  it("distinguishes an empty search result from an empty ledger", () => {
    const summary = { linkedPairs: 0, unlinkedCount: 0, unresolvedPositiveCount: 0, unresolvedNegativeCount: 0 };
    const noMatches = renderToStaticMarkup(<MoneyActivityView activity={[]} transactionCount={10} revertedCount={0} transferReview={summary} transferReviewGroups={[]} />);
    const noImports = renderToStaticMarkup(<MoneyActivityView activity={[]} transactionCount={0} revertedCount={0} transferReview={summary} transferReviewGroups={[]} />);
    expect(noMatches).toContain("No matching activity");
    expect(noMatches).not.toContain("No transactions imported");
    expect(noImports).toContain("No transactions imported");
  });

  it("separates insufficient planning history from unresolved transfer review", () => {
    const history = renderToStaticMarkup(<MoneyPlanningCard planning={{ ready: false, unresolvedTransferCount: 0, medianMonthlyNetMinor: 0, observedMonthCount: 0, projections: [] }} />);
    const review = renderToStaticMarkup(<MoneyPlanningCard planning={{ ready: false, unresolvedTransferCount: 2, medianMonthlyNetMinor: 0, observedMonthCount: 0, projections: [] }} />);
    expect(history).toContain("Not enough history");
    expect(history).not.toContain("Scenario needs transfer review");
    expect(review).toContain("Scenario needs transfer review");
  });

  it("states the bounded spending and investment contracts", () => {
    const spending = renderToStaticMarkup(<MoneySpendingView spending={{ months: [{ month: "2026-08", observed: true, spendMinor: 350, refundsMinor: 0, incomeMinor: 0, feesMinor: 10, taxesMinor: 0, netCashFlowMinor: -360 }], categories: [{ category: "uncategorized", amountMinor: 350, count: 1 }], categoryMonths: [], merchantMonths: [], categoryActivity: [], uncategorizedCount: 1 }} />);
    const investments = renderToStaticMarkup(<MoneyInvestmentsView marketData={emptyMarketData} investments={{ positions: [], totals: { eventCount: 0, boughtMinor: 0, soldMinor: 0, incomeMinor: 0, feesMinor: 0, taxesMinor: 0 }, realized: { positions: [], totals: { saleCount: 0, proceedsMinor: 0, costBasisMinor: 0, gainMinor: 0, unmatchedSaleCount: 0 } } }} />);

    expect(spending).toContain("excluding transfers, trades, adjustments, and reverted rows");
    expect(spending).toContain("3,50");
    expect(investments).toContain("Portfolio valuation");
    expect(investments).toContain("Imported investment activity");
    expect(investments).toContain("No realized gains yet");
  });

  it("shows FIFO realized gains separately from current valuation", () => {
    const html = renderToStaticMarkup(<MoneyInvestmentsView marketData={emptyMarketData} investments={{ positions: [], totals: { eventCount: 3, boughtMinor: 20_000, soldMinor: 30_000, incomeMinor: 0, feesMinor: 0, taxesMinor: 0 }, realized: { positions: [{ symbol: "ABC", soldQuantity: "1", saleCount: 1, proceedsMinor: 30_000, costBasisMinor: 20_000, gainMinor: 10_000 }], totals: { saleCount: 1, proceedsMinor: 30_000, costBasisMinor: 20_000, gainMinor: 10_000, unmatchedSaleCount: 0 } } }} />);
    expect(html).toContain("Realized gains and losses");
    expect(html).toContain("FIFO basis");
    expect(html).toContain("+50.0%");
    expect(html).toContain("+100,00");
  });

  it("shows auditable cost basis and return for priced positions", () => {
    const html = renderToStaticMarkup(<MoneyInvestmentsView marketData={{
      asOf: "2026-08-10T12:00:00.000Z",
      positions: [{ canonicalKey: "aum5", providerKey: "AUM5.DE", name: "Amundi S&amp;P 500", assetClass: "etf", quantity: "57.339404", costBasisMinor: 567_780, close: "134.01", currency: "EUR", marketValueMinor: 768_438, unrealizedGainMinor: 200_658, priceDate: "2026-08-10", state: "fresh" }],
      history: [{ date: "2026-08-10", costBasisMinor: 567_780, knownMarketValueMinor: 768_438, knownUnrealizedGainMinor: 200_658, complete: true }],
      totals: { costBasisMinor: 567_780, knownMarketValueMinor: 768_438, knownUnrealizedGainMinor: 200_658, complete: true }
    }} investments={{ positions: [], totals: { eventCount: 0, boughtMinor: 0, soldMinor: 0, incomeMinor: 0, feesMinor: 0, taxesMinor: 0 }, realized: { positions: [], totals: { saleCount: 0, proceedsMinor: 0, costBasisMinor: 0, gainMinor: 0, unmatchedSaleCount: 0 } } }} />);

    expect(html).toContain("FIFO");
    expect(html).toContain("avg");
    expect(html).toContain("99,02");
    expect(html).toContain("+35.3%");
    expect(html).toContain("View exact portfolio data");
  });

  it("surfaces analytical confidence and actionable repairs in one data-quality view", () => {
    const html = renderToStaticMarkup(<MoneyDataView
      accounts={["cash", "broker"]}
      categoryRules={[{ id: "rule-1", accountName: "Cash", description: "Net Interest Paid to 'Instant Access Savings", category: "income", updatedAt: "2026-08-09T05:08:51.000Z" }]}
      accountRoles={{ cash: "cash", broker: "investment" }}
      accountLastObserved={{ cash: "2026-08-01", broker: "2026-08-01" }}
      imports={[{ id: "import-1", digest: "digest", format: "revolut_cash_statement_v1", filename: "cash.tsv", bytes: 1200, rowCount: 100, insertedCount: 90, duplicateCount: 10, committedAt: "2026-08-09T05:08:51.000Z", actor: "operator@example.test" }]}
      marketData={{ ...emptyMarketData, positions: [{ canonicalKey: "ETF", name: "ETF", assetClass: "etf", quantity: "1", costBasisMinor: 10_000, state: "unpriced" }], totals: { ...emptyMarketData.totals, complete: false } }}
      months={[{ date: "2026-08-01", total: 100, values: { cash: 50, broker: 50 }, observedAccounts: ["cash", "broker"] }]}
      revertedCount={2}
      spending={{ months: [], categories: [{ category: "groceries", amountMinor: 100, count: 2 }, { category: "uncategorized", amountMinor: 50, count: 1 }], categoryMonths: [], merchantMonths: [], categoryActivity: [], uncategorizedCount: 1 }}
      transactionCount={100}
      transferReview={{ linkedPairs: 4, unlinkedCount: 1, unresolvedPositiveCount: 1, unresolvedNegativeCount: 0 }}
    />);

    expect(html).toContain("Data quality summary");
    expect(html).toContain("66.7%");
    expect(html).toContain("Active category rules");
    expect(html).toContain("Net Interest Paid to &#x27;Instant Access Savings");
    expect(html).toContain("Repair queue");
    expect(html).toContain("unpriced positions");
    expect(html.match(/lucide-chevron-right/g)).toHaveLength(4);
    expect(html).toContain("focus-visible:ring-inset");
    expect(html).not.toContain("Imported formats");
    expect(html).toContain('aria-label="Delete cash.tsv"');
  });

  it("renders disambiguated balance labels instead of stable account ids", () => {
    const html = renderToStaticMarkup(<History accounts={["id-cash", "id-investment"]} accountLabels={{ "id-cash": "Duplicate · manual a1", "id-investment": "Duplicate · manual b2" }} months={[{ date: "2026-08-01", values: { "id-cash": 10, "id-investment": 20 }, observedAccounts: ["id-cash", "id-investment"], total: 30, money: 10, stocks: 20, trend: 30 }]} />);
    expect(html).toContain("Duplicate · manual a1");
    expect(html).toContain("Duplicate · manual b2");
    expect(html).not.toContain(">id-cash<");
  });

  it("labels carried balances instead of presenting them as freshly observed", () => {
    const html = renderToStaticMarkup(<History accounts={["cash", "broker"]} accountLabels={{ cash: "Cash", broker: "Broker" }} months={[{ date: "2026-08-01", values: { cash: 10, broker: 20 }, observedAccounts: ["cash"], total: 30, money: 10, stocks: 20, trend: 30 }]} />);
    expect(html).toContain("1 carried");
    expect(html).toContain("carried forward from their last observation");
  });

  it("suppresses balance changes when a later-added account leaves an endpoint incomplete", () => {
    const html = renderToStaticMarkup(<History accounts={["cash", "broker"]} accountLabels={{ cash: "Cash", broker: "Broker" }} months={[
      { date: "2026-07-01", values: { cash: 10 }, observedAccounts: ["cash"], total: 10, money: 10, stocks: 0, trend: 10 },
      { date: "2026-08-01", values: { cash: 10, broker: 20 }, observedAccounts: ["cash", "broker"], total: 30, money: 10, stocks: 20, trend: 30 }
    ]} />);
    expect(html).toContain("requires both months fully observed");
  });

  it("uses persisted account roles instead of label suffixes for allocation", () => {
    const grouped = groupMonth({ date: "2026-08-01", values: { cash: 10, investment: 20 }, observedAccounts: ["cash", "investment"], total: 30 }, { cash: "cash", investment: "investment" });
    expect(grouped).toMatchObject({ money: 10, stocks: 20 });
  });
});
