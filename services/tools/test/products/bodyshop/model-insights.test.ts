import { describe, expect, it } from "vitest";
import { foodInsights, uncertainFoods } from "../../../products/bodyshop/model/insights.js";
import { food, on } from "./model-fixtures.js";

const entries = [
  food(on(0), "Oats", 400, { meal: "Breakfast", protein: 15 }),
  food(on(0), "Milk", 150, { meal: "Breakfast", protein: 8 }),
  food(on(1), "Oats", 400, { meal: "Breakfast", protein: 15 }),
  food(on(1), "Lentils", 300, { protein: 20 }),
  food(on(2), "Cake", 500, { meal: "Snack", protein: 5, fiber: null }),
  food(on(5), "Outside", 900)
];

describe("food insights", () => {
  it("sums the window by meal and ranks calorie and protein sources", () => {
    const result = foodInsights(entries, on(2), 3);
    expect(result).toMatchObject({ from: on(0), to: on(2), entries: 5, kcal: 1750, protein: 63, fiber: "Needs estimate", fiberRange: "Range needs review" });
    const breakfast = result.meals.find((meal) => meal.meal === "Breakfast");
    expect(breakfast).toMatchObject({ kcal: 950, protein: 38 });
    expect(breakfast?.share).toBeCloseTo(950 / 1750, 12);
    expect(breakfast?.proteinPer100Kcal).toBeCloseTo(4, 12);
    expect(result.meals.find((meal) => meal.meal === "Dinner")).toMatchObject({ kcal: 0, share: 0, proteinPer100Kcal: 0 });
    expect(result.topKcal.map((source) => source.food)).toEqual(["Oats", "Cake", "Lentils", "Milk"]);
    expect(result.topKcal[0]).toMatchObject({ occurrences: 2, kcal: 800, averageKcal: 400, protein: 30, proteinPer100Kcal: 3.75 });
    expect(result.topProtein.map((source) => source.food)).toEqual(["Oats", "Lentils", "Milk", "Cake"]);
  });

  it("shows the fiber range when every entry passes its checks", () => {
    const result = foodInsights(entries, on(1), 2);
    expect(result.fiber).toBeCloseTo(8, 12);
    expect(result.fiberRange).toBe("Range: 7.2 - 8.8 g");
  });

  it("reports no data for an empty window", () => {
    expect(foodInsights(entries, on(4), 1)).toMatchObject({ entries: 0, fiber: "No data", fiberRange: "", topKcal: [] });
  });
});

describe("food uncertainty ranking", () => {
  it("ranks foods by summed calorie half-range and skips entries without a range", () => {
    const ranked = uncertainFoods([...entries, food(on(1), "Mystery", 2000, { range: null })], on(0), on(2));
    expect(ranked.map((one) => one.food)).toEqual(["Oats", "Cake", "Lentils", "Milk"]);
    expect(ranked[0]).toMatchObject({ kcal: 800, entries: 2 });
    expect(ranked[0].halfRangeKcal).toBeCloseTo(80, 9);
  });
});
