/** Net-worth projection for the Plan view. */
type PredictionPoint = Readonly<{
  date: string;
  actual?: number;
  estimate?: number;
  range?: readonly [number, number];
  inflation?: number;
}>;
export type MoneyTrajectoryPrediction = Readonly<{
  historyMonths: number;
  horizonMonths: number;
  monthlyContribution: number;
  annualGrowthRate: number;
  annualGrowthRange: readonly [number, number];
  annualInflationRate: number;
  monthlyReturnVariation: number;
  points: readonly PredictionPoint[];
  forecast: readonly Required<
    Pick<PredictionPoint, "date" | "estimate" | "range" | "inflation">
  >[];
}>;

export type PortfolioProjectionPoint = Readonly<{
  date: string;
  costBasisMinor: number;
  knownMarketValueMinor: number;
  inflationBenchmarkMinor?: number;
  complete: boolean;
}>;

/** Compounds flow-adjusted portfolio returns and continues recent contributions. */
export function projectMoneyTrajectory(
  months: readonly Readonly<{ date: string; total: number }>[],
  horizonMonths: number,
  portfolioHistory: readonly PortfolioProjectionPoint[],
  monthlyContributionOverride?: number,
): MoneyTrajectoryPrediction | undefined {
  const observed = months
    .filter((month) => Number.isFinite(month.total))
    .slice(-60);
  const portfolioByMonth = new Map<string, PortfolioProjectionPoint>();
  for (const point of portfolioHistory) {
    if (point.complete && point.knownMarketValueMinor > 0) {
      portfolioByMonth.set(point.date.slice(0, 7), point);
    }
  }
  const portfolio = [...portfolioByMonth.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-60);
  if (observed.length < 6 || portfolio.length < 6) return undefined;

  const intervals = portfolio.slice(1).flatMap((point, index) => {
    const previous = portfolio[index]!;
    const basisChange = point.costBasisMinor - previous.costBasisMinor;
    const growthFactor =
      (point.knownMarketValueMinor - basisChange) /
      previous.knownMarketValueMinor;
    return growthFactor > 0
      ? [{ basisChange, logReturn: Math.log(growthFactor) }]
      : [];
  });
  if (intervals.length < 5) return undefined;

  const meanLogReturn = mean(intervals.map(({ logReturn }) => logReturn));
  const monthlyReturnVariation = Math.sqrt(
    intervals.reduce(
      (sum, { logReturn }) => sum + (logReturn - meanLogReturn) ** 2,
      0,
    ) / Math.max(intervals.length - 1, 1),
  );
  const returnMargin =
    1.281551565545 * monthlyReturnVariation / Math.sqrt(intervals.length);
  const monthlyRates = [
    Math.exp(meanLogReturn - returnMargin) - 1,
    Math.exp(meanLogReturn) - 1,
    Math.exp(meanLogReturn + returnMargin) - 1,
  ] as const;
  const annualGrowthRange = [
    Math.exp((meanLogReturn - returnMargin) * 12) - 1,
    Math.exp((meanLogReturn + returnMargin) * 12) - 1,
  ] as const;
  const historicalMonthlyContribution =
    mean(intervals.slice(-12).map(({ basisChange }) => basisChange)) / 100;
  const monthlyContribution =
    monthlyContributionOverride !== undefined &&
    Number.isFinite(monthlyContributionOverride) &&
    monthlyContributionOverride >= 0
      ? monthlyContributionOverride
      : historicalMonthlyContribution;
  const inflationReturns = portfolio.slice(1).flatMap((point, index) => {
    const previous = portfolio[index]!;
    if (
      point.inflationBenchmarkMinor === undefined ||
      previous.inflationBenchmarkMinor === undefined ||
      previous.inflationBenchmarkMinor <= 0
    ) {
      return [];
    }
    const basisChange = point.costBasisMinor - previous.costBasisMinor;
    const factor =
      (point.inflationBenchmarkMinor - basisChange) /
      previous.inflationBenchmarkMinor;
    return factor > 0 ? [Math.log(factor)] : [];
  });
  if (inflationReturns.length < 5) return undefined;
  const meanInflationLogReturn = mean(inflationReturns);
  const monthlyInflationRate = Math.exp(meanInflationLogReturn) - 1;
  const latest = observed.at(-1)!;
  const latestPortfolio = portfolio.at(-1)!.knownMarketValueMinor / 100;
  const currentCash = latest.total - latestPortfolio;
  let lowPortfolio = latestPortfolio;
  let centralPortfolio = latestPortfolio;
  let highPortfolio = latestPortfolio;
  let inflationBenchmark = latest.total;
  const forecast = Array.from({ length: horizonMonths }, (_, index) => {
    const monthsAhead = index + 1;
    lowPortfolio = lowPortfolio * (1 + monthlyRates[0]) + monthlyContribution;
    centralPortfolio =
      centralPortfolio * (1 + monthlyRates[1]) + monthlyContribution;
    highPortfolio =
      highPortfolio * (1 + monthlyRates[2]) + monthlyContribution;
    inflationBenchmark =
      inflationBenchmark * (1 + monthlyInflationRate) + monthlyContribution;
    const estimate = currentCash + centralPortfolio;
    return {
      date: addCalendarMonths(latest.date, monthsAhead),
      estimate,
      range: [currentCash + lowPortfolio, currentCash + highPortfolio] as const,
      inflation: inflationBenchmark,
    };
  });

  return {
    historyMonths: portfolio.length,
    horizonMonths,
    monthlyContribution,
    annualGrowthRate: Math.exp(meanLogReturn * 12) - 1,
    annualGrowthRange,
    annualInflationRate: Math.exp(meanInflationLogReturn * 12) - 1,
    monthlyReturnVariation,
    points: [
      ...observed.map((month, index) => ({
        date: month.date,
        actual: month.total,
        ...(index === observed.length - 1
          ? {
              estimate: latest.total,
              range: [latest.total, latest.total] as const,
              inflation: latest.total,
            }
          : {}),
      })),
      ...forecast,
    ],
    forecast,
  };
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function addCalendarMonths(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}
