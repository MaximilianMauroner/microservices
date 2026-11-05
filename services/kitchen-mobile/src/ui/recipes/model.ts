import { ingredientGroups, missingAtHome, nutritionPerServing, UNSORTED_SECTION, type KitchenSnapshot } from "@tools-platform/service/kitchen-contract";
import type { DraftLine } from "../lines";

export function recipeSummaries(kitchen: Pick<KitchenSnapshot, "recipes" | "ingredients" | "stock">) {
  const ingredients = new Map(kitchen.ingredients.map((one) => [one.id, one]));
  const stock = new Map(kitchen.stock.map((one) => [one.ingredientId, one.amount]));
  return kitchen.recipes.map((recipe) => {
    const nutrition = nutritionPerServing(recipe, ingredients);
    return {
      id: recipe.id, name: recipe.name, minutes: recipe.minutes,
      kcal: nutrition.kcal, protein: nutrition.protein,
      ingredientCount: recipe.lines.length,
      ingredientIds: recipe.lines.map((line) => line.ingredientId),
      sections: recipe.lines.flatMap((line) => {
        const ingredient = ingredients.get(line.ingredientId);
        return ingredient ? ingredientGroups(ingredient) : [UNSORTED_SECTION];
      }),
      missing: missingAtHome(recipe, stock)
    };
  });
}

export type RecipeSummary = ReturnType<typeof recipeSummaries>[number];

export function filterRecipes(recipes: readonly RecipeSummary[], query: string, wanted: readonly string[], fromHome: boolean): RecipeSummary[] {
  return recipes
    .filter((recipe) => recipe.name.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((recipe) => wanted.every((id) => recipe.ingredientIds.includes(id)))
    .filter((recipe) => !fromHome || recipe.ingredientCount > 0)
    .sort((a, b) => fromHome ? a.missing.length - b.missing.length : 0);
}

export function recipeDraftError(name: string, minutes: string, lines: readonly DraftLine[], recipes: KitchenSnapshot["recipes"], recipeId?: string) {
  const cleanName = name.trim().replace(/\s+/g, " ");
  if (!cleanName) return "nameRequired";
  if (cleanName.length > 120) return "nameTooLong";
  if (recipes.some((recipe) => recipe.id !== recipeId && recipe.name.toLowerCase() === cleanName.toLowerCase())) return "nameInUse";
  if (minutes && (!Number.isInteger(Number(minutes)) || Number(minutes) < 1 || Number(minutes) > 10_000)) return "minutesInvalid";
  const seen = new Set<string>();
  for (const line of lines.filter((one) => one.name.trim())) {
    const keys = [`name:${line.name.trim().replace(/\s+/g, " ").toLowerCase()}`, ...(line.ingredientId ? [`id:${line.ingredientId}`] : [])];
    if (keys.some((key) => seen.has(key))) return "duplicateIngredient";
    keys.forEach((key) => seen.add(key));
    const amount = Number(line.amount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return "amountInvalid";
  }
  return undefined;
}
