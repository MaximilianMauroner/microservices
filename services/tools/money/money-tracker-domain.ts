export type MoneyTrackerAccountCategory = "money" | "stocks";

export type MoneyFinancialPosition = Readonly<{
  asOf: string;
  cash: Readonly<{
    valueMinor: number;
    observationDate?: string;
    observedAccountCount: number;
    carriedAccountCount: number;
  }>;
  portfolio: Readonly<{
    knownValueMinor: number;
    priceDate?: string;
    pricedPositionCount: number;
    openPositionCount: number;
    freshPositionCount: number;
  }>;
  knownNetWorthMinor: number;
  state: "complete" | "carried" | "partial";
}>;

export type MoneyFinancialHistoryPoint = Readonly<{
  date: string;
  total: number;
  money: number;
  stocks: number;
  observed: boolean;
  portfolioDate?: string;
}>;

/** Builds the one current financial-position contract shared by every Money page. */
export function moneyFinancialPosition(input: Readonly<{
  asOf: string;
  cashValueMinor: number;
  cashObservationDate?: string;
  observedCashAccountCount: number;
  cashAccountCount: number;
  marketData: Readonly<{
    positions: readonly Readonly<{ state: "fresh" | "stale" | "unpriced"; priceDate?: string }>[];
    totals: Readonly<{ knownMarketValueMinor: number; complete: boolean }>;
  }>;
}>): MoneyFinancialPosition {
  const priced = input.marketData.positions.filter((position) => position.state !== "unpriced");
  const fresh = input.marketData.positions.filter((position) => position.state === "fresh");
  const priceDate = priced.map((position) => position.priceDate).filter((date): date is string => date !== undefined).sort().at(-1);
  const carriedAccountCount = Math.max(input.cashAccountCount - input.observedCashAccountCount, 0);
  const partial = !input.marketData.totals.complete;
  return {
    asOf: input.asOf,
    cash: {
      valueMinor: input.cashValueMinor,
      ...(input.cashObservationDate ? { observationDate: input.cashObservationDate } : {}),
      observedAccountCount: input.observedCashAccountCount,
      carriedAccountCount
    },
    portfolio: {
      knownValueMinor: input.marketData.totals.knownMarketValueMinor,
      ...(priceDate ? { priceDate } : {}),
      pricedPositionCount: priced.length,
      openPositionCount: input.marketData.positions.length,
      freshPositionCount: fresh.length
    },
    knownNetWorthMinor: input.cashValueMinor + input.marketData.totals.knownMarketValueMinor,
    state: partial ? "partial" : carriedAccountCount > 0 || fresh.length !== input.marketData.positions.length ? "carried" : "complete"
  };
}

/** Aligns monthly cash snapshots with the last accepted portfolio close on or before each date. */
export function moneyFinancialHistory(
  cashMonths: readonly Readonly<{ date: string; cashValue: number; observedCashAccountCount: number; cashAccountCount: number }>[],
  portfolioHistory: readonly Readonly<{ date: string; knownMarketValueMinor: number; complete: boolean }>[]
): MoneyFinancialHistoryPoint[] {
  const portfolio = [...portfolioHistory].sort((left, right) => left.date.localeCompare(right.date));
  let portfolioIndex = 0;
  let latestPortfolio: typeof portfolio[number] | undefined;
  return cashMonths.map((month) => {
    while (portfolioIndex < portfolio.length && portfolio[portfolioIndex]!.date <= month.date) {
      latestPortfolio = portfolio[portfolioIndex++]!;
    }
    const stocks = (latestPortfolio?.knownMarketValueMinor ?? 0) / 100;
    return {
      date: month.date,
      money: month.cashValue,
      stocks,
      total: month.cashValue + stocks,
      observed: month.observedCashAccountCount === month.cashAccountCount && latestPortfolio?.complete === true,
      ...(latestPortfolio ? { portfolioDate: latestPortfolio.date } : {})
    };
  });
}

export type MoneyTrackerTrendPoint = Readonly<{
  date: string;
  total: number;
  money: number;
  stocks: number;
  observed?: boolean;
}>;

type TrendChange = Readonly<{ change: number; percent?: number }>;

