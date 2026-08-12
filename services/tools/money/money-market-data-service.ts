import { fifoInvestmentLots } from "./money-investment-domain.js";
import { MONEY_MARKET_INSTRUMENTS } from "./money-market-data-catalog.js";
import { marketValueMinor } from "./money-market-data-domain.js";
import { EcbFxClient, EcbInflationClient, MoneyMarketProviderError, YahooChartClient } from "./money-market-data-provider.js";
import type { MoneyMarketDataRepository } from "./money-market-data-repository.js";

export type MoneyMarketPosition = Readonly<{
  canonicalKey: string;
  name: string;
  assetClass: "equity" | "etf" | "crypto";
  quantity: string;
  costBasisMinor: number;
  marketValueMinor?: number;
  unrealizedGainMinor?: number;
  close?: string;
  currency?: "EUR" | "USD";
  quotePerEuro?: string;
  priceDate?: string;
  providerKey?: string;
  state: "fresh" | "stale" | "unpriced";
}>;

export type MoneyMarketSnapshot = Readonly<{
  asOf: string;
  positions: readonly MoneyMarketPosition[];
  history: readonly Readonly<{
    date: string;
    costBasisMinor: number;
    knownMarketValueMinor: number;
    knownUnrealizedGainMinor: number;
    inflationBenchmarkMinor?: number;
    target7PercentMinor: number;
    complete: boolean;
  }>[];
  totals: Readonly<{
    costBasisMinor: number;
    knownMarketValueMinor: number;
    knownUnrealizedGainMinor: number;
    complete: boolean;
  }>;
}>;

export type MoneyMarketSyncResult = Readonly<{
  series: number;
  succeeded: number;
  failed: number;
  pricesSaved: number;
  ratesSaved: number;
  inflationIndicesSaved: number;
}>;

type YahooDailyClient = Pick<YahooChartClient, "dailySeries">;
type EcbRatesClient = Pick<EcbFxClient, "usdRates">;
type EcbInflationIndexClient = Pick<EcbInflationClient, "euroAreaHicp">;

/** Owns the provider sync and constructs current EUR valuations from cached data. */
export class MoneyMarketDataService {
  private currentSync?: Promise<MoneyMarketSyncResult>;

  constructor(
    private readonly repository: MoneyMarketDataRepository,
    private readonly yahoo: YahooDailyClient = new YahooChartClient(),
    private readonly ecb: EcbRatesClient = new EcbFxClient(),
    private readonly now: () => Date = () => new Date(),
    private readonly inflation: EcbInflationIndexClient = new EcbInflationClient()
  ) {}

  initializeCatalog() {
    return this.repository.syncCatalog(MONEY_MARKET_INSTRUMENTS);
  }

  sync(): Promise<MoneyMarketSyncResult> {
    this.currentSync ??= this.performSync().finally(() => {
      this.currentSync = undefined;
    });
    return this.currentSync;
  }

  async snapshot(): Promise<MoneyMarketSnapshot> {
    const now = this.now();
    const [inputs, historyInputs] = await Promise.all([
      this.repository.readValuationInputs(),
      this.repository.readHistoryInputs()
    ]);
    const analytics = fifoInvestmentLots(lotEvents(inputs.events));
    const prices = new Map(inputs.prices.map((price) => [price.canonicalKey, price]));
    const definitions = new Map(MONEY_MARKET_INSTRUMENTS.map((definition) => [definition.canonicalKey, definition]));
    const aggregated = new Map<string, { quantity: string; costBasisMinor: number }>();
    for (const position of analytics.openPositions) {
      const current = aggregated.get(position.symbol);
      aggregated.set(position.symbol, {
        quantity: addDecimal(current?.quantity ?? "0", position.quantity),
        costBasisMinor: (current?.costBasisMinor ?? 0) + position.costBasisMinor
      });
    }

    const positions = [...aggregated.entries()].map(([canonicalKey, lot]): MoneyMarketPosition => {
      const definition = definitions.get(canonicalKey);
      if (!definition) throw new Error(`No market-data definition exists for ${canonicalKey}.`);
      const price = prices.get(canonicalKey);
      if (!price || (price.currency === "USD" && !price.quotePerEuro)) {
        return {
          canonicalKey,
          name: definition.name,
          assetClass: definition.assetClass,
          quantity: lot.quantity,
          costBasisMinor: lot.costBasisMinor,
          state: "unpriced"
        };
      }
      const value = marketValueMinor(lot.quantity, price.close, price.quotePerEuro);
      const maxAgeDays = definition.assetClass === "crypto" ? 2 : 4;
      return {
        canonicalKey,
        name: definition.name,
        assetClass: definition.assetClass,
        quantity: lot.quantity,
        costBasisMinor: lot.costBasisMinor,
        marketValueMinor: value,
        unrealizedGainMinor: value - lot.costBasisMinor,
        close: price.close,
        currency: price.currency,
        ...(price.quotePerEuro ? { quotePerEuro: price.quotePerEuro } : {}),
        priceDate: price.priceDate,
        providerKey: price.providerKey,
        state: ageDays(price.priceDate, now) <= maxAgeDays ? "fresh" : "stale"
      };
    }).sort((left, right) => (right.marketValueMinor ?? -1) - (left.marketValueMinor ?? -1) || left.name.localeCompare(right.name));

    const valued = positions.filter((position): position is MoneyMarketPosition & { marketValueMinor: number; unrealizedGainMinor: number } => position.marketValueMinor !== undefined && position.unrealizedGainMinor !== undefined);
    return {
      asOf: now.toISOString(),
      positions,
      history: historyPoints(historyInputs),
      totals: {
        costBasisMinor: positions.reduce((sum, position) => sum + position.costBasisMinor, 0),
        knownMarketValueMinor: valued.reduce((sum, position) => sum + position.marketValueMinor, 0),
        knownUnrealizedGainMinor: valued.reduce((sum, position) => sum + position.unrealizedGainMinor, 0),
        complete: positions.every((position) => position.state !== "unpriced")
      }
    };
  }

