import { describe, expect, it } from "vitest";
import type { KitchenSync } from "@tools-platform/service/kitchen-contract";
import type { OutboxItem, QueuedAction } from "./model";
import { project } from "./project";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const homeId = id(1);
const riceId = id(2);
const bowlId = id(3);
const planId = id(4);
const noNutrition = { kcal: null, protein: null, carbs: null, fat: null };

function empty(): KitchenSync {
  return {
    today: "2026-11-05", planFrom: "2026-10-05",
    kitchens: [{
      kitchen: { id: homeId, name: "Home", mcpEnabled: false, hidden: false, members: [], groups: [] },
      ingredients: [], recipes: [], plan: [], stock: [], leftovers: [], extras: [],
    }],
  };
}

function queue(actions: readonly QueuedAction[]): OutboxItem[] {
  return actions.map((action, index) => ({ seq: index + 1, clientActionId: id(index + 100), kitchenId: homeId, action }));
}

function ingredient(overrides: Partial<Extract<QueuedAction, { type: "ingredient.save" }>> = {}): Extract<QueuedAction, { type: "ingredient.save" }> {
  return { type: "ingredient.save", createId: riceId, name: "Rice", unit: "g", section: "Grains", ...noNutrition, notes: "", ...overrides };
}

function recipe(overrides: Partial<Extract<QueuedAction, { type: "recipe.save" }>> = {}): Extract<QueuedAction, { type: "recipe.save" }> {
  return {
    type: "recipe.save", createId: bowlId, name: "Rice bowl", servings: 2, minutes: 15, instructions: "Cook the rice.",
    lines: [{ ingredientId: riceId, amount: 150, note: "dry" }], ...overrides,
  };
}

function meal(overrides: Partial<Extract<QueuedAction, { type: "plan.add" }>> = {}): Extract<QueuedAction, { type: "plan.add" }> {
  return { type: "plan.add", createId: planId, day: "2026-11-05", meal: "dinner", recipeId: bowlId, servings: 2, ...overrides };
}

function home(snapshot: KitchenSync) {
  return snapshot.kitchens[0]!;
}

function planned(): KitchenSync {
  return project(empty(), queue([ingredient(), recipe(), meal()]));
}

