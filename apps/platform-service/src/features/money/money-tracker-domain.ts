export type MoneyTrackerAccountCategory = "money" | "stocks";

export type MoneyTrackerTrendPoint = Readonly<{
  date: string;
  total: number;
  money: number;
  stocks: number;
}>;

type TrendChange = Readonly<{ change: number; percent?: number }>;

export type MoneyTrackerTrendStats = Readonly<{
  periodChange?: TrendChange;
  allTimeChange?: TrendChange;
  yearOverYear?: Readonly<{
    comparisonDate: string;
    total: TrendChange;
    money: TrendChange;
    stocks: TrendChange;
  }>;
  momentum?: TrendChange;
  highWaterMark?: Readonly<{ date: string; value: number }>;
  drawdown?: TrendChange;
  drawdowns: readonly Readonly<{ date: string; change: number; percent?: number }>[];
  maximumDrawdown?: Readonly<{ date: string; peakDate: string; change: number; percent?: number }>;
  positiveMonths: Readonly<{ positive: number; total: number; rate?: number }>;
  averageMonthlyChange?: number;
  averageMoneyChange?: number;
  averageStocksChange?: number;
  geometricAverageMonthlyPercent?: number;
  yearlyChanges: readonly Readonly<{ year: number; change: number; percent?: number }>[];
  allocation?: Readonly<{
    current: Readonly<{ money: number; stocks: number }>;
    previousYear?: Readonly<{ date: string; money: number; stocks: number }>;
  }>;
}>;

export type MoneyTrackerForecastHorizon = 6 | 12 | 24;
export type MoneyTrackerForecastConfidence = "low" | "medium" | "high";

type ForecastMetric = Readonly<{
  current: number;
  monthlyTrend: number;
  projected: number;
  change: number;
}>;

export type MoneyTrackerForecast = Readonly<{
  horizon: MoneyTrackerForecastHorizon;
  sampleCount: number;
  confidence: MoneyTrackerForecastConfidence;
  total: ForecastMetric;
  money: ForecastMetric;
  stocks: ForecastMetric;
  points: readonly Readonly<{
    date: string;
    total: number;
    money: number;
    stocks: number;
    lowerTotal: number;
    upperTotal: number;
  }>[];
  scenarios: readonly Readonly<{
    label: "Conservative" | "Base trend" | "Upper historical";
    monthlyChange: number;
    projected: number;
  }>[];
  milestones: readonly Readonly<{
    value: number;
    estimatedDate: string;
    earliestDate?: string;
    latestDate?: string;
    confidence: MoneyTrackerForecastConfidence;
  }>[];
}>;

/** Classifies accounts using the naming contract chosen for the money tracker UI. */
export function moneyTrackerAccountCategory(account: string): MoneyTrackerAccountCategory {
  return /stocks?$/i.test(account.trim()) ? "stocks" : "money";
}

