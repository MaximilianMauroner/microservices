import { describe, expect, it, vi } from "vitest";
import { marketValueMinor, parseEcbEuroAreaHicp, parseEcbUsdRates, parseYahooDailySeries } from "../money/money-market-data-domain.js";
import { moneyMarketInstrument, moneyMarketInstrumentName } from "../money/money-market-data-catalog.js";
import { YahooChartClient } from "../money/money-market-data-provider.js";

describe("money market-data domain", () => {
  it("resolves personal aliases without treating a ticker as global identity", () => {
    expect(moneyMarketInstrument("revolut", "VUSA")).toMatchObject({ canonicalKey: "isin:IE00B3XXRP09", series: { providerKey: "VUSA.DE", currency: "EUR" } });
    expect(moneyMarketInstrument("portfolio_export", "IE00B4L5Y983")).toMatchObject({ series: { providerKey: "EUNL.DE" } });
    expect(moneyMarketInstrument("portfolio_export", "ETH")).toMatchObject({ canonicalKey: "crypto:ethereum", series: { providerKey: "ETH-EUR" } });
    expect(moneyMarketInstrument("portfolio_export", "AAPL")).toBeUndefined();
  });

  it("uses imported instrument names and falls back to canonical catalog names", () => {
    expect(moneyMarketInstrumentName("IE00B4L5Y983")).toBe("iShares Core MSCI World UCITS ETF USD Acc");
    expect(moneyMarketInstrumentName("IE00B4L5Y983", "IE00B4L5Y983")).toBe("iShares Core MSCI World UCITS ETF USD Acc");
    expect(moneyMarketInstrumentName("IE00B4L5Y983", "Custom fund name")).toBe("Custom fund name");
    expect(moneyMarketInstrumentName("UNKNOWN")).toBeUndefined();
  });

  it("reconstructs raw pre-split closes while keeping split-day closes unchanged", () => {
    const result = parseYahooDailySeries(yahoo({
      timestamps: [1_577_923_200, 1_593_734_400, 1_593_820_800],
      closes: [20, 22, 5],
      split: { date: 1_593_820_800, numerator: 4, denominator: 1 }
    }), { providerKey: "TEST", currency: "USD" });
    expect(result.bars.map((bar) => bar.close)).toEqual(["80", "88", "5"]);
    expect(result.splits).toEqual([{ date: "2020-07-04", numerator: 4n, denominator: 1n }]);
  });

  it("converts USD market value to EUR cents with exact decimal arithmetic", () => {
    expect(marketValueMinor("2.5", "100", "1.25")).toBe(20_000);
    expect(marketValueMinor("0.0044", "2724.07", "1")).toBe(1_199);
  });

  it("parses official ECB quote-per-euro observations", () => {
    expect(parseEcbUsdRates("TIME_PERIOD,OBS_VALUE\n2026-08-07,1.1642\n2026-08-10,1.1555\n")).toEqual([
      { date: "2026-08-07", quoteCurrency: "USD", quotePerEuro: "1.1642" },
      { date: "2026-08-10", quoteCurrency: "USD", quotePerEuro: "1.1555" }
    ]);
  });

  it("parses official monthly euro-area HICP observations at month end", () => {
    expect(parseEcbEuroAreaHicp("TIME_PERIOD,OBS_VALUE\n2025-01,126.72\n2025-02,127.26\n")).toEqual([
      { date: "2025-01-31", value: "126.72" },
      { date: "2025-02-28", value: "127.26" }
    ]);
  });

  it("builds a bounded Yahoo request and rejects a mismatched symbol", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(yahoo({ timestamps: [1_725_667_200], closes: [10], symbol: "WRONG" })), { status: 200 }));
    await expect(new YahooChartClient(fetcher).dailySeries({ providerKey: "TEST", currency: "USD" }, "2024-09-07", "2024-09-07")).rejects.toThrow("instead of");
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("query2.finance.yahoo.com/v8/finance/chart/TEST");
  });
});

function yahoo(input: Readonly<{ timestamps: number[]; closes: number[]; symbol?: string; split?: { date: number; numerator: number; denominator: number } }>) {
  return { chart: { error: null, result: [{
    meta: { symbol: input.symbol ?? "TEST", currency: "USD", longName: "Test", gmtoffset: 0 },
    timestamp: input.timestamps,
    indicators: { quote: [{ close: input.closes }] },
    events: input.split ? { splits: { [String(input.split.date)]: input.split } } : {}
  }] } };
}
