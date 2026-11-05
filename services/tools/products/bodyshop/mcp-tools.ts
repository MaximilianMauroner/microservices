import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlatformPrincipal } from "#security";
import { type McpEffect, mcpAnnotations } from "../../platform/access/mcp.js";
import { addDays, BodyshopError, DAY_STATUSES, daysBetween, type FoodEntry, MEALS, type Nutrients } from "./domain.js";
import { entryCheck, entryNutrients } from "./model/day.js";
import type { BodyshopStore } from "./repository.js";
import {
  correctEntry, dayView, HISTORY_MAX_DAYS, historyRange, logFood, logMeal, logWeight, progress, readBodyshopSettings, removeRecord, saveFood, searchFoods, templateParts, updateDay, updateProfile, updateSettings
} from "./service.js";
import { SETTING_LABELS, SEXES, type SettingKey } from "./settings.js";

const LOGGING_RULES = [
  "Log what was eaten, not what was planned.",
  "Search saved foods first and log them by name, so the entry keeps their checked nutrition.",
  "Log a food that is not saved with `nutrients` for the logged amount and a `range` such as 0.25 for a rough estimate. Save foods that will come back.",
  "Use the food's container word as the unit for full packages, such as 1 pack of butter.",
  "Leave `day` out for the current day. Food before 04:00 Vienna time belongs to the day before.",
  "A repeated call within ten minutes returns the first entry. Set `repeat` only when the person ate the same food twice.",
  "Fix a wrong entry with bodyshop_entry_correct or bodyshop_entry_remove. Do not log a second entry to fix the first one.",
  "Mark the day Complete with bodyshop_day_update only when the person says every meal is logged."
].join(" ");

