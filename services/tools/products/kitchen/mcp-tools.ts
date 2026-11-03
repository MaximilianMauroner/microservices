import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlatformPrincipal } from "#security";
import { applyKitchenAction, applyKitchenAdminAction } from "./actions.js";
import { convertNutrition, INGREDIENT_UNITS, type Ingredient, KitchenError, MEALS, nutritionPerServing, today, weekStart } from "./domain.js";
import type { KitchenScope, KitchenStore } from "./repository.js";

const kitchenRef = z.string().optional().describe("Kitchen name or id. Leave out when you belong to one kitchen only.");
const nutrient = (what: string) => z.number().min(0).nullable().optional().describe(`${what} per 100 g or 100 ml, or per item for the piece and can units`);

/** Kitchen tools act as the signed-in person and open only the kitchens that person can open. */
export function registerKitchenTools(server: McpServer, store: KitchenStore, principal: PlatformPrincipal) {
  const who = principal;

  async function kitchen(ref: string | undefined): Promise<KitchenScope> {
    const kitchens = await store.list(who);
    const match = ref === undefined
      ? (kitchens.length === 1 ? kitchens[0] : undefined)
      : kitchens.find((one) => one.id === ref || one.name.toLowerCase() === ref.trim().toLowerCase());
    if (!match) {
      throw new KitchenError(ref === undefined
        ? `Name the kitchen. You can open: ${kitchens.map((one) => one.name).join(", ") || "none"}.`
        : `No kitchen named ${ref}. You can open: ${kitchens.map((one) => one.name).join(", ") || "none"}.`, "not_found");
    }
    return store.open(who, match.id);
  }

  async function ingredientByRef(scope: KitchenScope, ref: string): Promise<Ingredient> {
    const found = (await scope.ingredients()).find((one) => one.id === ref || one.name.toLowerCase() === ref.trim().toLowerCase());
    if (!found) throw new KitchenError(`No ingredient named ${ref} in ${scope.kitchen.name}.`, "not_found");
    return found;
  }

  async function recipeByRef(scope: KitchenScope, ref: string) {
    const found = (await scope.recipes()).find((one) => one.id === ref || one.name.toLowerCase() === ref.trim().toLowerCase());
    if (!found) throw new KitchenError(`No recipe named ${ref} in ${scope.kitchen.name}.`, "not_found");
    return found;
  }

  // The SDK infers callback types per call. One loose signature keeps each tool's own zod type below.
  const register = server.registerTool.bind(server) as unknown as (name: string, config: object, callback: (input: never) => Promise<object>) => void;
  const tool = <Shape extends z.ZodRawShape>(name: string, description: string, shape: Shape, run: (input: z.infer<z.ZodObject<Shape>>) => Promise<unknown>, readOnly = false) => {
    register(name, { description, inputSchema: shape, annotations: { readOnlyHint: readOnly } }, async (input: z.infer<z.ZodObject<Shape>>) => {
      try {
        const result = await run(input);
        return { content: [{ type: "text" as const, text: JSON.stringify(result ?? { ok: true }) }] };
      } catch (error) {
        if (error instanceof KitchenError) return { isError: true, content: [{ type: "text" as const, text: error.message }] };
        throw error;
      }
    });
  };

  tool("kitchen_list", "Lists the kitchens you can open, with their members.", {}, () => store.list(who), true);

  if (principal.role === "admin") {
    tool("kitchen_create", "Creates a kitchen. Admin only.", { name: z.string() }, ({ name }) => applyKitchenAdminAction(store, who, { type: "kitchen.create", name }));
  }

  tool("kitchen_week", "Shows the week plan, leftovers to use first, and what to buy for one week.", {
    kitchen: kitchenRef,
    week: z.string().optional().describe("Any date in the week, as YYYY-MM-DD. Default: this week.")
  }, async ({ kitchen: ref, week }) => {
    const scope = await kitchen(ref);
    const start = weekStart(week ?? today());
    const [plan, leftovers, shopping] = await Promise.all([scope.week(start), scope.leftovers(), scope.shopping(start)]);
    return { kitchen: scope.kitchen.name, week: start, meals: plan.entries, leftovers, toBuy: shopping.lines.filter((line) => line.toBuy > 0), extras: shopping.extras };
  }, true);

  tool("group_order_set", "Sets the order of the ingredient groups. The shopping list follows this order.", {
    kitchen: kitchenRef,
    groups: z.array(z.string()).describe("Group names, first to last.")
  }, async ({ kitchen: ref, groups }) => (await kitchen(ref)).setGroups(groups));

  tool("ingredient_list", "Lists the ingredients of a kitchen with unit, group, and nutrition.", { kitchen: kitchenRef }, async ({ kitchen: ref }) => (await kitchen(ref)).ingredients(), true);

  tool("ingredient_save", "Creates an ingredient, or changes the ingredient with the same name or id. Fields you leave out keep their value.", {
    kitchen: kitchenRef,
    id: z.string().optional().describe("Ingredient id, to rename an ingredient."),
    name: z.string(),
    unit: z.enum(INGREDIENT_UNITS).optional().describe("Unit for amounts. Default for a new ingredient: g."),
    oldPerNew: z.number().positive().optional()
      .describe("Needed to change the unit of an ingredient that recipes or stock use: how much of the old unit one new unit holds, such as 250 when one zucchini weighs 250 g. Recipe and stock amounts change with the unit, and nutrition you leave out is converted."),
    section: z.string().optional().describe("Main group, such as Proteine or Gemüse. The shopping list groups items by it."),
    otherGroups: z.array(z.string()).optional().describe("More groups the ingredient also belongs to, such as Kohlenhydrate for chickpeas. They count in the meal balance."),
    kcal: nutrient("Calories"),
    protein: nutrient("Protein in g"),
    carbs: nutrient("Carbohydrates in g"),
    fat: nutrient("Fat in g"),
    notes: z.string().optional()
  }, async ({ kitchen: ref, id, name, ...fields }) => {
    const scope = await kitchen(ref);
    const existing = (await scope.ingredients()).find((one) => id ? one.id === id : one.name.toLowerCase() === name.trim().toLowerCase());
    if (id && !existing) throw new KitchenError("This ingredient does not exist.", "not_found");
    const keep = <T>(value: T | undefined, current: T) => value === undefined ? current : value;
    const unit = fields.unit ?? existing?.unit ?? "g";
    const nutrition = existing && fields.oldPerNew && unit !== existing.unit
      ? convertNutrition(existing.nutrition, existing.unit, unit, fields.oldPerNew)
      : existing?.nutrition;
    return applyKitchenAction(store, who, scope.kitchen.id, {
      type: "ingredient.save",
      id: existing?.id,
      name,
      unit,
      section: fields.section ?? existing?.section ?? "",
      otherGroups: [...(fields.otherGroups ?? existing?.otherGroups ?? [])],
      kcal: keep(fields.kcal, nutrition?.kcal ?? null),
      protein: keep(fields.protein, nutrition?.protein ?? null),
      carbs: keep(fields.carbs, nutrition?.carbs ?? null),
      fat: keep(fields.fat, nutrition?.fat ?? null),
      notes: fields.notes ?? existing?.notes ?? "",
      oldPerNew: fields.oldPerNew
    });
  });

  tool("ingredient_delete", "Deletes an ingredient that no recipe uses.", { kitchen: kitchenRef, ingredient: z.string().describe("Name or id.") }, async ({ kitchen: ref, ingredient }) => {
    const scope = await kitchen(ref);
    return scope.deleteIngredient((await ingredientByRef(scope, ingredient)).id);
  });

  tool("recipe_list", "Lists the recipes of a kitchen with calories and protein per serving.", { kitchen: kitchenRef }, async ({ kitchen: ref }) => {
    const scope = await kitchen(ref);
    const [recipes, ingredients] = await Promise.all([scope.recipes(), scope.ingredients()]);
    const byId = new Map(ingredients.map((one) => [one.id, one]));
    return recipes.map((recipe) => ({ id: recipe.id, name: recipe.name, servings: recipe.servings, minutes: recipe.minutes, perServing: nutritionPerServing(recipe, byId) }));
  }, true);

  tool("recipe_get", "Shows one recipe with its ingredients, steps, and nutrition per serving.", { kitchen: kitchenRef, recipe: z.string().describe("Name or id.") }, async ({ kitchen: ref, recipe }) => {
    const scope = await kitchen(ref);
    const found = await recipeByRef(scope, recipe);
    return { ...found, perServing: nutritionPerServing(found, new Map((await scope.ingredients()).map((one) => [one.id, one]))) };
  }, true);

  tool("recipe_save", "Creates a recipe, or replaces the recipe with the same name or id. Ingredients that do not exist yet are created.", {
    kitchen: kitchenRef,
    id: z.string().optional().describe("Recipe id, to rename a recipe."),
    name: z.string(),
    servings: z.number().int().min(1),
    minutes: z.number().int().min(1).nullable().optional(),
    instructions: z.string().optional().describe("Steps, one per line."),
    ingredients: z.array(z.object({
      name: z.string(),
      amount: z.number().positive(),
      unit: z.enum(INGREDIENT_UNITS).optional().describe("Used only when the ingredient is new. Default: g."),
      note: z.string().optional()
    }))
  }, async ({ kitchen: ref, id, name, servings, minutes, instructions, ingredients }) => {
    const scope = await kitchen(ref);
    const existing = (await scope.recipes()).find((one) => id ? one.id === id : one.name.toLowerCase() === name.trim().toLowerCase());
    if (id && !existing) throw new KitchenError("This recipe does not exist.", "not_found");
    const lines = [];
    for (const line of ingredients) {
      const ingredient = await scope.ingredientNamed(line.name, line.unit ?? "g");
      lines.push({ ingredientId: ingredient.id, amount: line.amount, note: line.note ?? "" });
    }
    return scope.saveRecipe(existing?.id, { name, servings, minutes: minutes ?? existing?.minutes ?? null, instructions: instructions ?? existing?.instructions ?? "", lines });
  });

  tool("recipe_delete", "Deletes a recipe and removes it from the week plan.", { kitchen: kitchenRef, recipe: z.string().describe("Name or id.") }, async ({ kitchen: ref, recipe }) => {
    const scope = await kitchen(ref);
    return scope.deleteRecipe((await recipeByRef(scope, recipe)).id);
  });

  tool("recipe_copy", "Copies a recipe, with only the ingredients it uses, into another kitchen you can open.", {
    kitchen: kitchenRef,
    recipe: z.string().describe("Name or id."),
    toKitchen: z.string().describe("Name or id of the kitchen that gets the copy.")
  }, async ({ kitchen: ref, recipe, toKitchen }) => {
    const [from, to] = await Promise.all([kitchen(ref), kitchen(toKitchen)]);
    return store.copyRecipe(who, from.kitchen.id, (await recipeByRef(from, recipe)).id, to.kitchen.id);
  });

  tool("plan_add", "Plans a recipe for a meal on a day.", {
    kitchen: kitchenRef,
    day: z.string().describe("YYYY-MM-DD"),
    meal: z.enum(MEALS),
    recipe: z.string().describe("Name or id."),
    servings: z.number().int().min(1).optional().describe("Default: the recipe's servings.")
  }, async ({ kitchen: ref, day, meal, recipe, servings }) => {
    const scope = await kitchen(ref);
    const found = await recipeByRef(scope, recipe);
    return scope.plan({ day, meal, recipeId: found.id, servings: servings ?? found.servings });
  });

  tool("plan_remove", "Removes a meal from the week plan.", { kitchen: kitchenRef, entryId: z.string() }, async ({ kitchen: ref, entryId }) => (await kitchen(ref)).removePlan(entryId));

  tool("plan_cook", "Marks a planned meal as cooked. Its ingredients come out of stock, and leftover servings are kept.", {
    kitchen: kitchenRef,
    entryId: z.string(),
    leftoverServings: z.number().positive().optional(),
    leftoverUseBy: z.string().optional().describe("YYYY-MM-DD. Default: in 3 days.")
  }, async ({ kitchen: ref, entryId, leftoverServings, leftoverUseBy }) => {
    const scope = await kitchen(ref);
    const useBy = leftoverUseBy ?? new Date(Date.parse(`${today()}T00:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
    return scope.cook(entryId, leftoverServings ? { servings: leftoverServings, useBy } : undefined);
  });

  tool("shopping_list", "Shows what to buy for the planned meals of a week, minus what is at home, plus extra items.", {
    kitchen: kitchenRef,
    week: z.string().optional().describe("Any date in the week, as YYYY-MM-DD. Default: this week.")
  }, async ({ kitchen: ref, week }) => (await kitchen(ref)).shopping(weekStart(week ?? today())), true);

  tool("shopping_add", "Adds an extra item to the shopping list, such as soap.", {
    kitchen: kitchenRef,
    item: z.string(),
    everyWeek: z.boolean().optional().describe("Put the item on every week's list, such as snacks or coffee. Default: once.")
  }, async ({ kitchen: ref, item, everyWeek }) => (await kitchen(ref)).addExtra(item, everyWeek));

  tool("stock_list", "Shows the food at home.", { kitchen: kitchenRef }, async ({ kitchen: ref }) => (await kitchen(ref)).stock(), true);

  tool("stock_set", "Sets how much of an ingredient is at home. Use 0 when it is gone.", {
    kitchen: kitchenRef,
    ingredient: z.string().describe("Name or id."),
    amount: z.number().min(0).describe("In the ingredient's unit.")
  }, async ({ kitchen: ref, ingredient, amount }) => {
    const scope = await kitchen(ref);
    return scope.setStock((await ingredientByRef(scope, ingredient)).id, amount);
  });

  tool("leftover_add", "Keeps a leftover to use first.", {
    kitchen: kitchenRef,
    name: z.string(),
    servings: z.number().positive(),
    useBy: z.string().describe("YYYY-MM-DD")
  }, async ({ kitchen: ref, ...leftover }) => (await kitchen(ref)).addLeftover(leftover));

  tool("leftover_eat", "Eats servings of a leftover. It goes away when none remain.", {
    kitchen: kitchenRef,
    leftoverId: z.string(),
    servings: z.number().positive()
  }, async ({ kitchen: ref, leftoverId, servings }) => (await kitchen(ref)).eatLeftover(leftoverId, servings));
}
