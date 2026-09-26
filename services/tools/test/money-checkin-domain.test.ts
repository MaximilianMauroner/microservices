import { describe, expect, it } from "vitest";
import {
  cashMovesSince,
  checkInBaseline,
  moneyCheckIn,
  positionMovesSince,
  previousCheckIn,
  spendingSince,
  type MoneyCheckInCashMove,
  type MoneyCheckInPositionMove,
} from "../money/money-checkin-domain.js";
import type { MoneyMarketValuationEvent } from "../money/money-market-data-repository.js";

describe("money check-in", () => {
  it("defaults to the check-in before the latest upload", () => {
    const days = ["2026-06-29", "2026-07-27", "2026-08-24", "2026-09-26"];
    expect(checkInBaseline(days)).toBe("2026-08-24");
    expect(checkInBaseline(days, "2026-06-29")).toBe("2026-06-29");
    expect(checkInBaseline(days, "2026-06-30")).toBe("2026-08-24");
    expect(checkInBaseline(["2026-09-26"])).toBe("2026-09-26");
    expect(checkInBaseline([])).toBeUndefined();
    expect(previousCheckIn(days, "2026-08-24")).toBe("2026-07-27");
    expect(previousCheckIn(days, "2026-06-29")).toBeUndefined();
  });

  it("separates market moves from money added or withdrawn", () => {
    const result = positionMovesSince({
      baseline: "2026-08-24",
      events: [
        event("etf:A", "buy", "2026-07-01", "10", -100_000, 100),
        event("etf:A", "buy", "2026-09-01", "2", -24_000),
        event("stock:B", "buy", "2026-07-01", "5", -50_000),
        event("stock:B", "sell", "2026-09-10", "5", 60_000, 100),
        event("stock:C", "buy", "2026-09-05", "1", -10_000),
        event("stock:D", "buy", "2026-07-01", "1", -5_000),
        event("etf:E", "position_transfer", "2026-09-02", "3", 0),
      ],
      prices: [
        { canonicalKey: "etf:A", date: "2026-08-21", close: "105", currency: "EUR" },
        { canonicalKey: "etf:A", date: "2026-08-22", close: "110", currency: "EUR" },
        { canonicalKey: "etf:A", date: "2026-08-25", close: "999", currency: "EUR" },
        { canonicalKey: "stock:B", date: "2026-08-21", close: "130", currency: "USD" },
        { canonicalKey: "etf:E", date: "2026-09-01", close: "20", currency: "EUR" },
      ],
      usdRates: [{ date: "2026-08-21", quoteCurrency: "USD", quotePerEuro: "1.3" }],
      current: [
        { canonicalKey: "etf:A", name: "ETF A", assetClass: "etf", marketValueMinor: 150_000 },
        { canonicalKey: "stock:C", name: "Stock C", assetClass: "equity", marketValueMinor: 11_000 },
        { canonicalKey: "stock:D", name: "Stock D", assetClass: "equity" },
        { canonicalKey: "etf:E", name: "ETF E", assetClass: "etf", marketValueMinor: 7_500 },
      ],
    });

    expect(result.moves.map(({ canonicalKey, baselineValueMinor, boughtMinor, soldMinor, currentValueMinor, moveMinor, closed }) =>
      ({ canonicalKey, baselineValueMinor, boughtMinor, soldMinor, currentValueMinor, moveMinor, closed }))).toEqual([
      { canonicalKey: "etf:A", baselineValueMinor: 110_000, boughtMinor: 24_000, soldMinor: 0, currentValueMinor: 150_000, moveMinor: 16_000, closed: false },
      { canonicalKey: "stock:B", baselineValueMinor: 50_000, boughtMinor: 0, soldMinor: 59_900, currentValueMinor: 0, moveMinor: 9_900, closed: true },
      { canonicalKey: "etf:E", baselineValueMinor: 0, boughtMinor: 6_000, soldMinor: 0, currentValueMinor: 7_500, moveMinor: 1_500, closed: false },
      { canonicalKey: "stock:C", baselineValueMinor: 0, boughtMinor: 10_000, soldMinor: 0, currentValueMinor: 11_000, moveMinor: 1_000, closed: false },
    ]);
    expect(result.moves[0]!.returnPercent).toBeCloseTo(11.94, 2);
    expect(result.moves[1]!.returnPercent).toBeCloseTo(19.8, 5);
    expect(result.unpricedNames).toEqual(["Stock D"]);
  });

  it("explains cash changes between each account's snapshots", () => {
    const result = cashMovesSince({
      baseline: "2026-08-24",
      snapshots: [
        { accountId: "giro", date: "2026-07-31", valueMinor: 500_000 },
        { accountId: "giro", date: "2026-09-20", valueMinor: 550_000 },
        { accountId: "giro", date: "2026-08-20", valueMinor: 600_000 },
        { accountId: "savings", date: "2026-08-01", valueMinor: 1_000_000 },
        { accountId: "revolut", date: "2026-09-15", valueMinor: 20_000 },
      ],
      flows: [
        flow("giro", "2026-08-15", { incomeMinor: 999 }),
        flow("giro", "2026-09-01", { incomeMinor: 400_000 }),
        flow("giro", "2026-09-05", { spendingMinor: -380_000 }),
        flow("giro", "2026-09-10", { transfersMinor: -80_000 }),
        flow("giro", "2026-09-25", { spendingMinor: -1 }),
        flow("revolut", "2026-09-10", { transfersMinor: 25_000, spendingMinor: -5_000 }),
      ],
      items: [
        { accountId: "giro", date: "2026-08-15", kind: "spending", label: "Before the window", amountMinor: -900_000 },
        { accountId: "giro", date: "2026-09-01", kind: "income", label: "Employer", amountMinor: 400_000 },
        { accountId: "giro", date: "2026-09-05", kind: "spending", label: "Rent", amountMinor: -300_000 },
        { accountId: "giro", date: "2026-09-06", kind: "spending", label: "Billa", amountMinor: -50_000 },
        { accountId: "giro", date: "2026-09-07", kind: "spending", label: "Billa", amountMinor: -30_000 },
        { accountId: "revolut", date: "2026-09-10", kind: "spending", label: "Spotify", amountMinor: -5_000 },
      ],
    });

    expect(result).toEqual({
      moves: [
        cashMove("revolut", { baselineMinor: 0, currentMinor: 20_000, changeMinor: 20_000, spendingMinor: -5_000, transfersMinor: 25_000, driver: { label: "Transfers in", amountMinor: 25_000 } }),
        cashMove("giro", { baselineMinor: 600_000, currentMinor: 550_000, changeMinor: -50_000, incomeMinor: 400_000, spendingMinor: -380_000, transfersMinor: -80_000, otherMinor: 10_000, driver: { label: "Rent", amountMinor: -300_000 } }),
      ],
      baselineTotalMinor: 1_600_000,
      currentTotalMinor: 1_570_000,
    });
  });

  it("reconciles the net worth bridge with an explicit remainder", () => {
    const positions = { baseline: "2026-08-24", moves: [positionMove({ baselineValueMinor: 100, currentValueMinor: 150, moveMinor: 30 })], unpricedNames: [] };
    const spending = { currentTotalMinor: 0, previousTotalMinor: 0, categories: [] };
    const result = moneyCheckIn({
      days: ["2026-08-24", "2026-09-26"],
      positions,
      cash: { moves: [cashMove("giro", { incomeMinor: 50, spendingMinor: -20 })], baselineTotalMinor: 1_000, currentTotalMinor: 1_040 },
      spending,
    });

    expect(result.overview?.bridge).toEqual({
      baselineNetWorthMinor: 1_100,
      marketMinor: 30,
      incomeMinor: 50,
      spendingMinor: -20,
      otherMinor: 30,
      currentNetWorthMinor: 1_190,
    });
    expect(moneyCheckIn({ days: ["2026-08-24"], positions }).overview).toBeUndefined();
  });

  it("compares category spending with the period before the check-in", () => {
    const row = (date: string, category: "groceries" | "housing" | "health", merchant: string, amountMinor: number) => ({ date, category, merchant, amountMinor });
    const rows = [
      row("2026-07-27", "groceries", "Before both periods", 99_999),
      row("2026-08-01", "groceries", "Billa", 10_000),
      row("2026-08-24", "health", "Pharmacy", 4_800),
      row("2026-08-30", "groceries", "Billa", 12_000),
      row("2026-09-02", "groceries", "Spar", 3_000),
      row("2026-09-03", "groceries", "Billa", 2_000),
      row("2026-09-04", "housing", "Rent", 42_000),
    ];

    expect(spendingSince({ baseline: "2026-08-24", previousBaseline: "2026-07-27", rows })).toEqual({
      previousBaseline: "2026-07-27",
      currentTotalMinor: 59_000,
      previousTotalMinor: 14_800,
      categories: [
        { category: "housing", currentMinor: 42_000, previousMinor: 0, merchants: [{ label: "Rent", amountMinor: 42_000 }] },
        { category: "groceries", currentMinor: 17_000, previousMinor: 10_000, merchants: [{ label: "Billa", amountMinor: 14_000 }, { label: "Spar", amountMinor: 3_000 }] },
        { category: "health", currentMinor: 0, previousMinor: 4_800, merchants: [] },
      ],
    });
    expect(spendingSince({ baseline: "2026-08-24", rows }).previousBaseline).toBeUndefined();
  });
});

