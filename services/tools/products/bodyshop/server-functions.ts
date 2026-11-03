import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import { z } from "zod";
import { requireProductAccess } from "../../platform/auth/middleware.js";
import { DAY_STATUSES, findTemplate, MEALS } from "./domain.js";
import type { BodyshopScope } from "./repository.js";
import {
  correctEntry, dayView, type ImportReceipt, logFood, logMeal, logWeight, progress, readBodyshopSettings, removeRecord, saveFood, templateParts, updateDay, updateSettings
} from "./service.js";
import { SETTING_LABELS, type SettingKey } from "./settings.js";

const session = requireProductAccess("bodyshop");

type Who = { principal: { subject: string } };

/** Every Bodyshop request opens only the signed-in person's own records. */
function scope(context: Who): BodyshopScope {
  const runtime = getGlobalStartContext()?.runtime;
  if (!runtime) throw new Error("Bodyshop runtime is unavailable.");
  return runtime.bodyshop.owner(context.principal.subject);
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const id = z.string().max(64);
const share = z.number().min(0).max(5).nullable();
const text = (max: number) => z.string().max(max);
const nutrients = z.object({ kcal: z.number().min(0), protein: z.number().min(0).nullable(), carbs: z.number().min(0).nullable(), fat: z.number().min(0).nullable(), fiber: z.number().min(0).nullable() }).partial();
const item = z.object({
  food: text(200).min(1), meal: z.enum(MEALS), amount: z.number().positive().nullable().optional(), unit: text(40).nullable().optional(),
  nutrients: nutrients.nullable().optional(), range: share.optional(), fiberRange: share.optional(), source: z.enum(["Estimated", "Label"]).nullable().optional(), notes: text(2000).nullable().optional()
});

export const bodyshopAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("food.log"), day, time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), items: z.array(item).min(1).max(30), repeat: z.boolean().optional() }),
  z.object({
    type: z.literal("meal.log"), day, template: text(200), meal: z.enum(MEALS).optional(), repeat: z.boolean().optional(), skip: z.array(text(200)).max(40).optional(),
    choices: z.array(z.object({ part: text(200), food: text(200).optional(), amount: z.number().positive().optional(), unit: text(40).optional() })).max(40).optional()
  }),
  z.object({
    type: z.literal("entry.correct"), id, day: day.optional(), meal: z.enum(MEALS).optional(), food: text(200).optional(), amount: z.number().positive().optional(),
    unit: text(40).optional(), nutrients: nutrients.optional(), range: share.optional(), fiberRange: share.optional(), notes: text(2000).optional()
  }),
  z.object({ type: z.literal("remove"), kind: z.enum(["entry", "weight", "food"]), id }),
  z.object({ type: z.literal("weight.log"), day, kg: z.number(), notes: text(2000).optional() }),
  z.object({
    type: z.literal("day.update"), day, reported: z.enum(DAY_STATUSES).nullable().optional(), override: z.enum(DAY_STATUSES).nullable().optional(),
    training: text(200).optional(), trainingNotes: text(2000).optional(), steps: z.number().int().min(0).nullable().optional(), activityNotes: text(2000).optional(),
    hunger: z.number().int().min(1).max(5).nullable().optional(), fatigue: z.number().int().min(1).max(5).nullable().optional(),
    recovery: z.number().int().min(1).max(5).nullable().optional(), sleep: z.number().min(0).max(24).nullable().optional(), notes: text(4000).optional()
  }),
  z.object({
    type: z.literal("food.save"), id: id.optional(), name: text(200).min(1), brand: text(200).optional(), amount: z.number().positive().optional(), unit: text(40).optional(),
    nutrients: nutrients.optional(), range: share.optional(), fiberRange: share.optional(), container: text(100).optional(),
    fullSize: z.object({ amount: z.number().positive(), unit: text(40) }).nullable().optional(), source: text(200).optional(), notes: text(4000).optional()
  }),
  z.object({ type: z.literal("settings.update"), values: z.record(z.enum(Object.keys(SETTING_LABELS) as [SettingKey, ...SettingKey[]]), z.number().finite()) })
]);

export type BodyshopAction = z.infer<typeof bodyshopAction>;

