import { asAppProduct, type AppTokenResolver } from "../../platform/app-api.js";
import { readBoundedBody, RequestBodyTooLargeError } from "../../platform/request-body.js";
import { bodyshopAction } from "./actions.js";
import { addDays, BodyshopError, parseDay } from "./domain.js";
import type { BodyshopStore } from "./repository.js";
import { applyAction, dayPanel } from "./service.js";
import type { BodyshopAppSnapshot } from "./snapshot.js";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_ACTION_BYTES = 64 * 1024;
const HISTORY_DAYS = 90;

async function snapshot(store: BodyshopStore, subject: string, day: string | undefined): Promise<BodyshopAppSnapshot> {
  const scope = store.owner(subject);
  const [panel, foods] = await Promise.all([dayPanel(scope, day), scope.list("food")]);
  const history = await scope.list("weight", { from: addDays(panel.today, 1 - HISTORY_DAYS), to: panel.today });
  return { ...panel, foods: foods.sort((a, b) => a.name.localeCompare(b.name)), history };
}

function failure(error: unknown): Response {
  if (error instanceof BodyshopError) {
    const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : error.code === "too_large" ? 413 : 400;
    return Response.json({ error: error.code, message: error.message }, { status, headers: NO_STORE });
  }
  throw error;
}

/** `GET /api/bodyshop/app/today?day=`: the day, today when no day is given. */
export function handleBodyshopToday(request: Request, resolveAppToken: AppTokenResolver, store: BodyshopStore): Promise<Response> {
  return asAppProduct(request, resolveAppToken, "bodyshop", async (who) => {
    try {
      const day = new URL(request.url).searchParams.get("day");
      return Response.json(await snapshot(store, who.subject, day === null ? undefined : parseDay(day)), { headers: NO_STORE });
    } catch (error) {
      return failure(error);
    }
  });
}

/**
 * `POST /api/bodyshop/app/actions` with `{ action, day? }`: runs one change and answers with the day after it.
 * A food log sent again within ten minutes returns the first entry, so a retry after a lost answer logs nothing twice.
 */
export function handleBodyshopActions(request: Request, resolveAppToken: AppTokenResolver, store: BodyshopStore): Promise<Response> {
  return asAppProduct(request, resolveAppToken, "bodyshop", async (who) => {
    let body: unknown;
    try {
      const bytes = await readBoundedBody(request, MAX_ACTION_BYTES);
      body = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : undefined;
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "request_too_large" }, { status: 413, headers: NO_STORE });
    }
    const record = body && typeof body === "object" ? body as { action?: unknown; day?: unknown } : {};
    const action = bodyshopAction.safeParse(record.action);
    if (!action.success) return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
    try {
      const day = typeof record.day === "string" ? parseDay(record.day) : undefined;
      const result = await applyAction(store.owner(who.subject), action.data);
      return Response.json({ result, snapshot: await snapshot(store, who.subject, day) }, { headers: NO_STORE });
    } catch (error) {
      return failure(error);
    }
  });
}
