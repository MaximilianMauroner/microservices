// @vitest-environment jsdom
import { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TableTwin } from "../money/money-ui.js";
import { MoneyActivityView, preloadMoneyView } from "../money/money-view-loading.js";
import { MoneyInvestmentsView } from "../money/money-ledger-views.js";

it("shows a preloaded transaction view on its first render without a suspense fallback", async () => {
  await preloadMoneyView("transactions");
  const html = renderToStaticMarkup(<Suspense fallback={<p>Loading view</p>}><MoneyActivityView activity={[]} transactionCount={0} reviewCounts={{ uncategorized: 0, transfers: 0 }} /></Suspense>);
  expect(html).toContain("No transactions imported");
  expect(html).not.toContain("Loading view");
});

it("mounts disclosure rows when opened and preserves their state when closed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<TableTwin label="View balances as a table"><table><tbody><tr><td>July</td><td>123.45 EUR</td></tr></tbody></table></TableTwin>));
    expect(host.textContent).toContain("View balances as a table");
    expect(host.querySelector("table")).toBeNull();
    const details = host.querySelector("details")!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    const table = host.querySelector("table");
    expect(table?.textContent).toContain("123.45 EUR");
    await act(async () => { details.open = false; details.dispatchEvent(new Event("toggle")); });
    expect(host.querySelector("table")).toBe(table);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("shows the original FIFO totals and return when the realized-gain disclosure opens", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MoneyInvestmentsView
      marketData={{ asOf: "2026-01-01T00:00:00Z", positions: [], history: [], totals: { costBasisMinor: 0, knownMarketValueMinor: 0, knownUnrealizedGainMinor: 0, complete: true } }}
      investments={{ positions: [], trades: [], totals: { eventCount: 1, boughtMinor: 20_000, soldMinor: 30_000, incomeMinor: 0, feesMinor: 0, taxesMinor: 0 }, realized: { positions: [{ symbol: "ABC", soldQuantity: "1", saleCount: 1, proceedsMinor: 30_000, costBasisMinor: 20_000, gainMinor: 10_000 }], totals: { saleCount: 1, proceedsMinor: 30_000, costBasisMinor: 20_000, gainMinor: 10_000, unmatchedSaleCount: 0 } } }}
    />));
    expect(host.querySelectorAll('details tr')).toHaveLength(0);
    const details = [...host.querySelectorAll("details")].find((item) => item.querySelector("summary")?.textContent?.startsWith("Realized gains"))!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    expect(details.textContent).toContain("FIFO basis");
    expect(details.textContent).toContain("ABC");
    expect(details.textContent).toContain("+50.0%");
    expect(details.textContent).toContain("300");
    expect(details.textContent).toContain("200");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
