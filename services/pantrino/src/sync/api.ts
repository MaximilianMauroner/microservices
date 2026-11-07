import type { AppActionResult, CatalogProduct, KitchenSync } from "@tools-platform/service/kitchen-contract";
import { accessToken, currentSession, Offline, SignedOut, TOOLS_ORIGIN } from "../auth/session";
import type { OutboxItem } from "./model";

/**
 * The Kitchen app API on Tools. Every call carries the app's bearer token and retries once with a fresh token after a 401.
 * Both tokens come from the session that was current when the call started, so a call never carries one account's changes with another account's token.
 */
export type KitchenApi = {
  pull(): Promise<KitchenSync>;
  push(items: readonly OutboxItem[]): Promise<AppActionResult[]>;
};

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const session = currentSession();
  let token = await accessToken(session);
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${TOOLS_ORIGIN}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: "application/json" } })
      .catch((cause: unknown) => { throw new Offline("Tools cannot be reached.", { cause }); });
    if (response.status === 401 && attempt === 0) {
      token = await accessToken(session, token);
      continue;
    }
    if (response.status === 401 || response.status === 403) throw new SignedOut();
    if (!response.ok) throw new Error(`Tools answered ${response.status} on ${path}.`);
    return response;
  }
}

export const kitchenApi: KitchenApi = {
  pull: async () => (await call("/api/kitchen/sync")).json(),
  async push(items) {
    const body = JSON.stringify({ actions: items.map(({ clientActionId, kitchenId, queuedAt, action }) => ({ clientActionId, kitchenId, queuedAt, action })) });
    const response = await call("/api/kitchen/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    return ((await response.json()) as { results: AppActionResult[] }).results;
  }
};

/** Packaged foods from Open Food Facts that match a typed name. It needs a connection. */
export async function searchCatalog(query: string): Promise<readonly CatalogProduct[]> {
  const response = await call(`/api/kitchen/products?${new URLSearchParams({ q: query })}`);
  return ((await response.json()) as { products: CatalogProduct[] }).products;
}
