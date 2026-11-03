import { describe, expect, it } from "vitest";
import { convertNutrition, formatAmount, nutritionPerServing, parseUnit } from "../../../products/kitchen/domain.js";

describe("Kitchen units", () => {
  it("names cans like people say them in English and German", () => {
    expect(formatAmount(1, "can")).toBe("1 can");
    expect(formatAmount(2, "can")).toBe("2 cans");
    expect(formatAmount(1, "can", "de")).toBe("1 Dose");
    expect(formatAmount(1.5, "can", "de")).toBe("1,5 Dosen");
    expect(formatAmount(3, "piece", "de")).toBe("3 Stück");
    expect(formatAmount(1500, "g")).toBe("1.5 kg");
  });

  it("keeps nutrition per can, like per piece", () => {
    const perCan = convertNutrition({ kcal: 120, protein: 7, carbs: 15, fat: 2 }, "g", "can", 400);
    expect(perCan).toEqual({ kcal: 480, protein: 28, carbs: 60, fat: 8 });
    const hummus = { servings: 4, lines: [{ ingredientId: "chickpeas", amount: 2 }] } as const;
    expect(nutritionPerServing(hummus as never, new Map([["chickpeas", { unit: "can", nutrition: perCan }]])).kcal).toBe(240);
  });

  it("accepts can as a unit", () => {
    expect(parseUnit("can")).toBe("can");
    expect(() => parseUnit("tin")).toThrow();
  });
});
