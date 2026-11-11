import type { KitchenSnapshot } from "@tools-platform/service/kitchen-contract";
import { expect, it } from "vitest";
import type { OutboxItem, QueuedAction } from "../../sync/model";
import { project } from "../../sync/project";
import { cookUndo } from "./cook";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const line = { ingredientId: id(2), ingredient: "Rice", unit: "g" as const, amount: 150, note: "dry" };
const snapshot: KitchenSnapshot = {
  kitchen: { id: id(1), name: "Home", groups: [], hidden: false, mcpEnabled: false, members: [] },
  ingredients: [{ id: id(2), name: "Rice", unit: "g", section: "Grains", otherGroups: [], notes: "", recipeCount: 1, nutrition: { kcal: 350, protein: null, carbs: null, fat: null } }],
  recipes: [{ id: id(3), name: "Bowl", servings: 2, minutes: null, instructions: "", updatedAt: "", lines: [line] }],
  plan: [{ id: id(4), day: "2026-11-11", meal: "dinner", recipeId: id(3), recipe: "Bowl", servings: 1, custom: true, cooked: false, lines: [{ ...line, amount: 60 }] }],
  stock: [{ ingredientId: id(2), ingredient: "Rice", unit: "g", section: "Grains", amount: 40 }], leftovers: [], extras: [],
};
const queue = (actions: readonly QueuedAction[]): OutboxItem[] => actions.map((action, i) => ({ action, seq: i + 1, kitchenId: id(1), clientActionId: id(100 + i), queuedAt: "2026-11-11T12:00:00Z" }));

it("undoes one-tap cooking with the same meal, custom ingredients, and stock even when stock was short", () => {
  const entry = snapshot.plan[0]!;
  const result = project({ today: entry.day, planFrom: "2026-10-12", kitchens: [snapshot] }, queue([{ type: "plan.cook", id: entry.id }, ...cookUndo(snapshot, entry)]));
  expect(result.kitchens[0]!.plan).toEqual(snapshot.plan);
  expect(result.kitchens[0]!.stock).toEqual(snapshot.stock);
  expect(result.kitchens[0]!.leftovers).toEqual([]);
});

it("restores a regular meal's servings without turning it into a custom meal", () => {
  const entry = { ...snapshot.plan[0]!, custom: false, servings: 2, lines: [line] };
  const original = { ...snapshot, plan: [entry], stock: [{ ...snapshot.stock[0]!, amount: 500 }] };
  const result = project({ today: entry.day, planFrom: "2026-10-12", kitchens: [original] }, queue([{ type: "plan.cook", id: entry.id }, ...cookUndo(original, entry)]));
  expect(result.kitchens[0]!.plan).toEqual(original.plan);
  expect(result.kitchens[0]!.stock).toEqual(original.stock);
});
