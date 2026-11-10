import { createHash, randomUUID } from "node:crypto";
import {
  addDays, BodyshopError, type CheckIn, type DayStatus, type FoodEntry, findTemplate, loggingDay, type Meal, type Nutrients, NUTRIENTS,
  parseDay, type Reference, sameName, type SavedFood, type Setting, templateOn, type WeightReading
} from "./domain.js";
import { IMPORT_SHEETS, type Note, planImport, reconcile, type Reconciliation, type SheetCount } from "./import/plan.js";
import { readWorkbook } from "./import/workbook.js";
import { dayStatus, daySummaries, entryCheck, entryNutrients } from "./model/day.js";
import { stepEnergy, energyView } from "./model/energy.js";
import { runModel } from "./model/engine.js";
import { foodInsights, uncertainFoods } from "./model/insights.js";
import { projectWeight } from "./model/projection.js";
import { weeklyReview } from "./model/review.js";
import { dailyMeanWeights } from "./model/weight.js";
import type { BodyshopAction } from "./actions.js";
import type { BodyshopChange, BodyshopKind, BodyshopScope } from "./repository.js";
import { ageOn, PROFILE_LABELS, type Profile, readProfile, readSettings, SETTING_LABELS, SEXES, type SettingKey, type Settings } from "./settings.js";

/** A second log of the same food, meal, and amount within this time returns the first entry. */
const REPEAT_WINDOW_MS = 10 * 60 * 1000;

export type LogItem = Readonly<{
  /** A saved food's name or id, or a free name when `nutrients` are given. */
  food: string;
  meal: Meal;
  amount?: number | null;
  /** The saved food's unit, or its container word ("pack", "tub") for full packages. */
  unit?: string | null;
  /** The values for the logged amount, for a food that is not saved. */
  nutrients?: Partial<Nutrients> | null;
  range?: number | null;
  fiberRange?: number | null;
  source?: "Estimated" | "Label" | null;
  notes?: string | null;
}>;

export type LogResult = Readonly<{ entries: FoodEntry[]; repeated: string[] }>;

export type DayView = Readonly<{
  day: string;
  today: string;
  entries: readonly (FoodEntry & { nutrients: Nutrients; check: string })[];
  summary: ReturnType<typeof daySummaries>[number] | null;
  targets: Readonly<{ kcal: number; protein: number; carbs: number; fat: number; fiber: number }>;
  weights: readonly WeightReading[];
  checkIn: CheckIn | null;
}>;

async function settingsOf(scope: BodyshopScope): Promise<Settings> {
  return readSettings(await scope.list("setting"));
}

/** The logging day for `now`. Food eaten before the day-start hour belongs to the day before. */
export async function currentDay(scope: BodyshopScope, now = new Date()): Promise<string> {
  return loggingDay(now, (await settingsOf(scope)).dayStartHour);
}

function findFood(foods: readonly SavedFood[], ref: string): SavedFood | undefined {
  return foods.find((food) => food.id === ref) ?? foods.find((food) => sameName(food.name, ref));
}

function suggestions(foods: readonly SavedFood[], ref: string): string {
  const words = ref.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  const close = foods.filter((food) => words.some((word) => food.name.toLowerCase().includes(word))).slice(0, 5).map((food) => food.name);
  return close.length ? ` Saved foods with a similar name: ${close.join("; ")}.` : "";
}

const containerWords = (food: SavedFood) => [...food.container.split("/"), "full", "full size"].map((word) => word.trim().toLowerCase()).filter(Boolean);

/** The amount in the saved food's unit. A container word means full packages, such as "1 pack" of 250 g butter. */
function amountIn(food: SavedFood, amount: number | null | undefined, unit: string | null | undefined): { amount: number; note: string } {
  if (!unit || sameName(unit, food.unit)) {
    if (amount === null || amount === undefined) throw new BodyshopError(`Give the amount of ${food.name} in ${food.unit}.`);
    return { amount, note: "" };
  }
  const count = amount ?? 1;
  if (food.fullSize && containerWords(food).includes(unit.trim().toLowerCase())) {
    if (sameName(food.fullSize.unit, food.unit)) return { amount: count * food.fullSize.amount, note: `${count} ${unit} = ${count * food.fullSize.amount} ${food.unit}` };
  }
  throw new BodyshopError(`${food.name} is saved per ${food.amount} ${food.unit}. Give the amount in ${food.unit}${food.fullSize ? ` or as full ${food.container || "packages"} (${food.fullSize.amount} ${food.fullSize.unit} each)` : ""}.`);
}

function snapshot(food: SavedFood): Reference {
  return { food: food.name, amount: food.amount, unit: food.unit, nutrients: food.nutrients, range: food.range, fiberRange: food.fiberRange, notes: food.notes };
}

function checkRange(value: number | null | undefined, label: string) {
  if (value !== null && value !== undefined && !(value >= 0 && value <= 5)) throw new BodyshopError(`${label} must be a share between 0 and 5, such as 0.15 for ±15 %.`);
}

