import { createHash } from "node:crypto";
import { z } from "zod";
import { asAppProduct, type AppTokenResolver } from "../../platform/app-api.js";
import { readBoundedBody, RequestBodyTooLargeError } from "../../platform/request-body.js";
import { addDays, BodyshopError, loggingDay } from "./domain.js";
import type { HealthFeed, WeightChange } from "./health-contract.js";
import { entryNutrients } from "./model/day.js";
import type { BodyshopScope, BodyshopStore } from "./repository.js";
import { fillHealthCheckIns, readBodyshopSettings } from "./service.js";

const externalId = z.string().min(1).max(200);
const time = z.iso.datetime({ offset: true });
const changes = z.array(z.discriminatedUnion("type", [
  z.object({ type: z.literal("delete"), externalId }),
  z.object({
    type: z.literal("upsert"),
    weight: z.object({
      provider: z.literal("health-connect"), externalId, sourceApp: z.string().min(1).max(255),
      measuredAt: time, modifiedAt: time, offsetSeconds: z.number().int().min(-64800).max(64800).nullable(),
      kg: z.number().positive().max(1000),
    }),
  }),
])).max(100);
const imports = z.union([changes, z.object({
  checkIns: z.array(z.object({
    day: z.iso.date(), steps: z.number().int().min(0).max(1_000_000).optional(),
    sleep: z.number().positive().max(24).optional(),
  })).max(7),
})]);
const cursor = z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine((value) => {
  try { return BigInt(value) <= 9223372036854775807n; } catch { return false; }
});
const feedPosition = z.object({ baseline: cursor, after: cursor }).refine(({ baseline, after }) => BigInt(baseline) <= BigInt(after));
const headers = { "Cache-Control": "private, no-store" };

function weightId(externalId: string) {
  const hash = createHash("sha256").update("health-connect:weight:").update(externalId).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function importWeightChanges(scope: BodyshopScope, changes: readonly WeightChange[]) {
  await scope.exclusive(async (locked) => {
    const { settings } = await readBodyshopSettings(locked);
    for (const change of changes) {
      const id = weightId(change.type === "delete" ? change.externalId : change.weight.externalId);
      const prior = (await locked.history("weight", id)).at(-1);
      if (change.type === "delete") {
        if (prior?.record.external && !prior.removed) await locked.save([{ kind: "weight", remove: id }]);
        continue;
      }
      const { kg, ...external } = change.weight;
      if (prior && (prior.removed || !prior.record.external || Date.parse(prior.record.external.modifiedAt) >= Date.parse(external.modifiedAt))) continue;
      const moment = new Date(external.measuredAt);
      const local = external.offsetSeconds === null ? null : new Date(moment.getTime() + external.offsetSeconds * 1000).toISOString();
      const day = local
        ? addDays(local.slice(0, 10), Number(local.slice(11, 13)) < settings.dayStartHour ? -1 : 0)
        : loggingDay(moment, settings.dayStartHour);
      await locked.save([{ kind: "weight", record: {
        id, day, kg, time: local?.slice(11, 16) ?? null, source: external.sourceApp, notes: "", external,
      } }]);
    }
  });
}

export function handleBodyshopHealth(request: Request, resolveToken: AppTokenResolver, store: BodyshopStore) {
  return asAppProduct(request, resolveToken, "bodyshop", async ({ subject }) => {
    const scope = store.owner(subject);
    if (request.method === "POST") {
      let body: unknown;
      try {
        const bytes = await readBoundedBody(request, 128 * 1024);
        body = bytes && JSON.parse(new TextDecoder().decode(bytes));
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "request_too_large" }, { status: 413, headers });
        return Response.json({ error: "invalid_request" }, { status: 400, headers });
      }
      const parsed = imports.safeParse(body);
      if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400, headers });
      try {
        if (Array.isArray(parsed.data)) await importWeightChanges(scope, parsed.data);
        else await fillHealthCheckIns(scope, parsed.data.checkIns);
      } catch (error) {
        if (error instanceof BodyshopError) return Response.json({ error: "invalid_request" }, { status: 400, headers });
        throw error;
      }
      return new Response(null, { status: 204, headers });
    }
    const query = new URL(request.url).searchParams;
    if (!query.has("after") && !query.has("baseline")) {
      const cursor = await scope.exclusive((locked) => locked.nutritionBaseline());
      const namespace = createHash("sha256").update("pantrino:health-connect:nutrition:").update(subject).digest("hex");
      return Response.json({ kind: "baseline", cursor, namespace, checkIns: true } satisfies HealthFeed, { headers });
    }
    const parsed = feedPosition.safeParse(Object.fromEntries(query));
    if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400, headers });
    const { after, baseline } = parsed.data;
    const [rows, { settings }] = await Promise.all([scope.nutritionChanges(after, baseline), readBodyshopSettings(scope)]);
    return Response.json({
      kind: "changes", dayStartHour: settings.dayStartHour,
      changes: rows.map(({ cursor, id, revision, record }) => ({
        cursor, id, revision, food: record && { food: record.food, day: record.day, time: record.time, meal: record.meal, nutrients: entryNutrients(record) },
      })),
    } satisfies HealthFeed, { headers });
  });
}