describe("offline Kitchen projection", () => {
  it("creates an ingredient, a recipe, and a scaled meal through their app IDs in sequence order", () => {
    const outbox = queue([ingredient(), recipe(), meal({ servings: 3 })]);
    const result = home(project(empty(), [...outbox].reverse()));

    expect(result.ingredients).toEqual([{
      id: riceId, name: "Rice", unit: "g", section: "Grains", otherGroups: [], nutrition: noNutrition, notes: "", recipeCount: 1,
    }]);
    expect(result.recipes[0]).toMatchObject({ id: bowlId, name: "Rice bowl", servings: 2, updatedAt: "2026-11-05T00:00:00.000Z", lines: [{ ingredientId: riceId, amount: 150, note: "dry" }] });
    expect(result.plan).toEqual([{
      id: planId, day: "2026-11-05", meal: "dinner", recipeId: bowlId, recipe: "Rice bowl", servings: 3, cooked: false, custom: false,
      lines: [{ ingredientId: riceId, ingredient: "Rice", unit: "g", amount: 225, note: "dry" }],
    }]);
    expect(result.kitchen.groups).toEqual(["Grains"]);
  });

  it("cooks once, takes only the available stock, and keeps leftover servings", () => {
    const result = home(project(planned(), queue([
      { type: "stock.set", ingredientId: riceId, amount: 100 },
      { type: "plan.cook", id: planId, leftover: { servings: 1.5, useBy: "2026-11-07" } },
      { type: "plan.cook", id: planId, leftover: { servings: 2, useBy: "2026-11-08" } },
    ])));

    expect(result.plan[0]!.cooked).toBe(true);
    expect(result.stock).toEqual([]);
    expect(result.leftovers).toEqual([{ id: expect.any(String), name: "Rice bowl", servings: 1.5, useBy: "2026-11-07" }]);
  });

  it("uses the custom meal amounts when cooking and keeps the stock that remains", () => {
    const result = home(project(planned(), queue([
      { type: "stock.add", ingredientId: riceId, amount: 500 },
      { type: "plan.customize", id: planId, lines: [{ ingredientId: riceId, amount: 60, note: "small meal" }] },
      { type: "plan.cook", id: planId },
      { type: "plan.customize", id: planId, lines: [] },
    ])));

    expect(result.stock[0]!.amount).toBe(440);
    expect(result.plan[0]).toMatchObject({ cooked: true, custom: true, lines: [{ amount: 60, note: "small meal" }] });
  });

  it("leaves the meal and stock unchanged when a leftover has an invalid date", () => {
    const snapshot = project(planned(), queue([{ type: "stock.set", ingredientId: riceId, amount: 500 }]));
    expect(project(snapshot, queue([
      { type: "plan.cook", id: planId, leftover: { servings: 1, useBy: "2026-02-30" } },
    ]))).toEqual(snapshot);
  });

  it("converts stock, recipe lines, and custom meal lines to a new unit", () => {
    const result = home(project(planned(), queue([
      { type: "stock.set", ingredientId: riceId, amount: 750 },
      { type: "plan.customize", id: planId, lines: [{ ingredientId: riceId, amount: 300, note: "hungry" }] },
      ingredient({ id: riceId, name: "Rice pack", unit: "piece", section: "Pantry", oldPerNew: 250, kcal: 900 }),
      meal({ createId: id(5), servings: 1 }),
    ])));

    expect(result.stock).toEqual([{ ingredientId: riceId, ingredient: "Rice pack", unit: "piece", section: "Pantry", amount: 3 }]);
    expect(result.recipes[0]!.lines[0]).toEqual({ ingredientId: riceId, ingredient: "Rice pack", unit: "piece", amount: 0.6, note: "dry" });
    expect(result.plan[0]).toMatchObject({ custom: true, lines: [{ ingredient: "Rice pack", unit: "piece", amount: 1.2 }] });
    expect(result.plan[1]).toMatchObject({ custom: false, lines: [{ amount: 0.3 }] });
    expect(result.ingredients[0]!.nutrition.kcal).toBe(900);
  });

  it("requires a conversion for a used ingredient and keeps converted recipe amounts above zero", () => {
    const snapshot = planned();
    expect(project(snapshot, queue([ingredient({ id: riceId, unit: "piece" })]))).toEqual(snapshot);
    expect(project(snapshot, queue([ingredient({ id: riceId, unit: "piece", oldPerNew: 0 })]))).toEqual(snapshot);

    const result = home(project(snapshot, queue([
      ingredient({ id: riceId, unit: "piece", oldPerNew: 1_000_000 }),
    ])));
    expect(result.recipes[0]!.lines[0]!.amount).toBe(0.001);
  });

  it("adds an ingredient to recipes and updates their meals and recipe counts", () => {
    const beanId = id(6);
    const result = home(project(planned(), queue([
      ingredient({ createId: beanId, name: "Beans", unit: "can", section: "Proteins", otherGroups: ["Grains", " Proteins ", "Other"], addToRecipes: [{ recipeId: bowlId, amount: 2 }] }),
    ])));

    expect(result.ingredients.map((item) => [item.name, item.recipeCount])).toEqual([["Beans", 1], ["Rice", 1]]);
    expect(result.ingredients[0]!.otherGroups).toEqual(["Grains"]);
    expect(result.plan[0]!.lines[1]).toEqual({ ingredientId: beanId, ingredient: "Beans", unit: "can", amount: 2, note: "" });
    expect(result.kitchen.groups).toEqual(["Grains", "Proteins"]);
  });

  it("rejects the whole ingredient save when one requested recipe is missing or already uses it", () => {
    const snapshot = planned();
    const result = project(snapshot, queue([
      ingredient({ createId: id(7), name: "Beans", section: "Proteins", addToRecipes: [{ recipeId: bowlId, amount: 2 }, { recipeId: id(999), amount: 1 }] }),
      ingredient({ id: riceId, name: "New rice", addToRecipes: [{ recipeId: bowlId, amount: 1 }] }),
    ]));
    expect(result).toEqual(snapshot);
  });

  it("renames and rescales recipe meals while custom meals keep their own ingredients", () => {
    const snapshot = project(planned(), queue([
      { type: "plan.customize", id: planId, lines: [{ ingredientId: riceId, amount: 90, note: "custom" }] },
      meal({ createId: id(5), servings: 4 }),
    ]));
    const result = home(project(snapshot, queue([
      recipe({ id: bowlId, name: "Rice supper", servings: 3, lines: [{ ingredientId: riceId, amount: 300, note: "new" }] }),
      { type: "plan.update", id: planId, day: "2026-11-06", meal: "lunch", servings: 4 },
    ])));

    expect(result.plan.map((entry) => [entry.id, entry.recipe, entry.custom, entry.lines[0]!.amount])).toEqual([
      [id(5), "Rice supper", false, 400], [planId, "Rice supper", true, 180],
    ]);
    expect(result.ingredients[0]!.recipeCount).toBe(1);
    const reset = home(project({ ...snapshot, kitchens: [result] }, queue([{ type: "plan.reset", id: planId }])));
    expect(reset.plan.find((entry) => entry.id === planId)).toMatchObject({ custom: false, lines: [{ amount: 400, note: "new" }] });
  });

  it("can reset a cooked meal but cannot customize it", () => {
    const result = home(project(planned(), queue([
      { type: "plan.customize", id: planId, lines: [] },
      { type: "plan.cook", id: planId },
      { type: "plan.reset", id: planId },
      { type: "plan.customize", id: planId, lines: [] },
    ])));
    expect(result.plan[0]).toMatchObject({ cooked: true, custom: false, lines: [{ amount: 150 }] });
  });

  it("removes a recipe's meals and updates the ingredient use count", () => {
    const result = home(project(planned(), queue([{ type: "recipe.delete", id: bowlId }])));
    expect(result.recipes).toEqual([]);
    expect(result.plan).toEqual([]);
    expect(result.ingredients[0]!.recipeCount).toBe(0);
  });

  it("keeps ingredients used by recipes and deletes stock and custom lines for other ingredients", () => {
    const beanId = id(6);
    const result = home(project(planned(), queue([
      { type: "ingredient.delete", id: riceId },
      ingredient({ createId: beanId, name: "Beans", unit: "can" }),
      { type: "stock.set", ingredientId: beanId, amount: 3 },
      { type: "plan.customize", id: planId, lines: [{ ingredientId: beanId, amount: 1, note: "" }] },
      { type: "ingredient.delete", id: beanId },
    ])));
    expect(result.ingredients.map((item) => item.id)).toEqual([riceId]);
    expect(result.stock).toEqual([]);
    expect(result.plan[0]).toMatchObject({ custom: true, lines: [] });
  });

  it("sets and adds rounded stock amounts and hides zero stock", () => {
    const snapshot = project(empty(), queue([ingredient()]));
    const result = project(snapshot, queue([
      { type: "stock.set", ingredientId: riceId, amount: 1.23456 },
      { type: "stock.add", ingredientId: riceId, amount: 2.0001 },
      { type: "stock.add", ingredientId: riceId, amount: -1 },
    ]));
    expect(home(result).stock[0]!.amount).toBeCloseTo(3.235, 10);
    expect(home(project(result, queue([{ type: "stock.set", ingredientId: riceId, amount: 0 }]))).stock).toEqual([]);
  });

  it("eats leftovers until none remain and removes an uneaten leftover", () => {
    const snapshot = project(empty(), queue([
      { type: "leftover.add", createId: id(7), name: " Soup ", servings: 2, useBy: "2026-11-07" },
      { type: "leftover.add", createId: id(8), name: "Curry", servings: 1, useBy: "2026-11-06" },
      { type: "leftover.eat", id: id(7), servings: 0.5 },
    ]));
    expect(home(snapshot).leftovers.map((item) => [item.name, item.servings])).toEqual([["Curry", 1], ["Soup", 1.5]]);
    const result = project(snapshot, queue([
      { type: "leftover.eat", id: id(7), servings: 1.5 },
      { type: "leftover.remove", id: id(8) },
    ]));
    expect(home(result).leftovers).toEqual([]);
  });

  it("removes leftovers with at most 0.001 servings left, including when more than remains is eaten", () => {
    const result = home(project(empty(), queue([
      { type: "leftover.add", createId: id(7), name: "Soup", servings: 1.001, useBy: "2026-11-07" },
      { type: "leftover.add", createId: id(8), name: "Curry", servings: 1, useBy: "2026-11-06" },
      { type: "leftover.eat", id: id(7), servings: 1 },
      { type: "leftover.eat", id: id(8), servings: 2 },
    ])));
    expect(result.leftovers).toEqual([]);
  });

  it("buys an every-week extra for one week and preserves it when another week is unchecked", () => {
    const snapshot = project(empty(), queue([
      { type: "extra.add", createId: id(7), name: " Milk ", everyWeek: true },
      { type: "extra.mark", id: id(7), week: "2026-11-05", bought: true },
      { type: "extra.mark", id: id(7), week: "2026-11-09", bought: false },
    ]));
    expect(home(snapshot).extras).toEqual([{ id: id(7), name: "Milk", everyWeek: true, boughtWeek: "2026-11-02" }]);
    const result = project(snapshot, queue([{ type: "extra.mark", id: id(7), week: "2026-11-03", bought: false }]));
    expect(home(result).extras[0]!.boughtWeek).toBeNull();
  });

  it("buys a one-time extra by removing it and skips an invalid mark", () => {
    const snapshot = project(empty(), queue([
      { type: "extra.add", createId: id(7), name: "Tea" },
      { type: "extra.mark", id: id(7), week: "2026-11-05", bought: true },
    ]));
    expect(home(snapshot).extras).toEqual([{ id: id(7), name: "Tea", everyWeek: false, boughtWeek: null }]);
    expect(home(project(snapshot, queue([{ type: "extra.remove", id: id(7) }]))).extras).toEqual([]);
  });

  it("cleans the group order and remembers new ingredient groups", () => {
    const result = home(project(empty(), queue([
      { type: "groups.set", groups: [" Proteins ", "Other", "", "Proteins", "Grains"] },
      ingredient({ section: "Grains", otherGroups: ["Fresh"] }),
    ])));
    expect(result.kitchen.groups).toEqual(["Proteins", "Grains", "Fresh"]);
  });

  it("skips missing targets, invalid values, and name conflicts and continues with the next change", () => {
    const snapshot = planned();
    const result = home(project(snapshot, queue([
      ingredient({ createId: id(7), name: "rice" }),
      ingredient({ id: riceId, name: " " }),
      recipe({ id: bowlId, servings: 0 }),
      recipe({ createId: id(8), name: "Other bowl", lines: [{ ingredientId: id(999), amount: 1, note: "" }] }),
      meal({ createId: id(8), day: "2026-02-30" }),
      { type: "plan.update", id: id(999), day: "2026-11-05", meal: "lunch", servings: 2 },
      { type: "stock.set", ingredientId: id(999), amount: 100 },
      { type: "plan.customize", id: planId, lines: [{ ingredientId: id(999), amount: 1, note: "" }] },
      { type: "leftover.eat", id: id(999), servings: 1 },
      { type: "extra.add", createId: id(9), name: "Bread" },
    ])));
    expect(result.ingredients).toEqual(home(snapshot).ingredients);
    expect(result.recipes).toEqual(home(snapshot).recipes);
    expect(result.plan).toEqual(home(snapshot).plan);
    expect(result.stock).toEqual([]);
    expect(result.extras.map((item) => item.name)).toEqual(["Bread"]);
  });

  it("skips a missing kitchen without changing the snapshot", () => {
    const outbox = queue([ingredient()]).map((item) => ({ ...item, kitchenId: id(999) }));
    expect(project(empty(), outbox)).toEqual(empty());
  });

  it("rejects a created ID already used by the same item type in another kitchen", () => {
    const office = home(project(empty(), queue([{ type: "extra.add", createId: id(7), name: "Office tea" }])));
    const snapshot: KitchenSync = {
      ...empty(), kitchens: [home(empty()), { ...office, kitchen: { ...office.kitchen, id: id(8), name: "Office" } }],
    };
    const result = project(snapshot, queue([
      { type: "extra.add", createId: id(7), name: "Home tea" },
      ingredient({ createId: id(7) }),
    ]));
    expect(home(result).extras).toEqual([]);
    expect(home(result).ingredients[0]!.id).toBe(id(7));
    expect(result.kitchens[1]).toEqual(snapshot.kitchens[1]);
  });

  it("sorts names, meals, stock, and leftovers while preserving new meal creation order", () => {
    const result = home(project(empty(), queue([
      ingredient({ name: "zucchini", section: "Vegetables" }),
      ingredient({ createId: id(6), name: "Apple", section: "Fruit" }),
      recipe({ name: "zucchini bowl" }),
      recipe({ createId: id(7), name: "Apple bowl", lines: [] }),
      meal({ day: "2026-11-06", meal: "breakfast" }),
      meal({ createId: id(8), meal: "dinner" }),
      meal({ createId: id(9), meal: "breakfast" }),
      { type: "plan.update", id: planId, day: "2026-11-05", meal: "dinner", servings: 2 },
      meal({ createId: id(10), day: "2026-10-04" }),
      { type: "stock.set", ingredientId: riceId, amount: 1 },
      { type: "stock.set", ingredientId: id(6), amount: 1 },
    ])));
    expect(result.ingredients.map((item) => item.name)).toEqual(["Apple", "zucchini"]);
    expect(result.recipes.map((item) => item.name)).toEqual(["Apple bowl", "zucchini bowl"]);
    expect(result.plan.map((entry) => entry.id)).toEqual([id(9), planId, id(8)]);
    expect(result.stock.map((item) => item.section)).toEqual(["Fruit", "Vegetables"]);
  });

  it("removes meals and keeps meals moved before the sync window out of the plan", () => {
    const result = project(planned(), queue([
      meal({ createId: id(5) }),
      { type: "plan.remove", id: id(5) },
      { type: "plan.update", id: planId, day: "2026-10-04", meal: "lunch", servings: 2 },
    ]));
    expect(home(result).plan).toEqual([]);
  });

  it("preserves the input objects and gives repeated projections the same result", () => {
    const snapshot = planned();
    const outbox = queue([
      { type: "stock.add", ingredientId: riceId, amount: 500 },
      { type: "plan.cook", id: planId, leftover: { servings: 1, useBy: "2026-11-07" } },
      { type: "extra.add", name: "Bread" },
    ]);
    const beforeSnapshot = structuredClone(snapshot);
    const beforeOutbox = structuredClone(outbox);
    const result = project(snapshot, outbox);

    expect(project(snapshot, outbox)).toEqual(result);
    expect(snapshot).toEqual(beforeSnapshot);
    expect(outbox).toEqual(beforeOutbox);
    expect(home(result).stock[0]!.amount).toBe(350);
    expect(home(result).extras[0]!.name).toBe("Bread");
  });
});
