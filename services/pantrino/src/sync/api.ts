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

export type Report = Readonly<{ kind: "bug" | "feature"; message: string; details?: string; page: string; contactEmail?: string }>;
/** Why Tools refused a report. The app shows its own text for each reason. */
export type ReportRejection = "unknown_app" | "invalid_kind" | "empty_message" | "message_too_long" | "details_too_long" | "invalid_email";
export type ReportOutcome = { kind: "sent" } | { kind: "offline" } | { kind: "timeout" } | { kind: "rate-limited" } | { kind: "rejected"; reason: ReportRejection | "unknown" } | { kind: "failed" };

const REPORT_TIMEOUT_MS = 15_000;

/** Sends a bug report or an idea to the developer. Signed in, it names the account. Signed out, it is anonymous and may carry an email for a reply. */
export async function sendReport(report: Report, signedIn: boolean): Promise<ReportOutcome> {
  const body = JSON.stringify({ app: "pantrino", ...report, context: `Pantrino ${Constants.expoConfig?.version ?? "?"} · ${Platform.OS} ${Platform.Version}` });
  const session = currentSession();
  let token = signedIn ? await accessToken(session).catch(() => undefined) : undefined;
  for (let attempt = 0; ; attempt += 1) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REPORT_TIMEOUT_MS);
    const signal = abort.signal;
    let response: Response;
    try {
      response = await fetch(`${TOOLS_ORIGIN}/api/reports`, {
        method: "POST", body, signal,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
    } catch {
      return { kind: signal.aborted ? "timeout" : "offline" };
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 && token && attempt === 0) {
      token = await accessToken(session, token).catch(() => undefined);
      continue;
    }
    if (response.ok) return { kind: "sent" };
    if (response.status === 429) return { kind: "rate-limited" };
    if (response.status === 400) {
      const reason = ((await response.json().catch(() => ({}))) as { reason?: string }).reason;
      return { kind: "rejected", reason: REJECTIONS.includes(reason as ReportRejection) ? reason as ReportRejection : "unknown" };
    }
    return { kind: "failed" };
  }
}

const REJECTIONS: readonly string[] = ["unknown_app", "invalid_kind", "empty_message", "message_too_long", "details_too_long", "invalid_email"];
