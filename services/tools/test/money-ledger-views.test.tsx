import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyActivityView, MoneyInvestmentsView, MoneySpendingView } from "../money/money-ledger-views.js";
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
    needsTransferReview: true
  }
];

describe("Option A money ledger views", () => {
  it("renders auditable activity with flow and status boundaries", () => {
    const html = renderToStaticMarkup(<MoneyActivityView activity={activity} transactionCount={8_030} transferReview={{ linkedPairs: 12, unlinkedCount: 4, unresolvedPositiveCount: 1, unresolvedNegativeCount: 1 }} />);

    expect(html).toContain("Transaction activity");
    expect(html).toContain("8,030");
    expect(html).toContain("Coffee");
    expect(html).toContain("Revolut Current");
    expect(html).toContain("reverted");
    expect(html).toContain("Linked transfers");
    expect(html).toContain("Transfer treatment");
    expect(html).toContain("Needs review");
  });

  it("states the bounded spending and investment contracts", () => {
    const spending = renderToStaticMarkup(<MoneySpendingView spending={{ months: [{ month: "2026-08", spendMinor: 350, refundsMinor: 0, incomeMinor: 0, feesMinor: 10, taxesMinor: 0, netCashFlowMinor: -360 }], categories: [{ category: "uncategorized", amountMinor: 350, count: 1 }], uncategorizedCount: 1 }} />);
    const investments = renderToStaticMarkup(<MoneyInvestmentsView investments={{ positions: [], totals: { eventCount: 0, boughtMinor: 0, soldMinor: 0, incomeMinor: 0, feesMinor: 0, taxesMinor: 0 } }} />);

    expect(spending).toContain("excluding transfers, trades, adjustments, and reverted rows");
    expect(spending).toContain("3,50");
    expect(investments).toContain("No live prices or investment returns are inferred");
  });

  it("renders disambiguated balance labels instead of stable account ids", () => {
    const html = renderToStaticMarkup(<History accounts={["id-cash", "id-investment"]} accountLabels={{ "id-cash": "Duplicate · manual a1", "id-investment": "Duplicate · manual b2" }} months={[{ date: "2026-08-01", values: { "id-cash": 10, "id-investment": 20 }, total: 30, money: 10, stocks: 20, trend: 30 }]} />);
    expect(html).toContain("Duplicate · manual a1");
    expect(html).toContain("Duplicate · manual b2");
    expect(html).not.toContain(">id-cash<");
  });

  it("uses persisted account roles instead of label suffixes for allocation", () => {
    const grouped = groupMonth({ date: "2026-08-01", values: { cash: 10, investment: 20 }, total: 30 }, { cash: "cash", investment: "investment" });
    expect(grouped).toMatchObject({ money: 10, stocks: 20 });
  });
});