function entryFrom(item: LogItem, foods: readonly SavedFood[], day: string, time: string | null, now: string): FoodEntry {
  checkRange(item.range, "The range");
  checkRange(item.fiberRange, "The fiber range");
  const base = { id: randomUUID(), day, time, meal: item.meal, createdAt: now, updatedAt: now };
  if (item.nutrients) {
    const amount = item.amount ?? 1;
    const unit = item.unit?.trim() || "portion";
    if (!(amount > 0)) throw new BodyshopError(`The amount of ${item.food} must be more than 0.`);
    const nutrients = Object.fromEntries(NUTRIENTS.map((key) => [key, item.nutrients?.[key] ?? null])) as Nutrients;
    if (nutrients.kcal === null) throw new BodyshopError(`Give the calories of ${item.food}.`);
    const range = item.range ?? null;
    const fiberRange = item.fiberRange ?? null;
    return {
      ...base, food: item.food.trim(), amount, unit, source: item.source ?? "Estimated", notes: item.notes?.trim() ?? "",
      reference: { food: item.food.trim(), amount, unit, nutrients, range, fiberRange, notes: "" }, range, fiberRange
    };
  }
  const food = findFood(foods, item.food);
  if (!food) throw new BodyshopError(`No saved food named "${item.food}". Save it first, or log it with nutrients as an estimate.${suggestions(foods, item.food)}`, "not_found");
  if (!(food.amount > 0)) throw new BodyshopError(`${food.name} has no reference amount. Correct the saved food first.`);
  const { amount, note } = amountIn(food, item.amount, item.unit);
  if (!(amount > 0)) throw new BodyshopError(`The amount of ${food.name} must be more than 0.`);
  return {
    ...base, food: food.name, amount, unit: food.unit, source: "Saved food", notes: [item.notes?.trim(), note].filter(Boolean).join("\n"),
    reference: snapshot(food), range: item.range ?? food.range, fiberRange: item.fiberRange ?? food.fiberRange
  };
}

function isRepeat(existing: FoodEntry, entry: FoodEntry, now: number) {
  return existing.day === entry.day && existing.meal === entry.meal && sameName(existing.food, entry.food) && existing.amount === entry.amount
    && now - Date.parse(existing.createdAt) <= REPEAT_WINDOW_MS;
}

/**
 * Logs one or more foods in one transaction. An item that repeats an entry of the last ten minutes
 * (same day, meal, food, and amount) returns that entry, unless `repeat` is set.
 */
export async function logFood(scope: BodyshopScope, input: { items: readonly LogItem[]; day?: string; time?: string | null; repeat?: boolean }, now = new Date()): Promise<LogResult> {
  if (!input.items.length) throw new BodyshopError("Add at least one food.");
  const day = input.day ? parseDay(input.day) : await currentDay(scope, now);
  const stamp = now.toISOString();
  return scope.exclusive(async (locked) => {
    const [foods, existing] = await Promise.all([locked.list("food"), locked.list("entry", { from: day, to: day })]);
    const entries: FoodEntry[] = [];
    const repeated: string[] = [];
    const changes: FoodEntry[] = [];
    for (const item of input.items) {
      const entry = entryFrom(item, foods, day, input.time ?? null, stamp);
      // An item sent twice in one request counts as a repeat too.
      const earlier = input.repeat ? undefined : [...existing, ...changes].find((one) => isRepeat(one, entry, now.getTime()));
      if (earlier) { entries.push(earlier); repeated.push(earlier.id); continue; }
      entries.push(entry);
      changes.push(entry);
    }
    if (changes.length) await locked.save(changes.map((record) => ({ kind: "entry", record })));
    return { entries, repeated };
  });
}

/** The template parts that apply on the day, with the saved food each one uses. */
export async function templateParts(scope: BodyshopScope, name: string, day: string) {
  const [components, foods] = await Promise.all([scope.list("template"), scope.list("food")]);
  const template = findTemplate(components, name);
  if (!template) {
    const names = [...new Set(components.map((one) => one.template))];
    throw new BodyshopError(`No meal template named "${name}". Templates: ${names.join(", ") || "none"}.`, "not_found");
  }
  return { template, parts: templateOn(components, template, day).map((part) => ({ ...part, saved: findFood(foods, part.food) ?? null })) };
}

/**
 * Logs a meal template. `choices` replaces a part's food or amount, keyed by the part's food name. A part
 * whose food is not saved, such as "Billa bread item (variable)", needs a choice. `skip` leaves parts out.
 */
