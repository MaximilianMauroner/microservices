import type { Availability } from "./contract";
import type { DeviceMetric, DeviceMetricDay } from "./device-metrics";

export async function deviceMetricsAvailability(): Promise<Availability> { return "unavailable"; }
export async function grantedDeviceMetrics(): Promise<DeviceMetric[]> { return []; }
export async function deviceMetricGranted(_metric: DeviceMetric): Promise<boolean> { return false; }
export async function requestDeviceMetrics(_metrics: readonly DeviceMetric[]): Promise<void> {}
export async function readDeviceMetric(_metric: DeviceMetric, _day: DeviceMetricDay, _active: () => boolean): Promise<number | null> { return null; }

export function openDeviceMetricsSettings() {}
