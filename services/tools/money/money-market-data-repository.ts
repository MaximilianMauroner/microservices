import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import type { MoneyInvestmentEventKind } from "./money-import-domain.js";
import type { MoneyDailyPriceBar, MoneyFxRate, MoneyInflationIndex } from "./money-market-data-domain.js";
import type { MoneyMarketInstrumentDefinition } from "./money-market-data-catalog.js";
import { effectiveTransactions } from "./money-repository.js";

export type MoneyMarketSyncTarget = Readonly<{
  seriesId: string;
  canonicalKey: string;
  providerKey: string;
  currency: "EUR" | "USD";
  timezone: string;
  firstRequiredDate: string;
  lastPriceDate?: string;
}>;

export type MoneyMarketValuationEvent = Readonly<{
  accountKey: string;
  canonicalKey: string;
  name: string;
  assetClass: string;
  occurredAt: string;
  localDate: string;
  sourceOrder: string;
  eventKind: MoneyInvestmentEventKind;
  quantity?: string;
  baseAmountMinor: number;
  baseFeeMinor: number;
}>;

export type MoneyHistoricalPrice = Readonly<{
  canonicalKey: string;
  date: string;
  close: string;
  currency: "EUR" | "USD";
}>;

export type MoneyLatestPrice = Readonly<{
  canonicalKey: string;
  providerKey: string;
  close: string;
  priceDate: string;
  currency: "EUR" | "USD";
  quotePerEuro?: string;
  lastSuccessAt?: string;
  lastErrorCode?: string;
}>;

export interface MoneyMarketDataRepository {
  syncCatalog(definitions: readonly MoneyMarketInstrumentDefinition[]): Promise<void>;
  syncTargets(): Promise<readonly MoneyMarketSyncTarget[]>;
  saveSeriesSuccess(input: Readonly<{ seriesId: string; bars: readonly MoneyDailyPriceBar[]; fetchedAt: Date }>): Promise<void>;
  saveSeriesFailure(input: Readonly<{ seriesId: string; errorCode: string; attemptedAt: Date }>): Promise<void>;
  saveUsdRates(rates: readonly MoneyFxRate[], fetchedAt: Date): Promise<void>;
  saveInflationIndices(indices: readonly MoneyInflationIndex[], fetchedAt: Date): Promise<void>;
  readValuationInputs(): Promise<Readonly<{ events: readonly MoneyMarketValuationEvent[]; prices: readonly MoneyLatestPrice[] }>>;
  readHistoryInputs(): Promise<Readonly<{
    events: readonly MoneyMarketValuationEvent[];
    prices: readonly MoneyHistoricalPrice[];
    usdRates: readonly MoneyFxRate[];
    inflationIndices: readonly MoneyInflationIndex[];
  }>>;
  readiness(): Promise<void>;
  close(): Promise<void>;
}

export function createPostgresMoneyMarketDataRepository(databaseUrl: string, options: { readOnly?: boolean } = {}) {
  return postgresMoneyMarketDataRepository(postgres(databaseUrl, { max: 3, connection: options.readOnly ? { default_transaction_read_only: true } : undefined }));
}

