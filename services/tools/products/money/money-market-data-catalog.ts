export type MoneyMarketAssetClass = "equity" | "etf" | "crypto";
export type MoneyMarketSourceProvider = "revolut" | "portfolio_export";

export type MoneyMarketInstrumentDefinition = Readonly<{
  canonicalKey: string;
  name: string;
  assetClass: MoneyMarketAssetClass;
  isin?: string;
  aliases: readonly Readonly<{
    provider: MoneyMarketSourceProvider;
    symbol: string;
  }>[];
  series: Readonly<{
    provider: "yahoo_chart";
    providerKey: string;
    currency: "EUR" | "USD";
    timezone: string;
  }>;
}>;

/** Personal, auditable mappings for every investment identifier in the supported exports. */
export const MONEY_MARKET_INSTRUMENTS = [
  usEquity("AAPL", "Apple Inc.", "XNAS"),
  usEquity("AMC", "AMC Entertainment Holdings, Inc.", "XNYS"),
  usEquity("AMD", "Advanced Micro Devices, Inc.", "XNAS"),
  usEquity("AXP", "American Express Company", "XNYS"),
  usEquity("BHP", "BHP Group Limited ADR", "XNYS"),
  usEquity("GME", "GameStop Corp.", "XNYS"),
  usEquity("INTC", "Intel Corporation", "XNAS"),
  usEquity("META", "Meta Platforms, Inc.", "XNAS"),
  usEquity("MRNA", "Moderna, Inc.", "XNAS"),
  usEquity("MSFT", "Microsoft Corporation", "XNAS"),
  usEquity("NET", "Cloudflare, Inc.", "XNYS"),
  usEquity("NVDA", "NVIDIA Corporation", "XNAS"),
  usEquity("PFE", "Pfizer Inc.", "XNYS"),
  usEquity("SPCX", "Space Exploration Technologies Corp.", "XNAS"),
  usEquity("TSLA", "Tesla, Inc.", "XNAS"),
  europeanEtf({
    sourceSymbol: "VUSA",
    isin: "IE00B3XXRP09",
    name: "Vanguard S&P 500 UCITS ETF USD Distributing",
    providerKey: "VUSA.DE"
  }),
  europeanEtf({
    sourceSymbol: "IE000YU9K6K2",
    isin: "IE000YU9K6K2",
    name: "VanEck Space Innovators UCITS ETF",
    providerKey: "JEDI.DE"
  }),
  europeanEtf({
    sourceSymbol: "IE00B4L5Y983",
    isin: "IE00B4L5Y983",
    name: "iShares Core MSCI World UCITS ETF USD Acc",
    providerKey: "EUNL.DE"
  }),
  europeanEtf({
    sourceSymbol: "IE00BL25JM42",
    isin: "IE00BL25JM42",
    name: "Xtrackers MSCI World Value UCITS ETF 1C",
    providerKey: "XDEV.DE"
  }),
  europeanEtf({
    sourceSymbol: "LU1681048804",
    isin: "LU1681048804",
    name: "Amundi S&P 500 Swap UCITS ETF EUR Acc",
    providerKey: "AUM5.DE"
  }),
  {
    canonicalKey: "crypto:ethereum",
    name: "Ethereum",
    assetClass: "crypto",
    aliases: [{ provider: "portfolio_export", symbol: "ETH" }],
    series: { provider: "yahoo_chart", providerKey: "ETH-EUR", currency: "EUR", timezone: "UTC" }
  }
] as const satisfies readonly MoneyMarketInstrumentDefinition[];

export function moneyMarketInstrument(provider: MoneyMarketSourceProvider, symbol: string) {
  const normalized = symbol.trim().toLocaleUpperCase("en-GB");
  return MONEY_MARKET_INSTRUMENTS.find((instrument) => instrument.aliases.some(
    (alias) => alias.provider === provider && alias.symbol.toLocaleUpperCase("en-GB") === normalized
  ));
}

/** Uses an imported instrument name when available, otherwise resolves an unambiguous catalog alias. */
export function moneyMarketInstrumentName(symbol: string, importedName?: string | null) {
  const normalizedSymbol = symbol.trim().toLocaleUpperCase("en-GB");
  const normalizedName = importedName?.trim();
  if (normalizedName && normalizedName.toLocaleUpperCase("en-GB") !== normalizedSymbol) return normalizedName;

  const matches = MONEY_MARKET_INSTRUMENTS.filter((instrument) => instrument.aliases.some(
    (alias) => alias.symbol.toLocaleUpperCase("en-GB") === normalizedSymbol
  ));
  return matches.length === 1 ? matches[0]!.name : normalizedName;
}

function usEquity(symbol: string, name: string, mic: "XNAS" | "XNYS"): MoneyMarketInstrumentDefinition {
  return {
    canonicalKey: `listing:${mic}:${symbol}`,
    name,
    assetClass: "equity",
    aliases: [{ provider: "revolut", symbol }],
    series: { provider: "yahoo_chart", providerKey: symbol, currency: "USD", timezone: "America/New_York" }
  };
}

function europeanEtf(input: Readonly<{ sourceSymbol: string; isin: string; name: string; providerKey: string }>): MoneyMarketInstrumentDefinition {
  return {
    canonicalKey: `isin:${input.isin}`,
    name: input.name,
    assetClass: "etf",
    isin: input.isin,
    aliases: [{ provider: input.sourceSymbol === "VUSA" ? "revolut" : "portfolio_export", symbol: input.sourceSymbol }],
    series: { provider: "yahoo_chart", providerKey: input.providerKey, currency: "EUR", timezone: "Europe/Berlin" }
  };
}
