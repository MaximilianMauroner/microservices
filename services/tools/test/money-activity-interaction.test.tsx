// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MoneyActivityView } from "../money/money-activity-view.js";
import type { MoneyTrackerPageData } from "../src/protected-data.js";

vi.mock("../src/components/ui/use-mobile.js", () => ({ useIsMobile: () => false }));

it("uses the loaded ledger on mount and applies a dropdown filter without a debounce", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const activity: MoneyTrackerPageData["activity"] = [{
    id: "coffee", occurredAt: "2026-01-01T12:00:00Z", accountName: "Local test account", description: "Coffee", amountMinor: -300, feeMinor: 0, taxMinor: 0, currency: "EUR", status: "completed", sourceType: "Card Payment", flowKind: "spend", category: "dining", categoryOrigin: "source", needsTransferReview: false,
  }];
  const fetch = vi.fn(async () => Response.json({ items: [], total: 0, hasMore: false }));
  vi.stubGlobal("fetch", fetch);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<StrictMode><MoneyActivityView activity={activity} transactionCount={1} reviewCounts={{ uncategorized: 0, transfers: 0 }} /></StrictMode>); });
    expect(fetch).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Coffee");
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Filter by category"]')!;
    await act(async () => {
      select.value = "groceries";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toEqual([expect.stringContaining("category=groceries")]);
    expect(host.textContent).toContain("No matching rows");
    expect(host.textContent).not.toContain("Coffee");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
