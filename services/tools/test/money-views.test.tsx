import type { ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MoneyTrackerPageData } from "../src/protected-data.js";
import { MoneyTrackerPage } from "../money/money-tracker-page.js";
import { MoneySpendingView } from "../money/money-spending-view.js";
import { MoneyReviewView } from "../money/money-review-view.js";
import { moneyReviewCounts } from "../money/money-tracker-navigation.js";

/** Currency amounts use a no-break space before the euro sign. */
const renderToStaticMarkup = (element: ReactElement) => renderMarkup(element).replaceAll("\u00a0", " ");

const currentMonth = `${new Date().toISOString().slice(0, 7)}-01`;

function pageData(overrides: Partial<MoneyTrackerPageData> = {}): MoneyTrackerPageData {
  return {
    actor: "operator@example.test",
    accounts: ["cash", "savings", "broker"],
    accountLabels: { cash: "Girokonto", savings: "Tagesgeld", broker: "Depot" },
    accountRoles: { cash: "cash", savings: "cash", broker: "investment" },
    accountLastObserved: { cash: currentMonth, savings: "2026-01-01", broker: currentMonth },
    months: [
      { date: "2026-01-01", total: 1_500, values: { cash: 1_000, savings: 500 }, observedAccounts: ["cash", "savings"] },
      { date: currentMonth, total: 3_700, values: { cash: 1_200, savings: 500, broker: 2_000 }, observedAccounts: ["cash", "broker"] },
    ],
    imports: [],
    activity: [],
    transactionCount: 0,
    revertedCount: 0,
    currentMonthTransactionAccounts: [],
    transferReview: { linkedPairs: 0, unlinkedCount: 0, unresolvedPositiveCount: 0, unresolvedNegativeCount: 0 },
    transferReviewGroups: [],
    categoryRules: [],
    transferRules: [],
    transferPairRules: [],
    transferRuleOptions: [],
    spending: { months: [], categories: [], categoryMonths: [], merchantMonths: [], categoryActivity: [], uncategorizedCount: 0 },
    investments: { positions: [], trades: [], totals: { eventCount: 0, boughtMinor: 0, soldMinor: 0, incomeMinor: 0, feesMinor: 0, taxesMinor: 0 }, realized: { positions: [], totals: { saleCount: 0, proceedsMinor: 0, costBasisMinor: 0, gainMinor: 0, unmatchedSaleCount: 0 } } },
    planning: { ready: false, unresolvedTransferCount: 0, medianMonthlyNetMinor: 0, observedMonthCount: 0, projections: [] },
    reviewCounts: { uncategorized: 0, transfers: 0 },
    reviewQueue: { items: [], commonCategories: [] },
    marketData: { asOf: "2026-08-10T12:00:00.000Z", positions: [], history: [], totals: { costBasisMinor: 0, knownMarketValueMinor: 0, knownUnrealizedGainMinor: 0, complete: true } },
    ...overrides,
  };
}

const spending: MoneyTrackerPageData["spending"] = {
  months: [
    { month: "2026-06", observed: true, spendMinor: 200_000, refundsMinor: 0, incomeMinor: 400_000, feesMinor: 500, taxesMinor: 0, netCashFlowMinor: 199_500 },
    { month: "2026-07", observed: true, spendMinor: 300_000, refundsMinor: 5_000, incomeMinor: 400_000, feesMinor: 0, taxesMinor: 0, netCashFlowMinor: 105_000 },
  ],
  categories: [],
  categoryMonths: [
    { month: "2026-06", category: "groceries", amountMinor: 40_000, count: 8 },
    { month: "2026-07", category: "groceries", amountMinor: 50_000, count: 9 },
    { month: "2026-07", category: "travel", amountMinor: 120_000, count: 2 },
    { month: "2026-07", category: "uncategorized", amountMinor: 3_000, count: 1 },
  ],
  merchantMonths: [
    { month: "2026-07", category: "groceries", description: "BILLA", amountMinor: 30_000, count: 6 },
    { month: "2026-07", category: "groceries", description: "SPAR", amountMinor: 20_000, count: 3 },
  ],
  categoryActivity: [],
  uncategorizedCount: 1,
};

