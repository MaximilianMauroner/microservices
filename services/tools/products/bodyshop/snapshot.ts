import type { CheckIn, DaySummary, FoodEntry, Meal, Nutrients, SavedFood, WeightReading } from "./domain.js";

/**
 * One day as the app shows it, with every saved food in full so the app can search and preview without a request.
 * `history` holds the weigh-ins of the 90 days up to today, whichever day is shown.
 */
export type BodyshopAppSnapshot = Readonly<{
  day: string;
  today: string;
  entries: readonly (FoodEntry & { nutrients: Nutrients; check: string })[];
  summary: DaySummary | null;
  targets: Readonly<{ kcal: number; protein: number; carbs: number; fat: number; fiber: number }>;
  weights: readonly WeightReading[];
  checkIn: CheckIn | null;
  templates: readonly Readonly<{ name: string; meal: Meal; parts: readonly Readonly<{ part: string; amount: number; unit: string; saved: boolean; variable: boolean }>[] }>[];
  foods: readonly SavedFood[];
  history: readonly WeightReading[];
}>;