  readiness() {
    return this.repository.readiness();
  }

  close() {
    return this.repository.close();
  }

  private async performSync(): Promise<MoneyMarketSyncResult> {
    await this.initializeCatalog();
    const targets = await this.repository.syncTargets();
    const today = this.now().toISOString().slice(0, 10);
    let succeeded = 0;
    let failed = 0;
    let pricesSaved = 0;
    for (const target of targets) {
      const from = target.lastPriceDate ? maxDate(target.firstRequiredDate, addDays(target.lastPriceDate, -7)) : target.firstRequiredDate;
      try {
        const series = await this.yahoo.dailySeries({ providerKey: target.providerKey, currency: target.currency }, from, today);
        const bars = series.bars.filter((bar) => bar.date >= from && bar.date <= today);
        await this.repository.saveSeriesSuccess({ seriesId: target.seriesId, bars, fetchedAt: this.now() });
        succeeded += 1;
        pricesSaved += bars.length;
      } catch (error) {
        await this.repository.saveSeriesFailure({
          seriesId: target.seriesId,
          errorCode: error instanceof MoneyMarketProviderError ? error.code : "provider_unavailable",
          attemptedAt: this.now()
        });
        failed += 1;
      }
    }

    let ratesSaved = 0;
    const usdTargets = targets.filter((target) => target.currency === "USD");
    if (usdTargets.length) {
      const from = usdTargets.map((target) => target.firstRequiredDate).sort()[0]!;
      const rates = await this.ecb.usdRates(from, today);
      await this.repository.saveUsdRates(rates, this.now());
      ratesSaved = rates.length;
    }
    let inflationIndicesSaved = 0;
    if (targets.length) {
      const from = addDays(targets.map((target) => target.firstRequiredDate).sort()[0]!, -62);
      try {
        const indices = await this.inflation.euroAreaHicp(from, today);
        await this.repository.saveInflationIndices(indices, this.now());
        inflationIndicesSaved = indices.length;
      } catch {
        // Portfolio prices remain useful when the independent inflation feed is unavailable.
      }
    }
    return { series: targets.length, succeeded, failed, pricesSaved, ratesSaved, inflationIndicesSaved };
  }
}

