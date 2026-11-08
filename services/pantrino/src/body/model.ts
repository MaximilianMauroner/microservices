import type { BodyshopAction, Meal, Nutrients, SavedFood } from "@tools-platform/service/bodyshop-contract";
import { type Ingredient, isCountedUnit, type Meal as KitchenMeal, nutritionPerServing, type Recipe } from "@tools-platform/service/kitchen-contract";
import type { ScanResult } from "../ui/scan/scanner";

/**
 * Something Bodyshop can log: a saved Bodyshop food, a Kitchen recipe or ingredient, or a scan. `nutrients` are for `per`
 * of `unit`. A saved food goes by its id, so Bodyshop keeps its own reference. Everything else goes as an estimate with its values.
 */
export type Loggable = Readonly<{
  name: string;
  per: number;
  unit: string;
  nutrients: Nutrients;
  usual: number;
  origin: "bodyshop" | "recipe" | "ingredient" | "scan";
  savedId?: string;
}>;

const NONE = { kcal: null, protein: null, carbs: null, fat: null, fiber: null } as const;

export function fromSaved(food: SavedFood): Loggable {
  return { name: food.name, per: food.amount, unit: food.unit, nutrients: food.nutrients, usual: food.amount, origin: "bodyshop", savedId: food.id };
}

/** One serving of a recipe, with the values of its ingredients. Kitchen has no fiber, so fiber stays unknown. */
export function fromRecipe(recipe: Pick<Recipe, "name" | "servings" | "lines">, ingredients: ReadonlyMap<string, Pick<Ingredient, "unit" | "nutrition">>): Loggable {
  return { name: recipe.name, per: 1, unit: "portion", nutrients: { ...NONE, ...nutritionPerServing(recipe, ingredients) }, usual: 1, origin: "recipe" };
}

export function fromIngredient(ingredient: Pick<Ingredient, "name" | "unit" | "nutrition">): Loggable {
  const per = isCountedUnit(ingredient.unit) ? 1 : 100;
  return { name: ingredient.name, per, unit: ingredient.unit, nutrients: { ...NONE, ...ingredient.nutrition }, usual: per, origin: "ingredient" };
}

/** A catalog product keeps its name. A photographed table has no name, so the person types one. */
export function fromScan(scan: ScanResult): Loggable {
  if (scan.kind === "product") {
    const { product } = scan;
    return { name: product.brand ? `${product.brand} ${product.name}` : product.name, per: 100, unit: product.unit, nutrients: { ...NONE, ...product.nutrition }, usual: 100, origin: "scan" };
  }
  return { name: "", per: 100, unit: scan.unit, nutrients: scan.values, usual: 100, origin: "scan" };
}

/** The values for `amount`, to one decimal. An unknown value stays unknown. */
export function scaled(food: Loggable, amount: number): Nutrients {
  const scale = (value: number | null) => value === null ? null : Math.round((value * amount) / food.per * 10) / 10;
  return { kcal: scale(food.nutrients.kcal), protein: scale(food.nutrients.protein), carbs: scale(food.nutrients.carbs), fat: scale(food.nutrients.fat), fiber: scale(food.nutrients.fiber) };
}

/**
 * The Bodyshop change that logs `amount` of a food. `kcal` is the person's own value when the food has none; without
 * either, Bodyshop refuses the log, so no calorie value is ever made up.
 * A scan is a label value; a Kitchen recipe or ingredient is an estimate, since its values come from other labels.
 */
export function logAction(food: Loggable, input: { name: string; amount: number; meal: Meal; day: string; kcal?: number }): BodyshopAction {
  if (food.savedId) return { type: "food.log", day: input.day, items: [{ food: food.savedId, meal: input.meal, amount: input.amount, unit: food.unit }] };
  const { kcal: known, ...rest } = scaled(food, input.amount);
  const kcal = known ?? input.kcal;
  const nutrients = kcal === undefined ? rest : { ...rest, kcal };
  return {
    type: "food.log", day: input.day,
    items: [{ food: input.name.trim(), meal: input.meal, amount: input.amount, unit: food.unit, nutrients, source: food.origin === "scan" ? "Label" : "Estimated" }]
  };
}

/** The meal a log most likely belongs to at this hour. */
export function mealAt(now: Date): Meal {
  const hour = now.getHours() + now.getMinutes() / 60;
  if (hour < 4) return "Snack";
  if (hour < 10.5) return "Breakfast";
  if (hour < 15) return "Lunch";
  if (hour < 17) return "Snack";
  return hour < 21.5 ? "Dinner" : "Snack";
}

const MEAL_NAMES: Readonly<Record<KitchenMeal, Meal>> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

/** The Bodyshop meal for a planned Kitchen meal. */
export function bodyMeal(meal: KitchenMeal): Meal {
  return MEAL_NAMES[meal];
}
