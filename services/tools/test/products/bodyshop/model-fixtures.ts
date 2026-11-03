import { addDays, type CheckIn, type DayStatus, type DaySummary, type FoodEntry, type Meal, type WeightReading } from "../../../products/bodyshop/domain.js";
import { readSettings } from "../../../products/bodyshop/settings.js";

/** Synthetic records for the model tests. Every value is invented. */

export const settings = readSettings([]);
export const START = "2026-01-01";
export const on = (offset: number) => addDays(START, offset);

export function logged(day: string, kcal: number, options: { status?: DayStatus; range?: number | null; entries?: number; protein?: number; basis?: string } = {}): DaySummary {
  const { status = "Complete", range = 0.1, entries = 3, protein = 100, basis = "Recorded Complete; original basis: Check-ins O" } = options;
  const ready = range !== null;
  const bound = (side: -1 | 1) => ({ kcal: ready ? kcal * (1 + side * (range as number)) : null, protein: null, carbs: null, fat: null, fiber: null });
  return {
    day, kcal, protein, carbs: 300, fat: 80, fiber: ready ? 30 : null, low: bound(-1), high: bound(1),
    check: ready ? "Ready" : "Review Food Log checks", status, basis, entries, coverage: ready ? 1 : 0.5, evidence: "Direct date-attributed intake"
  };
}

export function weighIn(day: string, kg: number, source = "Scale"): WeightReading {
  return { id: `w-${day}-${kg}-${source}`, day, kg, time: null, notes: "", source };
}

export function checkIn(day: string, fields: Partial<CheckIn> = {}): CheckIn {
  return {
    id: `c-${day}-${fields.steps ?? ""}`, day, reported: null, training: "", trainingNotes: "", steps: null, activityNotes: "",
    hunger: null, fatigue: null, recovery: null, sleep: null, notes: "", basis: "", override: null, ...fields
  };
}

export function food(day: string, name: string, kcal: number, options: { meal?: Meal; protein?: number; fiber?: number | null; range?: number | null } = {}): FoodEntry {
  const { meal = "Lunch", protein = 10, fiber = 2, range = 0.1 } = options;
  return {
    id: `f-${day}-${name}-${kcal}`, day, time: null, meal, food: name, amount: 100, unit: "g", source: "Saved food", notes: "",
    reference: { food: name, amount: 100, unit: "g", nutrients: { kcal, protein, carbs: 10, fat: 5, fiber }, range, fiberRange: range, notes: "" },
    range, fiberRange: range, createdAt: "", updatedAt: ""
  };
}

/** `count` consecutive days from `START`, each logged complete at `kcal`. */
export const completeDays = (count: number, kcal = 3000) => Array.from({ length: count }, (_, offset) => logged(on(offset), kcal));

/** One reading per day from `START`, starting at `kg` and changing by `perDay`. */
export const dailyWeights = (count: number, kg = 100, perDay = 0) => Array.from({ length: count }, (_, offset) => weighIn(on(offset), kg + perDay * offset));
