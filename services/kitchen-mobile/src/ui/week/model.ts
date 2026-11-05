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
