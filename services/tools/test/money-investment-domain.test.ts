import { describe, expect, it } from "vitest";
import { fifoInvestmentLots, fifoRealizedGains, type MoneyRealizedGainEvent } from "../money/money-investment-domain.js";

describe("FIFO realized investment gains", () => {
  it("matches sales to the oldest lots and includes transaction fees", () => {
    const result = fifoRealizedGains([
      event("2026-01-01", "buy", "ABC", "2", -20_000, 1_000),
      event("2026-02-01", "buy", "ABC", "1", -15_000),
      event("2026-03-01", "sell", "ABC", "2.5", 50_000, 500)
    ]);

    expect(result).toEqual({
      positions: [{ symbol: "ABC", soldQuantity: "2.5", saleCount: 1, proceedsMinor: 49_500, costBasisMinor: 28_500, gainMinor: 21_000 }],
      totals: { saleCount: 1, proceedsMinor: 49_500, costBasisMinor: 28_500, gainMinor: 21_000, unmatchedSaleCount: 0 }
    });
  });

  it("preserves total lot cost through a stock split", () => {
    const result = fifoRealizedGains([
      event("2026-01-01", "buy", "SPLT", "2", -20_000),
      event("2026-02-01", "split", "SPLT", "4", 0),
      event("2026-03-01", "sell", "SPLT", "3", 45_000)
    ]);

    expect(result.positions[0]).toMatchObject({ soldQuantity: "3", proceedsMinor: 45_000, costBasisMinor: 10_000, gainMinor: 35_000 });
  });

  it("flags and excludes sale proceeds without acquisition history", () => {
    const result = fifoRealizedGains([
      event("2026-01-01", "buy", "MISS", "1", -10_000),
      event("2026-02-01", "sell", "MISS", "2", 30_000)
    ]);

    expect(result.positions[0]).toMatchObject({ soldQuantity: "1", proceedsMinor: 15_000, costBasisMinor: 10_000, gainMinor: 5_000 });
    expect(result.totals.unmatchedSaleCount).toBe(1);
  });

  it("does not realize gains for migrations or deliveries", () => {
    const result = fifoRealizedGains([
      event("2026-01-01", "buy", "MOVE", "1", -10_000),
      event("2026-02-01", "position_transfer", "MOVE", "-1", 0),
      event("2026-02-01", "position_transfer", "MOVE", "1", 0)
    ]);
    expect(result.totals).toEqual({ saleCount: 0, proceedsMinor: 0, costBasisMinor: 0, gainMinor: 0, unmatchedSaleCount: 0 });
  });

  it("keeps FIFO acquisition lots separate for each investment account", () => {
    const result = fifoRealizedGains([
      event("2026-01-01", "buy", "SAME", "1", -10_000, 0, "broker-b"),
      event("2026-01-02", "buy", "SAME", "1", -20_000, 0, "broker-a"),
      event("2026-02-01", "sell", "SAME", "1", 25_000, 0, "broker-a")
    ]);
    expect(result.positions[0]).toMatchObject({ costBasisMinor: 20_000, gainMinor: 5_000 });
  });

  it("uses source order for trades sharing a timestamp", () => {
    const result = fifoRealizedGains([
      event("2026-01-01", "sell", "ORDER", "1", 15_000, 0, "broker", "0002"),
      event("2026-01-01", "buy", "ORDER", "1", -10_000, 0, "broker", "0001")
    ]);
    expect(result.positions[0]).toMatchObject({ costBasisMinor: 10_000, gainMinor: 5_000 });
    expect(result.totals.unmatchedSaleCount).toBe(0);
  });

  it("retains sale fees that exceed gross proceeds", () => {
    const result = fifoRealizedGains([
      event("2026-01-01", "buy", "FEE", "1", -100),
      event("2026-02-01", "sell", "FEE", "1", 50, 75)
    ]);
    expect(result.positions[0]).toMatchObject({ proceedsMinor: -25, costBasisMinor: 100, gainMinor: -125 });
  });

  it("reports the remaining FIFO quantity and cost basis", () => {
    const result = fifoInvestmentLots([
      event("2026-01-01", "buy", "OPEN", "2", -20_000, 1_000),
      event("2026-02-01", "sell", "OPEN", "0.5", 8_000)
    ]);

    expect(result.openPositions).toEqual([{
      accountKey: "broker",
      symbol: "OPEN",
      quantity: "1.5",
      costBasisMinor: 15_750
    }]);
  });
});

function event(occurredAt: string, eventKind: MoneyRealizedGainEvent["eventKind"], symbol: string, quantity: string, baseAmountMinor: number, baseFeeMinor = 0, accountKey = "broker", sourceOrder = "0001"): MoneyRealizedGainEvent {
  return { accountKey, occurredAt, sourceOrder, eventKind, symbol, quantity, baseAmountMinor, baseFeeMinor };
}
