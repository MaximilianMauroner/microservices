import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
import { requireProductAccess } from "../../platform/auth/middleware.js";
import { applyKitchenAction, applyKitchenAdminAction, kitchenAction, kitchenAdminAction } from "./actions.js";
import { type Ingredient, type Kitchen, nutritionPerServing, type Recipe, today, UNSORTED_SECTION, weekStart } from "./domain.js";
import type { KitchenScope } from "./repository.js";
import { LANGUAGE_COOKIE, pickLanguage } from "./ui/language.js";

const kitchenSession = requireProductAccess("kitchen");

type Who = { principal: { role: "admin" | "member"; subject: string } };

function store() {
  const runtime = getGlobalStartContext()?.runtime;
  if (!runtime) throw new Error("Kitchen runtime is unavailable.");
  return runtime.kitchen;
}

/** `sections` holds the group of each ingredient line, for the balance stripe. */
export type RecipeSummary = Readonly<{ id: string; name: string; servings: number; minutes: number | null; kcal: number | null; protein: number | null; ingredientCount: number; sections: readonly string[] }>;

export type KitchenFrame = Readonly<{ kitchen: Kitchen; kitchens: readonly Kitchen[]; isAdmin: boolean; today: string }>;

async function frame(context: Who, kitchenId: string): Promise<{ scope: KitchenScope; frame: KitchenFrame }> {
  const kitchens = store();
  const [scope, all] = await Promise.all([kitchens.open(context.principal, kitchenId), kitchens.list(context.principal)]);
  return { scope, frame: { kitchen: scope.kitchen, kitchens: all, isAdmin: context.principal.role === "admin", today: today() } };
}

function summaries(recipes: readonly Recipe[], ingredients: readonly Ingredient[]): RecipeSummary[] {
  const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  return recipes.map((recipe) => {
    const nutrition = nutritionPerServing(recipe, byId);
    return {
      id: recipe.id, name: recipe.name, servings: recipe.servings, minutes: recipe.minutes, kcal: nutrition.kcal, protein: nutrition.protein,
      ingredientCount: recipe.lines.length, sections: recipe.lines.map((line) => byId.get(line.ingredientId)?.section ?? UNSORTED_SECTION)
    };
  });
}

const kitchenInput = (input: { kitchenId: string }) => ({ kitchenId: String(input.kitchenId) });
const weekInput = (input: { kitchenId: string; week?: string }) => ({ kitchenId: String(input.kitchenId), week: typeof input.week === "string" ? input.week : undefined });

/** The reader's language. It needs no session, because it only reads the reader's own request. */
export const getKitchenLanguage = createServerFn({ method: "GET" })
  .handler(() => pickLanguage(getCookie(LANGUAGE_COOKIE), getRequestHeader("accept-language")));

export const getKitchens = createServerFn({ method: "GET" })
  .middleware([kitchenSession])
  .handler(async ({ context }) => {
    const kitchens = await store().list(context.principal);
    const isAdmin = context.principal.role === "admin";
    return { kitchens, isAdmin, people: isAdmin ? await store().admin(context.principal).people() : [] };
  });

/** The kitchen switcher and tabs that stay on screen across the pages of one kitchen. */
export const getKitchenFrame = createServerFn({ method: "GET" })
  .middleware([kitchenSession])
  .validator(kitchenInput)
  .handler(async ({ data, context }) => (await frame(context, data.kitchenId)).frame);

export const getKitchenWeek = createServerFn({ method: "GET" })
  .middleware([kitchenSession])
  .validator(weekInput)
  .handler(async ({ data, context }) => {
    const { scope, frame: base } = await frame(context, data.kitchenId);
    const start = weekStart(data.week ?? base.today);
    const [week, recipes, ingredients, leftovers, shopping] = await Promise.all([scope.week(start), scope.recipes(), scope.ingredients(), scope.leftovers(), scope.shopping(start)]);
    return {
      ...base,
      week,
      recipes: summaries(recipes, ingredients),
      leftovers,
      toBuy: shopping.lines.filter((line) => line.toBuy > 0).length + shopping.extras.filter((extra) => !extra.bought).length,
      buySections: shopping.lines.filter((line) => line.toBuy > 0).map((line) => line.section)
    };
  });

export const getKitchenShopping = createServerFn({ method: "GET" })
  .middleware([kitchenSession])
  .validator(weekInput)
  .handler(async ({ data, context }) => {
    const { scope, frame: base } = await frame(context, data.kitchenId);
    const start = weekStart(data.week ?? base.today);
    const [shopping, week, ingredients] = await Promise.all([scope.shopping(start), scope.week(start), scope.ingredients()]);
    return { ...base, shopping, ingredients, plannedMeals: week.entries.filter((entry) => !entry.cooked).length };
  });

export const getKitchenRecipes = createServerFn({ method: "GET" })
  .middleware([kitchenSession])
  .validator(kitchenInput)
  .handler(async ({ data, context }) => {
    const { scope, frame: base } = await frame(context, data.kitchenId);
    const [recipes, ingredients] = await Promise.all([scope.recipes(), scope.ingredients()]);
    return { ...base, recipes: summaries(recipes, ingredients) };
  });

export const getKitchenRecipe = createServerFn({ method: "GET" })
  .middleware([kitchenSession])
  .validator((input: { kitchenId: string; recipeId: string }) => ({ kitchenId: String(input.kitchenId), recipeId: String(input.recipeId) }))
  .handler(async ({ data, context }) => {
    const { scope, frame: base } = await frame(context, data.kitchenId);
    const [recipe, ingredients] = await Promise.all([data.recipeId === "new" ? Promise.resolve(undefined) : scope.recipe(data.recipeId), scope.ingredients()]);
    return { ...base, recipe, ingredients, nutrition: recipe ? nutritionPerServing(recipe, new Map(ingredients.map((one) => [one.id, one]))) : undefined };
  });

export const getKitchenPantry = createServerFn({ method: "GET" })
  .middleware([kitchenSession])
  .validator(kitchenInput)
  .handler(async ({ data, context }) => {
    const { scope, frame: base } = await frame(context, data.kitchenId);
    const [stock, leftovers, ingredients] = await Promise.all([scope.stock(), scope.leftovers(), scope.ingredients()]);
    return { ...base, stock, leftovers, ingredients };
  });

export const getKitchenIngredients = createServerFn({ method: "GET" })
  .middleware([kitchenSession])
  .validator(kitchenInput)
  .handler(async ({ data, context }) => {
    const { scope, frame: base } = await frame(context, data.kitchenId);
    return { ...base, ingredients: await scope.ingredients() };
  });

export const runKitchenAction = createServerFn({ method: "POST" })
  .middleware([kitchenSession])
  .validator((input: { kitchenId: string; action: unknown }) => ({ kitchenId: String(input.kitchenId), action: kitchenAction.parse(input.action) }))
  .handler(async ({ data, context }) => {
    const result = await applyKitchenAction(store(), context.principal, data.kitchenId, data.action);
    return result && typeof result === "object" && "id" in result ? { id: String(result.id) } : {};
  });

export const runKitchenAdminAction = createServerFn({ method: "POST" })
  .middleware([kitchenSession])
  .validator((input: unknown) => kitchenAdminAction.parse(input))
  .handler(async ({ data, context }) => {
    const result = await applyKitchenAdminAction(store(), context.principal, data);
    return result && typeof result === "object" && "id" in result ? { id: String(result.id) } : {};
  });
