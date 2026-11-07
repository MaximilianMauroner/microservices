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
/** `auth-failed`: a report with the sender's name could not get a valid token, so it was not sent. It is never sent anonymously in its place. */
export type ReportOutcome = { kind: "sent" } | { kind: "offline" } | { kind: "timeout" } | { kind: "rate-limited" } | { kind: "auth-failed" } | { kind: "rejected"; reason: ReportRejection | "unknown" } | { kind: "failed" };

const REPORT_TIMEOUT_MS = 15_000;

/** Waits for a promise, but gives up when the report's deadline passes. */
function beforeDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("deadline")); return; }
    signal.addEventListener("abort", () => reject(new Error("deadline")), { once: true });
    promise.then(resolve, reject);
  });
}

/**
 * Sends a bug report or an idea to the developer. Named, it carries the account's token. Anonymous, it carries none and may carry an email for a reply.
 * One 15-second deadline covers getting the token, a refresh after a 401, and the request itself.
 */
export async function sendReport(report: Report, named: boolean): Promise<ReportOutcome> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), REPORT_TIMEOUT_MS);
  try {
    return await sendBefore(report, named, deadline.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function sendBefore(report: Report, named: boolean, signal: AbortSignal): Promise<ReportOutcome> {
  const body = JSON.stringify({ app: "pantrino", ...report, context: `Pantrino ${Constants.expoConfig?.version ?? "?"} · ${Platform.OS} ${Platform.Version}` });
  const session = currentSession();
  const token = async (stale?: string): Promise<string | ReportOutcome> => {
    try { return await beforeDeadline(accessToken(session, stale), signal); }
    catch { return { kind: signal.aborted ? "timeout" : "auth-failed" }; }
  };
  let bearer: string | undefined;
  if (named) {
    const first = await token();
    if (typeof first !== "string") return first;
    bearer = first;
  }
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${TOOLS_ORIGIN}/api/reports`, {
        method: "POST", body, signal, credentials: "omit",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }
      });
    } catch {
      return { kind: signal.aborted ? "timeout" : "offline" };
    }
    if (response.status === 401 && bearer) {
      if (attempt > 0) return { kind: "auth-failed" };
      const fresh = await token(bearer);
      if (typeof fresh !== "string") return fresh;
      bearer = fresh;
      continue;
    }
    if (response.ok) return { kind: "sent" };
    if (response.status === 429) return { kind: "rate-limited" };
    if (response.status === 400) {
      let reason: string | undefined;
      try { reason = ((await beforeDeadline(response.json(), signal).catch((error: unknown) => { if (signal.aborted) throw error; return {}; })) as { reason?: string }).reason; }
      catch { return { kind: "timeout" }; }
      return { kind: "rejected", reason: REJECTIONS.includes(reason as ReportRejection) ? reason as ReportRejection : "unknown" };
    }
    return { kind: "failed" };
  }
}

const REJECTIONS: readonly string[] = ["unknown_app", "invalid_kind", "empty_message", "message_too_long", "details_too_long", "invalid_email"];
