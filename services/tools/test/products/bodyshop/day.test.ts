import { describe, expect, it } from "vitest";
import { type CheckIn, type FoodEntry, loggingDay, templateOn, type TemplateComponent } from "../../../products/bodyshop/domain.js";
import { daySummaries, effectiveFiberRange, entryCheck, entryNutrients } from "../../../products/bodyshop/model/day.js";
import { readSettings } from "../../../products/bodyshop/settings.js";

let next = 0;
function entry(day: string, meal: FoodEntry["meal"], amount: number | null, override: Partial<FoodEntry> = {}): FoodEntry {
  const food = override.food ?? "Yogurt";
  return {
    id: String(next++), day, time: null, meal, food, amount, unit: "g", source: "Saved food", notes: "",
    reference: { food, amount: 100, unit: "g", nutrients: { kcal: 64, protein: 3.7, carbs: 4.5, fat: 3.2, fiber: 0 }, range: 0.1, fiberRange: 0.1, notes: "" },
    range: 0.1, fiberRange: 0.1, createdAt: "", updatedAt: "", ...override
  };
}

const checkIn = (day: string, reported: CheckIn["reported"], override: CheckIn["override"] = null): CheckIn => ({
  id: day, day, reported, training: "", trainingNotes: "", steps: null, activityNotes: "", hunger: null, fatigue: null, recovery: null, sleep: null, notes: "", basis: "", override
});

describe("Bodyshop day calculations", () => {
  it("scales the reference to the amount, and leaves values empty when the entry does not match its reference", () => {
    expect(entryNutrients(entry("2026-11-01", "Dinner", 250)).kcal).toBe(160);
    expect(entryNutrients(entry("2026-11-01", "Dinner", 250, { unit: "ml" })).kcal).toBeNull();
    expect(entryNutrients(entry("2026-11-01", "Dinner", null)).kcal).toBeNull();
  });

  it("names the first failing check, in the Food Log order", () => {
    expect(entryCheck(entry("2026-11-01", "Dinner", 250))).toBe("Ready");
    expect(entryCheck(entry("2026-11-01", "Dinner", 250, { reference: null }))).toBe("Reference missing / mismatch");
    expect(entryCheck(entry("2026-11-01", "Dinner", 250, { unit: "ml" }))).toBe("Quantity / unit check");
    expect(entryCheck(entry("2026-11-01", "Dinner", 250, { range: null }))).toBe("Estimate % missing");
    expect(entryCheck(entry("2026-11-01", "Dinner", 250, { fiberRange: null }))).toBe("Fiber estimate missing");
  });

  it("never makes the fiber range narrower than the nutrition range", () => {
    expect(effectiveFiberRange(0.05, 0.3)).toBe(0.3);
    expect(effectiveFiberRange(0.75, 0.5)).toBe(0.75);
    expect(effectiveFiberRange(null, 0.15)).toBe(0.15);
  });

  it("adds up a day with ranges, and hides fiber and ranges when one entry fails its check", () => {
    const [ready] = daySummaries([entry("2026-11-01", "Breakfast", 100), entry("2026-11-01", "Lunch", 100)], [], []);
    expect(ready).toMatchObject({ kcal: 128, check: "Ready", entries: 2, coverage: 1 });
    expect(ready!.low.kcal).toBeCloseTo(115.2);
    expect(ready!.high.kcal).toBeCloseTo(140.8);
    const [review] = daySummaries([entry("2026-11-02", "Breakfast", 100), entry("2026-11-02", "Lunch", 100, { range: null })], [], []);
    expect(review).toMatchObject({ kcal: 128, fiber: null, check: "Review Food Log checks", coverage: 0.5 });
    expect(review!.low.kcal).toBeNull();
  });

  it("splits a pooled log between the days it covers", () => {
    const days = daySummaries([entry("2026-10-02", "Dinner", 1000)], [], [
      { id: "a", day: "2026-10-01", sourceDay: "2026-10-02", fraction: 0.5, basis: "Pooled two-day average" },
      { id: "b", day: "2026-10-02", sourceDay: "2026-10-02", fraction: 0.5, basis: "Pooled two-day average" }
    ]);
    expect(days.map((day) => [day.day, day.kcal, day.evidence])).toEqual([["2026-10-01", 320, "Pooled two-day average"], ["2026-10-02", 320, "Pooled two-day average"]]);
  });

  it("completes a day from an override, a report, or three meals, in that order", () => {
    const meals = [entry("2026-11-03", "Breakfast", 100), entry("2026-11-03", "Lunch", 100), entry("2026-11-03", "Dinner", 100)];
    expect(daySummaries(meals, [], [])[0]).toMatchObject({ status: "Complete", basis: "Automatic: breakfast + lunch + dinner; editable" });
    expect(daySummaries(meals, [checkIn("2026-11-03", null, "Partial")], [])[0]).toMatchObject({ status: "Partial", basis: "Manual override: Partial" });
    expect(daySummaries(meals.slice(0, 2), [checkIn("2026-11-03", "Partial")], [])[0]!.status).toBe("Partial");
    expect(daySummaries(meals.slice(0, 2), [checkIn("2026-11-03", "Complete")], [])[0]!.status).toBe("Complete");
    expect(daySummaries(meals.slice(0, 2), [], [])[0]!.status).toBe("Unknown");
  });

  it("puts food eaten before 04:00 in Vienna on the day before", () => {
    expect(loggingDay(new Date("2026-11-03T02:30:00Z"), 4)).toBe("2026-11-02");
    expect(loggingDay(new Date("2026-11-03T03:30:00Z"), 4)).toBe("2026-11-03");
  });

  it("uses the newest template version that started on or before the meal day", () => {
    const part = (order: number, food: string, effectiveFrom: string): TemplateComponent => ({ id: `${order}${effectiveFrom}`, template: "Normal breakfast", aliases: ["usual breakfast"], order, food, amount: 1, unit: "g", quantity: "Fixed", meal: "Breakfast", effectiveFrom, notes: "" });
    const parts = [part(1, "Milk", "2026-09-17"), part(2, "Butter 10 g", "2026-09-17"), part(2, "Butter 14 g", "2026-09-18")];
    expect(templateOn(parts, "Normal breakfast", "2026-09-17").map((one) => one.food)).toEqual(["Milk", "Butter 10 g"]);
    expect(templateOn(parts, "normal breakfast", "2026-10-01").map((one) => one.food)).toEqual(["Milk", "Butter 14 g"]);
  });

  it("reads settings by label and keeps defaults for missing rows", () => {
    const settings = readSettings([{ label: "Daily calorie target", value: 2300 }, { label: "Trend weight smoothing factor", value: "0.25" }]);
    expect(settings.calorieTarget).toBe(2300);
    expect(settings.trendAlpha).toBe(0.25);
    expect(settings.proteinTarget).toBe(150);
  });
});