export async function logMeal(scope: BodyshopScope, input: {
  template: string; day?: string; time?: string | null; meal?: Meal; repeat?: boolean;
  choices?: readonly { part: string; food?: string; amount?: number; unit?: string }[]; skip?: readonly string[];
}, now = new Date()): Promise<LogResult & { template: string }> {
  const day = input.day ? parseDay(input.day) : await currentDay(scope, now);
  const { template, parts } = await templateParts(scope, input.template, day);
  if (!parts.length) throw new BodyshopError(`${template} has no parts on ${day}.`);
  for (const choice of input.choices ?? []) {
    if (!parts.some((part) => sameName(part.food, choice.part))) throw new BodyshopError(`${template} has no part named "${choice.part}". Parts: ${parts.map((part) => part.food).join(", ")}.`);
  }
  const items: LogItem[] = [];
  for (const part of parts) {
    if (input.skip?.some((name) => sameName(name, part.food))) continue;
    const choice = input.choices?.find((one) => sameName(one.part, part.food));
    const food = choice?.food ?? part.food;
    if (!choice?.food && !part.saved) throw new BodyshopError(`Choose the food for "${part.food}" in ${template}.`);
    const changedFood = choice?.food && !sameName(choice.food, part.food);
    items.push({
      food, meal: input.meal ?? part.meal,
      amount: choice?.amount ?? (changedFood ? undefined : part.amount),
      unit: choice?.unit ?? (changedFood ? undefined : part.unit),
      notes: `From ${template}`
    });
  }
  return { template, ...(await logFood(scope, { items, day, time: input.time, repeat: input.repeat }, now)) };
}

export type EntryPatch = Partial<Pick<FoodEntry, "day" | "time" | "meal" | "amount" | "notes" | "range" | "fiberRange">> & { food?: string; unit?: string; nutrients?: Partial<Nutrients> };

/**
 * Corrects one entry. A new food takes a new snapshot of that saved food; a new amount scales the
 * snapshot the entry already has. Every earlier version stays in the history.
 */
export async function correctEntry(scope: BodyshopScope, id: string, patch: EntryPatch, now = new Date()): Promise<FoodEntry> {
  return scope.exclusive((locked) => correctLocked(locked, id, patch, now));
}

async function correctLocked(scope: BodyshopScope, id: string, patch: EntryPatch, now: Date): Promise<FoodEntry> {
  const entry = await scope.get("entry", id);
  if (!entry) throw new BodyshopError("This food entry does not exist.", "not_found");
  checkRange(patch.range, "The range");
  checkRange(patch.fiberRange, "The fiber range");
  let next: FoodEntry = {
    ...entry, ...(patch.day ? { day: parseDay(patch.day) } : {}), time: patch.time === undefined ? entry.time : patch.time,
    meal: patch.meal ?? entry.meal, notes: patch.notes ?? entry.notes, range: patch.range === undefined ? entry.range : patch.range,
    fiberRange: patch.fiberRange === undefined ? entry.fiberRange : patch.fiberRange, updatedAt: now.toISOString()
  };
  if (patch.nutrients) {
    // New values merge with the values the entry has now, scaled to a new amount in the same unit, so correcting the calories keeps the protein.
    const defined = Object.fromEntries(Object.entries(patch.nutrients).filter(([, value]) => value !== undefined));
    const sameUnit = patch.unit === undefined || sameName(patch.unit, entry.unit);
    const scale = patch.amount && entry.amount && sameUnit ? patch.amount / entry.amount : 1;
    const current = Object.fromEntries(Object.entries(entryNutrients(entry)).map(([key, value]) => [key, value === null ? null : value * scale]));
    const nutrients = { ...current, ...defined };
    const replaced = entryFrom({ food: patch.food ?? entry.food, meal: next.meal, amount: patch.amount ?? entry.amount, unit: patch.unit ?? entry.unit, nutrients, range: next.range, fiberRange: next.fiberRange, source: "Estimated" }, [], next.day, next.time, entry.createdAt);
    next = { ...next, food: replaced.food, amount: replaced.amount, unit: replaced.unit, reference: replaced.reference, source: entry.source === "Saved food" ? "Estimated" : entry.source };
  } else if (patch.food && !sameName(patch.food, entry.food)) {
    const replaced = entryFrom({ food: patch.food, meal: next.meal, amount: patch.amount, unit: patch.unit }, await scope.list("food"), next.day, next.time, entry.createdAt);
    next = { ...next, food: replaced.food, amount: replaced.amount, unit: replaced.unit, reference: replaced.reference, source: replaced.source, range: patch.range ?? replaced.range, fiberRange: patch.fiberRange ?? replaced.fiberRange };
  } else if (patch.amount !== undefined || patch.unit !== undefined) {
    const food = entry.reference && entry.source === "Saved food" ? findFood(await scope.list("food"), entry.reference.food) : undefined;
    if (food && patch.unit && !sameName(patch.unit, entry.unit)) next = { ...next, amount: amountIn({ ...food, amount: entry.reference!.amount, unit: entry.reference!.unit }, patch.amount, patch.unit).amount };
    else {
      if (patch.amount !== undefined && patch.amount !== null && !(patch.amount > 0)) throw new BodyshopError("The amount must be more than 0.");
      next = { ...next, amount: patch.amount === undefined ? entry.amount : patch.amount, unit: patch.unit ?? entry.unit };
    }
  }
  await scope.save([{ kind: "entry", record: next }]);
  return next;
}

