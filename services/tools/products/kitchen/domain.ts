export const INGREDIENT_UNITS = ["g", "ml", "piece", "can"] as const;
export type IngredientUnit = (typeof INGREDIENT_UNITS)[number];

/**
 * What each unit means. `basis` is the amount that nutrition values refer to: 100 g, 100 ml, or one counted item.
 * Names are [one, many].
 */
const UNITS: Record<IngredientUnit, { basis: number; en: readonly [string, string]; de: readonly [string, string] }> = {
  g: { basis: 100, en: ["g", "g"], de: ["g", "g"] },
  ml: { basis: 100, en: ["ml", "ml"], de: ["ml", "ml"] },
  piece: { basis: 1, en: ["piece", "pieces"], de: ["Stück", "Stück"] },
  can: { basis: 1, en: ["can", "cans"], de: ["Dose", "Dosen"] }
};

/** True for units that count items, such as pieces or cans, instead of weighing or measuring them. */
export function isCountedUnit(unit: IngredientUnit): boolean {
  return UNITS[unit].basis === 1;
}

/** The unit as people say it, for one item or for many. */
export function unitName(unit: IngredientUnit, language: "en" | "de" = "en", amount = 2): string {
  return UNITS[unit][language][amount === 1 ? 0 : 1];
}

export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Meal = (typeof MEALS)[number];

export const MEAL_LABELS: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

/** Nutrition per 100 g or 100 ml, or per counted item. A missing value is unknown, not zero. */
export type Nutrition = Readonly<{ kcal: number | null; protein: number | null; carbs: number | null; fat: number | null }>;

export type KitchenMember = Readonly<{ personId: string; email: string }>;
/** `groups` is the kitchen's order of ingredient groups, such as the order of a shop or of a food list. */
export type Kitchen = Readonly<{ id: string; name: string; mcpEnabled: boolean; members: readonly KitchenMember[]; groups: readonly string[] }>;

export type Ingredient = Readonly<{
  id: string;
  name: string;
  unit: IngredientUnit;
  /** The main group. The shopping list and the stock show the ingredient here. */
  section: string;
  /** More groups the ingredient also belongs to, such as Kohlenhydrate for chickpeas in Proteine. */
  otherGroups: readonly string[];
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
  /** True when this one meal has its own ingredients. Its recipe stays as it is. */
  custom: boolean;
  /** What this meal uses for its servings: its own ingredients, or else the recipe's, scaled. */
  lines: readonly RecipeLine[];
}>;

export type StockItem = Readonly<{ ingredientId: string; ingredient: string; unit: IngredientUnit; section: string; amount: number }>;
export type Leftover = Readonly<{ id: string; name: string; servings: number; useBy: string }>;
/**
 * An item on the shopping list that no meal needs. A one-time item leaves the list when you buy it.
 * An every-week item stays: `bought` says if it is bought for the week the list shows.
 */
export type ExtraItem = Readonly<{ id: string; name: string; everyWeek: boolean; bought: boolean }>;

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

export type IngredientInput = Readonly<{ name: string; unit: IngredientUnit; section: string; otherGroups?: readonly string[]; nutrition: Nutrition; notes: string }>;
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

/** Every group an ingredient belongs to, the main group first. */
export function ingredientGroups(ingredient: Pick<Ingredient, "section" | "otherGroups">): readonly string[] {
  return [ingredient.section, ...ingredient.otherGroups];
}

export function parseIngredientInput(input: IngredientInput): IngredientInput & { otherGroups: readonly string[] } {
  const section = input.section.trim().slice(0, 60) || UNSORTED_SECTION;
  const seen = new Set([section.toLowerCase(), UNSORTED_SECTION.toLowerCase()]);
  const otherGroups = (input.otherGroups ?? []).map((group) => group.trim().slice(0, 60)).filter((group) => {
    if (!group || seen.has(group.toLowerCase())) return false;
    seen.add(group.toLowerCase());
    return true;
  });
  if (otherGroups.length > 10) throw new KitchenError("An ingredient can be in at most 11 groups.");
  return {
    name: requiredName(input.name, "ingredient"),
    unit: parseUnit(input.unit),
    section,
    otherGroups,
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
  return { name: requiredName(input.name, "recipe"), servings, minutes, instructions: input.instructions.trim().slice(0, 20_000), lines: parseLines(input.lines) };
}

export function parseLines(lines: readonly RecipeLineInput[]): RecipeLineInput[] {
  const seen = new Set<string>();
  return lines.map((line) => {
    if (seen.has(line.ingredientId)) throw new KitchenError("Each ingredient can appear once. Combine the amounts.");
    seen.add(line.ingredientId);
    return { ingredientId: line.ingredientId, amount: positiveAmount(line.amount), note: line.note.trim().slice(0, 200) };
  });
}

export function parseUnit(unit: string): IngredientUnit {
  if ((INGREDIENT_UNITS as readonly string[]).includes(unit)) return unit as IngredientUnit;
  throw new KitchenError("Use g, ml, piece, or can as the unit.");
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

/** The ingredients of a recipe, as written, that are not fully at home. */
export function missingAtHome(recipe: Pick<Recipe, "lines">, stock: ReadonlyMap<string, number>): readonly string[] {
  return recipe.lines.filter((line) => (stock.get(line.ingredientId) ?? 0) < line.amount).map((line) => line.ingredient);
}

/**
 * What to buy for the meals that are not cooked yet: the sum of their scaled
 * lines, minus what is at home. Cooking removes amounts from stock, so cooked
 * meals no longer count.
 */
export function shoppingList(
  entries: readonly PlanEntry[],
  stock: readonly StockItem[],
  sections: ReadonlyMap<string, string>,
  groups: readonly string[]
): readonly ShoppingLine[] {
  const order = byGroupOrder(groups);
  const needed = new Map<string, { line: RecipeLine; amount: number; recipes: Set<string> }>();
  for (const entry of entries) {
    if (entry.cooked) continue;
    for (const line of entry.lines) {
      const current = needed.get(line.ingredientId) ?? { line, amount: 0, recipes: new Set<string>() };
      current.amount += line.amount;
      current.recipes.add(entry.recipe);
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
      sum += (value * line.amount) / UNITS[ingredient.unit].basis;
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
  const factor = (oldPerNew * UNITS[to].basis) / UNITS[from].basis;
  const convert = (value: number | null) => value === null ? null : round(value * factor);
  return { kcal: convert(nutrition.kcal), protein: convert(nutrition.protein), carbs: convert(nutrition.carbs), fat: convert(nutrition.fat) };
}

/** A number with at most two decimals, and a decimal comma in German. */
export function formatNumber(value: number, language: "en" | "de" = "en"): string {
  const text = String(Math.round(value * 100) / 100);
  return language === "de" ? text.replace(".", ",") : text;
}

/** An amount for people: "1.5 kg" and "2 cans", or "1,5 kg" and "2 Dosen" in German. */
export function formatAmount(amount: number, unit: IngredientUnit, language: "en" | "de" = "en"): string {
  if (isCountedUnit(unit)) return `${formatNumber(amount, language)} ${unitName(unit, language, amount)}`;
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
