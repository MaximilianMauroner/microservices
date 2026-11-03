import { addDays } from "../domain.js";
import type { Settings } from "../settings.js";
import type { ModelDay, ModelSummary } from "./engine.js";
import { deviationSquares, rSquared, slope, slopeError } from "./stats.js";
import { fixed } from "./text.js";

/** A forecast is hidden when the latest measured weight is older than this many days (sheet Model B69). */
export const FORECAST_MAX_WEIGHT_AGE = 3;

export const PROJECTION_STATUSES = ["No fresh trend", "Building", "Stale weight", "Weight gap", "Review: rapid trend", "Ready"] as const;
/** Why the observed projection is or is not shown. */
export type ProjectionStatus = (typeof PROJECTION_STATUSES)[number];

/** One day of the conditional projection. A trend scenario, not a fat-mass forecast. */
export type ProjectionPoint = Readonly<{ day: string; kg: number; low: number; high: number }>;

/** The weight projection on the review date (sheet "Dashboard data" R11:R71). Rates are kg per week unless named per day. */
export type Projection = Readonly<{
  /** The current trend weight, and the trend seven days earlier. */
  trend: number | null;
  trendWeekAgo: number | null;
  trendChange: number | null;
  /** Measured weight days in the last 21 days, and the days between the first and last of them. */
  weighInDays: number;
  span: number | null;
  /** The fitted 21-day weight slope in kg per day, and its standard error. */
  slope: number | null;
  slopeError: number | null;
  /** The weekly rate used for the projection. Only when the status is Ready. */
  weeklyRate: number | null;
  /** The half-width of the weekly-rate scenario: the largest of the regression error, the floor, and the window sensitivity. */
  weeklyHalfWidth: number | null;
  /** The target path: the trend reduced by the weekly rate target over one and two horizons. A plan, not a prediction. */
  targetShort: number | null;
  targetLong: number | null;
  /** The observed projection at the horizon. Only when the status is Ready. */
  low: number | null;
  mid: number | null;
  high: number | null;
  status: ProjectionStatus;
  /** The 21-day slope as kg per week, its R², and the same rate only when the status is Ready. */
  shortTermSlope: number | null;
  fit: number | null;
  shortTermRate: number | null;
  /** The status, or whether the projection is window-sensitive. */
  trendStatus: ProjectionStatus | "Window-sensitive" | "Conditional projection";
  /** Weekly rates from 14 and up to 28 days of measured weights, when each has enough data. */
  rate14: number | null;
  rate28: number | null;
  /** The largest distance of those rates from the 21-day rate. */
  windowSensitivity: number | null;
  /** The residual standard deviation of the measured weights around the 21-day fit, in kg. */
  residual: number | null;
  /** The longest gap between measured weights in the last 21 days. */
  maxGap: number | null;
  /** The daily projection from the review date to the horizon, with its scenario range. Empty unless Ready. */
  path: readonly ProjectionPoint[];
  /** The goal and projection sentence shown on Progress. */
  summary: string;
}>;

type Points = { xs: number[]; ys: number[] };

function measured(rows: readonly ModelDay[], from: string, to: string): Points {
  const xs: number[] = [], ys: number[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.day >= from && row.day <= to && row.weight.actual !== null) {
      xs.push(index);
      ys.push(row.weight.actual);
    }
  }
  return { xs, ys };
}

const spanOf = ({ xs }: Points) => (xs.length ? xs[xs.length - 1] - xs[0] : 0);