export async function removeRecord(scope: BodyshopScope, kind: BodyshopKind, id: string): Promise<void> {
  await scope.exclusive((locked) => locked.save([{ kind, remove: id } as BodyshopChange]));
}

export type FoodInput = Partial<Omit<SavedFood, "id" | "name" | "nutrients">> & { id?: string; name: string; nutrients?: Partial<Nutrients> };

/** Creates a saved food, or changes the one with the same id or name. Fields left out keep their value. */
export async function saveFood(scope: BodyshopScope, input: FoodInput): Promise<SavedFood> {
  return scope.exclusive((locked) => saveFoodLocked(locked, input));
}

async function saveFoodLocked(scope: BodyshopScope, input: FoodInput): Promise<SavedFood> {
  const name = input.name.trim();
  if (!name) throw new BodyshopError("A food needs a name.");
  checkRange(input.range, "The range");
  checkRange(input.fiberRange, "The fiber range");
  const foods = await scope.list("food");
  const existing = input.id ? foods.find((food) => food.id === input.id) : findFood(foods, name);
  if (input.id && !existing) throw new BodyshopError("This saved food does not exist.", "not_found");
  const clash = foods.find((food) => food.id !== existing?.id && sameName(food.name, name));
  if (clash) throw new BodyshopError(`A saved food named ${clash.name} exists already.`, "conflict");
  const blank: SavedFood = {
    id: randomUUID(), name, brand: "", amount: 100, unit: "g", nutrients: { kcal: null, protein: null, carbs: null, fat: null, fiber: null }, notes: "",
    fullSize: null, container: "", fullSizeNotes: "", source: "", sourceReference: "", verified: null, confidence: "", range: null, fiberRange: null, fiberNotes: ""
  };
  const defined = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  const food: SavedFood = { ...(existing ?? blank), ...defined, id: existing?.id ?? blank.id, name, nutrients: { ...(existing ?? blank).nutrients, ...Object.fromEntries(Object.entries(input.nutrients ?? {}).filter(([, value]) => value !== undefined)) } };
  if (!(food.amount > 0)) throw new BodyshopError("The reference amount must be more than 0.");
  if (!food.unit.trim()) throw new BodyshopError("A food needs a unit.");
  if (food.nutrients.kcal === null) throw new BodyshopError(`Give the calories per ${food.amount} ${food.unit}.`);
  await scope.save([{ kind: "food", record: food }]);
  return food;
}

/** Logs a weight. The same weight sent again within ten minutes returns the first reading. */
export async function logWeight(scope: BodyshopScope, input: { kg: number; day?: string; time?: string | null; notes?: string; source?: string }, now = new Date()): Promise<WeightReading> {
  if (!(input.kg > 20 && input.kg < 400)) throw new BodyshopError("Give the weight in kg, between 20 and 400.");
  const day = input.day ? parseDay(input.day) : await currentDay(scope, now);
  return scope.exclusive(async (locked) => {
    const existing = (await locked.list("weight", { from: day, to: day }))
      .find((one) => one.kg === input.kg && one.loggedAt !== undefined && now.getTime() - Date.parse(one.loggedAt) <= REPEAT_WINDOW_MS);
    if (existing) return existing;
    const reading: WeightReading = { id: randomUUID(), day, kg: input.kg, time: input.time ?? null, notes: input.notes?.trim() ?? "", source: input.source?.trim() || "Reported", loggedAt: now.toISOString() };
    await locked.save([{ kind: "weight", record: reading }]);
    return reading;
  });
}

export type DayInput = Partial<Omit<CheckIn, "id" | "day">> & { day?: string };

/** Records the check-in of a day: how it went and whether the food log is complete. Fields left out keep their value. */
export async function updateDay(scope: BodyshopScope, input: DayInput, now = new Date()): Promise<CheckIn> {
  return scope.exclusive((locked) => updateDayLocked(locked, input, now));
}

async function updateDayLocked(scope: BodyshopScope, input: DayInput, now: Date): Promise<CheckIn> {
  const day = input.day ? parseDay(input.day) : await currentDay(scope, now);
  const [existing] = await scope.list("checkin", { from: day, to: day });
  for (const key of ["hunger", "fatigue", "recovery"] as const) {
    const value = input[key];
    if (value !== undefined && value !== null && !(Number.isInteger(value) && value >= 1 && value <= 5)) throw new BodyshopError(`${key} must be a whole number from 1 to 5.`);
  }
  const blank: CheckIn = { id: randomUUID(), day, reported: null, training: "", trainingNotes: "", steps: null, activityNotes: "", hunger: null, fatigue: null, recovery: null, sleep: null, notes: "", basis: "", override: null };
  const defined = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  const checkIn: CheckIn = { ...(existing ?? blank), ...defined, id: existing?.id ?? blank.id, day };
  await scope.save([{ kind: "checkin", record: checkIn }]);
  return checkIn;
}

