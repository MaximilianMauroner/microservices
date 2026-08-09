import { describe, expect, it } from "vitest";
import { moneyTrackerAccountCategory, moneyTrackerTrendStats } from "../money/money-tracker-domain.js";

describe("money tracker analytics", () => {
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

});

function trendPoint(date: string, total: number, money: number, stocks: number) {
  return { date, total, money, stocks };
}
