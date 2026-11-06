import type { PlatformPrincipal } from "#security";
import { principalSeesProduct } from "../../platform/access/product-access.js";
import { addDays, type Ingredient, type Kitchen, type Leftover, type PlanEntry, type Recipe, type StockItem, type StoredExtra, today, weekStart } from "./domain.js";
import { applyAppActions, appActionBatch } from "./actions.js";
import type { KitchenCatalog } from "./catalog.js";
import type { KitchenStore } from "./repository.js";
import { readBoundedBody, RequestBodyTooLargeError } from "../../platform/request-body.js";

/** The app keeps this many past weeks of the plan offline. Older weeks need a connection. */
export const SYNC_WEEKS_BACK = 4;

/** Far above a real offline queue, and low enough that one request cannot hold the database pool. */
const MAX_ACTIONS_BODY_BYTES = 1024 * 1024;

export type KitchenSnapshot = Readonly<{
  kitchen: Kitchen;
  ingredients: readonly Ingredient[];
  recipes: readonly Recipe[];
  plan: readonly PlanEntry[];
  stock: readonly StockItem[];
  leftovers: readonly Leftover[];
  extras: readonly StoredExtra[];
}>;

/** Everything the app shows, for every kitchen the person can open. The app replaces its copy with this. */
export type KitchenSync = Readonly<{ today: string; planFrom: string; kitchens: readonly KitchenSnapshot[] }>;

export async function kitchenSync(store: KitchenStore, who: PlatformPrincipal, now = new Date()): Promise<KitchenSync> {
  const day = today(now);
  const planFrom = addDays(weekStart(day), -7 * SYNC_WEEKS_BACK);
  const kitchens = await Promise.all((await store.list(who)).map(async (kitchen) => {
    const scope = await store.open(who, kitchen.id);
    const [ingredients, recipes, plan, stock, leftovers, extras] = await Promise.all([
      scope.ingredients(), scope.recipes(), scope.planFrom(planFrom), scope.stock(), scope.leftovers(), scope.storedExtras()
    ]);
    return { kitchen: scope.kitchen, ingredients, recipes, plan, stock, leftovers, extras };
  }));
  return { today: day, planFrom, kitchens };
}

type AppTokenResolver = (request: Request) => Promise<PlatformPrincipal | undefined>;

/** Only a Kitchen app token opens the app API; a cookie or an MCP token does not. */
async function asKitchenApp(request: Request, resolveAppToken: AppTokenResolver, serve: (who: PlatformPrincipal) => Promise<Response>): Promise<Response> {
  const principal = await resolveAppToken(request);
  if (!principal) return Response.json({ error: "invalid_token" }, { status: 401, headers: { "Cache-Control": "no-store", "WWW-Authenticate": "Bearer" } });
  if (!principalSeesProduct(principal, "kitchen")) return Response.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  return serve(principal);
}

export function handleKitchenSync(request: Request, resolveAppToken: AppTokenResolver, store: KitchenStore): Promise<Response> {
  return asKitchenApp(request, resolveAppToken, async (who) => Response.json(await kitchenSync(store, who), { headers: { "Cache-Control": "no-store" } }));
}

export function handleKitchenCatalog(request: Request, resolveAppToken: AppTokenResolver, catalog: KitchenCatalog): Promise<Response> {
  return asKitchenApp(request, resolveAppToken, async () => {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ products: await catalog.search(query.slice(0, 100)) }, { headers: { "Cache-Control": "no-store" } });
  });
}

export function handleKitchenActions(request: Request, resolveAppToken: AppTokenResolver, store: KitchenStore): Promise<Response> {
  return asKitchenApp(request, resolveAppToken, async (who) => {
    let body: unknown;
    try {
      const bytes = await readBoundedBody(request, MAX_ACTIONS_BODY_BYTES);
      body = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : undefined;
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "request_too_large" }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    const batch = appActionBatch.safeParse(body);
    if (!batch.success) return Response.json({ error: "invalid_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    return Response.json({ results: await applyAppActions(store, who, batch.data) }, { headers: { "Cache-Control": "no-store" } });
  });
}
