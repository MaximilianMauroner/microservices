import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyActivityView, MoneyInvestmentsView, MoneySpendingView } from "../money/money-ledger-views.js";

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
    categoryOrigin: "source" as const
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
    categoryOrigin: "source" as const
  }
];

describe("Option A money ledger views", () => {
  it("renders auditable activity with flow and status boundaries", () => {
    const html = renderToStaticMarkup(<MoneyActivityView activity={activity} transactionCount={8_030} transferReview={{ linkedPairs: 12, unlinkedCount: 4 }} />);

    expect(html).toContain("Transaction activity");
    expect(html).toContain("8,030");
    expect(html).toContain("Coffee");
    expect(html).toContain("Revolut Current");
    expect(html).toContain("reverted");
    expect(html).toContain("Linked transfers");
  });

  it("states the bounded spending and investment contracts", () => {
    const spending = renderToStaticMarkup(<MoneySpendingView spending={{ months: [{ month: "2026-08", spendMinor: 350, refundsMinor: 0, incomeMinor: 0, feesMinor: 10, taxesMinor: 0, netCashFlowMinor: -360 }], categories: [{ category: "uncategorized", amountMinor: 350, count: 1 }], uncategorizedCount: 1 }} />);
    const investments = renderToStaticMarkup(<MoneyInvestmentsView investments={{ positions: [], totals: { eventCount: 0, boughtMinor: 0, soldMinor: 0, incomeMinor: 0, feesMinor: 0, taxesMinor: 0 } }} />);

    expect(spending).toContain("excluding transfers, trades, adjustments, and reverted rows");
    expect(spending).toContain("3,50");
    expect(investments).toContain("No live prices or investment returns are inferred");
  });
});
