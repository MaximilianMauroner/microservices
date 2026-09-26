import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyActivityView, MoneyImportHistory, MoneyInvestmentsView, portfolioChartPoints, portfolioMovingAverage } from "../money/money-ledger-views.js";
import { MoneyRulesView } from "../money/money-rules-view.js";
import { groupMonth } from "../money/money-history.js";

/** Currency amounts use a no-break space before the euro sign. */
const renderToStaticMarkup = (element: ReactElement) => renderMarkup(element).replaceAll("\u00a0", " ");

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
    accountName: "Sparkasse",
    description: "Revolut card funding",
    amountMinor: -25_000,
    feeMinor: 0,
    taxMinor: 0,
    currency: "EUR",
    status: "completed" as const,
    sourceType: "Transfer",
    flowKind: "transfer" as const,
    category: "transfer" as const,
    categoryOrigin: "source" as const,
    needsTransferReview: true
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
    category: "transfer" as const,
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

const noInvestments = { positions: [], trades: [], totals: { eventCount: 0, boughtMinor: 0, soldMinor: 0, incomeMinor: 0, feesMinor: 0, taxesMinor: 0 }, realized: { positions: [], totals: { saleCount: 0, proceedsMinor: 0, costBasisMinor: 0, gainMinor: 0, unmatchedSaleCount: 0 } } };

describe("Money transactions", () => {
  it("edits categories in the row and sends transfers to review", () => {
    const accountIds = ["00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"];
    const html = renderToStaticMarkup(<MoneyActivityView activity={activity} accounts={accountIds} accountLabels={{ [accountIds[0]!]: "Savings", [accountIds[1]!]: "Savings" }} transactionCount={8_030} reviewCounts={{ uncategorized: 3, transfers: 2 }} />);

    expect(html).toContain("8,030 rows");
    expect(html).toContain("Coffee");
    expect(html).toContain('aria-label="Category for Coffee: Uncategorized"');
    expect(html).toContain("Choose category");
    expect(html).toMatch(/href="\/money\?view=review"[^>]*>Transfer to classify/);
    expect(html).toContain("matched transfer");
    expect(html).toMatch(/Needs review.*>5</s);
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain(`value="${accountIds[0]}"`);
    expect(html).toContain(`value="${accountIds[1]}"`);
    expect(html).toContain("−3,50 €");
    expect(html).toContain("0,10 € costs");
  });

  it("distinguishes an empty search result from an empty ledger", () => {
    const counts = { uncategorized: 0, transfers: 0 };
    const noMatches = renderToStaticMarkup(<MoneyActivityView activity={[]} transactionCount={10} reviewCounts={counts} />);
    const noImports = renderToStaticMarkup(<MoneyActivityView activity={[]} transactionCount={0} reviewCounts={counts} />);
    const noReview = renderToStaticMarkup(<MoneyActivityView activity={[]} transactionCount={10} reviewCounts={counts} initialReviewOnly />);
    expect(noMatches).toContain("No matching rows");
    expect(noImports).toContain("No transactions imported");
    expect(noReview).toContain("Nothing to review");
  });

  it("opens with URL filters applied", () => {
    const html = renderToStaticMarkup(<MoneyActivityView activity={activity} transactionCount={3} reviewCounts={{ uncategorized: 1, transfers: 1 }} initialCategory="groceries" initialReviewOnly />);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Needs review/);
    expect(html).toMatch(/value="groceries" selected/);
  });
});