describe("Money redesign views", () => {
  it("opens Overview with net worth, the parts, and one review line", () => {
    const html = renderToStaticMarkup(<MoneyTrackerPage {...pageData({ reviewCounts: { uncategorized: 4, transfers: 2 }, spending })} view="overview" />);
    expect(html).toContain("Known net worth");
    expect(html).toContain("1.700 €");
    expect(html).toMatch(/Review needed\..*4 uncategorized rows, 2 transfers to classify, 1 old balance/s);
    expect(html).toContain('href="/money?view=review"');
    expect(html).toContain("View net worth as a table");
    expect(html).toContain("Jul 2026 by category");
    expect(html).toContain("30 € is uncategorized");
    expect(html).toContain("No check-in yet");
  });

  it("plots combined, market, and cash history together", () => {
    const base = pageData();
    const html = renderToStaticMarkup(<MoneyTrackerPage {...pageData({
      marketData: {
        ...base.marketData,
        history: [
          { date: "2026-01-01", costBasisMinor: 100_000, knownMarketValueMinor: 100_000, knownUnrealizedGainMinor: 0, target7PercentMinor: 100_000, complete: true },
          { date: currentMonth, costBasisMinor: 100_000, knownMarketValueMinor: 200_000, knownUnrealizedGainMinor: 100_000, target7PercentMinor: 100_000, complete: true },
        ],
      },
    })} view="overview" />);
    expect(html).toMatch(/Combined<\/span>.*Market<\/span>.*Cash<\/span>/s);
    expect(html).toContain("Combined net worth, market, and cash from");
    expect(html.match(/class="money-series"/g)).toHaveLength(3);
    expect(html).toMatch(/<th class="num">Cash<\/th><th class="num">Market<\/th><th class="num">Combined<\/th>/);
  });

  it("marks old balances in Accounts and offers the update in the row", () => {
    const html = renderToStaticMarkup(<MoneyTrackerPage {...pageData()} view="accounts" />);
    expect(html).toContain("Girokonto");
    expect(html).toContain("1 balance is older");
    expect(html).toMatch(/Tagesgeld[\s\S]*text-warning[^>]*>Jan 26/);
    expect(html.match(/>Update</g)).toHaveLength(2);
    expect(html).toContain("Monthly snapshots (2)");
    expect(html).toContain("1 carried");
  });

  it("explains why Plan needs more history", () => {
    const html = renderToStaticMarkup(<MoneyTrackerPage {...pageData()} view="plan" />);
    expect(html).toContain("Not enough history");
  });

  it("filters Spending categories and shows the selected category detail", () => {
    const html = renderToStaticMarkup(<MoneySpendingView spending={spending} transferReview={{ linkedPairs: 0, unlinkedCount: 1, unresolvedPositiveCount: 0, unresolvedNegativeCount: 3 }} reviewCounts={{ uncategorized: 1, transfers: 3 }} initialCategory="groceries" />);
    expect(html).toContain("Jun 2026 – Jul 2026 · 2 complete months");
    expect(html).toContain("5.000 €");
    expect(html).toContain("+3.045 €");
    expect(html).toContain("Review 1 rows");
    expect(html).toContain("3 transfers still need a treatment.");
    expect(html).toMatch(/aria-selected="true"[\s\S]*Groceries/);
    expect(html).toMatch(/Travel[\s\S]*1\.200 €/);
    expect(html).toContain("View monthly cash flow as a table");
    expect(html).toMatch(/Largest merchants[\s\S]*BILLA[\s\S]*SPAR/);
    expect(html).toContain("fromMonth=2026-06&amp;toMonth=2026-07");
  });

  it("puts categories, transfers, prices, and balances in one Review queue", () => {
    const item = { id: "t-1", occurredAt: "2026-09-24T10:00:00.000Z", accountName: "Revolut", description: "SQ *MARKT STAND", amountMinor: -2_340, feeMinor: 0, taxMinor: 0, currency: "EUR", status: "completed" as const, sourceType: "Card Payment", flowKind: "spend" as const, category: "uncategorized" as const, categoryOrigin: "source" as const, needsTransferReview: false };
    const html = renderToStaticMarkup(<MoneyReviewView {...pageData({
      reviewCounts: { uncategorized: 41, transfers: 2, spendingRows: 2_000, sourceOtherRows: 37 },
      reviewQueue: { items: [{ ...item, similarCount: 3, suggestions: ["groceries"] }], commonCategories: ["groceries", "dining", "shopping"] },
      transferReviewGroups: [{ representativeId: "g-1", accountName: "Sparkasse", description: "Revolut card funding", sourceType: "Transfer", direction: "outflow", currency: "EUR", count: 2, totalMinor: -50_000, items: [{ ...item, id: "g-1", description: "Revolut card funding", flowKind: "transfer", category: "transfer", amountMinor: -25_000, needsTransferReview: true }, { ...item, id: "g-2", description: "Revolut card funding", flowKind: "transfer", category: "transfer", amountMinor: -25_000, needsTransferReview: true }] }],
      marketData: { ...pageData().marketData, positions: [{ canonicalKey: "asml", name: "ASML", assetClass: "equity", quantity: "1", costBasisMinor: 70_000, state: "stale", priceDate: "2026-09-13" }] },
    })} tab="queue" />);
    expect(html).toContain("Drop statements here");
    expect(html).toMatch(/Groceries[\s\S]*Dining[\s\S]*Shopping/);
    expect(html).toContain("This transaction");
    expect(html).toContain("This merchant description in Revolut: 3 other rows and future imports");
    expect(html).toContain("41 of 2,000 spending and refund rows need a category (2.1%)");
    expect(html).toContain("37 spending and refund rows have the generic source category Other");
    expect(html).toContain("Showing the newest 1 of 41.");
    expect(html).toContain("Apply to 2 rows");
    expect(html).toMatch(/Own transfer[\s\S]*Spending[\s\S]*Income[\s\S]*Refund[\s\S]*Leave out/);
    expect(html).toContain("Price from 13 Sep");
    expect(html).toMatch(/Tagesgeld[\s\S]*Last balance Jan 2026/);
  });

  it("reads review counts defensively", () => {
    expect(moneyReviewCounts({ reviewCounts: { uncategorized: 2, transfers: 1 } })).toEqual({ uncategorized: 2, transfers: 1 });
    expect(moneyReviewCounts({ reviewCounts: { uncategorized: "2" } })).toBeUndefined();
    expect(moneyReviewCounts(undefined)).toBeUndefined();
  });
});