export function postgresMoneyMarketDataRepository(sql: Sql): MoneyMarketDataRepository {
  return {
    syncCatalog(definitions) {
      return sql.begin(async (tx) => {
        const now = new Date();
        for (const definition of definitions) {
          const [instrument] = await tx<{ id: string }[]>`
            insert into tools.money_instruments (id, canonical_key, name, asset_class, isin, created_at, updated_at)
            values (${randomUUID()}, ${definition.canonicalKey}, ${definition.name}, ${definition.assetClass}, ${definition.isin ?? null}, ${now}, ${now})
            on conflict (canonical_key) do update set
              name = excluded.name, asset_class = excluded.asset_class, isin = excluded.isin, updated_at = excluded.updated_at
            returning id`;
          const instrumentId = instrument!.id;
          for (const alias of definition.aliases) {
            await tx`insert into tools.money_instrument_aliases
              (source_provider, source_symbol, instrument_id, created_at, updated_at)
              values (${alias.provider}, ${normalizeSymbol(alias.symbol)}, ${instrumentId}, ${now}, ${now})
              on conflict (source_provider, source_symbol) do update set instrument_id = excluded.instrument_id, updated_at = excluded.updated_at`;
          }
          await tx`update tools.money_market_series set active = false, updated_at = ${now}
            where instrument_id = ${instrumentId} and (provider <> ${definition.series.provider} or provider_key <> ${definition.series.providerKey}) and active`;
          await tx`insert into tools.money_market_series
            (id, instrument_id, provider, provider_key, quote_currency, timezone, active, first_required_date,
             last_attempt_at, last_success_at, last_error_code, created_at, updated_at)
            values (${randomUUID()}, ${instrumentId}, ${definition.series.provider}, ${definition.series.providerKey},
              ${definition.series.currency}, ${definition.series.timezone}, true, null, null, null, null, ${now}, ${now})
            on conflict (provider, provider_key) do update set
              instrument_id = excluded.instrument_id, quote_currency = excluded.quote_currency,
              timezone = excluded.timezone, active = true, updated_at = excluded.updated_at`;
        }

        await tx`update tools.money_investment_events e set instrument_id = aliases.instrument_id
          from tools.money_transactions t
          join tools.money_accounts a on a.id = t.account_id
          join tools.money_instrument_aliases aliases
            on aliases.source_provider = a.provider
          where e.transaction_id = t.id and e.symbol is not null
            and aliases.source_symbol = upper(trim(e.symbol))
            and e.instrument_id is distinct from aliases.instrument_id`;

        await tx`update tools.money_market_series s set first_required_date = source.first_required_date, updated_at = ${now}
          from (
            select e.instrument_id, min(t.local_date) - 1 first_required_date
            from tools.money_investment_events e
            join (${effectiveTransactions(tx)}) t on t.id = e.transaction_id
            where e.instrument_id is not null
              and e.event_kind in ('buy', 'sell', 'split', 'position_transfer', 'delivery')
              and e.quantity is not null
            group by e.instrument_id
          ) source
          where s.instrument_id = source.instrument_id and s.active`;
      });
    },

    async syncTargets() {
      const rows = await sql<SyncTargetRow[]>`select s.id, i.canonical_key, s.provider_key, s.quote_currency, s.timezone,
        s.first_required_date::text first_required_date, max(p.price_date)::text last_price_date
        from tools.money_market_series s
        join tools.money_instruments i on i.id = s.instrument_id
        left join tools.money_daily_prices p on p.series_id = s.id
        where s.active and s.first_required_date is not null
        group by s.id, i.canonical_key, s.provider_key, s.quote_currency, s.timezone, s.first_required_date
        order by i.canonical_key`;
      return rows.map((row) => ({
        seriesId: row.id,
        canonicalKey: row.canonical_key,
        providerKey: row.provider_key,
        currency: currency(row.quote_currency),
        timezone: row.timezone,
        firstRequiredDate: row.first_required_date,
        ...(row.last_price_date ? { lastPriceDate: row.last_price_date } : {})
      }));
    },

    saveSeriesSuccess(input) {
      return sql.begin(async (tx) => {
        for (const batch of chunks(input.bars, 500)) {
          if (!batch.length) continue;
          const values = batch.map((bar) => ({ series_id: input.seriesId, price_date: bar.date, close: bar.close, currency: bar.currency, fetched_at: input.fetchedAt }));
          await tx`insert into tools.money_daily_prices ${tx(values)}
            on conflict (series_id, price_date) do update set close = excluded.close, currency = excluded.currency,
              fetched_at = excluded.fetched_at`;
        }
        await tx`update tools.money_market_series set last_attempt_at = ${input.fetchedAt}, last_success_at = ${input.fetchedAt},
          last_error_code = null, updated_at = ${input.fetchedAt} where id = ${input.seriesId}`;
      });
    },

    async saveSeriesFailure(input) {
      await sql`update tools.money_market_series set last_attempt_at = ${input.attemptedAt}, last_error_code = ${input.errorCode},
        updated_at = ${input.attemptedAt} where id = ${input.seriesId}`;
    },

    async saveUsdRates(rates, fetchedAt) {
      for (const batch of chunks(rates, 500)) {
        if (!batch.length) continue;
        const values = batch.map((rate) => ({ rate_date: rate.date, quote_currency: rate.quoteCurrency, quote_per_euro: rate.quotePerEuro, provider: "ecb", fetched_at: fetchedAt }));
        await sql`insert into tools.money_fx_rates ${sql(values)}
          on conflict (rate_date, quote_currency) do update set quote_per_euro = excluded.quote_per_euro,
            provider = excluded.provider, fetched_at = excluded.fetched_at`;
      }
    },

    async saveInflationIndices(indices, fetchedAt) {
      for (const batch of chunks(indices, 500)) {
        if (!batch.length) continue;
        const values = batch.map((index) => ({ index_date: index.date, value: index.value, provider: "ecb_hicp", fetched_at: fetchedAt }));
        await sql`insert into tools.money_inflation_indices ${sql(values)}
          on conflict (index_date) do update set value = excluded.value,
            provider = excluded.provider, fetched_at = excluded.fetched_at`;
      }
    },

    async readValuationInputs() {
      const [eventRows, priceRows] = await Promise.all([
        sql<ValuationEventRow[]>`select t.account_id::text account_id, i.canonical_key, i.name, i.asset_class,
          t.occurred_at, t.local_date::text local_date, t.source_row, t.source_key, e.event_kind, e.quantity::text quantity,
          t.base_amount_minor::text base_amount_minor, t.base_fee_minor::text base_fee_minor
          from tools.money_investment_events e
          join (${effectiveTransactions(sql)}) t on t.id = e.transaction_id
          join tools.money_instruments i on i.id = e.instrument_id
          where t.base_currency = 'EUR'
          order by t.occurred_at, t.source_row, t.source_key`,
        sql<LatestPriceRow[]>`select i.canonical_key, s.provider_key, p.close::text close, p.price_date::text price_date,
          p.currency, fx.quote_per_euro::text quote_per_euro, s.last_success_at, s.last_error_code
          from tools.money_market_series s
          join tools.money_instruments i on i.id = s.instrument_id
          join lateral (
            select price_date, close, currency from tools.money_daily_prices
            where series_id = s.id order by price_date desc limit 1
          ) p on true
          left join lateral (
            select quote_per_euro from tools.money_fx_rates
            where quote_currency = p.currency and rate_date <= p.price_date
            order by rate_date desc limit 1
          ) fx on p.currency <> 'EUR'
          where s.active`
      ]);
      return {
        events: eventRows.map((row) => ({
          accountKey: row.account_id,
          canonicalKey: row.canonical_key,
          name: row.name,
          assetClass: row.asset_class,
          occurredAt: row.occurred_at.toISOString(),
          localDate: row.local_date,
          sourceOrder: `${String(row.source_row).padStart(10, "0")}\0${row.source_key}`,
          eventKind: row.event_kind,
          ...(row.quantity ? { quantity: normalizeDecimal(row.quantity) } : {}),
          baseAmountMinor: integer(row.base_amount_minor),
          baseFeeMinor: integer(row.base_fee_minor)
        })),
        prices: priceRows.map((row) => ({
          canonicalKey: row.canonical_key,
          providerKey: row.provider_key,
          close: normalizeDecimal(row.close),
          priceDate: row.price_date,
          currency: currency(row.currency),
          ...(row.quote_per_euro ? { quotePerEuro: normalizeDecimal(row.quote_per_euro) } : {}),
          ...(row.last_success_at ? { lastSuccessAt: row.last_success_at.toISOString() } : {}),
          ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {})
        }))
      };
    },

    async readHistoryInputs() {
      const [eventRows, priceRows, rateRows, inflationRows] = await Promise.all([
        sql<ValuationEventRow[]>`select t.account_id::text account_id, i.canonical_key, i.name, i.asset_class,
          t.occurred_at, t.local_date::text local_date, t.source_row, t.source_key, e.event_kind, e.quantity::text quantity,
          t.base_amount_minor::text base_amount_minor, t.base_fee_minor::text base_fee_minor
          from tools.money_investment_events e
          join (${effectiveTransactions(sql)}) t on t.id = e.transaction_id
          join tools.money_instruments i on i.id = e.instrument_id
          where t.base_currency = 'EUR'
          order by t.occurred_at, t.source_row, t.source_key`,
        sql<HistoricalPriceRow[]>`select i.canonical_key, p.price_date::text price_date, p.close::text close, p.currency
          from tools.money_daily_prices p
          join tools.money_market_series s on s.id = p.series_id
          join tools.money_instruments i on i.id = s.instrument_id
          where s.active order by p.price_date, i.canonical_key`,
        sql<FxRateRow[]>`select rate_date::text rate_date, quote_per_euro::text quote_per_euro
          from tools.money_fx_rates where quote_currency = 'USD' order by rate_date`,
        sql<InflationIndexRow[]>`select index_date::text index_date, value::text value
          from tools.money_inflation_indices order by index_date`
      ]);
      return {
        events: eventRows.map(valuationEvent),
        prices: priceRows.map((row) => ({
          canonicalKey: row.canonical_key,
          date: row.price_date,
          close: normalizeDecimal(row.close),
          currency: currency(row.currency)
        })),
        usdRates: rateRows.map((row) => ({ date: row.rate_date, quoteCurrency: "USD", quotePerEuro: normalizeDecimal(row.quote_per_euro) })),
        inflationIndices: inflationRows.map((row) => ({ date: row.index_date, value: normalizeDecimal(row.value) }))
      };
    },

    async readiness() {
      await sql`select 1 from tools.money_market_series limit 1`;
    },

    close: () => sql.end()
  };
}

