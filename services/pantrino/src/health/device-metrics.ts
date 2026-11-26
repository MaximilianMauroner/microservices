import { addDays } from "@tools-platform/service/bodyshop-contract";
import { resolveViennaTime, viennaTime } from "./nutrition";

export const DEVICE_METRICS = {
  activeCalories: "ActiveCaloriesBurned",
  distance: "Distance",
  elevation: "ElevationGained",
  exercise: "ExerciseSession",
  floors: "FloorsClimbed",
  speed: "Speed",
  totalCalories: "TotalCaloriesBurned",
  bodyFat: "BodyFat",
  heartRate: "HeartRate",
  restingHeartRate: "RestingHeartRate",
} as const;

export type DeviceMetric = keyof typeof DEVICE_METRICS;
export const DEVICE_METRIC_GROUPS = {
  activity: ["activeCalories", "exercise", "distance", "totalCalories", "floors", "elevation", "speed"],
  measurements: ["restingHeartRate", "heartRate", "bodyFat"],
} as const satisfies Record<string, readonly DeviceMetric[]>;

export type DeviceMetricDay = { day: string; start: string; end: string };
export type DeviceMetricPoint = { day: string; value: number | null };

export function deviceMetricDays(now: number, length: number): DeviceMetricDay[] {
  const today = viennaTime(now).wall.slice(0, 10);
  const midnight = (day: string) => new Date(resolveViennaTime(`${day}T00:00:00`)!).toISOString();
  return Array.from({ length }, (_, index) => {
    const day = addDays(today, index + 1 - length);
    return { day, start: midnight(day), end: day === today ? new Date(now).toISOString() : midnight(addDays(day, 1)) };
  });
}

export async function readDeviceMetricHistory(
  days: readonly DeviceMetricDay[],
  read: (day: DeviceMetricDay) => Promise<number | null>,
  active: () => boolean,
): Promise<DeviceMetricPoint[] | undefined> {
  const points: DeviceMetricPoint[] = [];
  const batchSize = 4;
  for (let offset = 0; offset < days.length; offset += batchSize) {
    if (!active()) return undefined;
    const batch = days.slice(offset, offset + batchSize);
    const values = await Promise.all(batch.map(read));
    if (!active()) return undefined;
    points.push(...batch.map(({ day }, index) => ({ day, value: values[index] ?? null })));
  }
  return points;
}