export const runBodyshopAction = createServerFn({ method: "POST" })
  .middleware([session])
  .validator((input: unknown) => bodyshopAction.parse(input))
  .handler(async ({ data, context }): Promise<{ id?: string; repeated?: number }> => {
    const mine = scope(context);
    switch (data.type) {
      case "food.log": { const result = await logFood(mine, data); return { id: result.entries[0]?.id, repeated: result.repeated.length }; }
      case "meal.log": { const result = await logMeal(mine, data); return { repeated: result.repeated.length }; }
      case "entry.correct": { const { type: _, id: entryId, ...patch } = data; return { id: (await correctEntry(mine, entryId, patch)).id }; }
      case "remove": await removeRecord(mine, data.kind, data.id); return {};
      case "weight.log": return { id: (await logWeight(mine, data)).id };
      case "day.update": { const { type: _, ...input } = data; return { id: (await updateDay(mine, input)).id }; }
      case "food.save": { const { type: _, ...input } = data; return { id: (await saveFood(mine, input)).id }; }
      case "settings.update": await updateSettings(mine, data.values); return {};
    }
  });

export const getBodyshopDay = createServerFn({ method: "GET" })
  .middleware([session])
  .validator((input: { day?: string } | undefined) => ({ day: input?.day === undefined ? undefined : day.parse(input.day) }))
  .handler(async ({ data, context }) => {
    const mine = scope(context);
    const [view, foods, templates] = await Promise.all([dayView(mine, data.day), mine.list("food"), mine.list("template")]);
    const names = [...new Set(templates.map((one) => one.template))];
    const meals = await Promise.all(names.map(async (name) => {
      const { parts } = await templateParts(mine, name, view.day);
      return { name, meal: parts[0]?.meal ?? "Other", parts: parts.map((part) => ({ part: part.food, amount: part.amount, unit: part.unit, saved: Boolean(part.saved), variable: part.quantity === "Variable" })) };
    }));
    return {
      ...view,
      foods: foods.map((food) => ({ id: food.id, name: food.name, brand: food.brand, amount: food.amount, unit: food.unit, kcal: food.nutrients.kcal, protein: food.nutrients.protein, container: food.container, fullSize: food.fullSize })).sort((a, b) => a.name.localeCompare(b.name)),
      templates: meals.filter((meal) => meal.parts.length && findTemplate(templates, meal.name))
    };
  });

export const getBodyshopProgress = createServerFn({ method: "GET" })
  .middleware([session])
  .handler(async ({ context }) => {
    const result = await progress(scope(context));
    return {
      today: result.today,
      settings: result.settings,
      summary: result.model.summary,
      rows: result.model.rows.map((row) => ({
        day: row.day, actual: row.weight.actual, display: row.weight.display, trend: row.weight.trend, status: row.intake.status,
        kcal: row.intake.kcal, modeled: row.intake.modeled, eligible: row.intake.eligible,
        expenditure: row.engine.displayed, expenditureLow: row.engine.displayedLow, expenditureHigh: row.engine.displayedHigh, state: row.engine.state
      })),
      projection: result.projection,
      energy: { headline: result.energy.headline, decision: result.energy.decision, maintenance: result.energy.maintenance, weightTrend: result.energy.weightTrend },
      review: result.review,
      steps: { status: result.steps.status, maintenance: result.steps.maintenance, stepDays: result.steps.stepDays, calibrationText: result.steps.calibrationText },
      insights: result.insights,
      uncertain: result.uncertain
    };
  });

export const getBodyshopFoods = createServerFn({ method: "GET" })
  .middleware([session])
  .handler(async ({ context }) => (await scope(context).list("food")).sort((a, b) => a.name.localeCompare(b.name)));

export const getBodyshopSettings = createServerFn({ method: "GET" })
  .middleware([session])
  .handler(async ({ context }) => {
    const mine = scope(context);
    const [{ settings, rows }, imports] = await Promise.all([readBodyshopSettings(mine), mine.imports<ImportReceipt>()]);
    return {
      settings, labels: SETTING_LABELS, rows,
      imports: imports.map((one) => ({ id: one.id, importedAt: one.receipt.importedAt, fileName: one.receipt.fileName, records: one.receipt.records, matchingDays: one.receipt.reconciliation.matchingDays, days: one.receipt.reconciliation.days }))
    };
  });
