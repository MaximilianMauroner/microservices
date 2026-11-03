import { describe, expect, it } from "vitest";
import type { CheckIn, DaySummary } from "../../../products/bodyshop/domain.js";
import { stepEnergy } from "../../../products/bodyshop/model/energy.js";
import { runModel } from "../../../products/bodyshop/model/engine.js";
import { weeklyReview } from "../../../products/bodyshop/model/review.js";
import { dailyMeanWeights } from "../../../products/bodyshop/model/weight.js";
import { checkIn, completeDays, dailyWeights, logged, on, settings } from "./model-fixtures.js";

const profile = { heightCm: 180, strideRatio: 0.4, walkingCost: 0.5, age: null, sex: null };

function review(days: DaySummary[], checkIns: CheckIn[], asOf: string) {
  const weights = dailyWeights(30);
  const model = runModel({ days, weights, checkIns, settings, asOf });
  const steps = stepEnergy(model, days, checkIns, settings, profile, 28);
  return weeklyReview({ days, weights: dailyMeanWeights(weights), steps, summary: model.summary, settings });
}

describe("weekly review", () => {
  it("averages complete days per Monday-to-Sunday week and flags a week with unchecked complete days", () => {
    const days = completeDays(10).map((day, index) =>
      index === 5 ? logged(day.day, 2000, { status: "Partial" }) : index === 6 ? logged(day.day, 2500, { status: "Unknown" }) : index === 8 ? logged(day.day, 3000, { range: null }) : day);
    const result = review(days, [], on(9));
    expect(result).toMatchObject({ intakeDays: 6, completeDays: 4, kcal: 3000, weight: 100, weightDays: 6, completeText: "4 marked complete" });
    expect(result.week.map((day) => day.status)).toEqual(["Complete", "Partial", "Unconfirmed", "Complete", "Complete", "Complete", "Not due"]);
    expect(result.week[1].kcal).toBe("2,000 kcal");
    expect(result.week[6].kcal).toBe("");
    expect(result.weeks[0]).toMatchObject({ start: "2026-01-05", completeDays: 4, kcal: 3000, vsTarget: 500, kcalRange: "Review" });
    expect(result.weeks[1]).toMatchObject({ start: "2025-12-29", completeDays: 4, weightDays: 4 });
    expect(result.weeks[1].kcalRange).toBeCloseTo(300, 9);
    expect(result.weeks[2]).toMatchObject({ completeDays: 0, kcal: null, kcalRange: null, weight: null });
  });

  it("sums food in and step-based energy out over closed, complete, step-estimated days", () => {
    const reports = Array.from({ length: 29 }, (_, offset) => offset).filter((offset) => offset !== 14).map((offset) => checkIn(on(offset), { steps: 10000, reported: "Complete" }));
    const result = review(completeDays(30), reports, on(29));
    expect(result.energyWeeks.map((week) => [week.start, week.coverage, week.assessment])).toEqual([
      ["2025-12-22", "Outside history", "No usable days"],
      ["2025-12-29", "4/4", "Start of record"],
      ["2026-01-05", "7/7", "Covered"],
      ["2026-01-12", "6/7", "Partial evidence"],
      ["2026-01-19", "7/7", "Covered"],
      ["2026-01-26", "4/4", "Week to date"]
    ]);
    expect(result.energyWeeks[2].food).toBeCloseTo(21000, 6);
    expect(result.energyWeeks[2].energyOut).toBeCloseTo(-21000, 6);
    expect(result.energyWeeks[2].net).toBeCloseTo(0, 6);
    expect(result).toMatchObject({ weekCoverage: "4/4", sevenDayCoverage: "7/7 days" });
    expect(result.sevenDayNet).toBeCloseTo(0, 6);
  });
});
