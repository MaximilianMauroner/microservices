import {
  addDays,
  formatAmount,
  shoppingList,
  weekStart,
  type ExtraItem,
  type KitchenSnapshot,
  type ShoppingLine,
} from "@tools-platform/service/kitchen-contract";
import type { QueuedAction } from "../../sync/model";
import type { KitchenLanguage } from "../language";
import type { TEXT } from "./text";

export function shoppingView(kitchen: KitchenSnapshot, day: string) {
  const start = weekStart(day);
  const end = addDays(start, 7);
  const entries = kitchen.plan.filter((entry) => entry.day >= start && entry.day < end);
  const lines = shoppingList(
    entries,
    kitchen.stock,
    new Map(kitchen.ingredients.map((one) => [one.id, one.section])),
    kitchen.kitchen.groups,
  );
  const extras: ExtraItem[] = kitchen.extras.map((extra) => ({
    id: extra.id,
    name: extra.name,
    everyWeek: extra.everyWeek,
    bought: extra.everyWeek && extra.boughtWeek === start,
  }));
  const toBuy = lines.filter((line) => line.toBuy > 0);
  const covered = lines.filter((line) => line.toBuy === 0);
  const once = extras.filter((extra) => !extra.everyWeek);
  const weekly = extras.filter((extra) => extra.everyWeek);
  return {
    start,
    toBuy,
    covered,
    once,
    weekly,
    plannedMeals: entries.filter((entry) => !entry.cooked).length,
    count: toBuy.length + once.length + weekly.filter((extra) => !extra.bought).length,
  };
}

/**
 * Quick picks for the Add sheet. The phone keeps no history of bought items, so "frequent" means the ingredients that
 * the most stored meals use, then those in the most recipes. Names on the list already are left out. While the person
 * types, only matching names stay.
 */
export function frequentItems(kitchen: Pick<KitchenSnapshot, "ingredients" | "plan" | "extras">, typed: string, limit = 8): string[] {
  const listed = new Set(kitchen.extras.map((extra) => extra.name.toLowerCase()));
  const uses = new Map<string, number>();
  for (const entry of kitchen.plan) for (const id of new Set(entry.lines.map((line) => line.ingredientId))) uses.set(id, (uses.get(id) ?? 0) + 1);
  const query = typed.trim().toLowerCase();
  return kitchen.ingredients
    .filter((one) => !listed.has(one.name.toLowerCase()) && one.name.toLowerCase().includes(query))
    .sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || b.recipeCount - a.recipeCount || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((one) => one.name);
}

export type ShoppingRow =
  | { kind: "line"; line: ShoppingLine }
  | { kind: "weekly"; extra: ExtraItem; week: string }
  | { kind: "once"; extra: ExtraItem };

/** The gesture each swipe direction runs. A swipe right does what a tap does. */
export const SWIPE = { right: "check", left: "remove" } as const;
export type RowGesture = (typeof SWIPE)[keyof typeof SWIPE];
export type RowChange = Readonly<{ action: QueuedAction; message: string; undo?: readonly QueuedAction[] }>;

/**
 * What each gesture changes on a row. A missing gesture means the row does not have it: no change removes an
 * ingredient line, because the planned meals need it. A one-time item has no bought state, so buying it removes it.
 */
export function rowChanges(
  row: ShoppingRow,
  text: (typeof TEXT)[KitchenLanguage],
  language: KitchenLanguage,
  newId: () => string,
): Partial<Record<RowGesture, RowChange>> {
  if (row.kind === "line") {
    const { line } = row;
    return {
      check: {
        action: { type: "stock.add", ingredientId: line.ingredientId, amount: line.toBuy },
        message: text.addedToHome(formatAmount(line.toBuy, line.unit, language), line.ingredient),
        undo: [{ type: "stock.set", ingredientId: line.ingredientId, amount: line.inStock }],
      },
    };
  }
  const { id, name } = row.extra;
  if (row.kind === "once") {
    const undo: QueuedAction[] = [{ type: "extra.add", name }];
    return {
      check: { action: { type: "extra.remove", id }, message: text.bought(name), undo },
      remove: { action: { type: "extra.remove", id }, message: text.removed(name), undo },
    };
  }
  const { week } = row;
  const mark = (bought: boolean, itemId = id): QueuedAction => ({ type: "extra.mark", id: itemId, week, bought });
  const createId = newId();
  const addAgain: QueuedAction = { type: "extra.add", createId, name, everyWeek: true };
  return {
    check: row.extra.bought
      ? { action: mark(false), message: text.notBought(name) }
      : { action: mark(true), message: text.bought(name), undo: [mark(false)] },
    remove: {
      action: { type: "extra.remove", id },
      message: text.stopped(name),
      undo: row.extra.bought ? [addAgain, mark(true, createId)] : [addAgain],
    },
  };
}