describe("Money investments", () => {
  it("folds FIFO realized gains below the current positions", () => {
    const html = renderToStaticMarkup(<MoneyInvestmentsView marketData={emptyMarketData} investments={{ ...noInvestments, totals: { ...noInvestments.totals, eventCount: 3, boughtMinor: 20_000, soldMinor: 30_000 }, realized: { positions: [{ symbol: "ABC", soldQuantity: "1", saleCount: 1, proceedsMinor: 30_000, costBasisMinor: 20_000, gainMinor: 10_000 }], totals: { saleCount: 1, proceedsMinor: 30_000, costBasisMinor: 20_000, gainMinor: 10_000, unmatchedSaleCount: 0 } } }} />);
    expect(html).toMatch(/<details class="money-twin"><summary>Realized gains · 1 matched sale · \+100 €/);
    expect(html).toContain("FIFO basis");
    expect(html).toContain("+50.0%");
    expect(html).toContain("No open positions");
    expect(html).toContain("No valuation history yet");
  });

  it("shows weight, gain, and old prices for positions", () => {
    const html = renderToStaticMarkup(<MoneyInvestmentsView marketData={{
      asOf: "2026-08-10T12:00:00.000Z",
      positions: [
        { canonicalKey: "aum5", providerKey: "AUM5.DE", name: "Amundi S&P 500", assetClass: "etf", quantity: "57.339404", costBasisMinor: 567_780, close: "134.01", currency: "EUR", marketValueMinor: 768_438, unrealizedGainMinor: 200_658, priceDate: "2026-08-10", state: "fresh" },
        { canonicalKey: "asml", providerKey: "ASML.AS", name: "ASML", assetClass: "equity", quantity: "2", costBasisMinor: 150_000, close: "700", currency: "EUR", marketValueMinor: 140_000, unrealizedGainMinor: -10_000, priceDate: "2026-07-30", state: "stale" }
      ],
      history: [{ date: "2026-08-10", costBasisMinor: 717_780, knownMarketValueMinor: 908_438, knownUnrealizedGainMinor: 190_658, inflationBenchmarkMinor: 740_000, target7PercentMinor: 760_000, complete: true }],
      totals: { costBasisMinor: 717_780, knownMarketValueMinor: 908_438, knownUnrealizedGainMinor: 190_658, complete: true }
    }} investments={noInvestments} />);

    expect(html).toContain("+35.3%");
    expect(html).toContain("84.6%");
    expect(html).toContain("Price from 30 Jul");
    expect(html).toContain("1 without a current price");
    expect(html).toContain("View portfolio values as a table");
    expect(html).toMatch(/Largest.*Amundi S&amp;P 500 84\.6%/s);
    expect(html).toContain("Growth against inflation and the 7% target");
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

  it("uses the trailing 90 calendar days for the portfolio trendline", () => {
    const points = portfolioMovingAverage([
      { date: "2026-01-01", marketValue: 100, costBasis: 100, target7Percent: 100 },
      { date: "2026-03-31", marketValue: 200, costBasis: 100, target7Percent: 101 },
      { date: "2026-04-01", marketValue: 300, costBasis: 100, target7Percent: 102 }
    ]);
    expect(points.map((point) => point.movingAverage90)).toEqual([100, 150, 250]);
  });
});

describe("Money rules and imports", () => {
  it("lists automatic category and transfer rules", () => {
    const html = renderToStaticMarkup(<MoneyRulesView
      accounts={["cash", "broker"]}
      accountLabels={{ cash: "Cash account", broker: "Broker account" }}
      accountRoles={{ cash: "cash", broker: "investment" }}
      categoryRules={[{ id: "rule-1", accountName: "Cash", description: "Net Interest Paid to 'Instant Access Savings", category: "income", updatedAt: "2026-08-09T05:08:51.000Z" }]}
      transferRules={[{ id: "transfer-rule-1", priority: 700, provider: "revolut", sourceType: "Topup", descriptionMatch: "starts_with", matchValue: "top-up by *", amountSign: "any", disposition: "internal_transfer", note: "Own card top-ups" }]}
      transferPairRules={[{ id: "pair-rule-1", debitProvider: "sparkasse", debitSourceType: "BEZAHLUNG EU LAENDER", debitMatchValue: "wallet", creditProvider: "revolut", creditSourceType: "Topup" }]}
      transferRuleOptions={[{ provider: "revolut", sourceType: "Topup", count: 12, unresolvedCount: 2 }]}
      transferReview={{ linkedPairs: 4, unlinkedCount: 2, unresolvedPositiveCount: 1, unresolvedNegativeCount: 1 }}
    />);

    expect(html).toContain("Create a category rule");
    expect(html).toContain("Net Interest Paid to &#x27;Instant Access Savings");
    expect(html).toContain("Create a transfer rule");
    expect(html).toContain("Own card top-ups");
    expect(html).toContain("Own-account transfer");
    expect(html).toContain("Pair card funding");
    expect(html).toContain("Topup · 2 unresolved");
  });

  it("lists every import with its own delete action", () => {
    const html = renderToStaticMarkup(<MoneyImportHistory imports={Array.from({ length: 6 }, (_, index) => ({ id: `import-${index}`, digest: `digest-${index}`, format: "revolut_cash_statement_v1", filename: `cash-${index}.tsv`, bytes: 1200, rowCount: 100, insertedCount: 90, duplicateCount: 10, committedAt: "2026-08-09T05:08:51.000Z", actor: "operator@example.test" }))} />);
    expect(html).toContain('aria-label="Delete cash-0.tsv"');
    expect(html).toContain('aria-label="Delete cash-5.tsv"');
    expect(html).toContain("Rebuild data");
    expect(html).toContain("revolut cash statement · 1.2 KB");
  });

  it("uses persisted account roles instead of label suffixes for allocation", () => {
    const grouped = groupMonth({ date: "2026-08-01", values: { cash: 10, investment: 20 }, observedAccounts: ["cash", "investment"], total: 30 }, { cash: "cash", investment: "investment" });
    expect(grouped).toMatchObject({ money: 10, stocks: 20 });
  });
});
