import { describe, expect, it } from "vitest";
import type { KitchenSnapshot, KitchenSync, PlanEntry } from "@tools-platform/service/kitchen-contract";
import type { QueuedAction } from "../../sync/model";
import { project } from "../../sync/project";
import { TEXT } from "./text";
import { frequentItems, rowChanges, shoppingView, type RowGesture, type ShoppingRow } from "./view";

const start = "2026-11-02";
const line = { ingredientId: "rice", ingredient: "Rice", unit: "g" as const, amount: 150, note: "" };
function meal(day: string, overrides: Partial<PlanEntry> = {}): PlanEntry {
  return {
    id: day,
    day,
    meal: "dinner",
    recipeId: "bowl",
    recipe: "Rice bowl",
    servings: 2,
    cooked: false,
    custom: false,
    lines: [line],
    ...overrides,
  };
}
function kitchen(): KitchenSnapshot {
  return {
    kitchen: { id: "home", name: "Home", mcpEnabled: false, hidden: false, members: [], groups: ["Grains"] },
    ingredients: [
      {
        id: "rice",
        name: "Rice",
        unit: "g",
        section: "Grains",
        otherGroups: [],
        nutrition: { kcal: null, protein: null, carbs: null, fat: null },
        notes: "",
        recipeCount: 1,
      },
    ],
    recipes: [
      {
        id: "bowl",
        name: "Rice bowl",
        servings: 2,
        minutes: null,
        instructions: "",
        lines: [line],
        updatedAt: "2026-11-02T00:00:00Z",
      },
    ],
    plan: [meal("2026-11-05")],
    stock: [],
    leftovers: [],
    extras: [],
  };
}
function apply(snapshot: KitchenSnapshot, actions: QueuedAction[]): KitchenSnapshot {
  const sync: KitchenSync = { today: "2026-11-05", planFrom: "2026-10-05", kitchens: [snapshot] };
  return project(
    sync,
    actions.map((action, seq) => ({ seq, clientActionId: String(seq), kitchenId: "home", queuedAt: "2026-11-05T09:00:00.000Z", action })),
  ).kitchens[0]!;
}

describe("the local shopping list", () => {
  it("uses Monday through Sunday of the shown week and counts only meals still to cook", () => {
    const snapshot = {
      ...kitchen(),
      plan: [
        meal("2026-11-01"),
        meal("2026-11-02"),
        meal("2026-11-08"),
        meal("2026-11-09"),
        meal("2026-11-04", { cooked: true }),
      ],
    };
    const view = shoppingView(snapshot, "2026-11-08");
    expect(view.start).toBe(start);
    expect(view.plannedMeals).toBe(2);
    expect(view.toBuy).toMatchObject([{ ingredient: "Rice", needed: 300, toBuy: 300, recipes: ["Rice bowl"] }]);
    expect(view.count).toBe(1);
  });

  it("buys only what is missing and moves it to Already at home after the queued purchase", () => {
    const snapshot = {
      ...kitchen(),
      stock: [{ ingredientId: "rice", ingredient: "Rice", unit: "g" as const, section: "Grains", amount: 50 }],
    };
    const before = shoppingView(snapshot, start);
    expect(before.toBuy).toMatchObject([{ inStock: 50, toBuy: 100 }]);
    const bought = apply(snapshot, [{ type: "stock.add", ingredientId: "rice", amount: before.toBuy[0]!.toBuy }]);
    const after = shoppingView(bought, start);
    expect(after.toBuy).toEqual([]);
    expect(after.covered).toMatchObject([{ ingredient: "Rice", inStock: 150, needed: 150 }]);
    expect(after.count).toBe(0);
    expect(
      shoppingView(apply(bought, [{ type: "stock.set", ingredientId: "rice", amount: 50 }]), start).toBuy[0]?.toBuy,
    ).toBe(100);
  });

  it("uses a meal's custom amounts and removes its demand after cooking", () => {
    const snapshot = { ...kitchen(), plan: [meal("2026-11-05", { custom: true, lines: [{ ...line, amount: 240 }] })] };
    expect(shoppingView(snapshot, start).toBuy[0]?.needed).toBe(240);
    const cooked = apply(snapshot, [{ type: "plan.cook", id: "2026-11-05" }]);
    expect(shoppingView(cooked, start)).toMatchObject({ toBuy: [], covered: [], count: 0, plannedMeals: 0 });
  });

  it("checks a weekly extra for the shown week and brings it back the next week", () => {
    const snapshot = {
      ...kitchen(),
      plan: [],
      extras: [
        { id: "coffee", name: "Coffee", everyWeek: true, boughtWeek: start },
        { id: "soap", name: "Soap", everyWeek: true, boughtWeek: "2026-10-26" },
        { id: "paper", name: "Paper", everyWeek: false, boughtWeek: start },
      ],
    };
    const view = shoppingView(snapshot, start);
    expect(view.weekly).toMatchObject([
      { name: "Coffee", bought: true },
      { name: "Soap", bought: false },
    ]);
    expect(view.once).toMatchObject([{ name: "Paper", bought: false }]);
    expect(view.count).toBe(2);
    expect(shoppingView(snapshot, "2026-11-09").count).toBe(3);
    const unchecked = apply(snapshot, [{ type: "extra.mark", id: "coffee", week: start, bought: false }]);
    expect(shoppingView(unchecked, start).weekly[0]?.bought).toBe(false);
    const checked = apply(unchecked, [{ type: "extra.mark", id: "coffee", week: start, bought: true }]);
    expect(shoppingView(checked, start).weekly[0]?.bought).toBe(true);
  });

  it("removes one-time purchases and stops weekly extras through queued changes", () => {
    const snapshot = {
      ...kitchen(),
      plan: [],
      extras: [
        { id: "paper", name: "Paper", everyWeek: false, boughtWeek: null },
        { id: "coffee", name: "Coffee", everyWeek: true, boughtWeek: null },
      ],
    };
    const bought = apply(snapshot, [{ type: "extra.remove", id: "paper" }]);
    expect(shoppingView(bought, start)).toMatchObject({ once: [], count: 1 });
    const stopped = apply(bought, [{ type: "extra.remove", id: "coffee" }]);
    expect(shoppingView(stopped, "2026-11-09")).toMatchObject({ weekly: [], count: 0 });
  });
});

