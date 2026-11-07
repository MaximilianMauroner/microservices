import {
  convertNutrition, fieldNumber, ingredientGroups, isCountedUnit, UNSORTED_SECTION,
  type CatalogProduct, type Ingredient, type IngredientUnit, type KitchenSnapshot, type Nutrition,
} from "@tools-platform/service/kitchen-contract";
import type { QueuedAction } from "../../sync/model";

export const NUTRIENTS = [["kcal", "kcal"], ["protein", "g"], ["carbs", "g"], ["fat", "g"]] as const;
type NutrientFields = Record<keyof Nutrition, string>;
export type IngredientDraft = {
  name: string;
  unit: IngredientUnit;
  groups: readonly string[];
  typedGroup: string;
  notes: string;
  values: NutrientFields;
  size: string;
  uses: ReadonlyMap<string, string>;
};

export function nutritionFields(nutrition: Nutrition | undefined, language: "en" | "de"): NutrientFields {
  const field = (value: number | null | undefined) => value == null ? "" : fieldNumber(value, language);
  return { kcal: field(nutrition?.kcal), protein: field(nutrition?.protein), carbs: field(nutrition?.carbs), fat: field(nutrition?.fat) };
}

export function ingredientDraft(existing: Ingredient | undefined, name: string, language: "en" | "de"): IngredientDraft {
  return {
    name: existing?.name ?? name, unit: existing?.unit ?? "g",
    groups: existing ? ingredientGroups(existing).filter((group) => group !== UNSORTED_SECTION) : [],
    typedGroup: "", notes: existing?.notes ?? "", values: nutritionFields(existing?.nutrition, language),
    size: "", uses: new Map(),
  };
}

export function fieldValue(value: string): number | null {
  return value.trim() === "" ? null : Number(value.replace(",", "."));
}

export function withGroup(groups: readonly string[], typed: string): string[] {
  const group = typed.trim();
  return group && !groups.some((one) => one.toLowerCase() === group.toLowerCase()) ? [...groups, group] : [...groups];
}

export function conversionUnits(from: IngredientUnit, to: IngredientUnit) {
  const larger = isCountedUnit(from) ? from : to;
  return { larger, smaller: larger === to ? from : to };
}

export function oldPerNew(from: IngredientUnit, to: IngredientUnit, input: string): number | undefined {
  const size = fieldValue(input);
  if (size === null || !Number.isFinite(size) || size <= 0) return undefined;
  const factor = conversionUnits(from, to).larger === to ? size : 1 / size;
  return Number.isFinite(factor) && factor > 0 ? factor : undefined;
}

export function changeSize(draft: IngredientDraft, existing: Ingredient, size: string, language: "en" | "de"): IngredientDraft {
  const factor = oldPerNew(existing.unit, draft.unit, size);
  return {
    ...draft, size,
    values: nutritionFields(factor ? convertNutrition(existing.nutrition, existing.unit, draft.unit, factor) : existing.nutrition, language),
  };
}

type SaveAction = Extract<QueuedAction, { type: "ingredient.save" }>;
type FormIssue = "nameIngredient" | "duplicateName" | "nutritionNeeded" | "conversionNeeded" | "amountsNeeded" | "groupLimit";

export function ingredientSave(draft: IngredientDraft, existing: Ingredient | undefined, kitchen: KitchenSnapshot):
  { action: SaveAction; issue?: never } | { issue: FormIssue; action?: never } {
  const name = draft.name.trim();
  if (!name) return { issue: "nameIngredient" };
  if (kitchen.ingredients.some((one) => one.id !== existing?.id && one.name.toLowerCase() === name.toLowerCase())) return { issue: "duplicateName" };
  const nutrition = { kcal: fieldValue(draft.values.kcal), protein: fieldValue(draft.values.protein), carbs: fieldValue(draft.values.carbs), fat: fieldValue(draft.values.fat) };
  if (Object.values(nutrition).some((value) => value !== null && (!Number.isFinite(value) || value < 0 || value > 10_000))) return { issue: "nutritionNeeded" };
  const groups = withGroup(draft.groups, draft.typedGroup);
  if (groups.length > 11) return { issue: "groupLimit" };
  const factor = existing && draft.unit !== existing.unit ? oldPerNew(existing.unit, draft.unit, draft.size) : undefined;
  const referenced = existing && (existing.recipeCount > 0
    || kitchen.stock.some((item) => item.ingredientId === existing.id && item.amount > 0)
    || kitchen.plan.some((entry) => entry.custom && entry.lines.some((line) => line.ingredientId === existing.id)));
  if (existing && draft.unit !== existing.unit && (referenced || draft.size.trim()) && factor === undefined) return { issue: "conversionNeeded" };
  const addToRecipes = [...draft.uses].map(([recipeId, amount]) => ({ recipeId, amount: fieldValue(amount) ?? Number.NaN }));
  if (addToRecipes.some((use) => !Number.isFinite(use.amount) || use.amount <= 0 || use.amount > 1_000_000)) return { issue: "amountsNeeded" };
  const [section = "", ...otherGroups] = groups;
  return { action: { type: "ingredient.save", id: existing?.id, name, unit: draft.unit, section, otherGroups, notes: draft.notes, ...nutrition, oldPerNew: factor, addToRecipes } };
}

/** The draft filled in from a packaged product: its name, its unit, and its nutrition per 100 g or 100 ml. */
export function withProduct(draft: IngredientDraft, product: CatalogProduct, language: "en" | "de"): IngredientDraft {
  return { ...withUnit(draft, product.unit, language), name: product.name, size: "", values: nutritionFields(product.nutrition, language) };
}

/** The amount a quick add to a recipe starts with, so one tap is enough for the usual case. */
export const USUAL_AMOUNT: Readonly<Record<IngredientUnit, number>> = { g: 100, ml: 100, piece: 1, can: 1 };

/** The draft in another unit. A recipe amount that is still the usual amount of the old unit takes the usual amount of the new one. */
export function withUnit(draft: IngredientDraft, unit: IngredientUnit, language: "en" | "de"): IngredientDraft {
  const before = fieldNumber(USUAL_AMOUNT[draft.unit], language);
  const after = fieldNumber(USUAL_AMOUNT[unit], language);
  return { ...draft, unit, uses: new Map([...draft.uses].map(([id, amount]) => [id, amount === before ? after : amount])) };
}
