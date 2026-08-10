import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyCategoryExplorer } from "../money/money-category-explorer.js";
import type { MoneySpendingAnalytics } from "../money/money-repository.js";

const spending = {
  months: [],
  categories: [
    { category: "groceries", amountMinor: 18_000, count: 4 },
    { category: "transport", amountMinor: 8_000, count: 2 }
  ],
  categoryMonths: [
    { month: "2026-06", category: "groceries", amountMinor: 10_000, count: 2 },
    { month: "2026-07", category: "groceries", amountMinor: 8_000, count: 2 },
    { month: "2026-07", category: "transport", amountMinor: 8_000, count: 2 }
  ],
  merchantMonths: [
    { month: "2026-06", category: "groceries", description: "Market", amountMinor: 10_000, count: 2 },
    { month: "2026-07", category: "groceries", description: "Market", amountMinor: 5_000, count: 1 },
    { month: "2026-07", category: "groceries", description: "Bakery", amountMinor: 3_000, count: 1 }
  ],
  categoryActivity: [{
    id: "transaction-1", occurredAt: "2026-07-20T12:00:00.000Z", accountName: "Current", description: "Market",
    amountMinor: -5_000, feeMinor: 0, taxMinor: 0, currency: "EUR", status: "completed", sourceType: "Card Payment",
    flowKind: "spend", category: "groceries", categoryOrigin: "rule", needsTransferReview: false
  }],
  uncategorizedCount: 0
} satisfies MoneySpendingAnalytics;

describe("money category explorer", () => {
  it("renders a clickable category graph with drill-down evidence", () => {
    const html = renderToStaticMarkup(<MoneyCategoryExplorer spending={spending} initialCategory="groceries" />);

    expect(html).toContain("Category map");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Merchant groups");
    expect(html).toContain("Market");
    expect(html).toContain("Recent transactions");
    expect(html).toContain("rule");
    expect(html).toContain("View exact graph data");
    expect(html).toContain("69.2%");
  });
});
