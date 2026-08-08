import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildSnapshot, loadMoneyTrackerConfig, MONEY_TRACKER_SHEETS_SCOPE } from "../src/features/money/money-tracker.js";
import { moneyTrackerAccountCategory, moneyTrackerForecast, moneyTrackerTrendStats } from "../src/features/money/money-tracker-domain.js";

describe("money tracker configuration", () => {
  it("uses only the Google Sheets read-only scope", () => {
    expect(MONEY_TRACKER_SHEETS_SCOPE).toBe("https://www.googleapis.com/auth/spreadsheets.readonly");
  });

  it("validates service-account JSON without exposing credential values", () => {
    expect(() => loadMoneyTrackerConfig({
      MONEY_TRACKER_SPREADSHEET_ID: "sheet-id",
      GOOGLE_SERVICE_ACCOUNT_JSON: "not-json"
    })).toThrow("must contain valid JSON");
    expect(() => loadMoneyTrackerConfig({
      MONEY_TRACKER_SPREADSHEET_ID: "sheet-id",
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "tracker@example.com", private_key: "secret" })
    })).toThrow("invalid client_email");
  });

  it("accepts a structurally valid service account", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const config = loadMoneyTrackerConfig({
      MONEY_TRACKER_SPREADSHEET_ID: "sheet-id",
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "tracker@example.iam.gserviceaccount.com",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" })
      })
    });
    expect(config.spreadsheetId).toBe("sheet-id");
    expect(config.sheetName).toBe("Monthly Entries");
  });
});

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

  it("projects balances and milestone windows from a stable monthly trend", () => {
    const history = Array.from({ length: 6 }, (_, index) => trendPoint(
      `08/0${index + 3}/2026`,
      25_000 + index * 1_000,
      5_000 + index * 200,
      20_000 + index * 800
    ));
    const forecast = moneyTrackerForecast(history, 6)!;

    expect(forecast.confidence).toBe("low");
    expect(forecast.total.monthlyTrend).toBeCloseTo(1_000);
    expect(forecast.total.projected).toBeCloseTo(36_000);
    expect(forecast.money.projected).toBeCloseTo(7_200);
    expect(forecast.stocks.projected).toBeCloseTo(28_800);
    expect(forecast.points).toHaveLength(6);
    expect(forecast.points[0]).toMatchObject({ date: "08/09/2026", total: 31_000, lowerTotal: 31_000, upperTotal: 31_000 });
    expect(forecast.milestones[0]).toMatchObject({ value: 35_000, estimatedDate: "08/01/2027" });
  });

  it("requires six snapshots before showing a prediction", () => {
    expect(moneyTrackerForecast([
      trendPoint("01/01/2026", 100, 40, 60),
      trendPoint("01/02/2026", 110, 44, 66)
    ], 12)).toBeUndefined();
  });
  it("sorts snapshots chronologically and calculates totals without hard-coded accounts", () => {
    const snapshot = buildSnapshot([
      ["Date", "Account", "Value", "Notes"],
      ["08/08/2026", "Cash", 420],
      ["08/08/2026", "Stocks", 1_580],
      ["11/07/2026", "Cash", 500],
      ["11/07/2026", "Stocks", 1_400]
    ]);

    expect(snapshot.accounts).toEqual(["Cash", "Stocks"]);
    expect(snapshot.months.map(({ date, total }) => ({ date, total }))).toEqual([
      { date: "11/07/2026", total: 1_900 },
      { date: "08/08/2026", total: 2_000 }
    ]);
    expect(snapshot.latestDate).toBe("08/08/2026");
  });

  it("rejects duplicate date and account pairs", () => {
    expect(() => buildSnapshot([
      ["Date", "Account", "Value"],
      ["08/08/2026", "Cash", 420],
      ["08/08/2026", "Cash", 430]
    ])).toThrow("duplicate account Cash");
  });

  it("rejects missing required headers", () => {
    expect(() => buildSnapshot([["When", "Account", "Value"]])).toThrow("must contain Date, Account, and Value columns");
  });
});

function trendPoint(date: string, total: number, money: number, stocks: number) {
  return { date, total, money, stocks };
}
