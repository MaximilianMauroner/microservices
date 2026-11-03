import { addDays, type FoodEntry, MEALS, type Meal } from "../domain.js";
import { entryBounds, entryCheck, entryNutrients } from "./day.js";
import { fixed } from "./text.js";

/** Calories and protein of one meal in the window. */
export type MealShare = Readonly<{
  meal: Meal;
  kcal: number;
  protein: number;
  /** The meal's share of all logged calories. */
  share: number;
  proteinPer100Kcal: number;
}>;

/** One food summed over the window. */
export type FoodSource = Readonly<{
  food: string;
  occurrences: number;
  kcal: number;
  averageKcal: number | null;
  protein: number;
  proteinPer100Kcal: number | null;
}>;

/** What was logged in the selected history window (sheet "Food Insights"). Partial and unverified days count. */
export type FoodInsights = Readonly<{
  from: string;
  to: string;
  entries: number;
  kcal: number;
  protein: number;
  /** Summed fiber, or a note when no entries or an entry has no fiber value. */
  fiber: number | "No data" | "Needs estimate";
  /** The fiber range text, or a note when an entry still needs a check. */
  fiberRange: string;
  meals: readonly MealShare[];
  /** The ten largest calorie and protein sources. */
  topKcal: readonly FoodSource[];
  topProtein: readonly FoodSource[];
}>;

type Row = { entry: FoodEntry; kcal: number | null; protein: number | null; fiber: number | null; fiberLow: number | null; fiberHigh: number | null; kcalLow: number | null; kcalHigh: number | null; ready: boolean };

function rowsBetween(entries: readonly FoodEntry[], from: string, to: string): Row[] {
  return entries.filter((entry) => entry.day >= from && entry.day <= to).map((entry) => {
    const nutrients = entryNutrients(entry);
    const { low, high } = entryBounds(entry, nutrients);
    return { entry, kcal: nutrients.kcal, protein: nutrients.protein, fiber: nutrients.fiber, fiberLow: low.fiber, fiberHigh: high.fiber, kcalLow: low.kcal, kcalHigh: high.kcal, ready: entryCheck(entry, nutrients) === "Ready" };
  });
}

const sum = (values: readonly (number | null)[]) => values.reduce<number>((total, value) => total + (value ?? 0), 0);

/** Groups rows by food and sorts by `rank`, largest first. Ties keep the food name order. */
function bySource(rows: readonly Row[], rank: (source: FoodSource) => number, limit: number): FoodSource[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) if (row.entry.food !== "") groups.set(row.entry.food, [...(groups.get(row.entry.food) ?? []), row]);
  return [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([food, group]): FoodSource => {
    const known = group.filter((row) => row.kcal !== null);
    const kcal = sum(group.map((row) => row.kcal));
    const protein = sum(group.map((row) => row.protein));
    return { food, occurrences: group.length, kcal, averageKcal: known.length ? kcal / known.length : null, protein, proteinPer100Kcal: kcal ? (protein / kcal) * 100 : null };
  }).sort((a, b) => rank(b) - rank(a)).slice(0, limit);
}

/** The food insights of the `viewDays` days ending on `reviewDate`. */
export function foodInsights(entries: readonly FoodEntry[], reviewDate: string, viewDays: number): FoodInsights {
  const from = addDays(reviewDate, -viewDays + 1);
  const rows = rowsBetween(entries, from, reviewDate);
  const kcal = sum(rows.map((row) => row.kcal));
  const fiber = rows.length === 0 ? "No data" : rows.some((row) => row.fiber === null) ? "Needs estimate" : sum(rows.map((row) => row.fiber));
  const fiberRange = rows.length === 0 ? "" : rows.some((row) => !row.ready) ? "Range needs review"
    : `Range: ${fixed(sum(rows.map((row) => row.fiberLow)), 1)} - ${fixed(sum(rows.map((row) => row.fiberHigh)), 1)} g`;
  const meals = MEALS.map((meal): MealShare => {
    const inMeal = rows.filter((row) => row.entry.meal === meal);
    const mealKcal = sum(inMeal.map((row) => row.kcal));
    const protein = sum(inMeal.map((row) => row.protein));
    return { meal, kcal: mealKcal, protein, share: kcal ? mealKcal / kcal : 0, proteinPer100Kcal: mealKcal ? (protein / mealKcal) * 100 : 0 };
  });
  return {
    from, to: reviewDate, entries: rows.length, kcal, protein: sum(rows.map((row) => row.protein)), fiber, fiberRange, meals,
    topKcal: bySource(rows, (source) => source.kcal, 10),
    topProtein: bySource(rows, (source) => source.protein, 10)
  };
}

/** A food whose logged ranges add the most calorie uncertainty to the current model window. */
export type UncertainFood = Readonly<{ food: string; halfRangeKcal: number; kcal: number; entries: number }>;

/**
 * The five foods with the largest summed calorie half-ranges from `from` to `to` (sheet "Model", rows 112 to 117).
 * The sums are not independent errors and not a food-quality judgment.
 */
export function uncertainFoods(entries: readonly FoodEntry[], from: string, to: string): UncertainFood[] {
  const groups = new Map<string, { halfRangeKcal: number; kcal: number; entries: number }>();
  for (const row of rowsBetween(entries, from, to)) {
    if (row.entry.food === "" || row.kcal === null || row.kcalHigh === null) continue;
    const group = groups.get(row.entry.food) ?? { halfRangeKcal: 0, kcal: 0, entries: 0 };
    group.halfRangeKcal += (row.kcalHigh - (row.kcalLow ?? 0)) / 2;
    group.kcal += row.kcal;
    group.entries += 1;
    groups.set(row.entry.food, group);
  }
  return [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([food, group]) => ({ food, ...group })).sort((a, b) => b.halfRangeKcal - a.halfRangeKcal).slice(0, 5);
}
