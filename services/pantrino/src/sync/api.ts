import type { BodyshopAction, BodyshopAppSnapshot } from "@tools-platform/service/bodyshop-contract";
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

/** The person has no access to this product. The account stays signed in. */
export class NoAccess extends Error {}
/** Tools refused a change by one of its rules. `message` says why, in words for the person. */
export class Refused extends Error {}

let networkAllowed = false;
let networkEpoch = 0;

/** Opens or closes every account call: Kitchen sync, product lookup, and Bodyshop. A call that started before a close fails. */
export function allowKitchenNetwork(allowed: boolean): void {
  networkAllowed = allowed;
  networkEpoch += 1;
}

/** A 403 signs the app out for Kitchen, the app's own product. For another product it only means no access to it. */
async function call(path: string, init: RequestInit = {}, forbidden: "signed-out" | "no-access" = "signed-out"): Promise<Response> {
  const epoch = networkEpoch;
  const requireAccount = () => { if (!networkAllowed || epoch !== networkEpoch) throw new SignedOut(); };
  requireAccount();
  const session = currentSession();
  let token = await accessToken(session);
  for (let attempt = 0; ; attempt += 1) {
    requireAccount();
    const response = await fetch(`${TOOLS_ORIGIN}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: "application/json" } })
      .catch((cause: unknown) => { throw new Offline("Tools cannot be reached.", { cause }); });
    requireAccount();
    if (response.status === 401 && attempt === 0) {
      token = await accessToken(session, token);
      continue;
    }
    if (response.status === 403 && forbidden === "no-access") throw new NoAccess();
    if (response.status === 401 || response.status === 403) throw new SignedOut();
    if ([400, 404, 409].includes(response.status) && forbidden === "no-access") {
      const body = await response.json().catch(() => undefined) as { message?: unknown } | undefined;
      if (typeof body?.message === "string") throw new Refused(body.message);
    }
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

/** Bodyshop through the same app token. It needs a connection; the app keeps the last day it read for offline use. */
export const bodyshopApi = {
  async today(day?: string): Promise<BodyshopAppSnapshot> {
    return (await call(`/api/bodyshop/app/today${day ? `?${new URLSearchParams({ day })}` : ""}`, {}, "no-access")).json();
  },
  async act(action: BodyshopAction, day?: string): Promise<{ result: { id?: string; repeated?: number }; snapshot: BodyshopAppSnapshot }> {
    const response = await call("/api/bodyshop/app/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, day }) }, "no-access");
    return response.json();
  }
};

/** Packaged foods from Open Food Facts that match a typed name. It needs a connection. */
export async function searchCatalog(query: string): Promise<readonly CatalogProduct[]> {
  const response = await call(`/api/kitchen/products?${new URLSearchParams({ q: query })}`);
  return ((await response.json()) as { products: CatalogProduct[] }).products;
}

/** The packaged food with this barcode, or undefined when no product with calories has it. It needs a connection. */
export async function lookupBarcode(code: string): Promise<CatalogProduct | undefined> {
  const response = await call(`/api/kitchen/products?${new URLSearchParams({ code })}`);
  return ((await response.json()) as { products: CatalogProduct[] }).products[0];
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
      const json: unknown = await beforeDeadline(response.json(), signal).catch(() => undefined);
      if (signal.aborted) return { kind: "timeout" };
      const reason = (json as { reason?: unknown } | null | undefined)?.reason;
      return { kind: "rejected", reason: typeof reason === "string" && REJECTIONS.includes(reason) ? reason as ReportRejection : "unknown" };
    }
    return { kind: "failed" };
  }
}

const REJECTIONS: readonly string[] = ["unknown_app", "invalid_kind", "empty_message", "message_too_long", "details_too_long", "invalid_email"];
