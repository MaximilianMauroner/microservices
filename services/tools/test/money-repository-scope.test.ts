import { describe, expect, it } from "vitest";
import { moneyLedgerQueriesFor } from "../money/money-repository.js";

describe("Money ledger query scopes", () => {
  it("loads cash flow and category drill-down data for Spending", () => {
    expect(moneyLedgerQueriesFor("spending")).toEqual([
      "reviewCounts",
      "transferSummary",
      "monthlyCashFlow",
      "categoryTotals",
      "categoryMonths",
      "merchantMonths",
      "categoryActivity",
    ]);
  });

  it("keeps overview and investment data isolated", () => {
    expect(moneyLedgerQueriesFor("overview")).toEqual([
      "reviewCounts",
      "transferSummary",
      "monthlyCashFlow",
      "categoryMonths",
      "balanceSnapshots",
    ]);
    expect(moneyLedgerQueriesFor("investments")).toEqual([
      "reviewCounts",
      "investmentPositions",
      "investmentTotals",
      "tradeMarkers",
      "realizedEvents",
    ]);
  });

  it("loads the review count on every view for the menu badge", () => {
    for (const view of ["overview", "spending", "transactions", "accounts", "investments", "plan", "review"] as const) {
      expect(moneyLedgerQueriesFor(view)).toContain("reviewCounts");
    }
  });

  it("keeps the full scope for repository integration coverage only", () => {
    expect(moneyLedgerQueriesFor("all")).toHaveLength(21);
  });

  it("loads rules, imports, and the queue only for Review", () => {
    expect(moneyLedgerQueriesFor("review")).toEqual(expect.arrayContaining(["imports", "categoryRules", "transferRules", "transferRuleOptions", "reviewQueue", "transferReview"]));
    for (const view of ["overview", "spending", "transactions", "accounts", "investments", "plan"] as const) {
      expect(moneyLedgerQueriesFor(view)).not.toContain("transferRules");
      expect(moneyLedgerQueriesFor(view)).not.toContain("reviewQueue");
    }
  });
});
