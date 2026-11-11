import type { Ingredient, KitchenSnapshot, PlanEntry, Recipe } from "@tools-platform/service/kitchen-contract";
import { describe, expect, it } from "vitest";
import { todayView } from "./model";

const today = "2026-11-11";
const rice: Ingredient = { id: "rice", name: "Rice", unit: "g", section: "Grains", otherGroups: [], nutrition: { kcal: 350, protein: 7, carbs: 78, fat: 1 }, notes: "", recipeCount: 1 };
const line = { ingredientId: rice.id, ingredient: rice.name, amount: 200, unit: rice.unit, note: "" };
const recipe: Recipe = { id: "bowl", name: "Rice bowl", servings: 2, minutes: 20, instructions: "Wash rice.\nBoil water.\nCook rice.\nServe.", updatedAt: "", lines: [line] };
const meal = (id: string, day = today, patch: Partial<PlanEntry> = {}): PlanEntry => ({ id, day, meal: "dinner", recipeId: recipe.id, recipe: recipe.name, servings: 2, cooked: false, custom: false, lines: [line], ...patch });
const kitchen = (patch: Partial<KitchenSnapshot> = {}): KitchenSnapshot => ({ kitchen: { id: "home", name: "Home", groups: ["Grains"], hidden: false, mcpEnabled: false, members: [] }, ingredients: [rice], recipes: [recipe], plan: [], leftovers: [], stock: [], extras: [], ...patch });

describe("the Today hub", () => {
  it("offers dinner planning when no uncooked meal remains today", () => {
    expect(todayView(kitchen(), today).tonight).toBeNull();
    expect(todayView(kitchen({ plan: [meal("done", today, { cooked: true }), meal("tomorrow", "2026-11-12")] }), today).tonight).toBeNull();
  });

  it("shows the first uncooked meal in meal order with its serving values and first steps", () => {
    const view = todayView(kitchen({ plan: [meal("dinner"), meal("lunch", today, { meal: "lunch", servings: 1, custom: true, lines: [{ ...line, amount: 50 }] }), meal("breakfast", today, { meal: "breakfast", cooked: true })] }), today);
    expect(view.tonight).toMatchObject({ entry: { id: "lunch", recipe: "Rice bowl", servings: 1 }, minutes: 20, kcal: 175, sections: ["Grains"], steps: ["Wash rice.", "Boil water.", "Cook rice."] });
  });

  it("puts the earliest leftovers first and marks past, today, and tomorrow as urgent", () => {
    const snapshot = kitchen({ leftovers: [
      { id: "later", name: "Rice", servings: 1, useBy: "2026-11-13" },
      { id: "tomorrow", name: "Soup", servings: 2, useBy: "2026-11-12" },
      { id: "past", name: "Curry", servings: 1, useBy: "2026-11-10" },
      { id: "today", name: "Beans", servings: 3, useBy: today },
    ] });
    expect(todayView(snapshot, today).leftovers.map(({ id, urgent }) => [id, urgent])).toEqual([["past", true], ["today", true], ["tomorrow", true], ["later", false]]);
    expect(snapshot.leftovers[0]!.id).toBe("later");
  });

  it("counts this week's missing ingredients and extras, leaving out cooked meals and bought weekly items", () => {
    const view = todayView(kitchen({ plan: [meal("today"), meal("done", "2026-11-12", { cooked: true }), meal("next", "2026-11-16")], extras: [
      { id: "soap", name: "Soap", everyWeek: false, boughtWeek: null },
      { id: "tea", name: "Tea", everyWeek: true, boughtWeek: null },
      { id: "milk", name: "Milk", everyWeek: true, boughtWeek: "2026-11-09" },
    ] }), today);
    expect(view.shopping.count).toBe(3);
    expect(view.shopping.toBuy[0]).toMatchObject({ ingredient: "Rice", toBuy: 200 });
    expect(view.buyNames).toEqual(["Rice", "Soap", "Tea"]);
  });

  it("shows only tomorrow's meals in meal order without changing the stored plan", () => {
    const snapshot = kitchen({ plan: [meal("dinner", "2026-11-12"), meal("today"), meal("lunch", "2026-11-12", { meal: "lunch" }), meal("later", "2026-11-13")] });
    expect(todayView(snapshot, today).tomorrow.map((one) => one.entry.id)).toEqual(["lunch", "dinner"]);
    expect(snapshot.plan[0]!.id).toBe("dinner");
  });
});
