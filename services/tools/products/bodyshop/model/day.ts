import { type Allocation, type CheckIn, type DayStatus, type DaySummary, type EntryCheck, type FoodEntry, NUTRIENTS, type Nutrient, type Nutrients } from "../domain.js";

const EMPTY: Nutrients = { kcal: null, protein: null, carbs: null, fat: null, fiber: null };

/** The nutrition of one entry: amount ÷ reference amount × reference value. Empty when the entry does not match its reference. */
export function entryNutrients(entry: Pick<FoodEntry, "food" | "unit" | "amount" | "reference">): Nutrients {
  const reference = entry.reference;
  if (!reference || entry.food !== reference.food || entry.unit !== reference.unit || entry.amount === null || !(reference.amount > 0)) return EMPTY;
  const amount = entry.amount;
  return Object.fromEntries(NUTRIENTS.map((key) => {
    const value = reference.nutrients[key];
    return [key, value === null ? null : amount / reference.amount * value];
  })) as Nutrients;
}

/** The low and high value of each nutrient. Fiber uses the fiber range, the others use the nutrition range. */
export function entryBounds(entry: FoodEntry, nutrients = entryNutrients(entry)): { low: Nutrients; high: Nutrients } {
  const bound = (key: Nutrient, side: -1 | 1) => {
    const value = nutrients[key];
    const range = key === "fiber" ? entry.fiberRange : entry.range;
    if (value === null || range === null) return null;
    return side < 0 ? Math.max(0, value * (1 - range)) : value * (1 + range);
  };
  const side = (direction: -1 | 1) => Object.fromEntries(NUTRIENTS.map((key) => [key, bound(key, direction)])) as Nutrients;
  return { low: side(-1), high: side(1) };
}

/** Why an entry cannot count fully yet, or Ready. The order of the checks matches the Food Log data check. */
export function entryCheck(entry: FoodEntry, nutrients = entryNutrients(entry)): EntryCheck {
  const reference = entry.reference;
  const knownMain = reference ? (["kcal", "protein", "carbs", "fat"] as const).filter((key) => reference.nutrients[key] !== null).length : 0;
  if (!reference || entry.food !== reference.food || !(reference.amount > 0) || knownMain < 4) return "Reference missing / mismatch";
  if (entry.unit !== reference.unit || entry.amount === null || entry.amount < 0) return "Quantity / unit check";
  if (entry.range === null) return "Estimate % missing";
  if (nutrients.fiber === null || entry.fiberRange === null) return "Fiber estimate missing";
  return "Ready";
}

/** The effective fiber range: the reference fiber range, but never narrower than the nutrition range. */
export function effectiveFiberRange(fiberRange: number | null, range: number | null): number | null {
  if (fiberRange !== null) return Math.max(fiberRange, range ?? 0);
  return range;
}

function hasMeal(entries: readonly FoodEntry[], meal: string) {
  return entries.some((entry) => entry.meal === meal && entry.food.trim() !== "" && entry.amount !== null && entry.amount > 0);
}

/**
 * The completion status of a day. A manual override wins. Then a reported Complete, then breakfast, lunch,
 * and dinner each logged with a positive amount, then a reported Partial. Everything else is Unknown.
 */
export function dayStatus(entries: readonly FoodEntry[], checkIn: CheckIn | undefined): { status: DayStatus; basis: string } {
  const override = checkIn?.override ?? null;
  const reported = checkIn?.reported ?? "Unknown";
  if (override) return { status: override, basis: `Manual override: ${override}` };
  if (reported === "Complete") return { status: "Complete", basis: "Recorded Complete; original basis: Check-ins O" };
  if (hasMeal(entries, "Breakfast") && hasMeal(entries, "Lunch") && hasMeal(entries, "Dinner")) {
    return { status: "Complete", basis: "Automatic: breakfast + lunch + dinner; editable" };
  }
  const status: DayStatus = reported === "Partial" ? "Partial" : "Unknown";
  return { status, basis: `Not complete: ${status}` };
}

const sum = (values: readonly (number | null)[]) => values.reduce<number>((total, value) => total + (value ?? 0), 0);

/**
 * One summary for each day with food or an allocation. An allocated day takes its fraction of the
 * source day's food. Fiber and the ranges show only when every entry of the source day passes its check.
 */
export function daySummaries(entries: readonly FoodEntry[], checkIns: readonly CheckIn[], allocations: readonly Allocation[]): DaySummary[] {
  const byDay = new Map<string, FoodEntry[]>();
  for (const entry of entries) byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
  const allocated = new Map(allocations.map((allocation) => [allocation.day, allocation]));
  const checks = new Map(checkIns.map((checkIn) => [checkIn.day, checkIn]));
  const days = [...new Set([...byDay.keys(), ...allocated.keys()])].sort();

  return days.map((day) => {
    const allocation = allocated.get(day);
    const source = byDay.get(allocation?.sourceDay ?? day) ?? [];
    const factor = allocation?.fraction ?? 1;
    const rows = source.map((entry) => {
      const nutrients = entryNutrients(entry);
      return { nutrients, ...entryBounds(entry, nutrients), check: entryCheck(entry, nutrients) };
    });
    const ready = rows.every((row) => row.check === "Ready");
    const total = (pick: (row: (typeof rows)[number]) => number | null) => factor * sum(rows.map(pick));
    const side = (which: "low" | "high") => Object.fromEntries(NUTRIENTS.map((key) => [key, ready ? total((row) => row[which][key]) : null])) as Nutrients;
    const { status, basis } = dayStatus(byDay.get(day) ?? [], checks.get(day));
    return {
      day,
      kcal: total((row) => row.nutrients.kcal),
      protein: total((row) => row.nutrients.protein),
      carbs: total((row) => row.nutrients.carbs),
      fat: total((row) => row.nutrients.fat),
      fiber: ready ? total((row) => row.nutrients.fiber) : null,
      low: side("low"),
      high: side("high"),
      check: ready ? "Ready" : "Review Food Log checks",
      status,
      basis,
      entries: rows.length,
      coverage: rows.length ? rows.filter((row) => row.check === "Ready").length / rows.length : null,
      evidence: allocation?.basis || "Direct date-attributed intake"
    };
  });
}