type SyncTargetRow = { id: string; canonical_key: string; provider_key: string; quote_currency: string; timezone: string; first_required_date: string; last_price_date: string | null };
type ValuationEventRow = { account_id: string; canonical_key: string; name: string; asset_class: string; occurred_at: Date; local_date: string; source_row: number; source_key: string; event_kind: MoneyInvestmentEventKind; quantity: string | null; base_amount_minor: string; base_fee_minor: string };
type LatestPriceRow = { canonical_key: string; provider_key: string; close: string; price_date: string; currency: string; quote_per_euro: string | null; last_success_at: Date | null; last_error_code: string | null };
type HistoricalPriceRow = { canonical_key: string; price_date: string; close: string; currency: string };
type FxRateRow = { rate_date: string; quote_per_euro: string };
type InflationIndexRow = { index_date: string; value: string };

function valuationEvent(row: ValuationEventRow): MoneyMarketValuationEvent {
  return {
    accountKey: row.account_id,
    canonicalKey: row.canonical_key,
    name: row.name,
    assetClass: row.asset_class,
    occurredAt: row.occurred_at.toISOString(),
    localDate: row.local_date,
    sourceOrder: `${String(row.source_row).padStart(10, "0")}\0${row.source_key}`,
    eventKind: row.event_kind,
    ...(row.quantity ? { quantity: normalizeDecimal(row.quantity) } : {}),
    baseAmountMinor: integer(row.base_amount_minor),
    baseFeeMinor: integer(row.base_fee_minor)
  };
}

function normalizeSymbol(value: string) {
  return value.trim().toLocaleUpperCase("en-GB");
}

function currency(value: string): "EUR" | "USD" {
  if (value !== "EUR" && value !== "USD") throw new Error(`Unsupported market currency ${JSON.stringify(value)}.`);
  return value;
}

function integer(value: string) {
  if (!/^-?\d+$/.test(value)) throw new Error("Expected an integer database value.");
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("Database value exceeds the supported integer range.");
  return result;
}

function normalizeDecimal(value: string) {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error("Expected a decimal database value.");
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function chunks<T>(values: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
