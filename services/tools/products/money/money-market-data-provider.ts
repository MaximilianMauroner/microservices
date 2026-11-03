import { parseEcbEuroAreaHicp, parseEcbUsdRates, parseYahooDailySeries, type MoneyYahooSeries } from "./money-market-data-domain.js";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export class MoneyMarketProviderError extends Error {
  constructor(readonly code: "rate_limited" | "provider_unavailable" | "invalid_response", message: string) {
    super(message);
    this.name = "MoneyMarketProviderError";
  }
}

export class YahooChartClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async dailySeries(series: MoneyYahooSeries, from: string, to: string) {
    const period1 = epoch(from);
    const period2 = epoch(addDays(to, 1));
    const url = new URL(`/v8/finance/chart/${encodeURIComponent(series.providerKey)}`, "https://query2.finance.yahoo.com");
    url.search = new URLSearchParams({ period1: String(period1), period2: String(period2), interval: "1d", events: "div,splits" }).toString();
    const source = await providerText(this.fetcher, url, { Accept: "application/json", "User-Agent": "Mozilla/5.0 money-tracker-personal" });
    try {
      return parseYahooDailySeries(JSON.parse(source), series);
    } catch (error) {
      throw new MoneyMarketProviderError("invalid_response", error instanceof Error ? error.message : "Yahoo returned invalid data.");
    }
  }
}

export class EcbFxClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async usdRates(from: string, to: string) {
    const url = new URL("/service/data/EXR/D.USD.EUR.SP00.A", "https://data-api.ecb.europa.eu");
    url.search = new URLSearchParams({ startPeriod: from, endPeriod: to, format: "csvdata" }).toString();
    const source = await providerText(this.fetcher, url, { Accept: "text/csv", "User-Agent": "money-tracker-personal/1.0" });
    try {
      return parseEcbUsdRates(source);
    } catch (error) {
      throw new MoneyMarketProviderError("invalid_response", error instanceof Error ? error.message : "ECB returned invalid data.");
    }
  }
}

export class EcbInflationClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async euroAreaHicp(from: string, to: string) {
    const url = new URL("/service/data/ICP/M.U2.N.000000.4.INX", "https://data-api.ecb.europa.eu");
    url.search = new URLSearchParams({ startPeriod: from.slice(0, 7), endPeriod: to.slice(0, 7), format: "csvdata" }).toString();
    const source = await providerText(this.fetcher, url, { Accept: "text/csv", "User-Agent": "money-tracker-personal/1.0" });
    try {
      return parseEcbEuroAreaHicp(source);
    } catch (error) {
      throw new MoneyMarketProviderError("invalid_response", error instanceof Error ? error.message : "ECB returned invalid HICP data.");
    }
  }
}

async function providerText(fetcher: typeof fetch, url: URL, headers: Record<string, string>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetcher(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (response.status === 429) throw new MoneyMarketProviderError("rate_limited", "The market-data provider rate-limited the request.");
      if (response.status >= 500) throw new MoneyMarketProviderError("provider_unavailable", `The market-data provider returned ${response.status}.`);
      if (!response.ok) throw new MoneyMarketProviderError("invalid_response", `The market-data provider returned ${response.status}.`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_RESPONSE_BYTES) throw new MoneyMarketProviderError("invalid_response", "The market-data response is too large.");
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new MoneyMarketProviderError("invalid_response", "The market-data response is too large.");
      return text;
    } catch (error) {
      lastError = error;
      if (error instanceof MoneyMarketProviderError && error.code === "invalid_response") throw error;
      if (attempt < 2) await delay(250 * 2 ** attempt);
    }
  }
  if (lastError instanceof MoneyMarketProviderError) throw lastError;
  throw new MoneyMarketProviderError("provider_unavailable", "The market-data provider could not be reached.");
}

function epoch(date: string) {
  const value = new Date(`${date}T00:00:00Z`).valueOf();
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error("Market-data dates must use YYYY-MM-DD.");
  return value / 1_000;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
