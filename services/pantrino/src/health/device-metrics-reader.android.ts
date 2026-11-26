import { aggregateRecord, getGrantedPermissions, readRecords, requestPermission, type AggregateResult, type AggregateResultRecordType } from "react-native-health-connect";
import { healthAdapter } from "./adapter";
import { DEVICE_METRICS, type DeviceMetric, type DeviceMetricDay } from "./device-metrics";

export const deviceMetricsAvailability = healthAdapter.availability;

export async function grantedDeviceMetrics(): Promise<DeviceMetric[]> {
  const granted = await getGrantedPermissions();
  return (Object.keys(DEVICE_METRICS) as DeviceMetric[]).filter((metric) =>
    granted.some((item) => item.accessType === "read" && item.recordType === DEVICE_METRICS[metric]));
}

export async function deviceMetricGranted(metric: DeviceMetric) {
  return (await grantedDeviceMetrics()).includes(metric);
}

export async function requestDeviceMetrics(metrics: readonly DeviceMetric[]) {
  const existing = await grantedDeviceMetrics();
  const requested = metrics.filter((metric) => !existing.includes(metric));
  if (requested.length) await requestPermission(requested.map((metric) => ({ accessType: "read", recordType: DEVICE_METRICS[metric] })));
}

async function aggregate<T extends AggregateResultRecordType>(recordType: T, timeRangeFilter: { operator: "between"; startTime: string; endTime: string }, value: (result: AggregateResult<T>) => number) {
  const result = await aggregateRecord({ recordType, timeRangeFilter });
  if (!result.dataOrigins.length) return null;
  const number = value(result);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export async function readDeviceMetric(metric: DeviceMetric, day: DeviceMetricDay, active: () => boolean): Promise<number | null> {
  const timeRangeFilter = { operator: "between", startTime: day.start, endTime: day.end } as const;
  if (!active() || day.start >= day.end) return null;
  switch (metric) {
    case "activeCalories": return aggregate("ActiveCaloriesBurned", timeRangeFilter, (r) => r.ACTIVE_CALORIES_TOTAL.inKilocalories);
    case "totalCalories": return aggregate("TotalCaloriesBurned", timeRangeFilter, (r) => r.ENERGY_TOTAL.inKilocalories);
    case "distance": return aggregate("Distance", timeRangeFilter, (r) => r.DISTANCE.inMeters / 1000);
    case "elevation": return aggregate("ElevationGained", timeRangeFilter, (r) => r.ELEVATION_GAINED_TOTAL.inMeters);
    case "exercise": return aggregate("ExerciseSession", timeRangeFilter, (r) => r.EXERCISE_DURATION_TOTAL.inSeconds / 60);
    case "floors": return aggregate("FloorsClimbed", timeRangeFilter, (r) => r.FLOORS_CLIMBED_TOTAL);
    case "speed": return aggregate("Speed", timeRangeFilter, (r) => r.SPEED_AVG.inKilometersPerHour);
    case "heartRate": return aggregate("HeartRate", timeRangeFilter, (r) => r.BPM_AVG);
    case "restingHeartRate": return aggregate("RestingHeartRate", timeRangeFilter, (r) => r.BPM_AVG);
    case "bodyFat": {
      let pageToken: string | undefined;
      let latest: { time: number; percentage: number } | undefined;
      do {
        if (!active()) return null;
        const page: Awaited<ReturnType<typeof readRecords<"BodyFat">>> = await readRecords("BodyFat", { timeRangeFilter, pageToken });
        for (const record of page.records) {
          const time = Date.parse(record.time);
          if (!Number.isFinite(time) || !Number.isFinite(record.percentage) || record.percentage < 0 || record.percentage > 100) continue;
          if (!latest || time > latest.time) latest = { time, percentage: record.percentage };
        }
        pageToken = page.pageToken || undefined;
      } while (pageToken);
      return latest?.percentage ?? null;
    }
  }
}

export { openHealthConnectSettings as openDeviceMetricsSettings } from "react-native-health-connect";
