import { describe, expect, it } from "vitest";
import { moneyFinancialHistory, moneyFinancialPosition, moneyTrackerAccountCategory, moneyTrackerTrendStats } from "../money/money-tracker-domain.js";

describe("money tracker analytics", () => {
  it("combines cash and live portfolio value into one confidence-aware position", () => {
    const position = moneyFinancialPosition({
      asOf: "2026-08-10T12:00:00.000Z",
      cashValueMinor: 298_906,
      cashObservationDate: "2026-08-01",
      observedCashAccountCount: 4,
      cashAccountCount: 5,
      marketData: {
        positions: [
          { state: "fresh", priceDate: "2026-08-10" },
          { state: "fresh", priceDate: "2026-08-10" }
        ],
        totals: { knownMarketValueMinor: 2_825_367, complete: true }
      }
    });

    expect(position.knownNetWorthMinor).toBe(3_124_273);
    expect(position.cash).toMatchObject({ observedAccountCount: 4, carriedAccountCount: 1 });
    expect(position.portfolio).toMatchObject({ knownValueMinor: 2_825_367, pricedPositionCount: 2, freshPositionCount: 2, priceDate: "2026-08-10" });
    expect(position.state).toBe("carried");
  });

  it("aligns monthly cash with the last accepted portfolio close without claiming incomplete points are observed", () => {
    const history = moneyFinancialHistory([
      { date: "2026-01-01", cashValue: 100, observedCashAccountCount: 2, cashAccountCount: 2 },
      { date: "2026-02-01", cashValue: 120, observedCashAccountCount: 1, cashAccountCount: 2 }
    ], [
      { date: "2025-12-31", knownMarketValueMinor: 20_000, complete: true },
      { date: "2026-01-31", knownMarketValueMinor: 25_000, complete: true }
    ]);

    expect(history).toEqual([
      { date: "2026-01-01", money: 100, stocks: 200, total: 300, observed: true, portfolioDate: "2025-12-31" },
      { date: "2026-02-01", money: 120, stocks: 250, total: 370, observed: false, portfolioDate: "2026-01-31" }
    ]);
  });

  it("separates stock-suffixed accounts from money on hand", () => {
    expect(moneyTrackerAccountCategory("Revolut Stocks")).toBe("stocks");
    expect(moneyTrackerAccountCategory("Company Stock ")).toBe("stocks");
    expect(moneyTrackerAccountCategory("Trade Republic")).toBe("money");
    expect(moneyTrackerAccountCategory("Stockholm Cash")).toBe("money");
  });

  it("calculates integrated snapshot trends without reading formula columns", () => {
    const history = [
      trendPoint("01/08/2025", 100, 40, 60),
      trendPoint("31/12/2025", 120, 45, 75),
      trendPoint("01/03/2026", 130, 40, 90),
      trendPoint("01/04/2026", 140, 42, 98),
      trendPoint("01/05/2026", 150, 45, 105),
      trendPoint("01/06/2026", 160, 48, 112),
      trendPoint("01/07/2026", 180, 50, 130),
      trendPoint("01/08/2026", 200, 60, 140)
    ];
    const stats = moneyTrackerTrendStats(history.slice(-6), history);

    expect(stats.yearOverYear?.total).toEqual({ change: 100, percent: 100 });
    expect(stats.momentum?.change).toBe(40);
    expect(stats.momentum?.percent).toBeCloseTo(28.57, 2);
    expect(stats.periodChange?.change).toBe(70);
    expect(stats.averageMonthlyChange).toBe(14);
    expect(stats.averageMoneyChange).toBe(4);
    expect(stats.averageStocksChange).toBe(10);
    expect(stats.geometricAverageMonthlyPercent).toBeCloseTo(9.00, 2);
    expect(stats.positiveMonths).toEqual({ positive: 5, total: 5, rate: 100 });
    expect(stats.yearlyChanges).toEqual([
      { year: 2025, change: 20, percent: 20 },
      { year: 2026, change: 80, percent: 80 / 120 * 100 }
    ]);
    expect(stats.allocation).toEqual({
      current: { money: 30, stocks: 70 },
      previousYear: { date: "01/08/2025", money: 40, stocks: 60 }
    });
  });

  it("uses tracked carried values without compacting calendar months", () => {
    const history = [
      { ...trendPoint("2026-01-01", 100, 100, 0), observed: true },
      { ...trendPoint("2026-02-01", 100, 100, 0), observed: false },
      { ...trendPoint("2026-03-01", 121, 121, 0), observed: true },
      { ...trendPoint("2026-04-01", 133.1, 133.1, 0), observed: true },
      { ...trendPoint("2026-05-01", 146.41, 146.41, 0), observed: false },
      { ...trendPoint("2026-06-01", 161.051, 161.051, 0), observed: true }
    ];
    const stats = moneyTrackerTrendStats(history);
    expect(stats.periodChange?.change).toBeCloseTo(61.051);
    expect(stats.positiveMonths).toEqual({ positive: 4, total: 5, rate: 80 });
    expect(stats.averageMonthlyChange).toBeCloseTo(12.2102);
    expect(stats.geometricAverageMonthlyPercent).toBeCloseTo(10);
    expect(stats.momentum).toBeDefined();
  });

});

function trendPoint(date: string, total: number, money: number, stocks: number) {
  return { date, total, money, stocks };
}
