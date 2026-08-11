import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyActivityView, MoneyDataView, MoneyInvestmentsView, MoneyPlanningCard, MoneySpendingView, portfolioChartPoints } from "../money/money-ledger-views.js";
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
    expect(html).toContain('aria-label="Category for Coffee"');
    expect(html).toContain("Uncategorized");
    expect(html).toContain('data-slot="popover-trigger"');
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

  it("opens directly into URL-selected repair queues", () => {
    const html = renderToStaticMarkup(<MoneyActivityView activity={activity} transactionCount={3} revertedCount={0} transferReview={{ linkedPairs: 0, unlinkedCount: 1, unresolvedPositiveCount: 1, unresolvedNegativeCount: 0 }} transferReviewGroups={[]} initialCategory="uncategorized" initialReviewOnly />);
    expect(html).toContain("Show all activity");
    expect(html).toContain("Grouped transfer review");
    expect(html).toMatch(/option value="uncategorized" selected/);
  });

  it("opens exact grouped transfer details with bulk range-selection controls", () => {
    const transferItems = [
      { ...activity[1]!, id: "review-1", status: "completed" as const, description: "Revolut card funding", amountMinor: -25_000, needsTransferReview: true },
      { ...activity[1]!, id: "review-2", status: "completed" as const, description: "Revolut card funding", amountMinor: -25_000, needsTransferReview: true }
    ];
    const html = renderToStaticMarkup(<MoneyActivityView activity={activity} transactionCount={3} revertedCount={0} transferReview={{ linkedPairs: 0, unlinkedCount: 2, unresolvedPositiveCount: 0, unresolvedNegativeCount: 2 }} transferReviewGroups={[{ representativeId: "review-1", accountName: "Sparkasse · 0004", description: "Revolut card funding", sourceType: "BEZAHLUNG EU LAENDER", direction: "outflow", currency: "EUR", count: 2, totalMinor: -50_000, items: transferItems }]} initialReviewOnly />);
    expect(html).toContain("2 exact unresolved rows");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Shift-click another to select the range");
    expect(html).toContain('aria-label="Select all 2 rows"');
    expect(html).toContain("Apply to 0");
  });

  it("shows scenarios with unresolved transfers excluded and only blocks on insufficient history", () => {
    const history = renderToStaticMarkup(<MoneyPlanningCard planning={{ ready: false, unresolvedTransferCount: 0, medianMonthlyNetMinor: 0, observedMonthCount: 0, projections: [] }} />);
    const scenario = renderToStaticMarkup(<MoneyPlanningCard planning={{ ready: true, unresolvedTransferCount: 2, medianMonthlyNetMinor: 1_000, observedMonthCount: 6, projections: [{ months: 6, changeMinor: 6_000 }, { months: 12, changeMinor: 12_000 }, { months: 60, changeMinor: 60_000 }] }} />);
    expect(history).toContain("Not enough history");
    expect(scenario).toContain("Simple 6-month run rate");
    expect(scenario).toContain("Simple 5-year run rate");
    expect(scenario).toContain("2 unresolved transfer rows excluded");
    expect(scenario).not.toContain("Scenario needs transfer review");
  });

  it("states the bounded spending and investment contracts", () => {
    const spending = renderToStaticMarkup(<MoneySpendingView spending={{ months: [{ month: "2026-08", observed: true, spendMinor: 350, refundsMinor: 0, incomeMinor: 0, feesMinor: 10, taxesMinor: 0, netCashFlowMinor: -360 }], categories: [{ category: "uncategorized", amountMinor: 350, count: 1 }], categoryMonths: [], merchantMonths: [], categoryActivity: [], uncategorizedCount: 1 }} transferReview={{ linkedPairs: 0, unlinkedCount: 0, unresolvedPositiveCount: 0, unresolvedNegativeCount: 0 }} />);
    const investments = renderToStaticMarkup(<MoneyInvestmentsView marketData={emptyMarketData} investments={{ positions: [], trades: [], totals: { eventCount: 0, boughtMinor: 0, soldMinor: 0, incomeMinor: 0, feesMinor: 0, taxesMinor: 0 }, realized: { positions: [], totals: { saleCount: 0, proceedsMinor: 0, costBasisMinor: 0, gainMinor: 0, unmatchedSaleCount: 0 } } }} />);

    expect(spending).toContain("excluding transfers, trades, adjustments, and reverted rows");
    expect(spending).toContain("3,50");
    expect(spending).toMatch(/>12M<.*>5Y<.*>All</);
    expect(investments).toContain("Portfolio valuation");
    expect(investments).toMatch(/>1Y<.*>5Y<.*>All</);
    expect(investments).toContain("Imported investment activity");
    expect(investments).toContain("No realized gains yet");
  });

  it("qualifies incomplete cash flow and shows uncategorized financial impact", () => {
    const html = renderToStaticMarkup(<MoneySpendingView spending={{ months: [{ month: "2026-07", observed: true, spendMinor: 1_000, refundsMinor: 0, incomeMinor: 2_000, feesMinor: 0, taxesMinor: 0, netCashFlowMinor: 1_000 }], categories: [{ category: "uncategorized", amountMinor: 750, count: 3 }], categoryMonths: [], merchantMonths: [], categoryActivity: [], uncategorizedCount: 3 }} transferReview={{ linkedPairs: 2, unlinkedCount: 4, unresolvedPositiveCount: 3, unresolvedNegativeCount: 1 }} />);
    expect(html).toContain("Cash flow is incomplete");
    expect(html).toContain("4 transfer rows still need treatment");
    expect(html).toContain("Classified net flow");
    expect(html).toContain("Uncategorized spending");
    expect(html).toContain("7,50");
  });

  it("shows FIFO realized gains separately from current valuation", () => {
    const html = renderToStaticMarkup(<MoneyInvestmentsView marketData={emptyMarketData} investments={{ positions: [], trades: [], totals: { eventCount: 3, boughtMinor: 20_000, soldMinor: 30_000, incomeMinor: 0, feesMinor: 0, taxesMinor: 0 }, realized: { positions: [{ symbol: "ABC", soldQuantity: "1", saleCount: 1, proceedsMinor: 30_000, costBasisMinor: 20_000, gainMinor: 10_000 }], totals: { saleCount: 1, proceedsMinor: 30_000, costBasisMinor: 20_000, gainMinor: 10_000, unmatchedSaleCount: 0 } } }} />);
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
    }} investments={{ positions: [], trades: [], totals: { eventCount: 0, boughtMinor: 0, soldMinor: 0, incomeMinor: 0, feesMinor: 0, taxesMinor: 0 }, realized: { positions: [], totals: { saleCount: 0, proceedsMinor: 0, costBasisMinor: 0, gainMinor: 0, unmatchedSaleCount: 0 } } }} />);

    expect(html).toContain("FIFO");
    expect(html).toContain("avg");
    expect(html).toContain("99,02");
    expect(html).toContain("+35.3%");
    expect(html).toContain("View exact portfolio data");
    expect(html).toContain("Allocation and concentration");
    expect(html).toContain("Largest position");
    expect(html).not.toContain("Yahoo closes");
    expect(html).not.toContain("ECB USD/EUR");
  });

  it("bounds portfolio graph points while preserving trade markers and basis changes", () => {
    const history = Array.from({ length: 2_000 }, (_, index) => ({
      date: `2020-01-${String(index + 1).padStart(4, "0")}`,
      marketValue: index,
      costBasis: index < 1_000 ? 500 : 750
    }));
    const trades = [
      { date: history[700]!.date, eventKind: "buy" as const, symbol: "ETF", quantity: "1", amountMinor: 10_000, feeMinor: 0, currency: "EUR" },
      { date: "9999-12-31", eventKind: "sell" as const, symbol: "ETF", quantity: "1", amountMinor: 12_000, feeMinor: 0, currency: "EUR" }
    ];

    const points = portfolioChartPoints(history, trades);

    expect(points.length).toBeLessThanOrEqual(480);
    expect(points[0]?.date).toBe(history[0]!.date);
    expect(points.at(-1)?.date).toBe(history.at(-1)!.date);
    expect(points.find((point) => point.date === history[700]!.date)?.buyMarker).toBeDefined();
    expect(points.at(-1)?.sellMarker).toBeDefined();
    expect(points.some((point) => point.date === history[999]!.date)).toBe(true);
    expect(points.some((point) => point.date === history[1_000]!.date)).toBe(true);
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
    expect(html).toContain("/money?view=transactions&amp;category=uncategorized");
    expect(html).toContain("/money?view=transactions&amp;review=true");
    expect(html).toContain("positions need pricing attention");
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
    expect(html).toContain("1 reused");
    expect(html).toContain("most recent earlier balance was used");
    expect(html).not.toContain('data-variant="destructive"');
  });

  it("suppresses balance changes when a later-added account leaves an endpoint incomplete", () => {
    const html = renderToStaticMarkup(<History accounts={["cash", "broker"]} accountLabels={{ cash: "Cash", broker: "Broker" }} months={[
      { date: "2026-07-01", values: { cash: 10 }, observedAccounts: ["cash"], total: 10, money: 10, stocks: 0, trend: 10 },
      { date: "2026-08-01", values: { cash: 10, broker: 20 }, observedAccounts: ["cash", "broker"], total: 30, money: 10, stocks: 20, trend: 30 }
    ]} />);
    expect(html).toContain("Not comparable: account coverage changed");
  });

  it("uses persisted account roles instead of label suffixes for allocation", () => {
    const grouped = groupMonth({ date: "2026-08-01", values: { cash: 10, investment: 20 }, observedAccounts: ["cash", "investment"], total: 30 }, { cash: "cash", investment: "investment" });
    expect(grouped).toMatchObject({ money: 10, stocks: 20 });
  });
});
