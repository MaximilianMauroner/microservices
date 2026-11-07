import type { AppActionResult, CatalogProduct, KitchenSync } from "@tools-platform/service/kitchen-contract";
import { accessToken, currentSession, Offline, SignedOut, TOOLS_ORIGIN } from "../auth/session";
import { Platform } from "react-native";
import Constants from "expo-constants";
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

/** Tools refused a report and said why, for example an invalid email. */
export class ReportRefused extends Error {}

export type Report = Readonly<{ kind: "bug" | "feature"; message: string; details?: string; page: string; contactEmail?: string }>;

/** Sends a bug report or an idea to the developer. Signed in, it names the account. Signed out, it is anonymous and may carry an email for a reply. */
export async function sendReport(report: Report, signedIn: boolean): Promise<void> {
  const body = JSON.stringify({ app: "pantrino", ...report, context: `Pantrino ${Constants.expoConfig?.version ?? "?"} · ${Platform.OS} ${Platform.Version}` });
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body };
  if (signedIn) { await call("/api/reports", init); return; }
  const response = await fetch(`${TOOLS_ORIGIN}/api/reports`, { ...init, headers: { ...init.headers, Accept: "application/json" } })
    .catch((cause: unknown) => { throw new Offline("Tools cannot be reached.", { cause }); });
  if (response.ok) return;
  const reason = ((await response.json().catch(() => ({}))) as { message?: string }).message;
  throw reason ? new ReportRefused(reason) : new Error(`Tools answered ${response.status} on /api/reports.`);
}
