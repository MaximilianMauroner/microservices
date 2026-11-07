import type { SavedFood } from "@tools-platform/service/bodyshop-contract";
import type { Ingredient, Recipe } from "@tools-platform/service/kitchen-contract";
import { describe, expect, it } from "vitest";
import { fromIngredient, fromRecipe, fromSaved, fromScan, logAction, mealAt } from "./model";

const lentils: Ingredient = { id: "lentils", name: "Red lentils", unit: "g", section: "Proteins", otherGroups: [], nutrition: { kcal: 340, protein: 24, carbs: 50, fat: 2 }, notes: "", recipeCount: 1 };
const curry: Recipe = { id: "curry", name: "Lentil curry", servings: 2, minutes: 30, instructions: "", updatedAt: "", lines: [{ ingredientId: "lentils", ingredient: "Red lentils", unit: "g", amount: 200, note: "" }] };
const skyr: SavedFood = {
  id: "skyr", name: "Skyr", brand: "Milfina", amount: 100, unit: "g", nutrients: { kcal: 63, protein: 11, carbs: 4, fat: 0.2, fiber: 0 }, notes: "",
  fullSize: null, container: "", fullSizeNotes: "", source: "", sourceReference: "", verified: null, confidence: "", range: null, fiberRange: null, fiberNotes: ""
};

describe("logging Kitchen and scanned food in Bodyshop", () => {
  it("logs a saved Bodyshop food by its id, so Bodyshop keeps its own reference", () => {
    expect(logAction(fromSaved(skyr), { name: "Skyr", amount: 150, meal: "Breakfast", day: "2026-11-07" }))
      .toEqual({ type: "food.log", day: "2026-11-07", items: [{ food: "skyr", meal: "Breakfast", amount: 150, unit: "g" }] });
  });

  it("logs servings of a Kitchen recipe as an estimate with the values of its ingredients", () => {
    const action = logAction(fromRecipe(curry, new Map([["lentils", lentils]])), { name: "Lentil curry", amount: 1.5, meal: "Dinner", day: "2026-11-07" });
    expect(action).toMatchObject({ items: [{ food: "Lentil curry", amount: 1.5, unit: "portion", source: "Estimated", nutrients: { kcal: 510, protein: 36, carbs: 50 * 1.5, fat: 3, fiber: null } }] });
  });

  it("logs a Kitchen ingredient per gram, and a counted one per piece", () => {
    expect(logAction(fromIngredient(lentils), { name: "Red lentils", amount: 50, meal: "Lunch", day: "2026-11-07" })).toMatchObject({ items: [{ amount: 50, unit: "g", nutrients: { kcal: 170, protein: 12 } }] });
    const egg = fromIngredient({ name: "Egg", unit: "piece", nutrition: { kcal: 80, protein: 7, carbs: null, fat: 5 } });
    expect(logAction(egg, { name: "Egg", amount: 2, meal: "Breakfast", day: "2026-11-07" })).toMatchObject({ items: [{ unit: "piece", nutrients: { kcal: 160, carbs: null } }] });
  });

  it("logs a scan as a label value, and never makes up calories that nobody gave", () => {
    const table = fromScan({ kind: "label", unit: "ml", values: { kcal: null, protein: 1, carbs: 6.7, fat: 1.5, fiber: 0.8 } });
    expect(table.name, "a table is not a product, so the person names it").toBe("");
    const typed = logAction(table, { name: "Oat drink", amount: 250, meal: "Snack", day: "2026-11-07", kcal: 115 });
    expect(typed).toMatchObject({ items: [{ food: "Oat drink", source: "Label", nutrients: { kcal: 115, carbs: 16.8 } }] });
    const blank = logAction(table, { name: "Oat drink", amount: 250, meal: "Snack", day: "2026-11-07" });
    expect(blank.type === "food.log" && blank.items[0]!.nutrients).not.toHaveProperty("kcal");
  });

  it("picks the meal from the hour", () => {
    expect(mealAt(new Date(2026, 10, 7, 8))).toBe("Breakfast");
    expect(mealAt(new Date(2026, 10, 7, 12, 30))).toBe("Lunch");
    expect(mealAt(new Date(2026, 10, 7, 19))).toBe("Dinner");
    expect(mealAt(new Date(2026, 10, 7, 23))).toBe("Snack");
  });
});
