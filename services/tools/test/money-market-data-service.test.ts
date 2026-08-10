import { describe, expect, it, vi } from "vitest";
import { MoneyMarketDataService } from "../money/money-market-data-service.js";
import { MoneyMarketProviderError } from "../money/money-market-data-provider.js";
import type { MoneyMarketDataRepository } from "../money/money-market-data-repository.js";

describe("money market-data service", () => {
  it("values remaining FIFO lots in EUR and exposes stale data", async () => {
    const repository = fakeRepository();
    repository.readValuationInputs = vi.fn().mockResolvedValue({
      events: [
        investmentEvent("2026-01-01", "buy", "2", -20_000),
        investmentEvent("2026-02-01", "sell", "0.5", 8_000)
      ],
      prices: [{
        canonicalKey: "listing:XNAS:AAPL",
        providerKey: "AAPL",
        close: "250",
        priceDate: "2026-08-01",
        currency: "USD",
        quotePerEuro: "1.25"
      }]
    });
    repository.readHistoryInputs = vi.fn().mockResolvedValue({
      events: [
        investmentEvent("2026-01-01", "buy", "2", -20_000),
        investmentEvent("2026-02-01", "sell", "0.5", 8_000)
      ],
      prices: [
        { canonicalKey: "listing:XNAS:AAPL", date: "2026-01-01", close: "100", currency: "USD" },
        { canonicalKey: "listing:XNAS:AAPL", date: "2026-02-01", close: "200", currency: "USD" }
      ],
      usdRates: [{ date: "2026-01-01", quoteCurrency: "USD", quotePerEuro: "1.25" }]
    });
    const service = new MoneyMarketDataService(repository, undefined, undefined, () => new Date("2026-08-10T12:00:00Z"));

    expect(await service.snapshot()).toMatchObject({
      positions: [{
        canonicalKey: "listing:XNAS:AAPL",
        quantity: "1.5",
        costBasisMinor: 15_000,
        marketValueMinor: 30_000,
        unrealizedGainMinor: 15_000,
        state: "stale"
      }],
      totals: {
        costBasisMinor: 15_000,
        knownMarketValueMinor: 30_000,
        knownUnrealizedGainMinor: 15_000,
        complete: true
      },
      history: [
        { date: "2026-01-01", costBasisMinor: 20_000, knownMarketValueMinor: 16_000, knownUnrealizedGainMinor: -4_000, complete: true },
        { date: "2026-02-01", costBasisMinor: 15_000, knownMarketValueMinor: 24_000, knownUnrealizedGainMinor: 9_000, complete: true }
      ]
    });
  });

  it("continues other series after a provider failure and refreshes ECB rates", async () => {
    const repository = fakeRepository();
    repository.syncTargets = vi.fn().mockResolvedValue([
      { seriesId: "a", canonicalKey: "listing:XNAS:AAPL", providerKey: "AAPL", currency: "USD", timezone: "America/New_York", firstRequiredDate: "2026-01-01" },
      { seriesId: "b", canonicalKey: "listing:XNAS:MSFT", providerKey: "MSFT", currency: "USD", timezone: "America/New_York", firstRequiredDate: "2026-02-01", lastPriceDate: "2026-08-08" }
    ]);
    const yahoo = {
      dailySeries: vi.fn()
        .mockResolvedValueOnce({ providerKey: "AAPL", name: "Apple", currency: "USD", splits: [], bars: [{ date: "2026-08-10", close: "200", currency: "USD" }] })
        .mockRejectedValueOnce(new MoneyMarketProviderError("rate_limited", "limited"))
    };
    const ecb = {
      usdRates: vi.fn().mockResolvedValue([{ date: "2026-08-10", quoteCurrency: "USD", quotePerEuro: "1.2" }])
    };
    const service = new MoneyMarketDataService(repository, yahoo, ecb, () => new Date("2026-08-10T12:00:00Z"));

    await expect(service.sync()).resolves.toEqual({ series: 2, succeeded: 1, failed: 1, pricesSaved: 1, ratesSaved: 1 });
    expect(yahoo.dailySeries).toHaveBeenNthCalledWith(2, { providerKey: "MSFT", currency: "USD" }, "2026-08-01", "2026-08-10");
    expect(repository.saveSeriesFailure).toHaveBeenCalledWith(expect.objectContaining({ seriesId: "b", errorCode: "rate_limited" }));
  });
});

function fakeRepository(): MoneyMarketDataRepository {
  return {
    syncCatalog: vi.fn().mockResolvedValue(undefined),
    syncTargets: vi.fn().mockResolvedValue([]),
    saveSeriesSuccess: vi.fn().mockResolvedValue(undefined),
    saveSeriesFailure: vi.fn().mockResolvedValue(undefined),
    saveUsdRates: vi.fn().mockResolvedValue(undefined),
    readValuationInputs: vi.fn().mockResolvedValue({ events: [], prices: [] }),
    readHistoryInputs: vi.fn().mockResolvedValue({ events: [], prices: [], usdRates: [] }),
    readiness: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  };
}

function investmentEvent(occurredAt: string, eventKind: "buy" | "sell", quantity: string, baseAmountMinor: number) {
  return {
    accountKey: "broker",
    canonicalKey: "listing:XNAS:AAPL",
    name: "Apple Inc.",
    assetClass: "equity",
    occurredAt: `${occurredAt}T12:00:00Z`,
    localDate: occurredAt,
    sourceOrder: "0001",
    eventKind,
    quantity,
    baseAmountMinor,
    baseFeeMinor: 0
  } as const;
}