export async function readBodyshopSettings(scope: BodyshopScope): Promise<{ settings: Settings; profile: Profile; rows: Setting[] }> {
  const rows = await scope.list("setting");
  return { settings: readSettings(rows), profile: readProfile(rows), rows: rows.sort((a, b) => a.order - b.order) };
}

/** Sets the birthday and sex for the resting energy equation. Null clears a value; a value left out stays. */
export async function updateProfile(scope: BodyshopScope, input: { birthday?: string | null; sex?: Profile["sex"] }, now = new Date()): Promise<Profile> {
  if (input.birthday) {
    const birthday = parseDay(input.birthday, "The birthday");
    const age = ageOn(birthday, loggingDay(now, 0));
    if (!(age >= 18 && age <= 110)) throw new BodyshopError("The resting energy equation needs an age from 18 to 110.");
  }
  if (input.sex && !SEXES.includes(input.sex)) throw new BodyshopError("Choose Male or Female.");
  return scope.exclusive(async (locked) => {
    const rows = await locked.list("setting");
    const changes: BodyshopChange[] = [];
    for (const [key, value] of [["birthday", input.birthday], ["sex", input.sex]] as const) {
      if (value === undefined) continue;
      const label = PROFILE_LABELS[key];
      const row = rows.find((one) => sameName(one.label, label));
      changes.push({ kind: "setting", record: row ? { ...row, value } : { id: randomUUID(), label, value, unit: "", notes: "", order: 900 + changes.length } });
    }
    if (changes.length) await locked.save(changes);
    return readProfile([...rows.filter((row) => !changes.some((change) => "record" in change && change.record.id === row.id)), ...changes.flatMap((change) => ("record" in change ? [change.record as Setting] : []))]);
  });
}

/** Settings that count days, weeks, or hours. They must be whole numbers of at least 1. */
const COUNTS = new Set<SettingKey>([
  "weightMeanMinDays", "reviewMinCompleteDays", "projectionMinWeighDays", "projectionMinSpan", "projectionHorizonWeeks", "modelWindow", "minCompleteDays",
  "minRecentComplete", "minWeightDays", "minWeightSpan", "maxWeightGap", "freshDays", "staleDays", "inferenceWindow", "inferenceMinDays",
  "inferenceMaxConsecutive", "minRecentWeights", "recentWeightWindow", "predictionHorizon"
]);
/** Settings that are shares or smoothing factors, from 0 to 1. */
const SHARES = new Set<SettingKey>(["trendAlpha", "expenditureAlpha", "minCoverage", "inferenceFloor", "energyUncertainty", "missingAllowance", "rapidTrendReview", "strideRatio"]);
/** Settings in percent of body weight per week. More than 10 % a week is not a real rate. */
const WEEKLY_PERCENTS = new Set<SettingKey>(["rateTargetPercent", "projectionMaxLossPercent", "projectionMaxGainPercent", "projectionFloorPercent"]);

function checkSetting(key: SettingKey, value: number) {
  const label = SETTING_LABELS[key];
  if (!Number.isFinite(value)) throw new BodyshopError(`${label} must be a number.`);
  if (key === "dayStartHour" && !(Number.isInteger(value) && value >= 0 && value <= 12)) throw new BodyshopError(`${label} must be a whole hour from 0 to 12.`);
  if (key === "inferenceMaxConsecutive" && !(Number.isInteger(value) && value >= 0)) throw new BodyshopError(`${label} must be a whole number of 0 or more.`);
  if (COUNTS.has(key) && key !== "inferenceMaxConsecutive" && !(Number.isInteger(value) && value >= 1)) throw new BodyshopError(`${label} must be a whole number of at least 1.`);
  if (key === "trendAlpha" || key === "expenditureAlpha" ? !(value > 0 && value <= 1) : SHARES.has(key) && !(value >= 0 && value <= 1)) throw new BodyshopError(`${label} must be a share from 0 to 1.`);
  if (WEEKLY_PERCENTS.has(key) && !(value >= 0 && value <= 10)) throw new BodyshopError(`${label} must be from 0 to 10 %.`);
  if (!(value >= 0)) throw new BodyshopError(`${label} cannot be negative.`);
  if (["energyDensity", "calorieTarget", "heightCm", "expenditureMax", "rateReferenceWeight"].includes(key) && !(value > 0)) throw new BodyshopError(`${label} must be more than 0.`);
}

/** Changes settings by key. A setting the workbook did not have gets a new row. */
export async function updateSettings(scope: BodyshopScope, values: Partial<Record<SettingKey, number>>): Promise<Settings> {
  return scope.exclusive((locked) => updateSettingsLocked(locked, values));
}

