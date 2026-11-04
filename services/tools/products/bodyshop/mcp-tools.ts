import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlatformPrincipal } from "#security";
import { BodyshopError, DAY_STATUSES, type FoodEntry, MEALS, type Nutrients } from "./domain.js";
import { entryCheck, entryNutrients } from "./model/day.js";
import type { BodyshopStore } from "./repository.js";
import {
  correctEntry, dayView, logFood, logMeal, logWeight, progress, readBodyshopSettings, removeRecord, saveFood, searchFoods, templateParts, updateDay, updateProfile, updateSettings
} from "./service.js";
import { SETTING_LABELS, SEXES, type SettingKey } from "./settings.js";

const LOGGING_RULES = [
  "Log what was eaten, not what was planned.",
  "Search saved foods first and log them by name, so the entry keeps their checked nutrition.",
  "Log a food that is not saved with `nutrients` for the logged amount and a `range` such as 0.25 for a rough estimate. Save foods that will come back.",
  "Use the food's container word as the unit for full packages, such as 1 pack of butter.",
  "Leave `day` out for the current day. Food before 04:00 Vienna time belongs to the day before.",
  "A repeated call within ten minutes returns the first entry. Set `repeat` only when the person ate the same food twice.",
  "Correct a wrong entry with bodyshop_entry_correct. Do not log a second entry to fix the first one.",
  "Mark the day Complete with bodyshop_day_update only when the person says every meal is logged."
].join(" ");

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD. Leave out for the current logging day.");
const time = z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().describe("HH:MM, local time. Optional.");
const share = (what: string) => z.number().min(0).max(5).nullable().optional().describe(`${what} as a share, such as 0.15 for ±15 %.`);
const nutrients = z.object({
  kcal: z.number().min(0), protein: z.number().min(0).nullable().optional(), carbs: z.number().min(0).nullable().optional(),
  fat: z.number().min(0).nullable().optional(), fiber: z.number().min(0).nullable().optional()
});
const item = z.object({
  food: z.string().min(1).describe("Saved food name or id, or a free name together with nutrients."),
  meal: z.enum(MEALS),
  amount: z.number().positive().nullable().optional().describe("In the saved food's unit. For full packages, the number of packages."),
  unit: z.string().nullable().optional().describe("Leave out for the saved food's unit. Use the container word for full packages."),
  nutrients: nutrients.nullable().optional().describe("Only for a food that is not saved: the values for the logged amount."),
  range: share("The nutrition range"),
  fiberRange: share("The fiber range"),
  source: z.enum(["Estimated", "Label"]).nullable().optional().describe("For unsaved foods: Label when read from a package, else Estimated."),
  notes: z.string().max(2000).nullable().optional()
});

const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
const roundAll = (values: Nutrients) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, round(value)]));

function brief(entry: FoodEntry) {
  const values = entryNutrients(entry);
  return { id: entry.id, day: entry.day, time: entry.time, meal: entry.meal, food: entry.food, amount: entry.amount, unit: entry.unit, ...roundAll(values), check: entryCheck(entry, values), notes: entry.notes || undefined };
}

