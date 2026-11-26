import { addDays, dailyMeanWeights, type DailyWeight, type WeightReading } from "@tools-platform/service/bodyshop-contract";

export const CHANGE_DAYS = 30;

export type WeightSummary = Readonly<{
  days: readonly DailyWeight[];
  latest: DailyWeight | null;
  /** The latest weight against the first weigh-in day of the 30 days before it. */
  change: Readonly<{ kg: number; since: string }> | null;
}>;

/** A snapshot cached by an app version before the weight page has no history yet. */
export function weightSummary(history: readonly WeightReading[] | undefined): WeightSummary {
  const days = dailyMeanWeights(history ?? []);
  const latest = days.at(-1) ?? null;
  const start = latest ? days.find((one) => one.day >= addDays(latest.day, -CHANGE_DAYS)) : undefined;
  return { days, latest, change: latest && start && start.day !== latest.day ? { kg: latest.kg - start.kg, since: start.day } : null };
}

export function rollingWeightAverages(days: readonly DailyWeight[]): readonly DailyWeight[] {
  return days.map(({ day }, index) => {
    const start = addDays(day, -6);
    const week = days.slice(0, index + 1).filter((one) => one.day >= start);
    return { day, kg: week.reduce((sum, one) => sum + one.kg, 0) / week.length };
  });
}
