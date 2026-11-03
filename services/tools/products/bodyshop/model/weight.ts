import { daysBetween, type WeightReading } from "../domain.js";
import type { Settings } from "../settings.js";

/** One measured weight per day: the mean of that day's readings. */
export type DailyWeight = Readonly<{ day: string; kg: number }>;

/**
 * The daily-mean weights, sorted by day. Readings with source Estimated and readings of zero or less are
 * not measurements and are left out.
 */
export function dailyMeanWeights(readings: readonly WeightReading[]): DailyWeight[] {
  const byDay = new Map<string, { sum: number; count: number }>();
  for (const reading of readings) {
    if (!(reading.kg > 0) || reading.source === "Estimated") continue;
    const day = byDay.get(reading.day) ?? { sum: 0, count: 0 };
    day.sum += reading.kg;
    day.count += 1;
    byDay.set(reading.day, day);
  }
  return [...byDay].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, { sum, count }]) => ({ day, kg: sum / count }));
}

export const WEIGHT_BASES = ["Recorded", "Interpolated", "Carried", "No weight"] as const;
export type WeightBasis = (typeof WEIGHT_BASES)[number];

/** The weight view of one calendar day. */
export type WeightDay = Readonly<{
  day: string;
  /** The measured daily-mean weight, or null on a day without a measurement. */
  actual: number | null;
  /** The measured weight, or a straight line between the measurements around a short gap. Display only. */
  display: number | null;
  /** The smoothed trend weight. It carries the last value through days without a display weight. */
  trend: number | null;
  /** Where the display value comes from. */
  basis: WeightBasis;
  /** The latest day with a measured weight, up to this day. */
  lastActual: string | null;
  /** On a measured day: days since the measurement before it, or 0 for the first. Null on other days. */
  gap: number | null;
}>;

/**
 * The display weight and trend for each of `days`, which must be consecutive calendar days. A gap is filled for
 * display only when the next measurement is on or before `reviewDate` and the gap is at most the maximum
 * internal weight gap. The trend is an exponentially weighted mean with the trend smoothing factor.
 */
export function weightTrend(days: readonly string[], means: readonly DailyWeight[], settings: Pick<Settings, "trendAlpha" | "maxWeightGap">, reviewDate: string): WeightDay[] {
  const byDay = new Map(means.map((mean) => [mean.day, mean.kg]));
  const measured = means.filter((mean) => mean.day <= reviewDate);
  const rows: WeightDay[] = [];
  let lastActual: string | null = null;
  let trend: number | null = null;
  for (const [index, day] of days.entries()) {
    const actual = byDay.get(day) ?? null;
    const gap = actual === null ? null : lastActual === null ? 0 : daysBetween(lastActual, day);
    let display = actual;
    if (actual === null && lastActual !== null) {
      const next = measured.find((mean) => mean.day > day);
      const span = next ? daysBetween(lastActual, next.day) : 0;
      if (next && span > 0 && span <= settings.maxWeightGap) {
        const previous = byDay.get(lastActual) as number;
        display = previous + (daysBetween(lastActual, day) / span) * (next.kg - previous);
      }
    }
    if (actual !== null) lastActual = day;
    if (display !== null) trend = index === 0 || trend === null ? display : trend + settings.trendAlpha * (display - trend);
    const basis: WeightBasis = actual !== null ? "Recorded" : display !== null ? "Interpolated" : trend !== null ? "Carried" : "No weight";
    rows.push({ day, actual, display, trend, basis, lastActual, gap });
  }
  return rows;
}
