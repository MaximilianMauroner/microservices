import { z } from "zod";
import { DAY_STATUSES, MEALS } from "./domain.js";
import { SETTING_LABELS, SEXES, type SettingKey } from "./settings.js";

/** Every change a person can make in Bodyshop, from the web page and from the app. */
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
  z.object({ type: z.literal("settings.update"), values: z.record(z.enum(Object.keys(SETTING_LABELS) as [SettingKey, ...SettingKey[]]), z.number().finite()) }),
  z.object({ type: z.literal("profile.update"), birthday: day.nullable().optional(), sex: z.enum(SEXES).nullable().optional() })
]);

export type BodyshopAction = z.infer<typeof bodyshopAction>;
