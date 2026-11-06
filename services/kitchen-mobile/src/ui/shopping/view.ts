import {
  addDays,
  shoppingList,
  weekStart,
  type ExtraItem,
  type KitchenSnapshot,
} from "@tools-platform/service/kitchen-contract";

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
