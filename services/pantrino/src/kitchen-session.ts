import type { NewSession } from "./auth/session";
import type { LocalVault, Vault } from "./storage/vault";
import { INITIAL, type SyncEngine } from "./sync/engine";
import type { QueuedAction } from "./sync/model";

type SessionState = Readonly<{
  session: "loading" | "signed-out" | "signed-in" | "local";
  kitchenId: string | null;
  error: boolean;
  hasLocal: boolean;
}>;

type Deps = {
  accountEngine: SyncEngine;
  localEngine: SyncEngine;
  accountVault: Vault;
  localVault: LocalVault;
  wipeAccount: () => Promise<void>;
  auth: { storedAccount: () => Promise<string | null>; signIn: () => Promise<NewSession | null>; signOut: () => Promise<void> };
  allowNetwork: (allowed: boolean) => void;
};

export function createKitchenSession({ accountEngine, localEngine, accountVault, localVault, wipeAccount, auth, allowNetwork }: Deps) {
  let state: SessionState = { session: "loading", kitchenId: null, error: false, hasLocal: false };
  let transitions: Promise<void> = Promise.resolve();
  let online: boolean | null = null;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const publish = (patch: Partial<SessionState>) => { state = { ...state, ...patch }; emit(); };
  const active = () => state.session === "signed-in" ? accountEngine : state.session === "local" ? localEngine : null;
  const preferences = () => state.session === "signed-in" ? accountVault : localVault;
  allowNetwork(false);
  accountEngine.subscribe(() => {
    if (state.session !== "signed-in") return;
    if (accountEngine.getState().signedOut) {
      allowNetwork(false);
      publish({ session: "signed-out", kitchenId: null });
    } else emit();
  });
  localEngine.subscribe(() => { if (state.session === "local") emit(); });

  async function stop() {
    allowNetwork(false);
    publish({ session: "loading", kitchenId: null, error: false });
    await Promise.all([accountEngine.stop(), localEngine.stop()]);
  }

  function transition(work: () => Promise<void>, localError = true) {
    const next = transitions.then(work).catch(async (error: unknown) => {
      await stop();
      publish({ session: "signed-out", error: localError });
      throw error;
    });
    transitions = next.catch(() => undefined);
    return next;
  }

  async function loadAccount(account: string) {
    if (await accountVault.setting("account") !== account) {
      await wipeAccount();
      await accountVault.saveSetting("account", account);
    }
    await accountEngine.load();
    const kitchenId = await accountVault.setting("kitchen");
    await rememberAccountMode("account");
    publish({ session: "signed-in", kitchenId, error: false });
    allowNetwork(true);
    void accountEngine.sync();
  }

  async function loadLocal() {
    await localEngine.load();
    await localVault.saveSetting("mode", "local");
    publish({ session: "local", kitchenId: null, error: false, hasLocal: true });
  }

  async function rememberAccountMode(mode: "account" | "signed-out") {
    // A local file without its device key must not block a separate account kitchen.
    await localVault.saveSetting("mode", mode).catch(() => undefined);
  }

  const controller = {
    getState: () => state,
    getSyncState: () => active()?.getState() ?? INITIAL,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start: () => transition(async () => {
      await stop();
      publish({ hasLocal: (await localVault.snapshot().catch(() => null)) !== null });
      const mode = await localVault.setting("mode").catch(() => null);
      if (mode === "local") return loadLocal();
      const account = mode === "signed-out" ? null : await auth.storedAccount();
      if (account) await loadAccount(account);
      else publish({ session: "signed-out" });
    }),
    openLocal: () => transition(async () => {
      await stop();
      await loadLocal();
    }),
    showSignIn: () => transition(async () => {
      await stop();
      await rememberAccountMode("signed-out");
      publish({ session: "signed-out" });
    }),
    signIn: () => transition(async () => {
      const next = await auth.signIn();
      if (!next) return;
      await stop();
      if (await accountVault.setting("account") !== next.account) await wipeAccount();
      await accountVault.saveSetting("account", next.account);
      await next.install();
      await loadAccount(next.account);
    }, false),
    signOut: () => transition(async () => {
      if (state.session !== "signed-in") return;
      await stop();
      await auth.signOut();
      await wipeAccount();
      await rememberAccountMode("signed-out");
      publish({ session: "signed-out" });
    }),
    openKitchen(kitchenId: string) {
      if (state.session !== "signed-in") return;
      publish({ kitchenId });
      void accountVault.saveSetting("kitchen", kitchenId);
    },
    setting: (key: string) => preferences().setting(key),
    saveSetting: (key: string, value: string) => preferences().saveSetting(key, value),
    change(kitchenId: string, action: QueuedAction) {
      const engine = active();
      if (!engine?.getState().view?.kitchens.some((one) => one.kitchen.id === kitchenId)) return Promise.resolve();
      return engine.change(kitchenId, action);
    },
    sync: () => active()?.sync() ?? Promise.resolve(),
    dismiss: (id: string) => active()?.dismiss(id) ?? Promise.resolve(),
    onAppState(next: string) {
      if (state.session === "signed-in" && (next === "active" || (next === "background" && accountEngine.getState().pending))) void controller.sync();
    },
    onConnectivity(connected: boolean | null) {
      if (state.session === "signed-in" && connected && online === false) void controller.sync();
      online = connected;
    },
  };
  return controller;
}