/** With every food entry, a long range would pass the client's tool output limit. */
const HISTORY_ENTRY_DAYS = 14;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD. Leave out for the current logging day.");
const time = z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().describe("HH:MM, local time. Optional.");
const share = (what: string) => z.number().min(0).max(5).nullable().optional().describe(`${what} as a share, such as 0.15 for ±15 %.`);
const nutrients = z.object({
  kcal: z.number().min(0), protein: z.number().min(0).nullable().optional(), carbs: z.number().min(0).nullable().optional(),
  fat: z.number().min(0).nullable().optional(), fiber: z.number().min(0).nullable().optional()
});
const item = z.object({
  food: z.string().min(1).describe("Saved food name or foodId, or a free name together with nutrients."),
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
/** Leaves out an empty value, so a long result carries only what was recorded. */
const known = <T>(value: T | null | "") => (value === null || value === "" ? undefined : value);

function brief(entry: FoodEntry) {
  const values = entryNutrients(entry);
  return { entryId: entry.id, day: entry.day, time: entry.time, meal: entry.meal, food: entry.food, amount: entry.amount, unit: entry.unit, ...roundAll(values), check: entryCheck(entry, values), notes: entry.notes || undefined };
}

/** Bodyshop tools read and write only the signed-in person's own records. The admin role opens no one else's data. */
export function registerBodyshopTools(server: McpServer, store: BodyshopStore, principal: PlatformPrincipal) {
  const scope = () => store.owner(principal.subject);

  // The SDK infers callback types per call. One loose signature keeps each tool's own zod type below.
  const register = server.registerTool.bind(server) as unknown as (name: string, config: object, callback: (input: never) => Promise<object>) => void;
  const tool = <Shape extends z.ZodRawShape>(name: string, title: string, effect: McpEffect, description: string, shape: Shape, run: (input: z.infer<z.ZodObject<Shape>>) => Promise<unknown>) => {
    register(name, { title, description, inputSchema: shape, annotations: { title, ...mcpAnnotations[effect] } }, async (input: z.infer<z.ZodObject<Shape>>) => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(await run(input) ?? { ok: true }) }] };
      } catch (error) {
        if (error instanceof BodyshopError) return { isError: true, content: [{ type: "text" as const, text: error.message }] };
        throw error;
      }
    });
  };

  tool("bodyshop_today", "Food log of a day", "read", "Use this to see what is logged on one day and what is left of the targets: entries with entryId, totals and ranges, targets, weight readings, and the check-in. Read it before you log or correct food.", { day }, async (input) => {
    const view = await dayView(scope(), input.day);
    const summary = view.summary;
    return {
      day: view.day, currentDay: view.today, targets: view.targets,
      totals: summary ? { kcal: round(summary.kcal), protein: round(summary.protein), carbs: round(summary.carbs), fat: round(summary.fat), fiber: round(summary.fiber), low: roundAll(summary.low), high: roundAll(summary.high), check: summary.check, status: summary.status, basis: summary.basis } : null,
      remaining: summary ? { kcal: round(view.targets.kcal - summary.kcal), protein: round(view.targets.protein - summary.protein) } : view.targets,
      entries: view.entries.map(brief), weights: view.weights.map((one) => ({ kg: one.kg, time: one.time })), checkIn: view.checkIn
    };
  });

  tool("bodyshop_history", "History of days", "read", `Use this to review or analyze a period: each day's food totals and completion, mean weight, steps, training, hunger, fatigue, recovery, sleep, and notes. Days with no record are left out. Ask for at most ${HISTORY_MAX_DAYS} days, or ${HISTORY_ENTRY_DAYS} days with entries. For the weight trend and expenditure model, use bodyshop_progress.`, {
    from: day.describe("YYYY-MM-DD. Default: 13 days before `to`."), to: day.describe("YYYY-MM-DD. Default: the current logging day."),
    entries: z.boolean().optional().describe(`Also list each food that was logged. Only for ranges of up to ${HISTORY_ENTRY_DAYS} days.`)
  }, async (input) => {
    const result = await historyRange(scope(), input);
    if (input.entries && daysBetween(result.from, result.to) >= HISTORY_ENTRY_DAYS) {
      throw new BodyshopError(`With entries, ask for at most ${HISTORY_ENTRY_DAYS} days, for example from ${addDays(result.to, 1 - HISTORY_ENTRY_DAYS)} to ${result.to}. Leave entries out to get day totals for up to ${HISTORY_MAX_DAYS} days.`);
    }
    return {
      from: result.from, to: result.to,
      days: result.days.map(({ day: date, status, basis, summary, entries, weightKg, checkIn }) => ({
        day: date, status, basis, weightKg: known(round(weightKg)),
        food: summary ? {
          kcal: round(summary.kcal), kcalRange: summary.check === "Ready" ? [round(summary.low.kcal), round(summary.high.kcal)] : undefined,
          protein: round(summary.protein), carbs: round(summary.carbs), fat: round(summary.fat), fiber: known(round(summary.fiber)),
          check: summary.check, entries: summary.entries, evidence: summary.evidence === "Direct date-attributed intake" ? undefined : summary.evidence
        } : undefined,
        steps: known(checkIn?.steps ?? null), training: known(checkIn?.training ?? null), trainingNotes: known(checkIn?.trainingNotes ?? null),
        activityNotes: known(checkIn?.activityNotes ?? null), hunger: known(checkIn?.hunger ?? null), fatigue: known(checkIn?.fatigue ?? null),
        recovery: known(checkIn?.recovery ?? null), sleep: known(checkIn?.sleep ?? null), notes: known(checkIn?.notes ?? null),
        log: input.entries ? entries.map(brief) : undefined
      }))
    };
  });

  tool("bodyshop_food_search", "Search saved foods", "read", "Use this before you log or save a food, to find the saved food and its nutrition. Returns each food's foodId, reference amount and nutrition, container word, and full size.", {
    query: z.string().describe("Words of the name or brand. Empty lists the first foods by name."), limit: z.number().int().min(1).max(50).optional()
  }, async ({ query, limit }) => (await searchFoods(scope(), query, limit)).map((food) => ({
    foodId: food.id, name: food.name, brand: food.brand || undefined, per: `${food.amount} ${food.unit}`, ...food.nutrients, range: food.range, fiberRange: food.fiberRange,
    container: food.container || undefined, fullSize: food.fullSize ? `${food.fullSize.amount} ${food.fullSize.unit}` : undefined, notes: food.notes || undefined
  })));

  tool("bodyshop_food_log", "Log food", "write", `Use this when the person tells you what they ate. Logs one or more foods in one step. ${LOGGING_RULES}`, {
    items: z.array(item).min(1).max(30), day, time, repeat: z.boolean().optional().describe("Log again although the same entry exists from the last ten minutes.")
  }, async (input) => {
    const result = await logFood(scope(), input);
    return { entries: result.entries.map(brief), alreadyLogged: result.repeated.length ? result.repeated : undefined };
  });

  tool("bodyshop_meal_templates", "Show a meal template", "read", "Use this before you log a meal template with variable parts. Shows the template's parts on a day, with the saved food each part uses. Parts without a saved food need a choice.", {
    template: z.string().describe("Template name or alias, such as \"usual dinner\"."), day
  }, async (input) => {
    const view = await dayView(scope(), input.day);
    const { template, parts } = await templateParts(scope(), input.template, view.day);
    return { template, day: view.day, parts: parts.map((part) => ({ part: part.food, amount: part.amount, unit: part.unit, quantity: part.quantity, meal: part.meal, saved: Boolean(part.saved) })) };
  });

  tool("bodyshop_meal_log", "Log a meal template", "write", `Use this when the person ate a recurring meal, such as "normal breakfast". Use choices for variable parts and changed amounts, and skip for parts not eaten. ${LOGGING_RULES}`, {
    template: z.string(), day, time, meal: z.enum(MEALS).optional().describe("Only when the meal differs from the template's meal."),
    choices: z.array(z.object({ part: z.string(), food: z.string().optional(), amount: z.number().positive().optional(), unit: z.string().optional() })).optional(),
    skip: z.array(z.string()).optional().describe("Part names that were not eaten."), repeat: z.boolean().optional()
  }, async (input) => {
    const result = await logMeal(scope(), input);
    return { template: result.template, entries: result.entries.map(brief), alreadyLogged: result.repeated.length ? result.repeated : undefined };
  });

  tool("bodyshop_entry_correct", "Correct a food entry", "repeatable write", "Use this when a logged entry has the wrong food, amount, meal, day, or nutrition. A new food takes that saved food's nutrition; a new amount scales the entry's own nutrition. The history keeps every earlier version.", {
    entryId: z.string().describe("From bodyshop_today or bodyshop_history."), day, time, meal: z.enum(MEALS).optional(), food: z.string().optional(),
    amount: z.number().positive().optional(), unit: z.string().optional(), nutrients: nutrients.optional().describe("New values for the logged amount. Makes the entry an estimate."),
    range: share("The nutrition range"), fiberRange: share("The fiber range"), notes: z.string().max(2000).optional()
  }, async ({ entryId, ...patch }) => brief(await correctEntry(scope(), entryId, patch)));

  tool("bodyshop_entry_remove", "Remove a food entry", "remove", "Use this only when the person did not eat a logged food, or it was logged twice. The entry leaves the log and the totals.", {
    entryId: z.string().describe("From bodyshop_today or bodyshop_history.")
  }, async ({ entryId }) => { await removeRecord(scope(), "entry", entryId); return { removed: entryId }; });

  tool("bodyshop_food_save", "Save a food", "repeatable write", "Use this to save a food that will come back, or to fix a saved food's nutrition. Changes the saved food with the same name or foodId. Fields you leave out keep their value. Entries logged earlier keep their own nutrition.", {
    foodId: z.string().optional(), name: z.string().min(1), brand: z.string().optional(),
    amount: z.number().positive().optional().describe("Reference amount, such as 100."), unit: z.string().optional().describe("Reference unit, such as g, ml, or piece."),
    nutrients: nutrients.partial().optional().describe("Values per reference amount."), range: share("The nutrition range"), fiberRange: share("The fiber range"),
    fullSize: z.object({ amount: z.number().positive(), unit: z.string() }).nullable().optional().describe("One full package, in the reference unit."),
    container: z.string().optional().describe("The package word, such as pack, tub, or jar."), source: z.string().optional().describe("Where the values come from, such as Label."),
    notes: z.string().max(2000).optional()
  }, async ({ foodId, ...input }) => saveFood(scope(), { ...input, id: foodId }));

  tool("bodyshop_weight_log", "Log weight", "write", "Use this when the person tells you a body weight. Several readings on one day count as their mean.", {
    kg: z.number(), day, time, notes: z.string().max(2000).optional(), source: z.string().optional().describe("Default: Reported.")
  }, async (input) => logWeight(scope(), input));

  tool("bodyshop_day_update", "Update a day's check-in", "repeatable write", "Use this to record whether the food log of a day is complete, and the day's training, steps, hunger, fatigue, recovery, sleep, and notes. Fields you leave out keep their value.", {
    day, reported: z.enum(DAY_STATUSES).nullable().optional().describe("Complete only when the person says all food is logged."),
    override: z.enum(DAY_STATUSES).nullable().optional().describe("Overrides the automatic completion. Null returns to automatic."),
    training: z.string().optional(), trainingNotes: z.string().optional(), steps: z.number().int().min(0).nullable().optional(), activityNotes: z.string().optional(),
    hunger: z.number().int().min(1).max(5).nullable().optional(), fatigue: z.number().int().min(1).max(5).nullable().optional(),
    recovery: z.number().int().min(1).max(5).nullable().optional(), sleep: z.number().min(0).max(24).nullable().optional(), notes: z.string().max(4000).optional()
  }, async (input) => updateDay(scope(), input));

  tool("bodyshop_progress", "Weight and energy progress", "read", "Use this for the current state of the diet: the weight trend and projection, the expenditure model, the energy balance, this week, and the last six weeks. Ranges are scenarios, not confidence intervals. For single days in a period, use bodyshop_history.", {}, async () => {
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
  });

  tool("bodyshop_settings", "Show targets and settings", "read", "Use this to see the calorie and macro targets, the model settings, and the birthday and sex used for the resting energy estimate.", {}, async () => {
    const { settings, profile } = await readBodyshopSettings(scope());
    return { ...settings, ...profile };
  });

  tool("bodyshop_settings_update", "Change targets and settings", "repeatable write", "Use this only when the person asks to change a target, a model setting, their birthday, or their sex. The birthday and sex are for the resting energy estimate. Values you leave out keep their value.", {
    values: z.record(z.string(), z.number()).optional().describe(`Keyed by setting name. Keys: ${Object.keys(SETTING_LABELS).join(", ")}.`),
    birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe("YYYY-MM-DD. Null clears it."),
    sex: z.enum(SEXES).nullable().optional().describe("For the resting energy equation. Null clears it.")
  }, async ({ values, birthday, sex }) => {
    const mine = scope();
    if (birthday !== undefined || sex !== undefined) await updateProfile(mine, { birthday, sex });
    if (values && Object.keys(values).length) await updateSettings(mine, values as Partial<Record<SettingKey, number>>);
    const { settings, profile } = await readBodyshopSettings(mine);
    return { ...settings, ...profile };
  });
}