/** Bodyshop tools read and write only the signed-in person's own records. The admin role opens no one else's data. */
export function registerBodyshopTools(server: McpServer, store: BodyshopStore, principal: PlatformPrincipal) {
  const scope = () => store.owner(principal.subject);

  // The SDK infers callback types per call. One loose signature keeps each tool's own zod type below.
  const register = server.registerTool.bind(server) as unknown as (name: string, config: object, callback: (input: never) => Promise<object>) => void;
  const tool = <Shape extends z.ZodRawShape>(name: string, description: string, shape: Shape, run: (input: z.infer<z.ZodObject<Shape>>) => Promise<unknown>, readOnly = false) => {
    register(name, { description, inputSchema: shape, annotations: { readOnlyHint: readOnly } }, async (input: z.infer<z.ZodObject<Shape>>) => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(await run(input) ?? { ok: true }) }] };
      } catch (error) {
        if (error instanceof BodyshopError) return { isError: true, content: [{ type: "text" as const, text: error.message }] };
        throw error;
      }
    });
  };

  tool("bodyshop_today", `Shows one day of your food log with totals, ranges, targets, weight, and check-in. Read this before you log. Logging rules: ${LOGGING_RULES}`, { day }, async (input) => {
    const view = await dayView(scope(), input.day);
    const summary = view.summary;
    return {
      day: view.day, currentDay: view.today, targets: view.targets,
      totals: summary ? { kcal: round(summary.kcal), protein: round(summary.protein), carbs: round(summary.carbs), fat: round(summary.fat), fiber: round(summary.fiber), low: roundAll(summary.low), high: roundAll(summary.high), check: summary.check, status: summary.status, basis: summary.basis } : null,
      remaining: summary ? { kcal: round(view.targets.kcal - summary.kcal), protein: round(view.targets.protein - summary.protein) } : view.targets,
      entries: view.entries.map(brief), weights: view.weights.map((one) => ({ id: one.id, kg: one.kg, time: one.time })), checkIn: view.checkIn
    };
  }, true);

  tool("bodyshop_food_search", "Searches your saved foods. Returns each food's reference amount and nutrition, its container word, and its full size.", {
    query: z.string().describe("Words of the name or brand. Empty lists the first foods by name."), limit: z.number().int().min(1).max(50).optional()
  }, async ({ query, limit }) => (await searchFoods(scope(), query, limit)).map((food) => ({
    id: food.id, name: food.name, brand: food.brand || undefined, per: `${food.amount} ${food.unit}`, ...food.nutrients, range: food.range, fiberRange: food.fiberRange,
    container: food.container || undefined, fullSize: food.fullSize ? `${food.fullSize.amount} ${food.fullSize.unit}` : undefined, notes: food.notes || undefined
  })), true);

  tool("bodyshop_food_log", `Logs one or more foods in one step. ${LOGGING_RULES}`, {
    items: z.array(item).min(1).max(30), day, time, repeat: z.boolean().optional().describe("Log again although the same entry exists from the last ten minutes.")
  }, async (input) => {
    const result = await logFood(scope(), input);
    return { entries: result.entries.map(brief), alreadyLogged: result.repeated.length ? result.repeated : undefined };
  });

  tool("bodyshop_meal_templates", "Shows a meal template's parts on a day, with the saved food each part uses. Parts without a saved food need a choice when you log the meal.", {
    template: z.string().describe("Template name or alias, such as \"usual dinner\"."), day
  }, async (input) => {
    const view = await dayView(scope(), input.day);
    const { template, parts } = await templateParts(scope(), input.template, view.day);
    return { template, day: view.day, parts: parts.map((part) => ({ part: part.food, amount: part.amount, unit: part.unit, quantity: part.quantity, meal: part.meal, saved: Boolean(part.saved) })) };
  }, true);

  tool("bodyshop_meal_log", `Logs a meal template, such as "normal breakfast". Use choices for variable parts and changed amounts, and skip for parts not eaten. ${LOGGING_RULES}`, {
    template: z.string(), day, time, meal: z.enum(MEALS).optional().describe("Only when the meal differs from the template's meal."),
    choices: z.array(z.object({ part: z.string(), food: z.string().optional(), amount: z.number().positive().optional(), unit: z.string().optional() })).optional(),
    skip: z.array(z.string()).optional().describe("Part names that were not eaten."), repeat: z.boolean().optional()
  }, async (input) => {
    const result = await logMeal(scope(), input);
    return { template: result.template, entries: result.entries.map(brief), alreadyLogged: result.repeated.length ? result.repeated : undefined };
  });

  tool("bodyshop_entry_correct", "Corrects or removes one food entry. A new food takes that saved food's nutrition; a new amount scales the entry's own nutrition. The history keeps every earlier version.", {
    id: z.string(), remove: z.boolean().optional(), day: day, time, meal: z.enum(MEALS).optional(), food: z.string().optional(),
    amount: z.number().positive().optional(), unit: z.string().optional(), nutrients: nutrients.optional().describe("New values for the logged amount. Makes the entry an estimate."),
    range: share("The nutrition range"), fiberRange: share("The fiber range"), notes: z.string().max(2000).optional()
  }, async ({ id, remove, ...patch }) => {
    if (remove) { await removeRecord(scope(), "entry", id); return { removed: id }; }
    return brief(await correctEntry(scope(), id, patch));
  });

  tool("bodyshop_food_save", "Saves a food with its nutrition per reference amount, or changes the saved food with the same name or id. Fields you leave out keep their value. Entries logged earlier keep their own nutrition.", {
    id: z.string().optional(), name: z.string().min(1), brand: z.string().optional(),
    amount: z.number().positive().optional().describe("Reference amount, such as 100."), unit: z.string().optional().describe("Reference unit, such as g, ml, or piece."),
    nutrients: nutrients.partial().optional().describe("Values per reference amount."), range: share("The nutrition range"), fiberRange: share("The fiber range"),
    fullSize: z.object({ amount: z.number().positive(), unit: z.string() }).nullable().optional().describe("One full package, in the reference unit."),
    container: z.string().optional().describe("The package word, such as pack, tub, or jar."), source: z.string().optional().describe("Where the values come from, such as Label."),
    notes: z.string().max(2000).optional()
  }, async (input) => saveFood(scope(), input));

  tool("bodyshop_weight_log", "Logs a body weight. Several readings on one day count as their mean.", {
    kg: z.number(), day, time, notes: z.string().max(2000).optional(), source: z.string().optional().describe("Default: Reported.")
  }, async (input) => logWeight(scope(), input));

  tool("bodyshop_day_update", "Records the check-in of a day: whether the food log is complete, training, steps, hunger, fatigue, recovery, sleep, and notes. Fields you leave out keep their value.", {
    day, reported: z.enum(DAY_STATUSES).nullable().optional().describe("Complete only when the person says all food is logged."),
    override: z.enum(DAY_STATUSES).nullable().optional().describe("Overrides the automatic completion. Null returns to automatic."),
    training: z.string().optional(), trainingNotes: z.string().optional(), steps: z.number().int().min(0).nullable().optional(), activityNotes: z.string().optional(),
    hunger: z.number().int().min(1).max(5).nullable().optional(), fatigue: z.number().int().min(1).max(5).nullable().optional(),
    recovery: z.number().int().min(1).max(5).nullable().optional(), sleep: z.number().min(0).max(24).nullable().optional(), notes: z.string().max(4000).optional()
  }, async (input) => updateDay(scope(), input));

  tool("bodyshop_progress", "Shows the weight trend and projection, the expenditure model, the energy balance, this week, and the last six weeks. Ranges are scenarios, not confidence intervals.", {}, async () => {
    const result = await progress(scope());
    const recent = result.model.rows.slice(-14).map((row) => ({
      day: row.day, kcal: round(row.intake.kcal), status: row.intake.status, weight: row.weight.actual, trend: row.weight.trend === null ? null : Math.round(row.weight.trend * 100) / 100
    }));
    const { path: _, ...projection } = result.projection;
    return {
      summary: result.model.summary, projection, energy: { headline: result.energy.headline, decision: result.energy.decision },
      thisWeek: { days: result.review.week, completeDays: result.review.completeDays, kcal: result.review.kcal, protein: result.review.protein, net: result.review.weekNet },
      weeks: result.review.weeks.slice(0, 6), recent
    };
  }, true);

  tool("bodyshop_settings", "Shows your targets, model settings, birthday, and sex. Give values to change them. The birthday and sex are for the resting energy estimate.", {
    values: z.record(z.string(), z.number()).optional().describe(`Keys: ${Object.keys(SETTING_LABELS).join(", ")}.`),
    birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe("YYYY-MM-DD. Null clears it."),
    sex: z.enum(SEXES).nullable().optional().describe("For the resting energy equation. Null clears it.")
  }, async ({ values, birthday, sex }) => {
    const mine = scope();
    if (birthday !== undefined || sex !== undefined) await updateProfile(mine, { birthday, sex });
    const settings = values && Object.keys(values).length ? await updateSettings(mine, values as Partial<Record<SettingKey, number>>) : (await readBodyshopSettings(mine)).settings;
    return { ...settings, ...(await readBodyshopSettings(mine)).profile };
  });
}