/** Calculates snapshot trends without treating balance changes as investment returns. */
export function moneyTrackerTrendStats(
  period: readonly MoneyTrackerTrendPoint[],
  history: readonly MoneyTrackerTrendPoint[] = period
): MoneyTrackerTrendStats {
  const latest = period.at(-1);
  const first = period.at(0);
  const changes = period.slice(1).map((point, index) => point.total - period[index]!.total);
  const moneyChanges = period.slice(1).map((point, index) => point.money - period[index]!.money);
  const stocksChanges = period.slice(1).map((point, index) => point.stocks - period[index]!.stocks);
  const positive = changes.filter((change) => change > 0).length;
  const firstHistorical = history.at(0);
  const high = history.length ? history.reduce((best, point) => point.total > best.total ? point : best) : undefined;
  const historicalDrawdowns = drawdownPoints(history);
  const visibleDates = new Set(period.map((point) => point.date));
  const drawdowns = historicalDrawdowns.filter((point) => visibleDates.has(point.date));
  const currentDrawdown = latest ? historicalDrawdowns.findLast((point) => point.date === latest.date) : undefined;
  const maximumDrawdown = historicalDrawdowns.length
    ? historicalDrawdowns.reduce((worst, point) => (point.percent ?? 0) < (worst.percent ?? 0) ? point : worst)
    : undefined;
  const previousYear = latest ? findPreviousYear(history, latest.date) : undefined;
  const currentWindow = period.slice(-3);
  const previousWindow = period.slice(-6, -3);
  const currentAllocation = latest ? allocation(latest) : undefined;

  return {
    periodChange: latest && first ? change(latest.total, first.total) : undefined,
    allTimeChange: latest && firstHistorical ? change(latest.total, firstHistorical.total) : undefined,
    yearOverYear: latest && previousYear ? {
      comparisonDate: previousYear.date,
      total: change(latest.total, previousYear.total),
      money: change(latest.money, previousYear.money),
      stocks: change(latest.stocks, previousYear.stocks)
    } : undefined,
    momentum: currentWindow.length === 3 && previousWindow.length === 3
      ? change(average(currentWindow.map((point) => point.total)), average(previousWindow.map((point) => point.total)))
      : undefined,
    highWaterMark: high ? { date: high.date, value: high.total } : undefined,
    drawdown: currentDrawdown ? { change: currentDrawdown.change, percent: currentDrawdown.percent } : undefined,
    drawdowns,
    maximumDrawdown,
    positiveMonths: {
      positive,
      total: changes.length,
      rate: changes.length ? positive / changes.length * 100 : undefined
    },
    averageMonthlyChange: changes.length ? average(changes) : undefined,
    averageMoneyChange: moneyChanges.length ? average(moneyChanges) : undefined,
    averageStocksChange: stocksChanges.length ? average(stocksChanges) : undefined,
    geometricAverageMonthlyPercent: latest && first && period.length > 1 && latest.total > 0 && first.total > 0
      ? (Math.pow(latest.total / first.total, 1 / (period.length - 1)) - 1) * 100
      : undefined,
    yearlyChanges: yearlyChanges(history),
    allocation: currentAllocation ? {
      current: currentAllocation,
      previousYear: previousYear ? { date: previousYear.date, ...allocation(previousYear) } : undefined
    } : undefined
  };
}

/** Extrapolates observed balances. It does not estimate investment returns or cash flow. */
export function moneyTrackerForecast(
  history: readonly MoneyTrackerTrendPoint[],
  horizon: MoneyTrackerForecastHorizon
): MoneyTrackerForecast | undefined {
  if (history.length < 6) return undefined;
  const latest = history.at(-1)!;
  const totalValues = history.map((point) => point.total);
  const moneyValues = history.map((point) => point.money);
  const stockValues = history.map((point) => point.stocks);
  const totalChanges = differences(totalValues);
  const totalSlope = linearSlope(totalValues);
  const moneySlope = linearSlope(moneyValues);
  const stocksSlope = linearSlope(stockValues);
  const volatility = standardDeviation(totalChanges);
  const lowerSlope = Math.min(quantile(totalChanges, 0.25), totalSlope);
  const upperSlope = Math.max(quantile(totalChanges, 0.75), totalSlope);
  const confidence: MoneyTrackerForecastConfidence = history.length < 12 ? "low" : history.length < 24 ? "medium" : "high";
  const points = Array.from({ length: horizon }, (_, index) => {
    const step = index + 1;
    const total = project(latest.total, totalSlope, step);
    const spread = volatility * Math.sqrt(step) * 1.28;
    return {
      date: addMonths(latest.date, step),
      total,
      money: project(latest.money, moneySlope, step),
      stocks: project(latest.stocks, stocksSlope, step),
      lowerTotal: Math.max(0, total - spread),
      upperTotal: total + spread
    };
  });

  return {
    horizon,
    sampleCount: history.length,
    confidence,
    total: forecastMetric(latest.total, totalSlope, horizon),
    money: forecastMetric(latest.money, moneySlope, horizon),
    stocks: forecastMetric(latest.stocks, stocksSlope, horizon),
    points,
    scenarios: [
      { label: "Conservative", monthlyChange: lowerSlope, projected: project(latest.total, lowerSlope, horizon) },
      { label: "Base trend", monthlyChange: totalSlope, projected: project(latest.total, totalSlope, horizon) },
      { label: "Upper historical", monthlyChange: upperSlope, projected: project(latest.total, upperSlope, horizon) }
    ],
    milestones: forecastMilestones(latest.date, latest.total, totalSlope, lowerSlope, upperSlope, confidence)
  };
}

