import type { BodyshopAction, BodyshopAppSnapshot } from "@tools-platform/service/bodyshop-contract";
import { useSyncExternalStore } from "react";
import { Offline, SignedOut } from "../auth/session";
import { vault } from "../storage/vault";
import { bodyshopApi, NoAccess, Refused } from "../sync/api";

/**
 * `unknown` until the first answer. `no-access` when the account has no Bodyshop, so the app hides it.
 * Offline, the last day read stays on screen and changes wait for a connection.
 */
export type BodyStatus = "unknown" | "ready" | "loading" | "offline" | "no-access" | "failed";
export type BodyState = Readonly<{ snapshot: BodyshopAppSnapshot | null; status: BodyStatus }>;
export type BodyResult = { ok: true; repeated: boolean } | { ok: false; reason: "offline" | "refused" | "failed"; message?: string };

const CACHE = "bodyshop";
let state: BodyState = { snapshot: null, status: "unknown" };
const listeners = new Set<() => void>();

function set(next: Partial<BodyState>) {
  state = { ...state, ...next };
  if (next.snapshot) void vault.saveSetting(CACHE, JSON.stringify(next.snapshot));
  listeners.forEach((listener) => listener());
}

function failed(error: unknown): BodyStatus {
  if (error instanceof NoAccess) return "no-access";
  if (error instanceof Offline) return "offline";
  return "failed";
}

export const bodyStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getState: () => state,

  /** Shows the last day from the vault at once, then asks Tools for a fresh one. */
  async load() {
    const cached = await vault.setting(CACHE);
    if (cached) set({ snapshot: JSON.parse(cached) as BodyshopAppSnapshot });
    await bodyStore.refresh();
  },

  /** Reads `day`, or the shown day, or today. A signed-out error is left to the Kitchen sync, which owns the session. */
  async refresh(day = state.snapshot?.day) {
    set({ status: "loading" });
    try {
      set({ snapshot: await bodyshopApi.today(day), status: "ready" });
    } catch (error) {
      if (error instanceof SignedOut) return set({ status: "failed" });
      set({ status: failed(error) });
    }
  },

  /** Sends one change and shows the day Tools answers with. Nothing is queued: an offline change says so and stays in its form. */
  async act(action: BodyshopAction): Promise<BodyResult> {
    try {
      const { result, snapshot } = await bodyshopApi.act(action, state.snapshot?.day);
      set({ snapshot, status: "ready" });
      return { ok: true, repeated: Boolean(result.repeated) };
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: "refused", message: error.message };
      const status = failed(error);
      if (status === "no-access") set({ status });
      return { ok: false, reason: status === "offline" ? "offline" : "failed" };
    }
  },

  reset() {
    set({ snapshot: null, status: "unknown" });
  },
};

export function useBody(): BodyState {
  return useSyncExternalStore(bodyStore.subscribe, bodyStore.getState);
}
