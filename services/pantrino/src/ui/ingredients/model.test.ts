import { describe, expect, it } from "vitest";
import { kitchenAction, type Ingredient, type KitchenSnapshot, type KitchenSync } from "@tools-platform/service/kitchen-contract";
import { project } from "../../sync/project";
import { changeSize, ingredientDraft, ingredientSave, oldPerNew, withGroup, withProduct, withScan, withUnit } from "./model";

const ingredient: Ingredient = {
  id: "tomato", name: "Tomato", unit: "g", section: "Vegetables", otherGroups: ["Basics"],
  nutrition: { kcal: 20, protein: 1.2, carbs: null, fat: 0 }, notes: "", recipeCount: 1,
};

function snapshot(): KitchenSnapshot {
  return {
    kitchen: { id: "home", name: "Home", groups: ["Vegetables", "Basics"], members: [], mcpEnabled: false, hidden: false },
    ingredients: [ingredient],
    recipes: [
      { id: "soup", name: "Soup", servings: 2, minutes: null, instructions: "", updatedAt: "", lines: [{ ingredientId: ingredient.id, ingredient: ingredient.name, unit: "g", amount: 125, note: "" }] },
      { id: "salad", name: "Salad", servings: 4, minutes: null, instructions: "", updatedAt: "", lines: [] },
    ],
    stock: [{ ingredientId: ingredient.id, ingredient: ingredient.name, unit: "g", section: "Vegetables", amount: 500 }],
    plan: [], leftovers: [], extras: [],
  };
}

describe("ingredient form", () => {
  it("saves the new unit, nutrition, stock, recipe amounts, and recipe additions in one queued change", () => {
    const kitchen = snapshot();
    const draft = changeSize({ ...ingredientDraft(ingredient, "", "de"), unit: "can" }, ingredient, "250", "de");
    const result = ingredientSave({ ...draft, uses: new Map([["salad", "1,5"]]) }, ingredient, kitchen);
    if (!result.action) throw new Error(result.issue);
    expect(result.action.oldPerNew).toBe(250);
    expect(kitchenAction.safeParse(result.action).success).toBe(true);
    const sync: KitchenSync = { today: "2026-11-05", planFrom: "2026-10-05", kitchens: [kitchen] };
    const projected = project(sync, [{ kitchenId: "home", seq: 1, clientActionId: "change", queuedAt: "2026-11-05T09:00:00.000Z", action: result.action }]).kitchens[0]!;

    expect(projected.ingredients[0]).toMatchObject({ unit: "can", recipeCount: 2, nutrition: { kcal: 50, protein: 3, carbs: null, fat: 0 } });
    expect(projected.stock[0]).toMatchObject({ unit: "can", amount: 2 });
    expect(projected.recipes.find((recipe) => recipe.id === "soup")!.lines[0]).toMatchObject({ unit: "can", amount: 0.5 });
    expect(projected.recipes.find((recipe) => recipe.id === "salad")!.lines[0]).toMatchObject({ unit: "can", amount: 1.5 });
  });

  it("converts back to weight using the reciprocal size and keeps German decimal fields", () => {
    const can: Ingredient = { ...ingredient, unit: "can", nutrition: { kcal: 50, protein: 3, carbs: null, fat: 0 } };
    const draft = changeSize({ ...ingredientDraft(can, "", "de"), unit: "g" }, can, "250", "de");
    expect(oldPerNew("can", "g", "250")).toBe(0.004);
    expect(draft.values).toEqual({ kcal: "20", protein: "1,2", carbs: "", fat: "0" });
    const result = ingredientSave(draft, can, snapshot());
    expect(result.action).toMatchObject({ oldPerNew: 0.004, kcal: 20, protein: 1.2, carbs: null, fat: 0 });
  });

  it("clears converted nutrition when an entered size is removed", () => {
    const converted = changeSize({ ...ingredientDraft(ingredient, "", "en"), unit: "can" }, ingredient, "250", "en");
    const cleared = changeSize(converted, ingredient, "", "en");
    expect(cleared.values.kcal).toBe("20");
    expect(ingredientSave(cleared, ingredient, snapshot()).issue).toBe("conversionNeeded");
  });

  it("requires a size for stock and custom meal amounts even when no recipe uses the ingredient", () => {
    const unused = { ...ingredient, recipeCount: 0 };
    const draft = { ...ingredientDraft(unused, "", "en"), unit: "can" as const };
    const kitchen = { ...snapshot(), ingredients: [unused], recipes: [] };
    expect(ingredientSave(draft, unused, kitchen).issue).toBe("conversionNeeded");
    const line = { ingredientId: ingredient.id, ingredient: ingredient.name, unit: ingredient.unit, amount: 100, note: "" };
    const meal = { id: "meal", day: "2026-11-05", meal: "dinner" as const, recipeId: "soup", recipe: "Soup", servings: 1, cooked: false, custom: true, lines: [line] };
    expect(ingredientSave(draft, unused, { ...kitchen, stock: [], plan: [meal] }).issue).toBe("conversionNeeded");
    expect(ingredientSave(draft, unused, { ...kitchen, stock: [] }).action?.unit).toBe("can");
  });

  it.each(["", "0", "-1", "Infinity", "1e309", "tomato"])("keeps invalid conversion size %j out of the queue", (size) => {
    const draft = { ...ingredientDraft(ingredient, "", "en"), unit: "can" as const, size };
    expect(ingredientSave(draft, ingredient, snapshot()).issue).toBe("conversionNeeded");
  });

  it("keeps the chosen main group first and adds a typed group once", () => {
    const draft = { ...ingredientDraft(ingredient, "", "en"), groups: ["Basics", "Vegetables"], typedGroup: "  Herbs  " };
    expect(ingredientSave(draft, ingredient, snapshot()).action).toMatchObject({ section: "Basics", otherGroups: ["Vegetables", "Herbs"] });
    expect(withGroup(["Basics", "Vegetables"], " basics ")).toEqual(["Basics", "Vegetables"]);
  });

  it("lets the engine assign a new item ID and keeps unknown nutrition separate from zero", () => {
    const draft = ingredientDraft(undefined, "  Salt  ", "de");
    const result = ingredientSave({ ...draft, values: { ...draft.values, kcal: "0" } }, undefined, snapshot());
    expect(result.action).toMatchObject({ name: "Salt", section: "", kcal: 0, protein: null, carbs: null, fat: null });
    expect(result.action).not.toHaveProperty("createId");
  });

  it("blocks empty names and names already used by another ingredient", () => {
    expect(ingredientSave(ingredientDraft(undefined, " ", "en"), undefined, snapshot()).issue).toBe("nameIngredient");
    expect(ingredientSave(ingredientDraft(undefined, " tomato ", "en"), undefined, snapshot()).issue).toBe("duplicateName");
    expect(ingredientSave(ingredientDraft(ingredient, "", "en"), ingredient, snapshot()).action?.id).toBe(ingredient.id);
  });

  it("moves a quick-picked recipe amount to the new unit and keeps a typed one", () => {
    const draft = { ...ingredientDraft(undefined, "Beans", "en"), uses: new Map([["soup", "100"], ["salad", "250"]]) };
    const result = ingredientSave(withUnit(draft, "can", "en"), undefined, snapshot());
    expect(result.action?.addToRecipes).toEqual([{ recipeId: "soup", amount: 1 }, { recipeId: "salad", amount: 250 }]);
  });

  it.each(["", "0", "-2", "Infinity", "1e309", "1000001", "a"])("blocks invalid recipe amount %j", (amount) => {
    const draft = { ...ingredientDraft(ingredient, "", "en"), uses: new Map([["salad", amount]]) };
    expect(ingredientSave(draft, ingredient, snapshot()).issue).toBe("amountsNeeded");
  });

  it.each(["-1", "Infinity", "a", "10001"])("blocks invalid nutrition %j", (value) => {
    const draft = ingredientDraft(ingredient, "", "en");
    expect(ingredientSave({ ...draft, values: { ...draft.values, protein: value } }, ingredient, snapshot()).issue).toBe("nutritionNeeded");
  });
});

