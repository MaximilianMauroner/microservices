import { addDays, ingredientGroups, MEALS, weekStart, nutritionPerServing, type KitchenSnapshot, type PlanEntry } from "@tools-platform/service/kitchen-contract";
import { compareText } from "../../compare";
import { shoppingView } from "../shopping/view";
import { useByStatus } from "../use-by";
import { buildWeek } from "../week/model";

export function todayView(snapshot: KitchenSnapshot, today: string) {
  const ingredients = new Map(snapshot.ingredients.map((one) => [one.id, one]));
  const recipes = new Map(snapshot.recipes.map((one) => [one.id, one]));
  const entriesOn = (day: string) => snapshot.plan.filter((one) => one.day === day)
    .sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));
  const describe = (entry: PlanEntry) => {
    const recipe = recipes.get(entry.recipeId);
    return {
      entry,
      sections: entry.lines.flatMap((line) => {
        const ingredient = ingredients.get(line.ingredientId);
        return ingredient ? ingredientGroups(ingredient) : [];
      }),
      minutes: recipe?.minutes ?? null,
      kcal: nutritionPerServing(entry, ingredients).kcal,
      steps: (recipe?.instructions ?? "").split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 3),
    };
  };
  const tonight = entriesOn(today).find((one) => !one.cooked);
  const shopping = shoppingView(snapshot, today);
  return {
    tonight: tonight ? describe(tonight) : null,
    leftovers: [...snapshot.leftovers].sort((a, b) => compareText(a.useBy, b.useBy) || compareText(a.name, b.name))
      .map((one) => ({ ...one, urgent: useByStatus(one.useBy, today) !== "later" })),
    shopping,
    buyNames: [...shopping.toBuy.map((one) => one.ingredient), ...shopping.once.map((one) => one.name), ...shopping.weekly.filter((one) => !one.bought).map((one) => one.name)].slice(0, 3),
    tomorrow: entriesOn(addDays(today, 1)).map(describe),
    week: buildWeek(snapshot, today, weekStart(today)),
  };
}
