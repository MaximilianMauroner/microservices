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