function historyPoints(inputs: Awaited<ReturnType<MoneyMarketDataRepository["readHistoryInputs"]>>) {
  if (!inputs.events.length || !inputs.prices.length) return [];
  const firstEventDate = inputs.events.map((event) => event.localDate).sort()[0]!;
  const dates = [...new Set(inputs.prices.map((price) => price.date).filter((date) => date >= firstEventDate))].sort();
  const events = [...inputs.events].sort((left, right) => left.localDate.localeCompare(right.localDate) || left.occurredAt.localeCompare(right.occurredAt) || left.sourceOrder.localeCompare(right.sourceOrder));
  const prices = [...inputs.prices].sort((left, right) => left.date.localeCompare(right.date) || left.canonicalKey.localeCompare(right.canonicalKey));
  const rates = [...inputs.usdRates].sort((left, right) => left.date.localeCompare(right.date));
  const inflationIndices = [...inputs.inflationIndices].sort((left, right) => left.date.localeCompare(right.date));
  const activeEvents: typeof events = [];
  const latestPrices = new Map<string, (typeof prices)[number]>();
  let latestUsdRate: string | undefined;
  let eventIndex = 0;
  let priceIndex = 0;
  let rateIndex = 0;
  let inflationIndex = 0;
  let latestInflation: number | undefined;
  let previousInflation: number | undefined;
  let inflationBenchmarkMinor: number | undefined;
  let target7PercentMinor: number | undefined;
  let previousCostBasisMinor: number | undefined;
  let previousDate: string | undefined;

  return dates.flatMap((date) => {
    while (eventIndex < events.length && events[eventIndex]!.localDate <= date) activeEvents.push(events[eventIndex++]!);
    while (priceIndex < prices.length && prices[priceIndex]!.date <= date) {
      const price = prices[priceIndex++]!;
      latestPrices.set(price.canonicalKey, price);
    }
    while (rateIndex < rates.length && rates[rateIndex]!.date <= date) latestUsdRate = rates[rateIndex++]!.quotePerEuro;
    while (inflationIndex < inflationIndices.length && inflationIndices[inflationIndex]!.date <= date) {
      latestInflation = Number(inflationIndices[inflationIndex++]!.value);
    }
    const openPositions = fifoInvestmentLots(lotEvents(activeEvents)).openPositions;
    if (!openPositions.length) {
      previousCostBasisMinor = 0;
      previousDate = date;
      previousInflation = latestInflation;
      inflationBenchmarkMinor = undefined;
      target7PercentMinor = undefined;
      return [];
    }
    let costBasisMinor = 0;
    let knownMarketValueMinor = 0;
    let complete = true;
    for (const position of openPositions) {
      costBasisMinor += position.costBasisMinor;
      const price = latestPrices.get(position.symbol);
      if (!price || (price.currency === "USD" && !latestUsdRate)) {
        complete = false;
        continue;
      }
      knownMarketValueMinor += marketValueMinor(position.quantity, price.close, price.currency === "USD" ? latestUsdRate : undefined);
    }
    const basisChange = costBasisMinor - (previousCostBasisMinor ?? costBasisMinor);
    if (target7PercentMinor === undefined) target7PercentMinor = costBasisMinor;
    else target7PercentMinor = Math.round(target7PercentMinor * 1.07 ** (daysBetween(previousDate!, date) / 365.2425) + basisChange);
    if (latestInflation !== undefined) {
      if (inflationBenchmarkMinor === undefined || previousInflation === undefined) inflationBenchmarkMinor = costBasisMinor;
      else inflationBenchmarkMinor = Math.round(inflationBenchmarkMinor * (latestInflation / previousInflation) + basisChange);
      previousInflation = latestInflation;
    }
    previousCostBasisMinor = costBasisMinor;
    previousDate = date;
    return [{
      date,
      costBasisMinor,
      knownMarketValueMinor,
      knownUnrealizedGainMinor: knownMarketValueMinor - costBasisMinor,
      ...(inflationBenchmarkMinor === undefined ? {} : { inflationBenchmarkMinor }),
      target7PercentMinor,
      complete
    }];
  });
}

function daysBetween(left: string, right: string) {
  return (new Date(`${right}T00:00:00Z`).valueOf() - new Date(`${left}T00:00:00Z`).valueOf()) / 86_400_000;
}

function lotEvents(events: readonly import("./money-market-data-repository.js").MoneyMarketValuationEvent[]) {
  return events.map((event) => ({
    accountKey: event.accountKey,
    occurredAt: event.occurredAt,
    sourceOrder: event.sourceOrder,
    eventKind: event.eventKind,
    symbol: event.canonicalKey,
    ...(event.quantity ? { quantity: event.quantity } : {}),
    baseAmountMinor: event.baseAmountMinor,
    baseFeeMinor: event.baseFeeMinor
  }));
}

const QUANTITY_SCALE = 1_000_000_000_000n;

function addDecimal(left: string, right: string) {
  return decimalString(fixedDecimal(left) + fixedDecimal(right));
}

function fixedDecimal(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(value);
  if (!match) throw new Error(`Invalid quantity ${JSON.stringify(value)}.`);
  const result = BigInt(match[2]!) * QUANTITY_SCALE + BigInt((match[3] ?? "").padEnd(12, "0") || "0");
  return match[1] ? -result : result;
}

function decimalString(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / QUANTITY_SCALE;
  const fraction = String(absolute % QUANTITY_SCALE).padStart(12, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function maxDate(left: string, right: string) {
  return left > right ? left : right;
}

function ageDays(date: string, now: Date) {
  return Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - new Date(`${date}T00:00:00Z`).valueOf()) / 86_400_000);
}
