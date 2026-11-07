import { describe, expect, it, vi } from "vitest";
import type { KitchenSync, Notice, OutboxItem } from "./sync/model";
import { createSyncEngine } from "./sync/engine";
import { createLocalEngine, freshLocalKitchen } from "./sync/local";
import { project } from "./sync/project";
import { createKitchenSession } from "./kitchen-session";

function memoryVault() {
  const settings = new Map<string, string>();
  let outbox: OutboxItem[] = [];
  let seq = 0;
  return {
    settings,
    snapshot: async () => settings.has("snapshot") ? JSON.parse(settings.get("snapshot")!) as KitchenSync : null,
    saveSnapshot: async (next: KitchenSync) => { settings.set("snapshot", JSON.stringify(next)); },
    outbox: async () => [...outbox],
    enqueue: async (item: Omit<OutboxItem, "seq">) => { outbox.push({ ...item, seq: ++seq }); },
    commit: async (next: KitchenSync, answered: readonly string[]) => {
      settings.set("snapshot", JSON.stringify(next));
      outbox = outbox.filter((one) => !answered.includes(one.clientActionId));
    },
    notices: async () => [] as Notice[],
    dismiss: async () => undefined,
    setting: async (key: string) => settings.get(key) ?? null,
    saveSetting: async (key: string, value: string) => { settings.set(key, value); },
    wipe: vi.fn(async () => { settings.clear(); outbox = []; }),
  };
}

