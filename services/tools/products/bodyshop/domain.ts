/**
 * Bodyshop records one person's food, weight, and day check-ins. Every record belongs to one owner.
 * Source records are stored; totals, ranges, trends, and model results are calculated from them.
 */

export const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack", "Other"] as const;
export type Meal = (typeof MEALS)[number];

export const DAY_STATUSES = ["Complete", "Partial", "Unknown"] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

export const NUTRIENTS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;
export type Nutrient = (typeof NUTRIENTS)[number];
/** An empty value is unknown. It is never treated as zero. */
export type Nutrients = Readonly<Record<Nutrient, number | null>>;

export const ENTRY_SOURCES = ["Saved food", "Estimated", "Label"] as const;

/**
 * The nutrition a food entry was logged with: the values for `amount` of `unit`.
 * It never changes when the saved food changes later.
 */
export type Reference = Readonly<{
  food: string;
  amount: number;
  unit: string;
  nutrients: Nutrients;
  /** The usual relative range of the nutrition values, such as 0.15 for ±15 %. */
  range: number | null;
  fiberRange: number | null;
  notes: string;
}>;

/**
 * One food that was eaten. `range` and `fiberRange` are the effective ranges, fixed when the entry was written.
 * A correction keeps the same id; storage keeps every earlier revision.
 */
export type FoodEntry = Readonly<{
  id: string;
  day: string;
  time: string | null;
  meal: Meal;
  food: string;
  amount: number | null;
  unit: string;
  source: string;
  notes: string;
  reference: Reference | null;
  range: number | null;
  fiberRange: number | null;
  createdAt: string;
  updatedAt: string;
}>;

export type SavedFood = Readonly<{
  id: string;
  name: string;
  brand: string;
  amount: number;
  unit: string;
  nutrients: Nutrients;
  notes: string;
  fullSize: Readonly<{ amount: number; unit: string }> | null;
  container: string;
  fullSizeNotes: string;
  source: string;
  sourceReference: string;
  verified: string | null;
  confidence: string;
  range: number | null;
  fiberRange: number | null;
  fiberNotes: string;
}>;

export const QUANTITY_TYPES = ["Fixed", "Variable"] as const;
export type QuantityType = (typeof QUANTITY_TYPES)[number];

/** One food of a recurring meal, valid from `effectiveFrom` until a later version of the same template and order. */
export type TemplateComponent = Readonly<{
  id: string;
  template: string;
  aliases: readonly string[];
  order: number;
  food: string;
  amount: number;
  unit: string;
  quantity: QuantityType;
  meal: Meal;
  effectiveFrom: string;
  notes: string;
}>;

/** `loggedAt` is when Bodyshop received the reading. Imported readings have none. */
export type WeightReading = Readonly<{ id: string; day: string; kg: number; time: string | null; notes: string; source: string; loggedAt?: string }>;

/** What happened on a day besides food. `override` wins over every automatic completion rule. */
export type CheckIn = Readonly<{
  id: string;
  day: string;
  reported: DayStatus | null;
  training: string;
  trainingNotes: string;
  steps: number | null;
  activityNotes: string;
  hunger: number | null;
  fatigue: number | null;
  recovery: number | null;
  sleep: number | null;
  notes: string;
  basis: string;
  override: DayStatus | null;
}>;

/** Food logged on `sourceDay` that belongs in part to `day`, for example one pooled log for two days. */
export type Allocation = Readonly<{ id: string; day: string; sourceDay: string; fraction: number; basis: string }>;

/** One settings row as you keep it: a label, a value, a unit, and notes. */
export type Setting = Readonly<{ id: string; label: string; value: string | number | null; unit: string; notes: string; order: number }>;

export const ENTRY_CHECKS = ["Ready", "Reference missing / mismatch", "Quantity / unit check", "Estimate % missing", "Fiber estimate missing"] as const;
export type EntryCheck = (typeof ENTRY_CHECKS)[number];

/** The food of one day: totals, the ranges around them, and whether the day counts as complete. */
export type DaySummary = Readonly<{
  day: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Fiber and every range exist only when all entries of the day pass their checks. */
  fiber: number | null;
  low: Nutrients;
  high: Nutrients;
  check: "Ready" | "Review Food Log checks";
  status: DayStatus;
  basis: string;
  entries: number;
  /** The share of entries that pass their checks. */
  coverage: number | null;
  evidence: string;
}>;

export class BodyshopError extends Error {
  constructor(message: string, readonly code: "invalid" | "not_found" | "conflict" | "too_large" = "invalid") {
    super(message);
    this.name = "BodyshopError";
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDay(value: unknown, label = "Date"): string {
  const text = String(value ?? "").trim();
  if (!DAY.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`)) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
    throw new BodyshopError(`${label} must be a date as YYYY-MM-DD.`);
  }
  return text;
}

export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const VIENNA = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });

/** The logging day for a moment. Food eaten before `dayStartHour` in Vienna belongs to the day before. */
export function loggingDay(now: Date, dayStartHour = 4): string {
  const parts = Object.fromEntries(VIENNA.formatToParts(now).map((part) => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour) < dayStartHour ? addDays(day, -1) : day;
}

export function isMeal(value: unknown): value is Meal {
  return MEALS.includes(value as Meal);
}

export function isDayStatus(value: unknown): value is DayStatus {
  return DAY_STATUSES.includes(value as DayStatus);
}

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The template components that apply on `day`: for each template and order, the version with the latest
 * `effectiveFrom` on or before the day. Later versions never change earlier meals.
 */
export function templateOn(components: readonly TemplateComponent[], template: string, day: string): TemplateComponent[] {
  const current = new Map<number, TemplateComponent>();
  for (const component of components) {
    if (!sameName(component.template, template) || component.effectiveFrom > day) continue;
    const seen = current.get(component.order);
    if (!seen || component.effectiveFrom > seen.effectiveFrom) current.set(component.order, component);
  }
  return [...current.values()].sort((a, b) => a.order - b.order);
}

/** Finds a template by its name or one of its aliases. */
export function findTemplate(components: readonly TemplateComponent[], name: string): string | undefined {
  const wanted = name.trim().toLowerCase();
  return components.find((one) => one.template.toLowerCase() === wanted || one.aliases.some((alias) => alias.toLowerCase() === wanted))?.template;
}