async function updateSettingsLocked(scope: BodyshopScope, values: Partial<Record<SettingKey, number>>): Promise<Settings> {
  const rows = await scope.list("setting");
  const changes: BodyshopChange[] = [];
  for (const [key, value] of Object.entries(values) as [SettingKey, number | undefined][]) {
    if (value === undefined) continue;
    if (!(key in SETTING_LABELS)) throw new BodyshopError(`Unknown setting ${key}.`);
    checkSetting(key, value);
    const label = SETTING_LABELS[key];
    const row = rows.find((one) => sameName(one.label, label));
    changes.push({ kind: "setting", record: row ? { ...row, value } : { id: randomUUID(), label, value, unit: "", notes: "", order: 1000 + rows.length + changes.length } });
  }
  const next = readSettings([...rows.filter((row) => !changes.some((change) => "record" in change && change.record.id === row.id)), ...changes.flatMap((change) => ("record" in change ? [change.record as Setting] : []))]);
  if (next.expenditureMin >= next.expenditureMax) throw new BodyshopError(`${SETTING_LABELS.expenditureMin} must be below ${SETTING_LABELS.expenditureMax}.`);
  if (next.goalLow > next.goalHigh) throw new BodyshopError(`${SETTING_LABELS.goalLow} must not be above ${SETTING_LABELS.goalHigh}.`);
  if (changes.length) await scope.save(changes);
  return next;
}

/** One day's food with totals, targets, weights, and the check-in. */
export async function dayView(scope: BodyshopScope, day?: string, now = new Date()): Promise<DayView> {
  const { settings } = await readBodyshopSettings(scope);
  const today = loggingDay(now, settings.dayStartHour);
  const wanted = day ? parseDay(day) : today;
  const [checkIns, allocations, weights] = await Promise.all([
    scope.list("checkin", { from: wanted, to: wanted }), scope.list("allocation", { from: wanted, to: wanted }), scope.list("weight", { from: wanted, to: wanted })
  ]);
  // A day split from a pooled log needs the food of the day it was split from.
  const sources = [wanted, ...allocations.map((one) => one.sourceDay)].sort();
  const entries = (await scope.list("entry", { from: sources[0], to: sources.at(-1) })).filter((entry) => sources.includes(entry.day));
  const summary = daySummaries(entries, checkIns, allocations).find((one) => one.day === wanted) ?? null;
  const own = entries.filter((entry) => entry.day === wanted).map((entry) => {
    const nutrients = entryNutrients(entry);
    return { ...entry, nutrients, check: entryCheck(entry, nutrients) };
  });
  return {
    day: wanted, today, entries: own, summary,
    targets: { kcal: settings.calorieTarget, protein: settings.proteinTarget, carbs: settings.carbTarget, fat: settings.fatTarget, fiber: settings.fiberTarget },
    weights, checkIn: checkIns[0] ?? null
  };
}

/** The longest range one history read returns. */
export const HISTORY_MAX_DAYS = 92;

export type HistoryDay = Readonly<{
  day: string;
  status: DayStatus;
  basis: string;
  summary: ReturnType<typeof daySummaries>[number] | null;
  entries: readonly FoodEntry[];
  /** The mean of the day's readings. */
  weightKg: number | null;
  checkIn: CheckIn | null;
}>;

/** Every day from `from` to `to` with its food, completion, weight, and check-in. Days with no record are left out. */
export async function historyRange(scope: BodyshopScope, input: { from?: string; to?: string }, now = new Date()): Promise<{ from: string; to: string; days: HistoryDay[] }> {
  const to = input.to ? parseDay(input.to, "To") : await currentDay(scope, now);
  const from = input.from ? parseDay(input.from, "From") : addDays(to, -13);
  if (from > to) throw new BodyshopError("From must not be after To.");
  if (addDays(from, HISTORY_MAX_DAYS - 1) < to) throw new BodyshopError(`Ask for at most ${HISTORY_MAX_DAYS} days at a time.`);
  const range = { from, to };
  const [checkIns, allocations, weights] = await Promise.all([scope.list("checkin", range), scope.list("allocation", range), scope.list("weight", range)]);
  // A day split from a pooled log needs the food of the day it was split from, which can be before the range.
  const start = [from, ...allocations.map((one) => one.sourceDay)].sort()[0]!;
  const entries = await scope.list("entry", { from: start, to });
  const summaries = new Map(daySummaries(entries, checkIns, allocations).map((one) => [one.day, one]));
  const means = new Map(dailyMeanWeights(weights).map((one) => [one.day, one.kg]));
  const checks = new Map(checkIns.map((one) => [one.day, one]));
  const own = new Map<string, FoodEntry[]>();
  for (const entry of entries) own.set(entry.day, [...(own.get(entry.day) ?? []), entry]);
  const days = [...new Set([...summaries.keys(), ...means.keys(), ...checks.keys()])].filter((day) => day >= from && day <= to).sort();
  return {
    from, to,
    days: days.map((day) => {
      const summary = summaries.get(day) ?? null;
      const checkIn = checks.get(day) ?? null;
      const { status, basis } = summary ?? dayStatus([], checkIn ?? undefined);
      return { day, status, basis, summary, entries: own.get(day) ?? [], weightKg: means.get(day) ?? null, checkIn };
    })
  };
}