describe("ingredient from a product", () => {
  it("saves the product's name, unit, and nutrition, and moves a usual recipe amount to the new unit", () => {
    const draft = { ...ingredientDraft(undefined, "hafer", "de"), unit: "piece" as const, uses: new Map([["salad", "1"]]) };
    const oats = { source: "billa" as const, code: "00-9001", name: "Haferdrink", brand: "Ja! Natürlich", quantity: "1 l", unit: "ml" as const, nutrition: { kcal: 46, protein: 0.4, carbs: 7.1, fat: null } };
    const result = ingredientSave(withProduct(draft, oats, "de"), undefined, snapshot());
    if (!result.action) throw new Error(result.issue);
    expect(result.action).toMatchObject({ name: "Haferdrink", unit: "ml", kcal: 46, protein: 0.4, carbs: 7.1, fat: null, addToRecipes: [{ recipeId: "salad", amount: 100 }] });
  });
});

describe("ingredient from a scanned barcode", () => {
  const passata = { source: "open-food-facts" as const, code: "8076809513388", name: "Passata", brand: "Mutti", quantity: "700 g", unit: "g" as const, nutrition: { kcal: 36, protein: 1.6, carbs: 5.4, fat: 0.2 } };

  it("fills a new ingredient with the product's name, unit, and nutrition", () => {
    const scan = withScan(ingredientDraft(undefined, "", "en"), undefined, { ...passata, unit: "ml" }, "en");
    expect(scan.result).toBe("filled");
    expect(scan.draft).toMatchObject({ name: "Passata", unit: "ml", values: { kcal: "36", protein: "1.6" } });
  });

  it("gives a saved ingredient only the nutrition and keeps its name", () => {
    const result = ingredientSave(withScan(ingredientDraft(ingredient, "", "de"), ingredient, passata, "de").draft, ingredient, snapshot());
    if (!result.action) throw new Error(result.issue);
    expect(result.action).toMatchObject({ id: "tomato", name: "Tomato", unit: "g", kcal: 36, protein: 1.6, carbs: 5.4, fat: 0.2 });
  });

  it("takes the unit and nutrition of a photographed table but keeps the typed name, since a table is not a product", () => {
    const scan = withScan(ingredientDraft(undefined, "Hafermilch", "de"), undefined, { unit: "ml", nutrition: { kcal: 46, protein: 1, carbs: 6.7, fat: 1.5 } }, "de");
    expect(scan.draft).toMatchObject({ name: "Hafermilch", unit: "ml", values: { kcal: "46", carbs: "6,7" } });
  });

  it("leaves a saved ingredient in another unit as it was, since values per 100 g do not fit a can", () => {
    const can = ingredientDraft({ ...ingredient, unit: "can" }, "", "en");
    expect(withScan(can, { ...ingredient, unit: "can" }, passata, "en")).toEqual({ draft: can, result: "otherUnit" });
  });
});