/** The observed weight projection for the review date of `summary`. `rows` are the model rows of the same run. */
export function projectWeight(rows: readonly ModelDay[], summary: ModelSummary, settings: Settings): Projection {
  const review = summary.reviewDate;
  const trend = summary.trend;
  const trendWeekAgo = rows.find((row) => row.day === addDays(review, -7))?.weight.trend ?? null;
  const window = measured(rows, addDays(review, -20), review);
  const weighInDays = window.xs.length;
  const span = weighInDays >= 2 ? spanOf(window) : null;
  const fitted = weighInDays < settings.projectionMinWeighDays || (span ?? 0) < settings.projectionMinSpan ? null : slope(window.ys, window.xs);
  const fittedError = fitted === null ? null : slopeError(window.ys, window.xs);

  const rateOver = (days: number, minRows: number, minSpan: number) => {
    const points = measured(rows, addDays(review, -(days - 1)), review);
    const value = points.xs.length >= minRows && spanOf(points) >= minSpan ? slope(points.ys, points.xs) : null;
    return value === null ? null : 7 * value;
  };
  const rate14 = rateOver(14, 7, 10);
  const rate28 = rateOver(28, settings.projectionMinWeighDays, settings.projectionMinSpan);
  const windowSensitivity = fitted === null ? null : Math.max(rate14 === null ? 0 : Math.abs(rate14 - 7 * fitted), rate28 === null ? 0 : Math.abs(rate28 - 7 * fitted));
  const floor = ((trend ?? 0) * settings.projectionFloorPercent) / 100;
  const weeklyHalfWidth = fitted === null || fittedError === null ? null : Math.max(2 * fittedError * 7, floor, windowSensitivity ?? 0);

  const first = window.xs[0];
  const gaps = window.xs.filter((x) => x > first).map((x) => rows[x].weight.gap ?? 0);
  const maxGap = gaps.length ? Math.max(...gaps) : null;
  const status: ProjectionStatus = trend === null ? "No fresh trend"
    : weighInDays < settings.projectionMinWeighDays || (span ?? 0) < settings.projectionMinSpan || fitted === null ? "Building"
    : (summary.weightAge ?? 0) > FORECAST_MAX_WEIGHT_AGE ? "Stale weight"
    : maxGap === null || maxGap > settings.maxWeightGap ? "Weight gap"
    : fitted * 7 < (-trend * settings.projectionMaxLossPercent) / 100 || fitted * 7 > (trend * settings.projectionMaxGainPercent) / 100 ? "Review: rapid trend"
    : "Ready";
  const ready = status === "Ready";
  const weeklyRate = ready ? (fitted as number) * 7 : null;
  const weeks = settings.projectionHorizonWeeks;
  const at = (rate: number) => Math.max(0, (trend as number) + rate * weeks);
  const target = (horizons: number) => (trend === null ? null : trend * (1 - settings.rateTargetPercent / 100) ** (horizons * weeks));
  const mid = ready ? at(weeklyRate as number) : null;
  const low = ready && weeklyHalfWidth !== null ? at((weeklyRate as number) - weeklyHalfWidth) : null;
  const high = ready && weeklyHalfWidth !== null ? at((weeklyRate as number) + weeklyHalfWidth) : null;
  const path: ProjectionPoint[] = ready && weeklyHalfWidth !== null ? Array.from({ length: weeks * 7 + 1 }, (_, offset) => {
    const line = (rate: number) => Math.max(0, (trend as number) + (rate / 7) * offset);
    return { day: addDays(review, offset), kg: line(weeklyRate as number), low: line((weeklyRate as number) - weeklyHalfWidth), high: line((weeklyRate as number) + weeklyHalfWidth) };
  }) : [];
  const shortTermSlope = fitted === null ? null : fitted * 7;
  const trendStatus = !ready ? status : (windowSensitivity ?? 0) > Math.max(2 * (fittedError as number) * 7, floor) ? "Window-sensitive" : "Conditional projection";

  const goal = trend === null ? "Waiting for fresh weight data. " : `Goal distance: ${fixed(Math.max(0, trend - settings.goalHigh), 1)} kg to ${fixed(settings.goalHigh)} kg. `;
  const outlook = ready
    ? `${weeks}-week conditional trend: ${fixed(mid as number, 1)} kg midpoint (${fixed(low as number, 1)} - ${fixed(high as number, 1)} kg scenario). ${trendStatus}; not a fat-mass forecast.`
    : `Projection unavailable: ${status}.`;

  return {
    trend, trendWeekAgo, trendChange: trend === null || trendWeekAgo === null ? null : trend - trendWeekAgo,
    weighInDays, span, slope: fitted, slopeError: fittedError, weeklyRate, weeklyHalfWidth,
    targetShort: target(1), targetLong: target(2), low, mid, high, status,
    shortTermSlope, fit: fitted === null ? null : rSquared(window.ys, window.xs), shortTermRate: ready ? shortTermSlope : null, trendStatus,
    rate14, rate28, windowSensitivity, residual: fittedError === null ? null : fittedError * Math.sqrt(deviationSquares(window.xs)), maxGap, path,
    summary: goal + outlook
  };
}
