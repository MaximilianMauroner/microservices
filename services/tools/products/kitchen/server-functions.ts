import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
import { requireProductAccess } from "../../platform/auth/middleware.js";
import { applyKitchenAction, applyKitchenAdminAction, applyKitchenPersonalAction, kitchenAction, kitchenAdminAction, kitchenPersonalAction } from "./actions.js";
import { type Ingredient, ingredientGroups, type Kitchen, missingAtHome, nutritionPerServing, type Recipe, today, UNSORTED_SECTION, weekStart } from "./domain.js";
import type { KitchenScope } from "./repository.js";
import { LANGUAGE_COOKIE, pickLanguage } from "./ui/language.js";

const kitchenSession = requireProductAccess("kitchen");

type Who = { principal: { role: "admin" | "member"; subject: string } };

function store() {
  const runtime = getGlobalStartContext()?.runtime;
  if (!runtime) throw new Error("Kitchen runtime is unavailable.");
  return runtime.kitchen;
}

/** `sections` holds the groups of each ingredient line, for the food-group ring. */
export type RecipeSummary = Readonly<{ id: string; name: string; servings: number; minutes: number | null; kcal: number | null; protein: number | null; ingredientCount: number; ingredientIds: readonly string[]; sections: readonly string[] }>;

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
      ingredientCount: recipe.lines.length, ingredientIds: recipe.lines.map((line) => line.ingredientId), sections: recipe.lines.flatMap((line) => { const one = byId.get(line.ingredientId); return one ? ingredientGroups(one) : [UNSORTED_SECTION]; })
    };
  });
}

/** What an ingredient sheet needs to know about each recipe: which ingredients it has, and for how many servings. */
export type RecipeChoice = Readonly<{ id: string; name: string; servings: number; ingredientIds: readonly string[] }>;

function recipeChoices(recipes: readonly Recipe[]): RecipeChoice[] {
  return recipes.map((recipe) => ({ id: recipe.id, name: recipe.name, servings: recipe.servings, ingredientIds: recipe.lines.map((line) => line.ingredientId) }));
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
    return { kitchens, isAdmin, people: isAdmin ? await store().admin(context.principal).people() : [],
      hiddenKitchens: isAdmin ? (await store().list(context.principal, { includeHidden: true })).filter((one) => one.hidden) : [] };
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
      ingredients,
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
    const [recipes, ingredients, stock] = await Promise.all([scope.recipes(), scope.ingredients(), scope.stock()]);
    const home = new Map(stock.map((item) => [item.ingredientId, item.amount]));
    /** For each recipe, the ingredients that are not fully at home. */
    const missing = Object.fromEntries(recipes.map((recipe) => [recipe.id, missingAtHome(recipe, home)]));
    return { ...base, recipes: summaries(recipes, ingredients), ingredients, missing };
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
    const [stock, leftovers, ingredients, recipes] = await Promise.all([scope.stock(), scope.leftovers(), scope.ingredients(), scope.recipes()]);
    return { ...base, stock, leftovers, ingredients, recipes: recipeChoices(recipes) };
  });

export const getKitchenIngredients = createServerFn({ method: "GET" })
  .middleware([kitchenSession])
  .validator(kitchenInput)
  .handler(async ({ data, context }) => {
    const { scope, frame: base } = await frame(context, data.kitchenId);
    const [ingredients, recipes] = await Promise.all([scope.ingredients(), scope.recipes()]);
    return { ...base, ingredients, recipes: recipeChoices(recipes) };
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

export const runKitchenPersonalAction = createServerFn({ method: "POST" })
  .middleware([kitchenSession])
  .validator((input: unknown) => kitchenPersonalAction.parse(input))
  .handler(async ({ data, context }) => {
    await applyKitchenPersonalAction(store(), context.principal, data);
    return {};
  });

/** Packaged foods from Open Food Facts that match what the person types as a new ingredient's name. */
export const searchKitchenCatalog = createServerFn({ method: "GET" })
  .middleware([kitchenSession])
  .validator((input: { query: string }) => ({ query: String(input.query).slice(0, 100) }))
  .handler(async ({ data }) => {
    const catalog = getGlobalStartContext()?.runtime?.kitchenCatalog;
    if (!catalog) throw new Error("Kitchen runtime is unavailable.");
    return catalog.search(data.query);
  });