function fixture() {
  const localVault = memoryVault();
  const accountVault = memoryVault();
  let id = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`;
  const server = freshLocalKitchen(newId, "2026-11-07");
  const pull = vi.fn(async () => server);
  const push = vi.fn(async (items: readonly OutboxItem[]) => items.map(({ clientActionId }) => ({ clientActionId, status: "applied" as const })));
  const storedAccount = vi.fn(async (): Promise<string | null> => null);
  const install = vi.fn(async () => undefined);
  const signIn = vi.fn(async () => ({ account: "account-a", install }));
  const signOut = vi.fn(async () => undefined);
  const allowNetwork = vi.fn();
  function mount() {
    const accountEngine = createSyncEngine({ vault: accountVault, api: { pull, push }, project, newId, isSignedOut: () => false, isOffline: () => false });
    const localEngine = createLocalEngine({ vault: localVault, newId });
    const session = createKitchenSession({ accountEngine, localEngine, accountVault, localVault, wipeAccount: accountVault.wipe, auth: { storedAccount, signIn, signOut }, allowNetwork });
    return { session, accountEngine, localEngine };
  }
  return { mount, localVault, accountVault, pull, push, storedAccount, signIn, signOut, allowNetwork, server };
}

describe("kitchen session modes", () => {
  it("opens a fresh install locally, blocks all sync triggers, and restores local mode without reading credentials", async () => {
    const app = fixture();
    const { session } = app.mount();
    await session.start();
    expect(session.getState().session).toBe("signed-out");
    await session.openLocal();
    const localId = session.getSyncState().view!.kitchens[0]!.kitchen.id;
    await session.change(localId, { type: "extra.add", name: "Tea" });
    session.onConnectivity(false);
    session.onConnectivity(true);
    session.onAppState("active");
    session.onAppState("background");
    await session.sync();
    expect(app.pull).not.toHaveBeenCalled();
    expect(app.push).not.toHaveBeenCalled();
    expect(app.allowNetwork.mock.calls.every(([allowed]) => allowed === false)).toBe(true);
    expect(app.signOut).not.toHaveBeenCalled();
    app.storedAccount.mockClear();
    const restored = app.mount().session;
    await restored.start();
    expect(app.storedAccount).not.toHaveBeenCalled();
    expect(restored.getState()).toMatchObject({ session: "local", hasLocal: true });
    expect(restored.getSyncState().view!.kitchens[0]!.extras[0]!.name).toBe("Tea");
    expect(await app.accountVault.snapshot()).toBeNull();
    expect(await app.accountVault.outbox()).toEqual([]);
  });

  it("preserves local data across sign-in, sign-out, and account replacement without uploading or merging it", async () => {
    const app = fixture();
    const { session } = app.mount();
    await session.start();
    await session.openLocal();
    const localId = session.getSyncState().view!.kitchens[0]!.kitchen.id;
    await session.change(localId, { type: "extra.add", name: "Local tea" });
    await session.saveSetting("language", "de");
    const local = await app.localVault.snapshot();
    await session.showSignIn();
    expect(session.getState()).toMatchObject({ session: "signed-out", hasLocal: true });
    expect(session.getSyncState().view).toBeNull();
    await session.signIn();
    await session.sync();
    expect(session.getSyncState().view).toEqual(app.server);
    expect(await session.setting("language")).toBeNull();
    expect(await app.localVault.snapshot()).toEqual(local);
    await session.change(localId, { type: "extra.add", name: "Stale local screen" });
    await session.sync();
    expect(app.push).not.toHaveBeenCalled();
    await session.signOut();
    expect(app.signOut).toHaveBeenCalledOnce();
    expect(await app.accountVault.snapshot()).toBeNull();
    expect(await app.localVault.snapshot()).toEqual(local);
    await session.openLocal();
    expect(session.getSyncState().view).toEqual(local);
    expect(await session.setting("language")).toBe("de");
    await session.showSignIn();
    app.signIn.mockResolvedValue({ account: "account-b", install: vi.fn(async () => undefined) });
    await session.signIn();
    await session.sync();
    expect(await app.accountVault.setting("account")).toBe("account-b");
    expect(await app.localVault.snapshot()).toEqual(local);
    expect(await app.accountVault.outbox()).toEqual([]);
    await session.showSignIn();
  });

  it("can leave sign-in and return to local mode while keeping an expired account's unsent changes separate", async () => {
    const app = fixture();
    await app.accountVault.saveSetting("account", "account-a");
    await app.accountVault.enqueue({ clientActionId: "old", kitchenId: "account-kitchen", queuedAt: "2026-11-07T12:00:00Z", action: { type: "extra.add", name: "Account coffee" } });
    const { session } = app.mount();
    await session.start();
    await session.openLocal();
    await session.showSignIn();
    const restarted = app.mount().session;
    await restarted.start();
    expect(restarted.getState()).toMatchObject({ session: "signed-out", hasLocal: true });
    await restarted.openLocal();
    await restarted.sync();
    expect(await app.accountVault.outbox()).toHaveLength(1);
    expect(app.accountVault.wipe).not.toHaveBeenCalled();
    expect(app.pull).not.toHaveBeenCalled();
    expect(app.push).not.toHaveBeenCalled();
  });

  it("returns to onboarding with an error when local storage cannot save the first snapshot", async () => {
    const app = fixture();
    app.localVault.saveSnapshot = async () => { throw new Error("disk full"); };
    const { session } = app.mount();
    await session.start();
    await expect(session.openLocal()).rejects.toThrow("disk full");
    expect(session.getState()).toMatchObject({ session: "signed-out", error: true, hasLocal: false });
    expect(session.getSyncState().view).toBeNull();
    expect(app.pull).not.toHaveBeenCalled();
    expect(app.allowNetwork.mock.calls.every(([allowed]) => allowed === false)).toBe(true);
  });

  it("opens account kitchens when the separate local vault cannot be read or written", async () => {
    const app = fixture();
    const local = freshLocalKitchen(() => "local", "2026-11-07");
    await app.localVault.saveSnapshot(local);
    app.localVault.snapshot = async () => { throw new Error("missing local key"); };
    app.localVault.setting = async () => { throw new Error("missing local key"); };
    app.localVault.saveSetting = async () => { throw new Error("missing local key"); };
    app.storedAccount.mockResolvedValue("account-a");
    const { session } = app.mount();
    await session.start();
    await session.sync();
    expect(session.getState().session).toBe("signed-in");
    expect(session.getSyncState().view).toEqual(app.server);
    await session.signOut();
    await session.signIn();
    await session.sync();
    expect(session.getState().session).toBe("signed-in");
    expect(JSON.parse(app.localVault.settings.get("snapshot")!)).toEqual(local);
    await session.showSignIn();
    await expect(session.openLocal()).rejects.toThrow("missing local key");
    expect(session.getState()).toMatchObject({ session: "signed-out", error: true });
  });

  it("does not mark a sign-in failure as a local storage failure", async () => {
    const app = fixture();
    app.signIn.mockRejectedValue(new Error("network unavailable"));
    const { session } = app.mount();
    await session.start();
    await expect(session.signIn()).rejects.toThrow("network unavailable");
    expect(session.getState()).toMatchObject({ session: "signed-out", error: false });
  });
});