function event(canonicalKey: string, eventKind: MoneyMarketValuationEvent["eventKind"], localDate: string, quantity: string, baseAmountMinor: number, baseFeeMinor = 0): MoneyMarketValuationEvent {
  return {
    accountKey: "broker",
    canonicalKey,
    name: canonicalKey,
    assetClass: "equity",
    occurredAt: `${localDate}T12:00:00Z`,
    localDate,
    sourceOrder: "0001",
    eventKind,
    quantity,
    baseAmountMinor,
    baseFeeMinor,
  };
}

function flow(accountId: string, date: string, values: Partial<Record<"incomeMinor" | "spendingMinor" | "transfersMinor" | "tradesMinor", number>>) {
  return { accountId, date, incomeMinor: 0, spendingMinor: 0, transfersMinor: 0, tradesMinor: 0, ...values };
}

function cashMove(accountId: string, values: Partial<MoneyCheckInCashMove>): MoneyCheckInCashMove {
  return { accountId, baselineMinor: 0, currentMinor: 0, changeMinor: 0, incomeMinor: 0, spendingMinor: 0, transfersMinor: 0, tradesMinor: 0, otherMinor: 0, ...values };
}

function positionMove(values: Partial<MoneyCheckInPositionMove>): MoneyCheckInPositionMove {
  return { canonicalKey: "etf:A", name: "ETF A", assetClass: "etf", baselineValueMinor: 0, currentValueMinor: 0, boughtMinor: 0, soldMinor: 0, moveMinor: 0, closed: false, ...values };
}