function forecastMetric(current: number, monthlyTrend: number, horizon: number): ForecastMetric {
  const projected = project(current, monthlyTrend, horizon);
  return { current, monthlyTrend, projected, change: projected - current };
}

function forecastMilestones(date: string, current: number, baseSlope: number, lowerSlope: number, upperSlope: number, confidence: MoneyTrackerForecastConfidence) {
  if (baseSlope <= 0) return [];
  const first = Math.floor(current / 5_000) * 5_000 + 5_000;
  return Array.from({ length: 3 }, (_, index) => first + index * 5_000).flatMap((value) => {
    const estimatedMonths = Math.ceil((value - current) / baseSlope);
    if (estimatedMonths > 60) return [];
    const earliestMonths = upperSlope > 0 ? Math.max(1, Math.ceil((value - current) / upperSlope)) : undefined;
    const latestMonths = lowerSlope > 0 ? Math.ceil((value - current) / lowerSlope) : undefined;
    return [{
      value,
      estimatedDate: addMonths(date, estimatedMonths),
      earliestDate: earliestMonths === undefined ? undefined : addMonths(date, earliestMonths),
      latestDate: latestMonths === undefined || latestMonths > 60 ? undefined : addMonths(date, latestMonths),
      confidence: estimatedMonths > 24 ? "low" as const : confidence
    }];
  });
}

function linearSlope(values: readonly number[]) {
  const center = (values.length - 1) / 2;
  const numerator = values.reduce((sum, value, index) => sum + (index - center) * value, 0);
  const denominator = values.reduce((sum, _value, index) => sum + Math.pow(index - center, 2), 0);
  return denominator === 0 ? 0 : numerator / denominator;
}

function differences(values: readonly number[]) {
  return values.slice(1).map((value, index) => value - values[index]!);
}

function standardDeviation(values: readonly number[]) {
  if (!values.length) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => Math.pow(value - mean, 2))));
}

function quantile(values: readonly number[], percentile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const remainder = position - lower;
  return sorted[lower]! + ((sorted[lower + 1] ?? sorted[lower]!) - sorted[lower]!) * remainder;
}

function project(current: number, monthlyTrend: number, months: number) {
  return Math.max(0, current + monthlyTrend * months);
}

function addMonths(value: string, months: number) {
  const parsed = parseDate(value);
  if (!parsed) return value;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1 + months, Math.min(parsed.day, 28)));
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

function yearlyChanges(history: readonly MoneyTrackerTrendPoint[]) {
  const years = [...new Set(history.map((point) => parseDate(point.date)?.year).filter((year): year is number => year !== undefined))];
  return years.map((year) => {
    const firstIndex = history.findIndex((point) => parseDate(point.date)?.year === year);
    const last = history.findLast((point) => parseDate(point.date)?.year === year)!;
    const base = firstIndex > 0 ? history[firstIndex - 1]! : history[firstIndex]!;
    return { year, ...change(last.total, base.total) };
  });
}

function findPreviousYear(history: readonly MoneyTrackerTrendPoint[], latestDate: string) {
  const latest = parseDate(latestDate);
  if (!latest) return undefined;
  return history.find((point) => {
    const candidate = parseDate(point.date);
    return candidate?.month === latest.month && candidate.year === latest.year - 1;
  });
}

function parseDate(value: string) {
  const [day, month, year] = value.split("/").map(Number);
  return day && month && year ? { day, month, year } : undefined;
}

function change(current: number, base: number): TrendChange {
  return { change: current - base, percent: base === 0 ? undefined : (current - base) / base * 100 };
}

function allocation(point: MoneyTrackerTrendPoint) {
  return point.total === 0 ? { money: 0, stocks: 0 } : {
    money: point.money / point.total * 100,
    stocks: point.stocks / point.total * 100
  };
}

function drawdownPoints(history: readonly MoneyTrackerTrendPoint[]) {
  let peak: MoneyTrackerTrendPoint | undefined;
  return history.map((point) => {
    if (!peak || point.total >= peak.total) peak = point;
    const drawdown = change(point.total, peak.total);
    return { date: point.date, peakDate: peak.date, ...drawdown };
  });
}

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
