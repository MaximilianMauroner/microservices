import type { WeightReading } from "@tools-platform/service/bodyshop-contract";
import { expect, it } from "vitest";
import { weightSummary } from "./weight";

const reading = (day: string, kg: number, source = "App"): WeightReading => ({ id: `${day}-${kg}`, day, kg, time: null, notes: "", source });

it("shows the latest day's mean and the change since the first weigh-in of the 30 days before it", () => {
  const summary = weightSummary([reading("2026-09-20", 99), reading("2026-10-15", 98), reading("2026-11-10", 97.2), reading("2026-11-10", 96.8)]);
  expect(summary.latest).toEqual({ day: "2026-11-10", kg: 97 });
  expect(summary.change).toEqual({ kg: -1, since: "2026-10-15" });
  expect(summary.days).toHaveLength(3);
});

it("has no change from one weigh-in day, and leaves estimated weights out", () => {
  const summary = weightSummary([reading("2026-11-01", 80, "Estimated"), reading("2026-11-10", 81)]);
  expect(summary.latest).toEqual({ day: "2026-11-10", kg: 81 });
  expect(summary.change).toBeNull();
});

it("reads a snapshot without history as no weigh-ins", () => {
  expect(weightSummary(undefined)).toEqual({ days: [], latest: null, change: null });
});
