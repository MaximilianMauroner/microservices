import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import { z } from "zod";
import { requireProductAccess } from "../../platform/auth/middleware.js";
import { bodyshopAction } from "./actions.js";
import type { BodyshopScope } from "./repository.js";
import { applyAction, dayPanel, type ImportReceipt, progress, readBodyshopSettings } from "./service.js";
import { SETTING_LABELS } from "./settings.js";

export type { BodyshopAction } from "./actions.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

const session = requireProductAccess("bodyshop");

type Who = { principal: { subject: string } };

/** Every Bodyshop request opens only the signed-in person's own records. */
function scope(context: Who): BodyshopScope {
  const runtime = getGlobalStartContext()?.runtime;
  if (!runtime) throw new Error("Bodyshop runtime is unavailable.");
  return runtime.bodyshop.owner(context.principal.subject);
}

export const runBodyshopAction = createServerFn({ method: "POST" })
  .middleware([session])
  .validator((input: unknown) => bodyshopAction.parse(input))
  .handler(async ({ data, context }) => applyAction(scope(context), data));

export const getBodyshopDay = createServerFn({ method: "GET" })
  .middleware([session])
  .validator((input: { day?: string } | undefined) => ({ day: input?.day === undefined ? undefined : day.parse(input.day) }))
  .handler(async ({ data, context }) => dayPanel(scope(context), data.day));

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
      steps: { status: result.steps.status, maintenance: result.steps.maintenance, stepDays: result.steps.stepDays, calibrationText: result.steps.calibrationText, resting: result.steps.resting },
      profile: result.profile,
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
    const [{ settings, profile, rows }, imports] = await Promise.all([readBodyshopSettings(mine), mine.imports<ImportReceipt>()]);
    return {
      settings, profile, labels: SETTING_LABELS, rows,
      imports: imports.map((one) => ({ id: one.id, importedAt: one.receipt.importedAt, fileName: one.receipt.fileName, records: one.receipt.records, matchingDays: one.receipt.reconciliation.matchingDays, days: one.receipt.reconciliation.days }))
    };
  });
