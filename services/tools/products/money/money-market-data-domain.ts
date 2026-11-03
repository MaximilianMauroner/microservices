import { parse } from "csv-parse/sync";

export type MoneyDailyPriceBar = Readonly<{
  date: string;
  close: string;
  currency: "EUR" | "USD";
}>;

export type MoneyYahooSeries = Readonly<{
  providerKey: string;
  currency: "EUR" | "USD";
}>;

export type ParsedYahooSeries = Readonly<{
  providerKey: string;
  name: string;
  currency: "EUR" | "USD";
  bars: readonly MoneyDailyPriceBar[];
  splits: readonly Readonly<{ date: string; numerator: bigint; denominator: bigint }>[];
}>;

const DECIMAL_SCALE = 1_000_000_000_000n;

/** Parses Yahoo daily data and reverses its split normalization into raw historical closes. */
export function parseYahooDailySeries(value: unknown, expected: MoneyYahooSeries): ParsedYahooSeries {
  const root = record(value, "Yahoo response");
  const chart = record(root.chart, "Yahoo chart");
  if (chart.error !== null && chart.error !== undefined) throw new Error("Yahoo returned a chart error.");
  if (!Array.isArray(chart.result) || chart.result.length !== 1) throw new Error("Yahoo returned no unambiguous chart result.");
  const result = record(chart.result[0], "Yahoo result");
  const meta = record(result.meta, "Yahoo metadata");
  const providerKey = requiredString(meta.symbol, "Yahoo symbol");
  if (providerKey.toLocaleUpperCase("en-GB") !== expected.providerKey.toLocaleUpperCase("en-GB")) {
    throw new Error(`Yahoo returned symbol ${JSON.stringify(providerKey)} instead of ${JSON.stringify(expected.providerKey)}.`);
  }
  const currency = requiredString(meta.currency, "Yahoo currency");
  if (currency !== expected.currency) throw new Error(`Yahoo returned ${currency} prices for a ${expected.currency} series.`);
  const name = optionalString(meta.longName) ?? optionalString(meta.shortName) ?? providerKey;
  if (!Array.isArray(result.timestamp)) throw new Error("Yahoo timestamps are missing.");
  const indicators = record(result.indicators, "Yahoo indicators");
  if (!Array.isArray(indicators.quote) || indicators.quote.length !== 1) throw new Error("Yahoo quote data is missing.");
  const quote = record(indicators.quote[0], "Yahoo quote");
  const closes = quote.close;
  if (!Array.isArray(closes) || closes.length !== result.timestamp.length) {
    throw new Error("Yahoo closes do not align with timestamps.");
  }
  const offset = optionalInteger(meta.gmtoffset) ?? 0;
  const splits = yahooSplits(result.events, offset);
  const bars = result.timestamp.flatMap((rawTimestamp, index): MoneyDailyPriceBar[] => {
    const timestamp = integer(rawTimestamp, `Yahoo timestamp ${index}`);
    const rawClose = closes[index];
    if (rawClose === null) return [];
    const close = positiveDecimal(rawClose, `Yahoo close ${index}`);
    const date = unixDate(timestamp, offset);
    const unadjusted = splits.reduce(
      (current, split) => date < split.date ? divideRounded(current * split.numerator, split.denominator) : current,
      close
    );
    return [{ date, close: decimalString(unadjusted), currency: expected.currency }];
  });
  assertIncreasingDates(bars);
  if (!bars.length) throw new Error("Yahoo returned no usable daily closes.");
  return { providerKey, name, currency: expected.currency, bars, splits };
}

export type MoneyFxRate = Readonly<{ date: string; quoteCurrency: "USD"; quotePerEuro: string }>;
export type MoneyInflationIndex = Readonly<{ date: string; value: string }>;

