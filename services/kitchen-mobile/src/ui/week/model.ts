import {
  addDays, ingredientGroups, type KitchenSnapshot, type Meal, MEALS,
  nutritionPerServing, type PlanEntry, shoppingList, UNSORTED_SECTION, weekDays, weekStart,
} from "@tools-platform/service/kitchen-contract";

export function buildWeek(snapshot: KitchenSnapshot, requested: string, planFrom: string) {
  const start = weekStart(requested < planFrom ? planFrom : requested);
  const end = addDays(start, 7);
  const entries = snapshot.plan.filter((entry) => entry.day >= start && entry.day < end);
  const days = weekDays(start).map((day) => ({
    day,
    entries: entries.filter((entry) => entry.day === day).sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal)),
  }));
  const ingredients = new Map(snapshot.ingredients.map((one) => [one.id, one]));
  const recipes = snapshot.recipes.map((recipe) => ({
    ...recipe,
    kcal: nutritionPerServing(recipe, ingredients).kcal,
    sections: recipe.lines.flatMap((line) => {
      const ingredient = ingredients.get(line.ingredientId);
      return ingredient ? ingredientGroups(ingredient) : [UNSORTED_SECTION];
    }),
  }));
  const shopping = shoppingList(entries, snapshot.stock, new Map(snapshot.ingredients.map((one) => [one.id, one.section])), snapshot.kitchen.groups);
  const missing = shopping.filter((line) => line.toBuy > 0);
  return {
    start, entries, days, recipes,
    canGoBack: addDays(start, -7) >= planFrom,
    cooked: entries.filter((entry) => entry.cooked).length,
    leftovers: [...snapshot.leftovers].sort((a, b) => a.useBy.localeCompare(b.useBy) || a.name.localeCompare(b.name)),
    toBuy: missing.length + snapshot.extras.filter((extra) => !extra.everyWeek || extra.boughtWeek !== start).length,
    buySections: missing.map((line) => line.section),
  };
}

export type WeekView = ReturnType<typeof buildWeek>;

export function defaultMeal(entries: readonly PlanEntry[]): Meal {
  const taken = new Set(entries.map((entry) => entry.meal));
  return (["dinner", "lunch", "breakfast", "snack"] as const).find((meal) => !taken.has(meal)) ?? "dinner";
}

/**
 * The days the Plan sheet offers and the day it selects. It offers seven days from today, or the shown week when that
 * starts later, so a person can plan past Sunday. It selects the day the person picked, or else the first day without a meal.
 */
export function planStrip({ weekStart, today, plan, day }: { weekStart: string; today: string; plan: readonly Pick<PlanEntry, "day">[]; day?: string }) {
  const soonest = weekStart > today ? weekStart : today;
  const from = day && day < soonest ? day : soonest;
  const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));
  const planned = new Set(plan.map((entry) => entry.day));
  return { days, selected: day ?? days.find((one) => !planned.has(one)) ?? from };
}

/**
 * The week change a released horizontal swipe asks for: 1 for the next week, -1 for the previous one, 0 for none.
 * A swipe to the left shows the next week, like turning a page. A short fast flick counts as much as a long slow drag.
 */
export function swipeStep(translationX: number, velocityX: number): -1 | 0 | 1 {
  const reach = translationX + velocityX * 0.15;
  if (Math.abs(translationX) < 24 || Math.abs(reach) < 96) return 0;
  return reach < 0 ? 1 : -1;
}