export type MoneyTrackerTrendStats = Readonly<{
  periodChange?: TrendChange;
  yearOverYear?: Readonly<{
    comparisonDate: string;
    total: TrendChange;
    money: TrendChange;
    stocks: TrendChange;
  }>;
  momentum?: TrendChange;
  highWaterMark?: Readonly<{ date: string; value: number }>;
  drawdown?: TrendChange;
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

/** Classifies accounts using the naming contract chosen for the money tracker UI. */
export function moneyTrackerAccountCategory(account: string): MoneyTrackerAccountCategory {
  return /stocks?$/i.test(account.trim()) ? "stocks" : "money";
}

/** Calculates snapshot trends without treating balance changes as investment returns. */
export function moneyTrackerTrendStats(
  period: readonly MoneyTrackerTrendPoint[],
  history: readonly MoneyTrackerTrendPoint[] = period
): MoneyTrackerTrendStats {
  const observedPeriod = period.filter(isObserved);
  const observedHistory = history.filter(isObserved);
  const latest = observedPeriod.at(-1);
  const first = observedPeriod.at(0);
  const adjacent = period.slice(1).flatMap((point, index) => {
    const previous = period[index]!;
    return isObserved(point) && isObserved(previous) && monthDistance(previous.date, point.date) === 1 ? [{ previous, point }] : [];
  });
  const changes = adjacent.map(({ previous, point }) => point.total - previous.total);
  const moneyChanges = adjacent.map(({ previous, point }) => point.money - previous.money);
  const stocksChanges = adjacent.map(({ previous, point }) => point.stocks - previous.stocks);
  const positive = changes.filter((change) => change > 0).length;
  const high = observedPeriod.length ? observedPeriod.reduce((best, point) => point.total > best.total ? point : best) : undefined;
  const previousYear = latest ? findPreviousYear(observedHistory, latest.date) : undefined;
  const currentWindow = period.slice(-3);
  const previousWindow = period.slice(-6, -3);
  const currentAllocation = latest ? allocation(latest) : undefined;

  return {
    periodChange: latest && first ? change(latest.total, first.total) : undefined,
    yearOverYear: latest && previousYear ? {
      comparisonDate: previousYear.date,
      total: change(latest.total, previousYear.total),
      money: change(latest.money, previousYear.money),
      stocks: change(latest.stocks, previousYear.stocks)
    } : undefined,
    momentum: currentWindow.length === 3 && previousWindow.length === 3 && [...previousWindow, ...currentWindow].every(isObserved) && consecutiveMonths([...previousWindow, ...currentWindow])
      ? change(average(currentWindow.map((point) => point.total)), average(previousWindow.map((point) => point.total)))
      : undefined,
    highWaterMark: high ? { date: high.date, value: high.total } : undefined,
    drawdown: latest && high ? change(latest.total, high.total) : undefined,
    positiveMonths: {
      positive,
      total: changes.length,
      rate: changes.length ? positive / changes.length * 100 : undefined
    },
    averageMonthlyChange: changes.length ? average(changes) : undefined,
    averageMoneyChange: moneyChanges.length ? average(moneyChanges) : undefined,
    averageStocksChange: stocksChanges.length ? average(stocksChanges) : undefined,
    geometricAverageMonthlyPercent: latest && first && latest.total > 0 && first.total > 0 && monthDistance(first.date, latest.date) > 0
      ? (Math.pow(latest.total / first.total, 1 / monthDistance(first.date, latest.date)) - 1) * 100
      : undefined,
    yearlyChanges: yearlyChanges(observedHistory),
    allocation: currentAllocation ? {
      current: currentAllocation,
      previousYear: previousYear ? { date: previousYear.date, ...allocation(previousYear) } : undefined
    } : undefined
  };
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
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const [day, month, year] = value.split("/").map(Number);
  return day && month && year ? { day, month, year } : undefined;
}

function isObserved(point: MoneyTrackerTrendPoint) { return point.observed !== false; }

function monthDistance(from: string, to: string) {
  const start = parseDate(from); const end = parseDate(to);
  return start && end ? (end.year - start.year) * 12 + end.month - start.month : Number.NaN;
}

function consecutiveMonths(points: readonly MoneyTrackerTrendPoint[]) {
  return points.slice(1).every((point, index) => monthDistance(points[index]!.date, point.date) === 1);
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

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
