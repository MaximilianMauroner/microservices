import { z } from "zod";
import { INGREDIENT_UNITS, MEALS, weekStart } from "./domain.js";
import type { KitchenScope, KitchenStore } from "./repository.js";
import type { PlatformPrincipal } from "#security";

const id = z.string().max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const amount = z.number().finite();
const nutrient = z.number().finite().nullable();
const lines = z.array(z.object({ ingredientId: id, amount, note: z.string().max(400) })).max(200);

export const ingredientFields = {
  name: z.string().max(200),
  unit: z.enum(INGREDIENT_UNITS),
  section: z.string().max(100),
  otherGroups: z.array(z.string().max(100)).max(20).optional(),
  kcal: nutrient,
  protein: nutrient,
  carbs: nutrient,
  fat: nutrient,
  notes: z.string().max(4_000)
};

export const recipeFields = {
  name: z.string().max(200),
  servings: z.number().int(),
  minutes: z.number().int().nullable(),
  instructions: z.string().max(40_000)
};

/** Every change a person can make inside one kitchen, from the web app or from MCP. */
export const kitchenAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ingredient.save"),
    id: id.optional(),
    ...ingredientFields,
    oldPerNew: z.number().finite().positive().optional(),
    addToRecipes: z.array(z.object({ recipeId: id, amount })).max(200).optional()
  }),
  z.object({ type: z.literal("ingredient.delete"), id }),
  z.object({
    type: z.literal("recipe.save"),
    id: id.optional(),
    ...recipeFields,
    lines
  }),
  z.object({ type: z.literal("recipe.delete"), id }),
  z.object({ type: z.literal("recipe.copy"), id, toKitchenId: id }),
  z.object({ type: z.literal("plan.add"), day, meal: z.enum(MEALS), recipeId: id, servings: z.number().int() }),
  z.object({ type: z.literal("plan.update"), id, day, meal: z.enum(MEALS), servings: z.number().int() }),
  z.object({ type: z.literal("plan.remove"), id }),
  z.object({ type: z.literal("plan.customize"), id, lines }),
  z.object({ type: z.literal("plan.reset"), id }),
  z.object({ type: z.literal("plan.cook"), id, leftover: z.object({ servings: amount, useBy: day }).optional() }),
  z.object({ type: z.literal("stock.set"), ingredientId: id, amount }),
  z.object({ type: z.literal("stock.add"), ingredientId: id, amount }),
  z.object({ type: z.literal("leftover.add"), name: z.string().max(200), servings: amount, useBy: day }),
  z.object({ type: z.literal("leftover.eat"), id, servings: amount }),
  z.object({ type: z.literal("leftover.remove"), id }),
  z.object({ type: z.literal("extra.add"), name: z.string().max(200), everyWeek: z.boolean().optional() }),
  z.object({ type: z.literal("extra.mark"), id, week: day, bought: z.boolean() }),
  z.object({ type: z.literal("extra.remove"), id }),
  z.object({ type: z.literal("groups.set"), groups: z.array(z.string().max(100)).max(100) })
]);

export type KitchenAction = z.infer<typeof kitchenAction>;

export const kitchenAdminAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("kitchen.create"), name: z.string().max(200) }),
  z.object({ type: z.literal("kitchen.rename"), kitchenId: id, name: z.string().max(200) }),
  z.object({ type: z.literal("kitchen.remove"), kitchenId: id }),
  z.object({ type: z.literal("kitchen.move"), kitchenId: id, personId: id, leave: z.boolean() }),
  z.object({ type: z.literal("kitchen.restore"), kitchenId: id }),
  z.object({ type: z.literal("member.add"), kitchenId: id, personId: id }),
  z.object({ type: z.literal("member.remove"), kitchenId: id, personId: id })
]);

export type KitchenAdminAction = z.infer<typeof kitchenAdminAction>;

export const kitchenPersonalAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("kitchen.mcp"), kitchenId: id, enabled: z.boolean() }),
  z.object({ type: z.literal("kitchen.leave"), kitchenId: id }),
]);
export type KitchenPersonalAction = z.infer<typeof kitchenPersonalAction>;

export function applyKitchenPersonalAction(store: KitchenStore, who: Who, action: KitchenPersonalAction): Promise<void> {
  return action.type === "kitchen.mcp"
    ? store.setMcpEnabled(who, action.kitchenId, action.enabled)
    : store.leave(who, action.kitchenId);
}

type Who = Pick<PlatformPrincipal, "role" | "subject">;

export async function applyKitchenAction(store: KitchenStore, who: Who, kitchenId: string, action: KitchenAction): Promise<unknown> {
  if (action.type === "recipe.copy") return store.copyRecipe(who, kitchenId, action.id, action.toKitchenId);
  return apply(await store.open(who, kitchenId), action);
}

function apply(kitchen: KitchenScope, action: Exclude<KitchenAction, { type: "recipe.copy" }>): Promise<unknown> {
  switch (action.type) {
    case "ingredient.save": {
      const { id: ingredientId, kcal, protein, carbs, fat, oldPerNew, addToRecipes, ...rest } = action;
      return kitchen.saveIngredient(ingredientId, { ...rest, nutrition: { kcal, protein, carbs, fat } }, { oldPerNew, addToRecipes });
    }
    case "ingredient.delete": return kitchen.deleteIngredient(action.id);
    case "recipe.save": return kitchen.saveRecipe(action.id, action);
    case "recipe.delete": return kitchen.deleteRecipe(action.id);
    case "plan.add": return kitchen.plan(action);
    case "plan.update": return kitchen.updatePlan(action.id, action);
    case "plan.remove": return kitchen.removePlan(action.id);
    case "plan.customize": return kitchen.customizePlan(action.id, action.lines);
    case "plan.reset": return kitchen.resetPlan(action.id);
    case "plan.cook": return kitchen.cook(action.id, action.leftover);
    case "stock.set": return kitchen.setStock(action.ingredientId, action.amount);
    case "stock.add": return kitchen.addStock(action.ingredientId, action.amount);
    case "leftover.add": return kitchen.addLeftover(action);
    case "leftover.eat": return kitchen.eatLeftover(action.id, action.servings);
    case "leftover.remove": return kitchen.removeLeftover(action.id);
    case "extra.add": return kitchen.addExtra(action.name, action.everyWeek);
    case "extra.mark": return kitchen.markExtra(action.id, weekStart(action.week), action.bought);
    case "extra.remove": return kitchen.removeExtra(action.id);
    case "groups.set": return kitchen.setGroups(action.groups);
  }
}

export async function applyKitchenAdminAction(store: KitchenStore, who: Who, action: KitchenAdminAction): Promise<unknown> {
  const admin = store.admin(who);
  switch (action.type) {
    case "kitchen.create": return admin.create(action.name);
    case "kitchen.rename": return admin.rename(action.kitchenId, action.name);
    case "kitchen.remove": return admin.remove(action.kitchenId);
    case "kitchen.move": return admin.move(action.kitchenId, action.personId, action.leave);
    case "kitchen.restore": return admin.restore(action.kitchenId);
    case "member.add": return admin.addMember(action.kitchenId, action.personId);
    case "member.remove": return admin.removeMember(action.kitchenId, action.personId);
  }
}
