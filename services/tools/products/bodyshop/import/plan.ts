import { randomUUID } from "node:crypto";
import { type Allocation, type CheckIn, type DaySummary, type FoodEntry, isDayStatus, isMeal, type Nutrients, QUANTITY_TYPES, type QuantityType, type Reference, type SavedFood, type Setting, type TemplateComponent, type WeightReading } from "../domain.js";
import type { BodyshopKinds, ImportRecords } from "../repository.js";
import type { Cell, Sheet } from "./workbook.js";

/** The sheets an import reads. Daily and Model inputs are read only to check the results. */
export const SOURCE_SHEETS = ["Food Log", "Foods", "Meal Templates", "Weight", "Check-ins", "Multi-day allocations", "Settings"] as const;
export const CHECK_SHEETS = ["Daily", "Model inputs"] as const;
export const IMPORT_SHEETS = [...SOURCE_SHEETS, ...CHECK_SHEETS] as const;

export type Note = Readonly<{ source: string; message: string }>;
export type SheetCount = Readonly<{ sheet: string; rows: number; imported: number; skipped: readonly Note[] }>;

/** What the sheet showed for one day, to compare with Bodyshop's own calculation. */
export type SheetDay = Readonly<{ day: string; values: Readonly<Record<DayField, number | string | null>> }>;
export type SheetWeight = Readonly<{ day: string; actual: number | null; trend: number | null }>;

export const DAY_FIELDS = ["kcal", "protein", "carbs", "fat", "fiber", "kcalLow", "kcalHigh", "proteinLow", "proteinHigh", "carbsLow", "carbsHigh", "fatLow", "fatHigh", "fiberLow", "fiberHigh", "status", "check", "entries", "coverage"] as const;
export type DayField = (typeof DAY_FIELDS)[number];

export type ImportPlan = Readonly<{
  records: { [K in keyof BodyshopKinds]: { record: BodyshopKinds[K]; source: string }[] };
  sheets: readonly SheetCount[];
  /** Problems that stop the import. */
  errors: readonly Note[];
  /** Facts worth knowing that do not stop the import. */
  warnings: readonly Note[];
  sheetDays: readonly SheetDay[];
  sheetWeights: readonly SheetWeight[];
}>;

const EPOCH = Date.UTC(1899, 11, 30);

function headers(sheet: Sheet): Map<string, string> {
  return new Map([...(sheet.rows.get(1) ?? new Map<string, Cell>())].map(([column, cell]) => [cell.value.trim(), column]));
}

class Rows {
  readonly columns: Map<string, string>;
  constructor(readonly sheet: Sheet, required: readonly string[], private readonly errors: Note[]) {
    this.columns = headers(sheet);
    for (const name of required) if (!this.columns.has(name)) errors.push({ source: `${sheet.name}!1`, message: `The column "${name}" is missing.` });
  }
  cell(row: number, header: string): Cell | undefined {
    const column = this.columns.get(header);
    return column ? this.sheet.rows.get(row)?.get(column) : undefined;
  }
  text(row: number, header: string): string { return this.cell(row, header)?.value.trim() ?? ""; }
  number(row: number, header: string): number | null { return toNumber(this.cell(row, header)); }
  percent(row: number, header: string): number | null { return toPercent(this.cell(row, header)); }
  day(row: number, header: string): string | null { return toDay(this.cell(row, header)); }
  /** Comments on the row's cells, with their column name, for the record's notes. */
  comments(row: number): string {
    const names = new Map([...this.columns].map(([name, column]) => [column, name]));
    return [...this.sheet.comments].filter(([ref]) => Number(/\d+/.exec(ref)?.[0]) === row)
      .map(([ref, text]) => `Comment on ${names.get(/^[A-Z]+/.exec(ref)?.[0] ?? "") ?? ref}: ${text}`).join("\n");
  }
  dataRows(): number[] { return [...this.sheet.rows.keys()].filter((row) => row > 1).sort((a, b) => a - b); }
  source(row: number): string { return `${this.sheet.name}!${row}`; }
}

function toNumber(cell: Cell | undefined): number | null {
  if (!cell || cell.value.trim() === "" || cell.type === "s" && !/^-?\d+(\.\d+)?$/.test(cell.value.trim())) return null;
  const value = Number(cell.value);
  return Number.isFinite(value) ? value : null;
}

function toPercent(cell: Cell | undefined): number | null {
  const text = cell?.value.trim() ?? "";
  const match = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(text);
  return match ? Number(match[1]) / 100 : toNumber(cell);
}

