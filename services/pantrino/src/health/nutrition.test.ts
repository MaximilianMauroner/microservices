import type { NutritionChange } from "@tools-platform/service/bodyshop-contract";
import { describe, expect, it } from "vitest";
import { nutritionRecord } from "./nutrition";

const change: NutritionChange = {
  cursor: "12", id: "entry", revision: 2,
  food: {
    food: "Bread", day: "2026-03-29", time: null, meal: "Breakfast",
    nutrients: { kcal: 120, protein: 6, carbs: 20, fat: 2, fiber: null },
  },
};

describe("Health Connect nutrition dates", () => {
  it("keeps an unknown-time meal inside its backdated diary date across a DST change", () => {
    const record = nutritionRecord(change, "owner", 4);
    expect(record).toMatchObject({
      id: "bodyshop:owner:entry", revision: 2, nutrients: { fiber: null, kcal: 120 },
      start: "2026-03-29T00:00:00.000+01:00", end: "2026-03-29T23:59:59.999+02:00",
    });
  });

  it("uses the following calendar day for an early-morning entry on the prior logging day", () => {
    const record = nutritionRecord({ ...change, food: { ...change.food!, time: "03:15" } }, "owner", 4);
    expect(record).toMatchObject({
      start: "2026-03-30T03:15:00.000+02:00", end: "2026-03-30T03:15:00.001+02:00",
    });
  });

  it("uses a day interval when the specified clock time was skipped", () => {
    const record = nutritionRecord({ ...change, food: { ...change.food!, time: "02:15" } }, "owner", 0);
    expect(record?.start).toBe("2026-03-29T00:00:00.000+01:00");
    expect(record?.end).toBe("2026-03-29T23:59:59.999+02:00");
  });

  it("uses the earlier occurrence for an ambiguous clock time", () => {
    const record = nutritionRecord({ ...change, food: { ...change.food!, day: "2026-10-25", time: "02:15" } }, "owner", 0);
    expect(record?.start).toBe("2026-10-25T02:15:00.000+02:00");
  });
});
