import { expect, it, vi } from "vitest";

import { deviceMetricGranted, grantedDeviceMetrics, readDeviceMetric, requestDeviceMetrics } from "./device-metrics-reader.android";
import { deviceMetricDays, readDeviceMetricHistory } from "./device-metrics";

const mocks = vi.hoisted(() => ({
  aggregateRecord: vi.fn(),
  readRecords: vi.fn(),
  getGrantedPermissions: vi.fn(),
  requestPermission: vi.fn(),
}));

vi.mock("react-native-health-connect", () => mocks);
vi.mock("./adapter", () => ({ healthAdapter: { availability: async () => "available" } }));

const garmin = "com.garmin.android.apps.connectmobile";
const samsung = "com.sec.android.app.shealth";
const day = { day: "2026-03-29", start: "2026-03-28T23:00:00.000Z", end: "2026-03-29T22:00:00.000Z" };

it("uses Vienna dates across daylight saving and reads today through now", () => {
  expect(deviceMetricDays(Date.parse("2026-03-30T09:00Z"), 2)).toEqual([
    day, { day: "2026-03-30", start: day.end, end: "2026-03-30T09:00:00.000Z" },
  ]);
});

it("requests missing read permissions for the selected group in one dialog", async () => {
  mocks.getGrantedPermissions.mockResolvedValue([{ accessType: "write", recordType: "HeartRate" }, { accessType: "read", recordType: "BodyFat" }]);
  mocks.requestPermission.mockResolvedValue([{ accessType: "read", recordType: "HeartRate" }]);
  expect(await deviceMetricGranted("heartRate")).toBe(false);
  expect(await grantedDeviceMetrics()).toEqual(["bodyFat"]);
  await requestDeviceMetrics(["heartRate", "bodyFat", "restingHeartRate"]);
  expect(mocks.requestPermission).toHaveBeenCalledWith([{ accessType: "read", recordType: "HeartRate" }, { accessType: "read", recordType: "RestingHeartRate" }]);
});

it("converts exercise duration from any Health Connect source to minutes", async () => {
  mocks.aggregateRecord.mockResolvedValueOnce({ dataOrigins: [garmin], EXERCISE_DURATION_TOTAL: { inSeconds: 1950 } })
    .mockResolvedValueOnce({ dataOrigins: [samsung], EXERCISE_DURATION_TOTAL: { inSeconds: 1800 } });
  expect(await readDeviceMetric("exercise", day, () => true)).toBe(32.5);
  expect(mocks.aggregateRecord).toHaveBeenLastCalledWith({
    recordType: "ExerciseSession",
    timeRangeFilter: { operator: "between", startTime: day.start, endTime: day.end },
  });
  expect(await readDeviceMetric("exercise", day, () => true)).toBe(30);
});

it("keeps an actual zero and rejects an empty aggregate", async () => {
  mocks.aggregateRecord.mockResolvedValueOnce({ dataOrigins: [garmin], FLOORS_CLIMBED_TOTAL: 0 })
    .mockResolvedValueOnce({ dataOrigins: [], FLOORS_CLIMBED_TOTAL: 0 });
  expect(await readDeviceMetric("floors", day, () => true)).toBe(0);
  expect(await readDeviceMetric("floors", day, () => true)).toBeNull();
});

it("reads all body fat pages and uses the latest valid measurement across sources", async () => {
  mocks.readRecords.mockResolvedValueOnce({ pageToken: "second", records: [
    { time: "2026-03-29T10:00:00Z", percentage: 20, metadata: { dataOrigin: garmin } },
  ] }).mockResolvedValueOnce({ records: [
    { time: "2026-03-29T11:00:00Z", percentage: 21, metadata: { dataOrigin: garmin } },
    { time: "2026-03-29T13:00:00Z", percentage: 22, metadata: { dataOrigin: samsung } },
  ] });
  expect(await readDeviceMetric("bodyFat", day, () => true)).toBe(22);
  expect(mocks.readRecords).toHaveBeenLastCalledWith("BodyFat", { pageToken: "second", timeRangeFilter: { operator: "between", startTime: day.start, endTime: day.end } });
});

it("keeps dates in order and stops starting reads when the view closes", async () => {
  const days = deviceMetricDays(Date.parse("2026-03-30T09:00Z"), 7);
  let active = true;
  const read = vi.fn(async () => {
    active = false;
    return 5;
  });
  expect(await readDeviceMetricHistory(days, read, () => active)).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(4);
  expect(await readDeviceMetricHistory(days, async (day) => day.day === days[0]?.day ? 0 : null, () => true))
    .toEqual(days.map(({ day }, index) => ({ day, value: index === 0 ? 0 : null })));
});