function toDay(cell: Cell | undefined): string | null {
  const text = cell?.value.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const serial = toNumber(cell);
  if (serial === null || serial < 1 || serial > 100_000) return null;
  return new Date(EPOCH + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

function toTime(cell: Cell | undefined): string | null {
  const text = cell?.value.trim() ?? "";
  if (/^\d{1,2}:\d{2}/.test(text)) return text.slice(0, 5).padStart(5, "0");
  const fraction = toNumber(cell);
  if (fraction === null) return null;
  const minutes = Math.round((fraction % 1) * 1440);
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

const joinNotes = (...parts: string[]) => parts.filter(Boolean).join("\n");

/** Turns the source sheets into Bodyshop records. Every row is imported, skipped with a reason, or reported as an error. */
export function planImport(sheets: ReadonlyMap<string, Sheet>): ImportPlan {
  const errors: Note[] = [];
  const warnings: Note[] = [];
  const counts: SheetCount[] = [];
  const records: ImportPlan["records"] = { food: [], entry: [], template: [], weight: [], checkin: [], allocation: [], setting: [] };
  for (const name of SOURCE_SHEETS) if (!sheets.has(name)) errors.push({ source: name, message: `The sheet "${name}" is missing.` });

  function each(name: string, required: readonly string[], keep: (rows: Rows, row: number) => boolean, read: (rows: Rows, row: number, skip: (reason: string) => void) => void) {
    const sheet = sheets.get(name);
    if (!sheet) return;
    const rows = new Rows(sheet, required, errors);
    const skipped: Note[] = [];
    let imported = 0;
    let total = 0;
    for (const row of rows.dataRows()) {
      if (!keep(rows, row)) continue;
      total += 1;
      let reason: string | undefined;
      read(rows, row, (why) => { reason = why; });
      if (reason) skipped.push({ source: rows.source(row), message: reason }); else imported += 1;
    }
    counts.push({ sheet: name, rows: total, imported, skipped });
  }

  const nutrientsAt = (rows: Rows, row: number, names: readonly [string, string, string, string, string]): Nutrients => ({
    kcal: rows.number(row, names[0]), protein: rows.number(row, names[1]), carbs: rows.number(row, names[2]), fat: rows.number(row, names[3]), fiber: rows.number(row, names[4])
  });

  const LOG = ["Date", "Time", "Meal", "Food", "Amount", "Unit", "Calories", "Source", "Notes", "Range ±", "Fiber range ±", "Ref amount", "Ref unit", "Ref kcal", "Ref protein", "Ref carbs", "Ref fat", "Ref fiber", "Ref nutrition ±", "Ref fiber ±", "Ref food", "Reference notes"] as const;
  each("Food Log", LOG, (rows, row) => ["Date", "Meal", "Food", "Amount", "Unit", "Source", "Notes"].some((header) => rows.text(row, header) !== ""), (rows, row, skip) => {
    const source = rows.source(row);
    const day = rows.day(row, "Date");
    const food = rows.text(row, "Food");
    const meal = rows.text(row, "Meal");
    if (!food) return skip("The row has no food name.");
    if (!day) { errors.push({ source, message: "The date is not a date." }); return skip("The date is not a date."); }
    if (!isMeal(meal)) { errors.push({ source, message: `The meal "${meal}" is not Breakfast, Lunch, Dinner, Snack, or Other.` }); return skip("Unknown meal."); }
    const amount = rows.number(row, "Amount");
    const unit = rows.text(row, "Unit");
    const typed = rows.cell(row, "Calories") && !rows.cell(row, "Calories")!.formula;
    let reference: Reference | null = null;
    if (typed) {
      // A few rows hold typed totals in place of the formulas. Their snapshot is the typed total for the logged amount.
      if (amount !== null && amount > 0) {
        reference = { food, amount, unit, nutrients: nutrientsAt(rows, row, ["Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Fiber (g)"]), range: rows.percent(row, "Range ±"), fiberRange: rows.percent(row, "Fiber range ±"), notes: rows.text(row, "Reference notes") };
      }
      warnings.push({ source, message: "Typed nutrition values in place of the formulas. They are kept as this entry's snapshot." });
    } else if (rows.text(row, "Ref food")) {
      const refAmount = rows.number(row, "Ref amount");
      reference = {
        food: rows.text(row, "Ref food"),
        amount: refAmount ?? 0,
        unit: rows.text(row, "Ref unit"),
        nutrients: nutrientsAt(rows, row, ["Ref kcal", "Ref protein", "Ref carbs", "Ref fat", "Ref fiber"]),
        range: rows.percent(row, "Ref nutrition ±"),
        fiberRange: rows.percent(row, "Ref fiber ±"),
        notes: rows.text(row, "Reference notes")
      };
    }
    const entry: FoodEntry = {
      id: randomUUID(), day, time: toTime(rows.cell(row, "Time")), meal, food, amount, unit,
      source: rows.text(row, "Source"), notes: joinNotes(rows.text(row, "Notes"), rows.comments(row)), reference,
      // The ranges as the sheet showed them when exported. A blank snapshot range fell back to the saved food's range then.
      range: rows.percent(row, "Range ±"), fiberRange: rows.percent(row, "Fiber range ±"),
      createdAt: `${day}T12:00:00.000Z`, updatedAt: `${day}T12:00:00.000Z`
    };
    records.entry.push({ record: entry, source });
  });

  const FOODS = ["Food / alias", "Brand / description", "Reference amount", "Unit", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Fiber (g)", "Notes", "Full size amount", "Full size unit", "Container / shorthand", "Full size notes", "Nutrition source", "Source reference", "Verified / observed date", "Confidence", "Nutrition estimate ±", "Fiber estimate ±", "Fiber source / estimate notes"] as const;
  each("Foods", FOODS, (rows, row) => rows.text(row, "Food / alias") !== "", (rows, row, skip) => {
    const amount = rows.number(row, "Reference amount");
    if (amount === null || amount <= 0) { warnings.push({ source: rows.source(row), message: "The reference amount is missing. The food is kept, but it cannot scale to an amount." }); }
    const fullAmount = rows.number(row, "Full size amount");
    const verifiedText = rows.text(row, "Verified / observed date");
    const verified = rows.day(row, "Verified / observed date");
    if (verifiedText && !verified) warnings.push({ source: rows.source(row), message: `The verified date "${verifiedText}" is not a date and was left out.` });
    const food: SavedFood = {
      id: randomUUID(), name: rows.text(row, "Food / alias"), brand: rows.text(row, "Brand / description"), amount: amount ?? 0, unit: rows.text(row, "Unit"),
      nutrients: nutrientsAt(rows, row, ["Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Fiber (g)"]),
      notes: joinNotes(rows.text(row, "Notes"), rows.comments(row)),
      fullSize: fullAmount !== null && fullAmount > 0 ? { amount: fullAmount, unit: rows.text(row, "Full size unit") || rows.text(row, "Unit") } : null,
      container: rows.text(row, "Container / shorthand"), fullSizeNotes: rows.text(row, "Full size notes"), source: rows.text(row, "Nutrition source"),
      sourceReference: rows.text(row, "Source reference"), verified, confidence: rows.text(row, "Confidence"),
      range: rows.percent(row, "Nutrition estimate ±"), fiberRange: rows.percent(row, "Fiber estimate ±"), fiberNotes: rows.text(row, "Fiber source / estimate notes")
    };
    if (!food.name) return skip("No name.");
    records.food.push({ record: food, source: rows.source(row) });
  });

  each("Meal Templates", ["Template", "Aliases", "Component order", "Food / alias", "Default amount", "Unit", "Quantity type", "Meal", "Effective from", "Notes"], (rows, row) => rows.text(row, "Template") !== "", (rows, row, skip) => {
    const source = rows.source(row);
    const effectiveFrom = rows.day(row, "Effective from");
    const meal = rows.text(row, "Meal");
    const quantity = rows.text(row, "Quantity type");
    if (!effectiveFrom) { errors.push({ source, message: "The effective date is not a date." }); return skip("No effective date."); }
    if (!isMeal(meal)) { errors.push({ source, message: `The meal "${meal}" is not known.` }); return skip("Unknown meal."); }
    const component: TemplateComponent = {
      id: randomUUID(), template: rows.text(row, "Template"), aliases: rows.text(row, "Aliases").split(",").map((one) => one.trim()).filter(Boolean),
      order: rows.number(row, "Component order") ?? row, food: rows.text(row, "Food / alias"), amount: rows.number(row, "Default amount") ?? 0, unit: rows.text(row, "Unit"),
      quantity: (QUANTITY_TYPES.includes(quantity as QuantityType) ? quantity : "Fixed") as QuantityType, meal, effectiveFrom, notes: joinNotes(rows.text(row, "Notes"), rows.comments(row))
    };
    records.template.push({ record: component, source });
  });

  each("Weight", ["Date", "Weight (kg)", "Notes", "Weight source"], (rows, row) => rows.text(row, "Date") !== "" || rows.text(row, "Weight (kg)") !== "", (rows, row, skip) => {
    const day = rows.day(row, "Date");
    const kg = rows.number(row, "Weight (kg)");
    if (!day || kg === null || kg <= 0) { errors.push({ source: rows.source(row), message: "The weight row needs a date and a weight." }); return skip("No date or weight."); }
    const reading: WeightReading = { id: randomUUID(), day, kg, time: null, notes: joinNotes(rows.text(row, "Notes"), rows.comments(row)), source: rows.text(row, "Weight source") };
    records.weight.push({ record: reading, source: rows.source(row) });
  });

  const CHECKS = ["Date", "Reported status (history)", "Training", "Training notes", "Steps", "Activity notes", "Hunger (1-5)", "Fatigue (1-5)", "Recovery (1-5)", "Sleep (h)", "Notes", "Completion basis", "Completion override"] as const;
  each("Check-ins", CHECKS, (rows, row) => rows.text(row, "Date") !== "", (rows, row, skip) => {
    const day = rows.day(row, "Date");
    if (!day) { errors.push({ source: rows.source(row), message: "The date is not a date." }); return skip("No date."); }
    const reported = rows.text(row, "Reported status (history)");
    const override = rows.text(row, "Completion override");
    if (reported && !isDayStatus(reported)) warnings.push({ source: rows.source(row), message: `The reported status "${reported}" is not Complete, Partial, or Unknown. It is kept in the notes.` });
    if (override && override !== "Auto" && !isDayStatus(override)) warnings.push({ source: rows.source(row), message: `The override "${override}" is not known. It is kept in the notes.` });
    const checkIn: CheckIn = {
      id: randomUUID(), day, reported: isDayStatus(reported) ? reported : null, training: rows.text(row, "Training"), trainingNotes: rows.text(row, "Training notes"),
      steps: rows.number(row, "Steps"), activityNotes: rows.text(row, "Activity notes"), hunger: rows.number(row, "Hunger (1-5)"), fatigue: rows.number(row, "Fatigue (1-5)"),
      recovery: rows.number(row, "Recovery (1-5)"), sleep: rows.number(row, "Sleep (h)"),
      notes: joinNotes(rows.text(row, "Notes"), rows.comments(row), reported && !isDayStatus(reported) ? `Reported status in the sheet: ${reported}` : "", override && override !== "Auto" && !isDayStatus(override) ? `Override in the sheet: ${override}` : ""),
      basis: rows.text(row, "Completion basis"), override: isDayStatus(override) ? override : null
    };
    records.checkin.push({ record: checkIn, source: rows.source(row) });
  });

  each("Multi-day allocations", ["Allocation date", "Food-source date", "Allocation fraction", "Reporting basis"], (rows, row) => rows.text(row, "Allocation date") !== "", (rows, row, skip) => {
    const day = rows.day(row, "Allocation date");
    const sourceDay = rows.day(row, "Food-source date");
    const fraction = rows.percent(row, "Allocation fraction");
    if (!day || !sourceDay || fraction === null || fraction < 0) { errors.push({ source: rows.source(row), message: "The allocation needs two dates and a fraction." }); return skip("Incomplete allocation."); }
    const allocation: Allocation = { id: randomUUID(), day, sourceDay, fraction, basis: rows.text(row, "Reporting basis") };
    records.allocation.push({ record: allocation, source: rows.source(row) });
  });

  each("Settings", ["Setting", "Value", "Unit", "Notes"], (rows, row) => rows.text(row, "Setting") !== "", (rows, row) => {
    const cell = rows.cell(row, "Value");
    const number = toNumber(cell);
    const setting: Setting = {
      id: randomUUID(), label: rows.text(row, "Setting"), value: number ?? (cell?.value.trim() || null), unit: rows.text(row, "Unit"),
      notes: joinNotes(rows.text(row, "Notes"), rows.comments(row)), order: row
    };
    records.setting.push({ record: setting, source: rows.source(row) });
  });

  return { records, sheets: counts, errors, warnings, sheetDays: readDaily(sheets.get("Daily")), sheetWeights: readTrend(sheets.get("Model inputs")) };
}

const DAILY_HEADERS: Readonly<Record<DayField, string>> = {
  kcal: "Calories", protein: "Protein (g)", carbs: "Carbs (g)", fat: "Fat (g)", fiber: "Fiber (g)", kcalLow: "Calories low", kcalHigh: "Calories high",
  proteinLow: "Protein low (g)", proteinHigh: "Protein high (g)", carbsLow: "Carbs low (g)", carbsHigh: "Carbs high (g)", fatLow: "Fat low (g)", fatHigh: "Fat high (g)",
  fiberLow: "Fiber low (g)", fiberHigh: "Fiber high (g)", status: "Log status", check: "Data check", entries: "Source food entries", coverage: "Range coverage"
};

function readDaily(sheet: Sheet | undefined): SheetDay[] {
  if (!sheet) return [];
  const rows = new Rows(sheet, [], []);
  return rows.dataRows().flatMap((row) => {
    const day = rows.day(row, "Date");
    if (!day) return [];
    const values = Object.fromEntries(Object.entries(DAILY_HEADERS).map(([field, header]) => {
      const text = rows.text(row, header);
      return [field, field === "status" || field === "check" ? text || null : rows.number(row, header)];
    })) as Record<DayField, number | string | null>;
    return [{ day, values }];
  });
}

function readTrend(sheet: Sheet | undefined): SheetWeight[] {
  if (!sheet) return [];
  const rows = new Rows(sheet, [], []);
  return rows.dataRows().flatMap((row) => {
    const day = rows.day(row, "Date");
    const actual = rows.number(row, "Actual daily-mean weight");
    const trend = rows.number(row, "Display EWMA trend");
    return day && (actual !== null || trend !== null) ? [{ day, actual, trend }] : [];
  });
}

export type Difference = Readonly<{ day: string; field: string; sheet: number | string | null; bodyshop: number | string | null }>;
export type Reconciliation = Readonly<{
  days: number;
  matchingDays: number;
  differences: readonly Difference[];
  weights: number;
  matchingWeights: number;
  weightDifferences: readonly Difference[];
}>;

function bodyshopValue(summary: DaySummary, field: DayField): number | string | null {
  switch (field) {
    case "kcalLow": return summary.low.kcal;
    case "kcalHigh": return summary.high.kcal;
    case "proteinLow": return summary.low.protein;
    case "proteinHigh": return summary.high.protein;
    case "carbsLow": return summary.low.carbs;
    case "carbsHigh": return summary.high.carbs;
    case "fatLow": return summary.low.fat;
    case "fatHigh": return summary.high.fat;
    case "fiberLow": return summary.low.fiber;
    case "fiberHigh": return summary.high.fiber;
    default: return summary[field];
  }
}

const close = (a: number | string | null, b: number | string | null, tolerance: number) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= tolerance : (a ?? null) === (b ?? null) || (a === null && b === 0) || (a === 0 && b === null);

/**
 * Compares Bodyshop's day totals and weight trend with what the sheet showed. Each difference names the
 * day and the field. Tolerances: 0.01 for nutrients and counts, 0.001 kg for weights.
 */
export function reconcile(plan: Pick<ImportPlan, "sheetDays" | "sheetWeights">, summaries: readonly DaySummary[], weights: readonly { day: string; actual: number | null; trend: number | null }[]): Reconciliation {
  const ours = new Map(summaries.map((summary) => [summary.day, summary]));
  const differences: Difference[] = [];
  let matchingDays = 0;
  for (const { day, values } of plan.sheetDays) {
    const summary = ours.get(day);
    const before = differences.length;
    if (!summary) differences.push({ day, field: "day", sheet: "present", bodyshop: null });
    else for (const field of DAY_FIELDS) {
      if (!close(values[field], bodyshopValue(summary, field), 0.01)) differences.push({ day, field, sheet: values[field], bodyshop: bodyshopValue(summary, field) });
    }
    if (differences.length === before) matchingDays += 1;
  }
  const sheetDays = new Set(plan.sheetDays.map((one) => one.day));
  for (const summary of summaries) if (!sheetDays.has(summary.day)) differences.push({ day: summary.day, field: "day", sheet: null, bodyshop: "present" });

  const trend = new Map(weights.map((one) => [one.day, one]));
  const weightDifferences: Difference[] = [];
  let matchingWeights = 0;
  for (const row of plan.sheetWeights) {
    const mine = trend.get(row.day);
    const before = weightDifferences.length;
    for (const field of ["actual", "trend"] as const) {
      if (!close(row[field], mine?.[field] ?? null, 0.001)) weightDifferences.push({ day: row.day, field: field === "actual" ? "daily-mean weight" : "trend weight", sheet: row[field], bodyshop: mine?.[field] ?? null });
    }
    if (weightDifferences.length === before) matchingWeights += 1;
  }
  return { days: plan.sheetDays.length, matchingDays, differences, weights: plan.sheetWeights.length, matchingWeights, weightDifferences };
}

export type { ImportRecords };