describe("the quick picks of the Add sheet", () => {
  const ingredient = (id: string, name: string, recipeCount: number) => ({ ...kitchen().ingredients[0]!, id, name, recipeCount });
  const uses = (day: string, ...ids: string[]) => meal(day, { id: `${day}:${ids.join()}`, lines: ids.map((id) => ({ ...line, ingredientId: id })) });
  const snapshot = (patch: Partial<KitchenSnapshot> = {}): KitchenSnapshot => ({
    ...kitchen(),
    ingredients: [ingredient("rice", "Rice", 1), ingredient("milk", "Milk", 3), ingredient("eggs", "Eggs", 5), ingredient("salt", "Salt", 0)],
    plan: [uses("2026-10-12", "rice", "milk"), uses("2026-10-20", "rice"), uses("2026-11-05", "rice", "rice")],
    ...patch,
  });

  it("puts the ingredients that stored meals use most first, then those in the most recipes", () => {
    expect(frequentItems(snapshot(), "")).toEqual(["Rice", "Milk", "Eggs", "Salt"]);
  });

  it("leaves out what is already on the list, in any case", () => {
    const listed = snapshot({ extras: [{ id: "x", name: "rice", everyWeek: false, boughtWeek: null }] });
    expect(frequentItems(listed, "")).toEqual(["Milk", "Eggs", "Salt"]);
  });

  it("suggests only matching ingredients while the person types", () => {
    expect(frequentItems(snapshot(), "  i ")).toEqual(["Rice", "Milk"]);
    expect(frequentItems(snapshot(), "coffee")).toEqual([]);
  });

  it("shows at most eight", () => {
    const many = snapshot({ ingredients: Array.from({ length: 12 }, (_, index) => ingredient(`i${index}`, `Item ${index}`, index)), plan: [] });
    expect(frequentItems(many, "")).toEqual(["Item 11", "Item 10", "Item 9", "Item 8", "Item 7", "Item 6", "Item 5", "Item 4"]);
  });
});

describe("the gestures on a shopping row", () => {
  const snapshot = (): KitchenSnapshot => ({
    ...kitchen(),
    extras: [
      { id: "coffee", name: "Coffee", everyWeek: true, boughtWeek: null },
      { id: "paper", name: "Paper", everyWeek: false, boughtWeek: null },
    ],
  });
  const rows = (view: ReturnType<typeof shoppingView>): Record<string, ShoppingRow> => ({
    ...Object.fromEntries(view.toBuy.map((line) => [line.ingredient, { kind: "line", line }])),
    ...Object.fromEntries(view.weekly.map((extra) => [extra.name, { kind: "weekly", extra, week: view.start }])),
    ...Object.fromEntries(view.once.map((extra) => [extra.name, { kind: "once", extra }])),
  });
  function run(before: KitchenSnapshot, name: string, gesture: RowGesture) {
    const change = rowChanges(rows(shoppingView(before, start))[name]!, TEXT.en, "en")[gesture]!;
    const after = apply(before, [change.action]);
    return { change, after: shoppingView(after, start), undone: change.undo ? shoppingView(apply(after, [change.undo]), start) : null };
  }

  it("buys an ingredient line into At home and gives it back on undo, but cannot remove it", () => {
    const { change, after, undone } = run(snapshot(), "Rice", "check");
    expect(change.message).toBe("150 g Rice added to At home");
    expect(after.covered).toMatchObject([{ ingredient: "Rice", inStock: 150 }]);
    expect(undone?.toBuy).toMatchObject([{ ingredient: "Rice", toBuy: 150 }]);
    expect(rowChanges(rows(shoppingView(snapshot(), start)).Rice!, TEXT.en, "en").remove).toBeUndefined();
  });

  it("checks a weekly item for the week, and a second check puts it back on the list", () => {
    const bought = run(snapshot(), "Coffee", "check");
    expect(bought.after.weekly).toMatchObject([{ name: "Coffee", bought: true }]);
    expect(bought.undone?.weekly).toMatchObject([{ name: "Coffee", bought: false }]);
    const kitchenAfter = apply(snapshot(), [bought.change.action]);
    const back = run(kitchenAfter, "Coffee", "check");
    expect(back.change.message).toBe("Coffee back on the list");
    expect(back.after.weekly).toMatchObject([{ name: "Coffee", bought: false }]);
  });

  it("stops a weekly item on remove and brings it back as a weekly item on undo", () => {
    const { change, after, undone } = run(snapshot(), "Coffee", "remove");
    expect(change.message).toBe("Coffee is no longer on every week's list");
    expect(after.weekly).toEqual([]);
    expect(undone?.weekly).toMatchObject([{ name: "Coffee", everyWeek: true, bought: false }]);
  });

  it("takes a one-time item off the list when it is bought or removed, and undo puts it back", () => {
    for (const [gesture, message] of [["check", "Paper bought"], ["remove", "Paper removed"]] as const) {
      const { change, after, undone } = run(snapshot(), "Paper", gesture);
      expect(change.message).toBe(message);
      expect(after.once).toEqual([]);
      expect(undone?.once).toMatchObject([{ name: "Paper", everyWeek: false }]);
    }
  });
});
