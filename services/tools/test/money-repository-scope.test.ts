import { describe, expect, it } from "vitest";
import { moneyLedgerQueriesFor } from "../money/money-repository.js";

describe("Money ledger query scopes", () => {
  it("loads only category drill-down data for the category view", () => {
    expect(moneyLedgerQueriesFor("categories")).toEqual([
      "categoryMonths",
      "merchantMonths",
      "categoryActivity",
    ]);
  });

  it("keeps overview and investment data isolated", () => {
    expect(moneyLedgerQueriesFor("overview")).toEqual([
      "counts",
      "transferSummary",
      "monthlyCashFlow",
      "categoryTotals",
      "balanceSnapshots",
    ]);
    expect(moneyLedgerQueriesFor("investments")).toEqual([
      "investmentPositions",
      "investmentTotals",
      "tradeMarkers",
      "realizedEvents",
    ]);
  });

  it("keeps the full scope for repository integration coverage only", () => {
    expect(moneyLedgerQueriesFor("all")).toHaveLength(16);
  });
});
