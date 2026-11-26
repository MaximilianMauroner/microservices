import { describe, expect, it, vi } from "vitest";
import { healthAdapter } from "./adapter";
import { readHealthCheckIns } from "./check-ins";

describe("Health Connect check-ins", () => {
  it("queries completed Vienna days and preserves an explicit zero", async () => {
    const stepCount = vi.fn().mockResolvedValue(undefined).mockResolvedValueOnce(0);
    const now = Date.parse("2026-03-30T12:00:00Z");
    const rows = await readHealthCheckIns("steps", { ...healthAdapter, stepCount }, now, () => {});
    expect(rows).toEqual([{ day: "2026-03-23", steps: 0 }]);
    expect(stepCount).toHaveBeenCalledTimes(7);
    expect(stepCount).toHaveBeenLastCalledWith("2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z");
  });

  it("includes an older sleep session in a 90-day backfill", async () => {
    const now = Date.parse("2026-03-29T12:00:00Z");
    const sleepSessions = vi.fn().mockResolvedValue({ sessions: [
      { startTime: "2026-01-12T22:00:00Z", endTime: "2026-01-13T06:00:00Z" },
    ] });
    const adapter = { ...healthAdapter, sleepSessions };
    expect(await readHealthCheckIns("sleep", adapter, now, () => {}, 90))
      .toEqual([{ day: "2026-01-13", sleep: 8 }]);
    expect(await readHealthCheckIns("sleep", adapter, now, () => {})).toEqual([]);
  });

  it("assigns sleep to the wake date and merges overlapping reports across pages", async () => {
    const now = Date.parse("2026-03-29T12:00:00Z");
    const sleepSessions = vi.fn()
      .mockResolvedValueOnce({ sessions: [
        { startTime: "2026-03-28T22:00:00Z", endTime: "2026-03-29T04:00:00Z" },
      ], next: "page-2" })
      .mockResolvedValueOnce({ sessions: [
        { startTime: "2026-03-29T01:00:00Z", endTime: "2026-03-29T06:00:00Z",
          asleep: [{ startTime: "2026-03-29T01:00:00Z", endTime: "2026-03-29T05:00:00Z" }] },
        { startTime: "2026-03-29T11:00:00Z", endTime: "2026-03-29T14:00:00Z" },
      ] });
    const rows = await readHealthCheckIns("sleep", { ...healthAdapter, sleepSessions }, now, () => {});
    expect(rows).toEqual([{ day: "2026-03-29", sleep: 7 }]);
    expect(sleepSessions).toHaveBeenLastCalledWith(expect.any(String), new Date(now).toISOString(), "page-2");
  });
});
