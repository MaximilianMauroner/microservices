export const INGREDIENT_UNITS = ["g", "ml", "piece"] as const;
export type IngredientUnit = (typeof INGREDIENT_UNITS)[number];

/** The amount that nutrition values refer to: 100 g, 100 ml, or 1 piece. */
const NUTRITION_BASIS: Record<IngredientUnit, number> = { g: 100, ml: 100, piece: 1 };

export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Meal = (typeof MEALS)[number];

export const MEAL_LABELS: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

/** Nutrition per 100 g or 100 ml, or per piece. A missing value is unknown, not zero. */
export type Nutrition = Readonly<{ kcal: number | null; protein: number | null; carbs: number | null; fat: number | null }>;

export type KitchenMember = Readonly<{ personId: string; email: string }>;
/** `groups` is the kitchen's order of ingredient groups, such as the order of a shop or of a food list. */
export type Kitchen = Readonly<{ id: string; name: string; members: readonly KitchenMember[]; groups: readonly string[] }>;

export type Ingredient = Readonly<{
  id: string;
  name: string;
  unit: IngredientUnit;
  section: string;
  nutrition: Nutrition;
  notes: string;
  recipeCount: number;
}>;

export type RecipeLine = Readonly<{ ingredientId: string; ingredient: string; unit: IngredientUnit; amount: number; note: string }>;

export type Recipe = Readonly<{
  id: string;
  name: string;
  servings: number;
  minutes: number | null;
  instructions: string;
  lines: readonly RecipeLine[];
  updatedAt: string;
}>;

export type PlanEntry = Readonly<{
  id: string;
  day: string;
  meal: Meal;
  recipeId: string;
  recipe: string;
  servings: number;
  cooked: boolean;
}>;

export type StockItem = Readonly<{ ingredientId: string; ingredient: string; unit: IngredientUnit; section: string; amount: number }>;
export type Leftover = Readonly<{ id: string; name: string; servings: number; useBy: string }>;
export type ExtraItem = Readonly<{ id: string; name: string }>;

export type ShoppingLine = Readonly<{
  ingredientId: string;
  ingredient: string;
  unit: IngredientUnit;
  section: string;
  needed: number;
  inStock: number;
  toBuy: number;
  recipes: readonly string[];
}>;

export type IngredientInput = Readonly<{ name: string; unit: IngredientUnit; section: string; nutrition: Nutrition; notes: string }>;
export type RecipeLineInput = Readonly<{ ingredientId: string; amount: number; note: string }>;
export type RecipeInput = Readonly<{ name: string; servings: number; minutes: number | null; instructions: string; lines: readonly RecipeLineInput[] }>;

export class KitchenError extends Error {
  constructor(message: string, readonly code: "not_found" | "forbidden" | "invalid" | "conflict" = "invalid") {
    super(message);
    this.name = "KitchenError";
  }
}

export const UNSORTED_SECTION = "Other";

/** Sorts groups in the kitchen's order. Groups outside that order follow alphabetically, and Other comes last. */
export function byGroupOrder(groups: readonly string[]): (a: string, b: string) => number {
  const rank = (group: string) => {
    if (group === UNSORTED_SECTION) return Number.MAX_SAFE_INTEGER;
    const index = groups.indexOf(group);
    return index === -1 ? groups.length : index;
  };
  return (a, b) => rank(a) - rank(b) || a.localeCompare(b);
}

export function parseGroups(groups: readonly string[]): readonly string[] {
  const clean = [...new Set(groups.map((group) => group.trim().slice(0, 60)).filter((group) => group && group !== UNSORTED_SECTION))];
  if (clean.length > 50) throw new KitchenError("A kitchen can have up to 50 groups.");
  return clean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDay(value: string): string {
  if (!DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || toDay(new Date(`${value}T00:00:00Z`)) !== value) {
    throw new KitchenError("Enter a date as YYYY-MM-DD.");
  }
  return value;
}

export function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDay(date);
}

/** The Monday of the ISO week that holds the day. */
export function weekStart(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export function weekDays(start: string): readonly string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function parseIngredientInput(input: IngredientInput): IngredientInput {
  return {
    name: requiredName(input.name, "ingredient"),
    unit: parseUnit(input.unit),
    section: input.section.trim().slice(0, 60) || UNSORTED_SECTION,
    nutrition: {
      kcal: nutritionValue(input.nutrition.kcal, "Calories"),
      protein: nutritionValue(input.nutrition.protein, "Protein"),
      carbs: nutritionValue(input.nutrition.carbs, "Carbohydrates"),
      fat: nutritionValue(input.nutrition.fat, "Fat")
    },
    notes: input.notes.trim().slice(0, 2_000)
  };
}

export function parseRecipeInput(input: RecipeInput): RecipeInput {
  const servings = positiveInteger(input.servings, "Servings", 100);
  const minutes = input.minutes === null ? null : positiveInteger(input.minutes, "Minutes", 10_000);
  const seen = new Set<string>();
  const lines = input.lines.map((line) => {
    if (seen.has(line.ingredientId)) throw new KitchenError("Each ingredient can appear once in a recipe. Combine the amounts.");
    seen.add(line.ingredientId);
    return { ingredientId: line.ingredientId, amount: positiveAmount(line.amount), note: line.note.trim().slice(0, 200) };
  });
  return { name: requiredName(input.name, "recipe"), servings, minutes, instructions: input.instructions.trim().slice(0, 20_000), lines };
}

export function parseUnit(unit: string): IngredientUnit {
  if ((INGREDIENT_UNITS as readonly string[]).includes(unit)) return unit as IngredientUnit;
  throw new KitchenError("Use g, ml, or piece as the unit.");
}

export function parseMeal(meal: string): Meal {
  if ((MEALS as readonly string[]).includes(meal)) return meal as Meal;
  throw new KitchenError("Use breakfast, lunch, dinner, or snack as the meal.");
}

export function parseServings(value: number): number {
  return positiveInteger(value, "Servings", 100);
}

export function parseStockAmount(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) throw new KitchenError("Enter an amount of 0 or more.");
  return round(value);
}

