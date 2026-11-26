import { addDays, type BodyshopTrendDay, dailyMeanWeights, type WeightReading } from "@tools-platform/service/bodyshop-contract";

const OVERVIEW_METRICS = ["weight", "steps", "sleep", "kcal"] as const;

export function overview(trends: readonly BodyshopTrendDay[], weights: readonly WeightReading[], end: string, range: number) {
  const measured = dailyMeanWeights(weights);
  return OVERVIEW_METRICS.map((metric) => {
    const lastDay = metric === "steps" || metric === "kcal" ? addDays(end, -1) : end;
    const start = addDays(lastDay, 1 - range);
    const previousStart = addDays(start, -range);
    const points = metric === "weight"
      ? measured.map(({ day, kg }) => ({ day, value: kg }))
      : trends.flatMap((row) => row[metric] == null || (metric === "kcal" && row.status !== "Complete") ? [] : [{ day: row.day, value: row[metric] }]);
    const current = points.filter(({ day }) => day >= start && day <= lastDay);
    const previous = points.filter(({ day }) => day >= previousStart && day < start);
    const mean = (rows: typeof points) => rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
    const minimum = metric === "weight" ? 2 : range === 7 ? 3 : 8;
    const value = current.length ? mean(current) : null;
    const prior = previous.length >= minimum && current.length >= minimum ? mean(previous) : null;
    return { metric, value, prior, count: current.length };
  });
}

export function insightCoverage(trends: readonly BodyshopTrendDay[], weights: readonly WeightReading[], end: string, range: number) {
  const byDay = new Map(trends.map((row) => [row.day, row]));
  const measured = new Set(dailyMeanWeights(weights).map(({ day }) => day));
  return Array.from({ length: range }, (_, index) => {
    const day = addDays(end, index + 1 - range);
    const row = byDay.get(day);
    return {
      day,
      weight: measured.has(day),
      steps: day !== end && row?.steps != null,
      sleep: row?.sleep != null,
      kcal: day !== end && row?.status === "Complete" && row.kcal != null,
    };
  });
}

export function weeklyPatterns(trends: readonly BodyshopTrendDay[], today: string, range: number) {
  const lastDay = addDays(today, -1);
  const start = addDays(lastDay, 1 - range);
  const window = trends.filter(({ day }) => day >= start && day <= lastDay);
  return (["steps", "sleep"] as const).flatMap((metric) => {
    const weekday: number[] = [];
    const weekend: number[] = [];
    for (const row of window) {
      const value = row[metric];
      if (value == null) continue;
      const day = new Date(`${row.day}T00:00:00Z`).getUTCDay();
      (day === 0 || day === 6 ? weekend : weekday).push(value);
    }
    if (weekday.length < 3 || weekend.length < 3) return [];
    return [{
      metric,
      groups: [weekday, weekend].map((values) => ({
        count: values.length,
        average: values.reduce((sum, value) => sum + value, 0) / values.length,
      })),
    }];
  });
}