/** Every record the model needs, with the day totals. */
export async function history(scope: BodyshopScope, now = new Date()) {
  const [entries, checkIns, allocations, weights, settingRows] = await Promise.all([
    scope.list("entry"), scope.list("checkin"), scope.list("allocation"), scope.list("weight"), scope.list("setting")
  ]);
  const settings = readSettings(settingRows);
  const today = loggingDay(now, settings.dayStartHour);
  const days = daySummaries(entries, checkIns, allocations);
  return { entries, checkIns, allocations, weights, settings, profile: readProfile(settingRows), today, days };
}

/** How many days the insight and step views look back. */
const VIEW_DAYS = 28;

/** The expenditure model, weight projection, weekly review, step energy, and food insights, from all records up to today. */
export async function progress(scope: BodyshopScope, now = new Date()) {
  const data = await history(scope, now);
  const { settings, today } = data;
  const model = runModel({ days: data.days, weights: data.weights, checkIns: data.checkIns, settings, asOf: today });
  const { profile } = data;
  const age = profile.birthday ? ageOn(profile.birthday, today) : null;
  const steps = stepEnergy(model, data.days, data.checkIns, settings, { heightCm: settings.heightCm, strideRatio: settings.strideRatio, walkingCost: settings.walkingCost, age, sex: profile.sex }, VIEW_DAYS);
  return {
    ...data, model, steps,
    projection: projectWeight(model.rows, model.summary, settings),
    energy: energyView(model, settings),
    review: weeklyReview({ days: data.days, weights: dailyMeanWeights(data.weights), steps, summary: model.summary, settings }),
    insights: foodInsights(data.entries, today, VIEW_DAYS),
    uncertain: uncertainFoods(data.entries, addDays(today, -VIEW_DAYS + 1), today).slice(0, 8)
  };
}

/** A short list of saved foods that match a search, best match first. */
export async function searchFoods(scope: BodyshopScope, query: string, limit = 20): Promise<SavedFood[]> {
  const foods = await scope.list("food");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return foods.sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  const score = (food: SavedFood) => {
    const text = `${food.name} ${food.brand} ${food.container}`.toLowerCase();
    if (!words.every((word) => text.includes(word))) return -1;
    return (food.name.toLowerCase().startsWith(words[0]!) ? 2 : 0) + (sameName(food.name, query) ? 4 : 0);
  };
  return foods.map((food) => ({ food, score: score(food) })).filter((one) => one.score >= 0).sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name)).slice(0, limit).map((one) => one.food);
}

export type ImportReceipt = Readonly<{
  digest: string;
  fileName: string;
  importedAt: string;
  sheets: readonly SheetCount[];
  warnings: readonly Note[];
  records: Readonly<Record<BodyshopKind, number>>;
  reconciliation: Reconciliation;
}>;

export type ImportPreview = ImportReceipt & Readonly<{
  errors: readonly Note[];
  /** Records you made in Bodyshop that stay, on days the workbook also covers. */
  overlap: Readonly<{ entries: number; weights: number; days: readonly string[] }>;
  /** Imported records you corrected or removed in Bodyshop. The import replaces them with the workbook's rows. */
  replacedChanges: number;
  /** Changes when an import or an edit of imported records happens. The commit compares it with the preview's mark. */
  changeMark: string;
  previous: Readonly<{ importedAt: string; fileName: string } | null>;
}>;

const MAX_DIFFERENCES = 200;

function prepare(bytes: Uint8Array, fileName: string, now: Date) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const plan = planImport(readWorkbook(bytes, IMPORT_SHEETS));
  const records = plan.records;
  const days = daySummaries(records.entry.map((one) => one.record), records.checkin.map((one) => one.record), records.allocation.map((one) => one.record));
  const settings = readSettings(records.setting.map((one) => one.record));
  const asOf = loggingDay(now, settings.dayStartHour);
  const model = runModel({ days, weights: records.weight.map((one) => one.record), checkIns: records.checkin.map((one) => one.record), settings, asOf });
  const full = reconcile(plan, days, model.rows.map((row) => ({ day: row.day, actual: row.weight.actual, trend: row.weight.trend })));
  const reconciliation = { ...full, differences: full.differences.slice(0, MAX_DIFFERENCES), weightDifferences: full.weightDifferences.slice(0, MAX_DIFFERENCES) };
  const receipt: ImportReceipt = {
    digest, fileName: fileName.slice(0, 200), importedAt: now.toISOString(), sheets: plan.sheets, warnings: plan.warnings,
    records: Object.fromEntries(Object.entries(records).map(([kind, list]) => [kind, list.length])) as Record<BodyshopKind, number>, reconciliation
  };
  return { plan, receipt };
}

