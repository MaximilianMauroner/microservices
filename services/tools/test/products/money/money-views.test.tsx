// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import * as Router from "@tanstack/react-router";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MoneyTrackerPageData } from "../../../platform/protected-data.js";
import { MoneyTrackerPage } from "../../../products/money/money-tracker-page.js";
import { MoneySpendingView } from "../../../products/money/money-spending-view.js";
import { MoneyReviewView } from "../../../products/money/money-review-view.js";
import { preloadMoneyView } from "../../../products/money/money-view-loading.js";
import { moneyReviewCounts } from "../../../products/money/money-tracker-navigation.js";
import { FlowChart, MonthBars, SparkBars } from "../../../products/money/money-ui.js";

vi.mock("../../../platform/ui/components/ui/use-mobile.js", () => ({ useIsMobile: () => false }));

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
    deprecatedAccountIds: [],
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
    { month: "2026-07", observed: true, spendMinor: 295_000, refundsMinor: 5_000, incomeMinor: 400_000, feesMinor: 0, taxesMinor: 0, netCashFlowMinor: 105_000 },
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
    expect(html).toContain("Review needed.");
    expect(html).toContain("4 uncategorized rows");
    expect(html).toContain("2 transfers to classify");
    expect(html).toContain("1 old balance");
    expect(html).toContain('href="/money?view=review"');
    expect(html).toContain("View net worth as a table");
    expect(html).toContain("Jul 2026 by category");
    expect(html).toContain("30 € is uncategorized");
    expect(html).toContain("No check-in yet");
  });

  it("shows the cached price date, not the snapshot time, in the freshness line", () => {
    const html = renderToStaticMarkup(<MoneyTrackerPage {...pageData({
      marketData: {
        ...pageData().marketData,
        asOf: "2026-08-10T12:00:00.000Z",
        positions: [{ canonicalKey: "asml", name: "ASML", assetClass: "equity", quantity: "1", costBasisMinor: 70_000, state: "stale", priceDate: "2026-08-01" }],
      },
    })} view="overview" />);
    expect(html).toContain("prices 1 Aug");
    expect(html).not.toContain("prices 10 Aug");
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
    expect(html).toContain("View net worth as a table");
    expect(html).not.toContain('<th class="num">Combined</th>');
  });

  it("marks old balances in Accounts and offers the update in the row", () => {
    const html = renderToStaticMarkup(<MoneyTrackerPage {...pageData()} view="accounts" />);
    expect(html).toContain("Girokonto");
    expect(html).toContain("1 balance is older");
    expect(html).toMatch(/Tagesgeld[\s\S]*text-warning[^>]*>Jan 26/);
    expect(html.match(/>Update</g)).toHaveLength(2);
    expect(html).toContain("Monthly snapshots (2)");
    expect(html).not.toContain("1 carried");
  });

  it("keeps deprecated accounts out of active counts and stale work while retaining history and filters", () => {
    const data = pageData({ deprecatedAccountIds: ["savings"] });
    const accounts = renderToStaticMarkup(<MoneyTrackerPage {...data} view="accounts" />);
    const host = document.createElement("div");
    host.innerHTML = accounts;
    const balances = host.querySelector('table[aria-label="Account balances"]')!;
    expect(balances.textContent).toContain("Girokonto");
    expect(balances.textContent).not.toContain("Tagesgeld");
    expect(host.querySelector('[aria-label="Restore Tagesgeld"]')).not.toBeNull();
    expect(accounts).toContain("Deprecated accounts");
    expect(accounts).toContain("2 of 2");
    expect(accounts).toContain("All current");
    expect(accounts).not.toContain("balance is older");
    expect(accounts).toMatch(/Cash[\s\S]*1 account/);
    const overview = renderToStaticMarkup(<MoneyTrackerPage {...data} view="overview" />);
    const original = renderToStaticMarkup(<MoneyTrackerPage {...pageData()} view="overview" />);
    expect(overview).not.toContain("1 old balance");
    expect(overview).not.toContain("1 balance carried");
    expect(overview).toContain("1.700 €");
    expect(original).toContain("1.700 €");
    expect(overview).toContain("Combined net worth, market, and cash from");
    expect(renderToStaticMarkup(<MoneyReviewView {...data} tab="queue" />)).not.toContain("Tagesgeld");
    expect(accounts).toContain("Monthly snapshots (2)");
  });

  it("offers deprecation only for a known, exactly zero cash balance", () => {
    const data = pageData({
      accounts: ["zero", "positive", "negative", "unknown", "tiny", "broker"],
      accountRoles: { zero: "cash", positive: "cash", negative: "cash", unknown: "cash", tiny: "cash", broker: "investment" },
      months: [{ date: currentMonth, total: 0, values: { zero: 0, positive: 1, negative: -1, tiny: 0.001, broker: 0 }, observedAccounts: [] }],
    });
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<MoneyTrackerPage {...data} view="accounts" />);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Deprecate zero"]')!.disabled).toBe(false);
    for (const account of ["positive", "negative", "unknown", "tiny"]) {
      const button = host.querySelector<HTMLButtonElement>(`[aria-label="Deprecate ${account}"]`)!;
      expect(button.disabled).toBe(true);
      expect(host.querySelector(`[id="${button.getAttribute("aria-describedby")}"]`)?.textContent).toMatch(/zero/);
    }
    expect(host.querySelector('[aria-label="Deprecate Depot"]')).toBeNull();
  });

  it("saves deprecation and restoration, shows server errors, and blocks duplicate actions while busy", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const invalidate = vi.fn(async () => {});
    const router = vi.spyOn(Router, "useRouter").mockReturnValue({ invalidate } as unknown as ReturnType<typeof Router.useRouter>);
    let finishRequest!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const data = pageData({
      deprecatedAccountIds: ["savings"],
      months: [{ date: currentMonth, total: 0, values: { cash: 0, savings: 0 }, observedAccounts: ["cash"] }],
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<MoneyTrackerPage {...data} view="accounts" />));
      const update = [...host.querySelectorAll("button")].find((button) => button.textContent === "Update")!;
      await act(async () => update.click());
      expect(host.querySelector('form[aria-label="New balance for Girokonto"]')).not.toBeNull();
      expect(fetch).not.toHaveBeenCalled();
      await act(async () => update.click());
      const deprecate = host.querySelector<HTMLButtonElement>('[aria-label="Deprecate Girokonto"]')!;
      const restore = host.querySelector<HTMLButtonElement>('[aria-label="Restore Tagesgeld"]')!;
      fetch.mockImplementationOnce(() => new Promise((resolve) => { finishRequest = resolve; }));
      await act(async () => deprecate.click());
      expect(deprecate.disabled).toBe(true);
      expect(restore.disabled).toBe(true);
      expect(host.textContent).toContain("Saving…");
      expect(fetch).toHaveBeenCalledWith("/api/money/accounts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: "cash", deprecated: true }),
      });
      expect(invalidate).not.toHaveBeenCalled();
      await act(async () => finishRequest(Response.json({ message: "The latest balance is no longer zero." }, { status: 409 })));
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("no longer zero");
      expect(deprecate.disabled).toBe(false);
      expect(invalidate).not.toHaveBeenCalled();
      fetch.mockResolvedValueOnce(Response.json({ ok: true }));
      await act(async () => deprecate.click());
      expect(invalidate).toHaveBeenCalledOnce();
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await act(async () => root.render(<MoneyTrackerPage {...data} deprecatedAccountIds={["cash", "savings"]} view="accounts" />));
      expect(host.querySelector('table[aria-label="Account balances"]')?.textContent).not.toContain("Girokonto");
      fetch.mockResolvedValueOnce(Response.json({ ok: true }));
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Restore Tagesgeld"]')!.click());
      expect(fetch).toHaveBeenLastCalledWith("/api/money/accounts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: "savings", deprecated: false }),
      });
      expect(invalidate).toHaveBeenCalledTimes(2);
      await act(async () => root.render(<MoneyTrackerPage {...data} deprecatedAccountIds={["cash"]} view="accounts" />));
      expect(host.querySelector('table[aria-label="Account balances"]')?.textContent).toContain("Tagesgeld");
      expect(host.querySelector('[aria-label="Restore Tagesgeld"]')).toBeNull();
      expect(host.textContent).toContain("1 balance is older");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      router.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("keeps deprecated history selectable, snapshot totals, and transaction filters", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    const fetch = vi.fn(async () => Response.json({ items: [], total: 0, hasMore: false }));
    vi.stubGlobal("fetch", fetch);
    const data = pageData({ deprecatedAccountIds: ["savings"] });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<MoneyTrackerPage {...data} view="accounts" />));
      const snapshots = [...host.querySelectorAll("details")].find((details) => details.textContent?.includes("Monthly snapshots"))!;
      await act(async () => { snapshots.open = true; snapshots.dispatchEvent(new Event("toggle")); });
      expect(snapshots.textContent?.replaceAll("\u00a0", " ")).toContain("3.700 €");
      expect(snapshots.textContent?.replaceAll("\u00a0", " ")).toContain("1.500 €");
      const account = [...host.querySelectorAll("button")].find((button) => button.textContent === "Tagesgeld")!;
      await act(async () => account.click());
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("accountId=savings"), expect.anything());
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Tagesgeld");
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("No transactions imported for this account.");
      await preloadMoneyView("transactions");
      await act(async () => root.render(<MoneyTrackerPage {...data} view="transactions" />));
      const filter = host.querySelector<HTMLSelectElement>('select[aria-label="Filter by account"]')!;
      expect(filter.querySelector('option[value="savings"]')?.textContent).toBe("Tagesgeld");
      await act(async () => { filter.value = "savings"; filter.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("accountId=savings"));
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("explains why Plan needs more history", () => {
    const html = renderToStaticMarkup(<MoneyTrackerPage {...pageData()} view="plan" />);
    expect(html).toContain("Not enough history");
  });

  it("filters Spending categories and shows the selected category detail", () => {
    const html = renderToStaticMarkup(<MoneySpendingView spending={spending} transferReview={{ linkedPairs: 0, unlinkedCount: 1, unresolvedPositiveCount: 0, unresolvedNegativeCount: 3 }} reviewCounts={{ uncategorized: 1, transfers: 3 }} initialCategory="groceries" />);
    expect(html).toContain("Jun 2026 – Jul 2026 · 2 complete months");
    expect(html).toContain("4.950 €");
    expect(html).toContain("8.000 €");
    expect(html).not.toContain("8.050 €");
    expect(html).toContain("Refunds lower spending");
    expect(html).toContain("+3.045 €");
    expect(html).toContain("Review 1");
    expect(html).toContain("3 transfers still need a treatment.");
    expect(html).toMatch(/aria-selected="true"[\s\S]*Groceries/);
    expect(html).toMatch(/Travel[\s\S]*1\.200 €/);
    expect(html).toContain("View monthly cash flow as a table");
    expect(html).toMatch(/Largest merchants[\s\S]*BILLA[\s\S]*SPAR/);
    expect(html).toContain("fromMonth=2026-06&amp;toMonth=2026-07");
  });

  it("shows a category refund received after its purchase month as negative spending", () => {
    const html = renderToStaticMarkup(<MoneySpendingView spending={{
      ...spending,
      months: [{ month: "2026-07", observed: true, spendMinor: -5_000, refundsMinor: 5_000, incomeMinor: 0, feesMinor: 0, taxesMinor: 0, netCashFlowMinor: 5_000 }],
      categoryMonths: [{ month: "2026-07", category: "travel", amountMinor: -5_000, count: 1 }],
      merchantMonths: [{ month: "2026-07", category: "travel", description: "Rail ticket", amountMinor: -5_000, count: 1 }],
    }} transferReview={{ linkedPairs: 0, unlinkedCount: 0, unresolvedPositiveCount: 0, unresolvedNegativeCount: 0 }} reviewCounts={{ uncategorized: 0, transfers: 0 }} initialCategory="travel" />);
    expect(html).toMatch(/Spent[\s\S]*−50 €/);
    expect(html).toMatch(/Income[\s\S]*0 €/);
    expect(html).toMatch(/Travel[\s\S]*−50 €/);
    expect(html).toContain("Refunds lower spending");
    expect(html).toMatch(/Rail ticket[\s\S]*−50 €/);
  });

  it("keeps refund bars and negative income inside their chart bounds", () => {
    const tooltip = () => ({ title: "Refund month", rows: [] });
    const charts = [
      renderToStaticMarkup(<FlowChart months={[{ label: "Jul", income: -10, spending: -50, net: 40 }]} label="Refund cash flow" tooltip={tooltip} />),
      renderToStaticMarkup(<MonthBars values={[-50, 20]} labels={["Jul", "Aug"]} label="Net category spending" average={-15} tooltip={tooltip} />),
      renderToStaticMarkup(<SparkBars values={[-50, 20]} />),
    ];
    for (const chart of charts) {
      const height = Number(chart.match(/<svg[^>]*height="([\d.]+)"/)?.[1]);
      const bars = [...chart.matchAll(/<rect[^>]* y="([\d.-]+)"[^>]* height="([\d.-]+)"/g)];
      expect(bars.length).toBeGreaterThan(0);
      for (const bar of bars) {
        const top = Number(bar[1]);
        const size = Number(bar[2]);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(size).toBeGreaterThan(1);
        expect(top + size).toBeLessThanOrEqual(height);
      }
    }
  });

  it("puts categories, transfers, prices, and balances in one Review queue", () => {
    const item = { id: "t-1", occurredAt: "2026-09-24T10:00:00.000Z", accountName: "Revolut", description: "SQ *MARKT STAND", amountMinor: -2_340, feeMinor: 0, taxMinor: 0, currency: "EUR", status: "completed" as const, sourceType: "Card Payment", flowKind: "spend" as const, category: "uncategorized" as const, categoryOrigin: "source" as const, needsTransferReview: false };
    const html = renderToStaticMarkup(<MoneyReviewView {...pageData({
      reviewCounts: { uncategorized: 41, transfers: 2, spendingRows: 2_000, otherRows: 37 },
      reviewQueue: { items: [{ ...item, similarCount: 3, suggestions: ["groceries"] }], commonCategories: ["groceries", "dining", "shopping"] },
      transferReviewGroups: [{ representativeId: "g-1", accountName: "Sparkasse", description: "Revolut card funding", sourceType: "Transfer", direction: "outflow", currency: "EUR", count: 2, totalMinor: -50_000, items: [{ ...item, id: "g-1", description: "Revolut card funding", flowKind: "transfer", category: "transfer", amountMinor: -25_000, needsTransferReview: true }, { ...item, id: "g-2", description: "Revolut card funding", flowKind: "transfer", category: "transfer", amountMinor: -25_000, needsTransferReview: true }] }],
      marketData: { ...pageData().marketData, positions: [{ canonicalKey: "asml", name: "ASML", assetClass: "equity", quantity: "1", costBasisMinor: 70_000, state: "stale", priceDate: "2026-09-13" }] },
    })} tab="queue" />);
    expect(html).toContain("Drop statements here");
    expect(html).toMatch(/Groceries[\s\S]*Dining[\s\S]*Shopping/);
    expect(html).toContain("This transaction");
    expect(html).toContain("This merchant description in Revolut: 3 other rows and future imports");
    expect(html).toContain("41 of 2,000 spending and refund rows need a category (2.1%)");
    expect(html).toContain("37 spending and refund rows got the broad category Other from a rule");
    expect(html).toContain("Write a rule");
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