export function parseEcbUsdRates(source: string): readonly MoneyFxRate[] {
  const rows = parse(source, { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  const rates = rows.map((row, index): MoneyFxRate => {
    const date = requiredString(row.TIME_PERIOD, `ECB date ${index + 2}`);
    assertIsoDate(date, `ECB date ${index + 2}`);
    const scaled = positiveDecimal(row.OBS_VALUE, `ECB value ${index + 2}`);
    return { date, quoteCurrency: "USD", quotePerEuro: decimalString(scaled) };
  });
  assertIncreasingDates(rates);
  if (!rates.length) throw new Error("ECB returned no USD rates.");
  return rates;
}

/** Parses the ECB's monthly euro-area all-items HICP index and dates each observation at month end. */
export function parseEcbEuroAreaHicp(source: string): readonly MoneyInflationIndex[] {
  const rows = parse(source, { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  const values = rows.map((row, index): MoneyInflationIndex => {
    const period = requiredString(row.TIME_PERIOD, `ECB HICP period ${index + 2}`);
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`ECB HICP period ${index + 2} must use YYYY-MM.`);
    const date = new Date(`${period}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    const scaled = positiveDecimal(row.OBS_VALUE, `ECB HICP value ${index + 2}`);
    return { date: date.toISOString().slice(0, 10), value: decimalString(scaled) };
  });
  assertIncreasingDates(values);
  if (!values.length) throw new Error("ECB returned no euro-area HICP observations.");
  return values;
}

/** Converts an exact quantity and close to EUR cents using quote-currency units per euro. */
export function marketValueMinor(quantity: string, close: string, quotePerEuro = "1") {
  const quantityScaled = decimal(quantity, "quantity");
  const closeScaled = positiveDecimal(close, "close");
  const rateScaled = positiveDecimal(quotePerEuro, "quotePerEuro");
  const minor = divideRounded(quantityScaled * closeScaled * 100n, DECIMAL_SCALE * rateScaled);
  const result = Number(minor);
  if (!Number.isSafeInteger(result)) throw new Error("Market value exceeds the supported range.");
  return result;
}

function yahooSplits(rawEvents: unknown, offset: number) {
  if (rawEvents === null || rawEvents === undefined) return [];
  const events = record(rawEvents, "Yahoo events");
  if (events.splits === null || events.splits === undefined) return [];
  const splits = record(events.splits, "Yahoo split events");
  return Object.values(splits).map((raw, index) => {
    const split = record(raw, `Yahoo split ${index}`);
    const date = unixDate(integer(split.date, `Yahoo split date ${index}`), offset);
    const numerator = positiveInteger(split.numerator, `Yahoo split numerator ${index}`);
    const denominator = positiveInteger(split.denominator, `Yahoo split denominator ${index}`);
    return { date, numerator, denominator };
  }).sort((left, right) => left.date.localeCompare(right.date));
}

function assertIncreasingDates(values: readonly { date: string }[]) {
  let previous: string | undefined;
  for (const value of values) {
    assertIsoDate(value.date, "market date");
    if (previous && value.date <= previous) throw new Error("Market dates must be unique and increasing.");
    previous = value.date;
  }
}

function unixDate(timestamp: number, offsetSeconds: number) {
  const date = new Date((timestamp + offsetSeconds) * 1_000);
  if (!Number.isFinite(date.valueOf())) throw new Error("Yahoo returned an invalid timestamp.");
  return date.toISOString().slice(0, 10);
}

function decimal(value: unknown, label: string) {
  const source = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = /^(-?)(\d{1,18})(?:\.(\d{1,12}))?$/.exec(source);
  if (!match) throw new Error(`${label} must be a decimal with at most 12 fractional digits.`);
  const scaled = BigInt(match[2]!) * DECIMAL_SCALE + BigInt((match[3] ?? "").padEnd(12, "0") || "0");
  return match[1] ? -scaled : scaled;
}

function positiveDecimal(value: unknown, label: string) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive.`);
    value = value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  }
  const result = decimal(value, label);
  if (result <= 0n) throw new Error(`${label} must be positive.`);
  return result;
}

function decimalString(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / DECIMAL_SCALE;
  const fraction = String(absolute % DECIMAL_SCALE).padStart(12, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function divideRounded(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) throw new Error("Decimal divisor must be positive.");
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const result = (absolute + denominator / 2n) / denominator;
  return negative ? -result : result;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integer(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${label} must be an integer.`);
  return value;
}

function optionalInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function positiveInteger(value: unknown, label: string) {
  const result = integer(value, label);
  if (result <= 0) throw new Error(`${label} must be positive.`);
  return BigInt(result);
}

function assertIsoDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be an ISO date.`);
  }
}
