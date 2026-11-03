import { describe, expect, it } from "vitest";
import { dailyMeanWeights, weightTrend } from "../../../products/bodyshop/model/weight.js";
import { on, settings, weighIn } from "./model-fixtures.js";

const calendar = (count: number) => Array.from({ length: count }, (_, offset) => on(offset));

describe("daily-mean weight", () => {
  it("averages same-day readings and leaves out estimated and non-positive readings", () => {
    const means = dailyMeanWeights([weighIn(on(1), 101), weighIn(on(0), 100), weighIn(on(0), 101), weighIn(on(1), 90, "Estimated"), weighIn(on(2), 0)]);
    expect(means).toEqual([{ day: on(0), kg: 100.5 }, { day: on(1), kg: 101 }]);
  });
});

describe("display trend", () => {
  it("interpolates a short gap, smooths with the trend factor, and carries the last value after the latest reading", () => {
    const rows = weightTrend(calendar(5), dailyMeanWeights([weighIn(on(0), 100), weighIn(on(2), 102)]), settings, on(4));
    expect(rows.map((row) => row.basis)).toEqual(["Recorded", "Interpolated", "Recorded", "Carried", "Carried"]);
    expect(rows[1].display).toBeCloseTo(101, 9);
    expect(rows[1].actual).toBeNull();
    expect(rows.map((row) => row.trend)).toEqual([100, expect.closeTo(100.2, 9), expect.closeTo(100.56, 9), expect.closeTo(100.56, 9), expect.closeTo(100.56, 9)]);
    expect(rows[2]).toMatchObject({ gap: 2, lastActual: on(2) });
    expect(rows[3].gap).toBeNull();
  });

  it("does not fill a gap longer than the maximum internal weight gap", () => {
    const rows = weightTrend(calendar(10), dailyMeanWeights([weighIn(on(0), 100), weighIn(on(9), 91)]), settings, on(9));
    expect(rows.slice(1, 9).every((row) => row.basis === "Carried" && row.display === null && row.trend === 100)).toBe(true);
    expect(rows[9]).toMatchObject({ basis: "Recorded", gap: 9, trend: 100 + 0.2 * (91 - 100) });
  });

  it("never uses a reading after the review date to fill a gap", () => {
    const rows = weightTrend(calendar(3), dailyMeanWeights([weighIn(on(0), 100), weighIn(on(3), 103)]), settings, on(2));
    expect(rows.map((row) => row.basis)).toEqual(["Recorded", "Carried", "Carried"]);
  });

  it("shows no weight before the first reading", () => {
    const rows = weightTrend(calendar(2), dailyMeanWeights([weighIn(on(1), 100)]), settings, on(1));
    expect(rows[0]).toMatchObject({ basis: "No weight", trend: null, lastActual: null });
  });
});