export function parseLeftoverServings(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 100) throw new KitchenError("Enter more than 0 servings.");
  return round(value);
}

export function requiredName(value: string, what: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new KitchenError(`Enter a name for the ${what}.`);
  if (name.length > 120) throw new KitchenError(`Use 120 characters or fewer for the ${what} name.`);
  return name;
}

/** Scales a recipe's lines from its own servings to the planned servings. */
export function scaledLines(recipe: Pick<Recipe, "servings" | "lines">, servings: number): readonly RecipeLine[] {
  const factor = servings / recipe.servings;
  return recipe.lines.map((line) => ({ ...line, amount: round(line.amount * factor) }));
}

/**
 * What to buy for the meals that are not cooked yet: the sum of their scaled
 * lines, minus what is at home. Cooking removes amounts from stock, so cooked
 * meals no longer count.
 */
export function shoppingList(
  entries: readonly PlanEntry[],
  recipes: ReadonlyMap<string, Recipe>,
  stock: readonly StockItem[],
  sections: ReadonlyMap<string, string>,
  groups: readonly string[]
): readonly ShoppingLine[] {
  const order = byGroupOrder(groups);
  const needed = new Map<string, { line: RecipeLine; amount: number; recipes: Set<string> }>();
  for (const entry of entries) {
    const recipe = recipes.get(entry.recipeId);
    if (entry.cooked || !recipe) continue;
    for (const line of scaledLines(recipe, entry.servings)) {
      const current = needed.get(line.ingredientId) ?? { line, amount: 0, recipes: new Set<string>() };
      current.amount += line.amount;
      current.recipes.add(recipe.name);
      needed.set(line.ingredientId, current);
    }
  }
  const inStock = new Map(stock.map((item) => [item.ingredientId, item.amount]));
  return [...needed.values()]
    .map(({ line, amount, recipes: names }) => {
      const have = inStock.get(line.ingredientId) ?? 0;
      return {
        ingredientId: line.ingredientId,
        ingredient: line.ingredient,
        unit: line.unit,
        section: sections.get(line.ingredientId) ?? UNSORTED_SECTION,
        needed: round(amount),
        inStock: round(have),
        toBuy: round(Math.max(0, amount - have)),
        recipes: [...names].sort((a, b) => a.localeCompare(b))
      };
    })
    .sort((a, b) => order(a.section, b.section) || a.ingredient.localeCompare(b.ingredient));
}

/** Nutrition of one serving. A value is null when any ingredient lacks it. */
export function nutritionPerServing(recipe: Pick<Recipe, "servings" | "lines">, ingredients: ReadonlyMap<string, Pick<Ingredient, "unit" | "nutrition">>): Nutrition {
  const total = (key: keyof Nutrition) => {
    let sum = 0;
    for (const line of recipe.lines) {
      const ingredient = ingredients.get(line.ingredientId);
      const value = ingredient?.nutrition[key];
      if (value === null || value === undefined || !ingredient) return null;
      sum += (value * line.amount) / NUTRITION_BASIS[ingredient.unit];
    }
    return recipe.lines.length ? Math.round(sum / recipe.servings) : null;
  };
  return { kcal: total("kcal"), protein: total("protein"), carbs: total("carbs"), fat: total("fat") };
}

/**
 * Nutrition for a new unit, when one new unit holds `oldPerNew` of the old unit.
 * Example: 20 kcal per 100 g is 50 kcal per piece when one piece holds 250 g.
 */
export function convertNutrition(nutrition: Nutrition, from: IngredientUnit, to: IngredientUnit, oldPerNew: number): Nutrition {
  const factor = (oldPerNew * NUTRITION_BASIS[to]) / NUTRITION_BASIS[from];
  const convert = (value: number | null) => value === null ? null : round(value * factor);
  return { kcal: convert(nutrition.kcal), protein: convert(nutrition.protein), carbs: convert(nutrition.carbs), fat: convert(nutrition.fat) };
}

/** A number with at most two decimals, and a decimal comma in German. */
export function formatNumber(value: number, language: "en" | "de" = "en"): string {
  const text = String(Math.round(value * 100) / 100);
  return language === "de" ? text.replace(".", ",") : text;
}

/** An amount for people: "1.5 kg" and "2 pieces", or "1,5 kg" and "2 Stück" in German. */
export function formatAmount(amount: number, unit: IngredientUnit, language: "en" | "de" = "en"): string {
  if (unit === "piece") return `${formatNumber(amount, language)} ${language === "de" ? "Stück" : amount === 1 ? "piece" : "pieces"}`;
  if (amount >= 1000) return `${formatNumber(amount / 1000, language)} ${unit === "g" ? "kg" : "l"}`;
  return `${formatNumber(amount, language)} ${unit}`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function positiveInteger(value: number, label: string, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new KitchenError(`${label} must be a whole number from 1 to ${max}.`);
  return value;
}

function positiveAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) throw new KitchenError("Each amount must be more than 0.");
  return round(value);
}

function nutritionValue(value: number | null, label: string): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 10_000) throw new KitchenError(`${label} must be 0 or more.`);
  return round(value);
}

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

/** Today in the same fixed time zone as every other Tools date, so the server and browser agree. */
export function today(now = new Date()): string {
  return TODAY.format(now);
}