/** Reads a workbook and shows what an import would write. It writes nothing. */
export async function previewImport(scope: BodyshopScope, bytes: Uint8Array, fileName: string, now = new Date()): Promise<ImportPreview> {
  const { plan, receipt } = prepare(bytes, fileName, now);
  const covered = new Set(plan.records.entry.map((one) => one.record.day));
  const [imports, entries, weights, changed] = await Promise.all([scope.imports<ImportReceipt>(), scope.native("entry"), scope.native("weight"), scope.changedImports()]);
  const ownEntries = entries.filter((one) => covered.has(one.day));
  const ownWeights = weights.filter((one) => covered.has(one.day));
  const last = imports[0];
  return {
    ...receipt, errors: plan.errors,
    overlap: { entries: ownEntries.length, weights: ownWeights.length, days: [...new Set([...ownEntries, ...ownWeights].map((one) => one.day))].sort() },
    replacedChanges: changed.records,
    changeMark: changeMark(imports, changed),
    previous: last ? { importedAt: last.receipt.importedAt, fileName: last.receipt.fileName } : null
  };
}

/**
 * Imports a workbook. `expectedDigest` must be the digest the preview showed, so the file cannot change
 * between preview and import. The same file again returns the first receipt.
 */
const changeMark = (imports: readonly { id: string }[], changed: { edits: number }) => `${imports[0]?.id ?? "none"}:${changed.edits}`;

/** Imports the file the preview checked. It stops when imported records changed after the preview, so the preview's warning stays true. */
export async function commitImport(scope: BodyshopScope, bytes: Uint8Array, fileName: string, checked: Pick<ImportPreview, "digest" | "changeMark">, now = new Date()): Promise<{ receipt: ImportReceipt; replay: boolean }> {
  const { plan, receipt } = prepare(bytes, fileName, now);
  if (receipt.digest !== checked.digest) throw new BodyshopError("This file is not the file you checked. Check it again before you import it.", "conflict");
  if (plan.errors.length) throw new BodyshopError(`The workbook has ${plan.errors.length} problems. Fix them in the sheet, then check the file again.`);
  return scope.exclusive(async (locked) => {
    const imports = await locked.imports();
    const replay = imports.some((one) => one.digest === receipt.digest);
    if (!replay && changeMark(imports, await locked.changedImports()) !== checked.changeMark) {
      throw new BodyshopError("Imported records changed after you checked the file. Check it again before you import it.", "conflict");
    }
    return locked.commitImport(receipt.digest, receipt, plan.records);
  });
}

export type { DayStatus };

/** Runs one change. The web page and the app send the same changes, so both get the same rules. */
export async function applyAction(scope: BodyshopScope, data: BodyshopAction): Promise<{ id?: string; repeated?: number }> {
  switch (data.type) {
    case "food.log": { const result = await logFood(scope, data); return { id: result.entries[0]?.id, repeated: result.repeated.length }; }
    case "meal.log": { const result = await logMeal(scope, data); return { repeated: result.repeated.length }; }
    case "entry.correct": { const { type: _, id: entryId, ...patch } = data; return { id: (await correctEntry(scope, entryId, patch)).id }; }
    case "remove": await removeRecord(scope, data.kind, data.id); return {};
    case "weight.log": return { id: (await logWeight(scope, data)).id };
    case "day.update": { const { type: _, ...input } = data; return { id: (await updateDay(scope, input)).id }; }
    case "food.save": { const { type: _, ...input } = data; return { id: (await saveFood(scope, input)).id }; }
    case "settings.update": await updateSettings(scope, data.values); return {};
    case "profile.update": await updateProfile(scope, { birthday: data.birthday, sex: data.sex }); return {};
  }
}

/** One day with every saved food and the recurring meals that apply on it, as the Today page shows it. */
export async function dayPanel(scope: BodyshopScope, day?: string) {
  const [view, foods, templates] = await Promise.all([dayView(scope, day), scope.list("food"), scope.list("template")]);
  const names = [...new Set(templates.map((one) => one.template))];
  const meals = await Promise.all(names.map(async (name) => {
    const { parts } = await templateParts(scope, name, view.day);
    return { name, meal: parts[0]?.meal ?? "Other", parts: parts.map((part) => ({ part: part.food, amount: part.amount, unit: part.unit, saved: Boolean(part.saved), variable: part.quantity === "Variable" })) };
  }));
  return {
    ...view,
    foods: foods.map((food) => ({ id: food.id, name: food.name, brand: food.brand, amount: food.amount, unit: food.unit, kcal: food.nutrients.kcal, protein: food.nutrients.protein, container: food.container, fullSize: food.fullSize })).sort((a, b) => a.name.localeCompare(b.name)),
    templates: meals.filter((meal) => meal.parts.length && findTemplate(templates, meal.name))
  };
}
