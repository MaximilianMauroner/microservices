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
  const latest = period.at(-1);
  const first = period.at(0);
  const changes = period.slice(1).map((point, index) => point.total - period[index]!.total);
  const moneyChanges = period.slice(1).map((point, index) => point.money - period[index]!.money);
  const stocksChanges = period.slice(1).map((point, index) => point.stocks - period[index]!.stocks);
  const positive = changes.filter((change) => change > 0).length;
  const high = period.length ? period.reduce((best, point) => point.total > best.total ? point : best) : undefined;
  const previousYear = latest ? findPreviousYear(history, latest.date) : undefined;
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
    momentum: currentWindow.length === 3 && previousWindow.length === 3
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
