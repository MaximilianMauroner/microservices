import type { AppActionResult } from "@tools-platform/service/kitchen-contract";
import type { KitchenApi } from "./api";
import type { KitchenSync, Notice, OutboxItem, QueuedAction, SyncStatus } from "./model";
import type { Vault } from "../storage/vault";

/** What the screens read: the server snapshot with the unconfirmed changes applied on top. */
export type SyncState = Readonly<{
  view: KitchenSync | null;
  pending: number;
  notices: readonly Notice[];
  status: SyncStatus;
  signedOut: boolean;
}>;

type Deps = Readonly<{
  vault: Pick<Vault, "snapshot" | "outbox" | "enqueue" | "commit" | "notices" | "dismiss">;
  api: KitchenApi;
  project: (snapshot: KitchenSync, outbox: readonly OutboxItem[]) => KitchenSync;
  newId: () => string;
  isSignedOut: (error: unknown) => boolean;
  isOffline: (error: unknown) => boolean;
  now?: () => Date;
}>;

const BATCH = 200;

const INITIAL: SyncState = { view: null, pending: 0, notices: [], status: { kind: "idle", syncedAt: null }, signedOut: false };

/**
 * Keeps the local copy and the server in step. A sync sends the outbox in order, then replaces the snapshot.
 * The sent changes leave the outbox only together with a snapshot that contains them; until then they are sent
 * again, and the server answers a repeat with its first outcome.
 * Only one sync runs at a time; a request during a sync runs one more sync after it.
 *
 * The engine serves one signed-in account at a time. `load` starts it for the stored account and `stop` ends it.
 * Each start is a new epoch. Work from an earlier epoch never sends, stores, or shows anything, so one account's
 * kitchens and changes cannot reach another account.
 */
export function createSyncEngine({ vault, api, project, newId, isSignedOut, isOffline, now = () => new Date() }: Deps) {
  let state: SyncState = INITIAL;
  let snapshot: KitchenSync | null = null;
  let syncedAt: string | null = null;
  let running: { epoch: number; done: Promise<void> } | undefined;
  let again = false;
  let epoch = 0;
  let stopped = true;
  let writing: Promise<void> | undefined;
  const listeners = new Set<() => void>();

  async function refresh(mine: number, patch: Partial<SyncState> = {}) {
    const [outbox, notices] = await Promise.all([vault.outbox(), vault.notices()]);
    if (mine !== epoch) return;
    state = { ...state, ...patch, view: snapshot && project(snapshot, outbox), pending: outbox.length, notices };
    for (const listener of listeners) listener();
  }

  async function once(mine: number) {
    await refresh(mine, { status: { kind: "syncing" } });
    try {
      const outbox = await vault.outbox();
      const results: AppActionResult[] = [];
      for (let start = 0; start < outbox.length; start += BATCH) {
        if (mine !== epoch) return;
        results.push(...await api.push(outbox.slice(start, start + BATCH)));
      }
      if (mine !== epoch) return;
      const fresh = await api.pull();
      if (mine !== epoch) return;
      writing = vault.commit(fresh, results.map((one) => one.clientActionId), results.filter(isRejected).map(({ clientActionId, message }) => ({ clientActionId, message })));
      await writing;
      if (mine !== epoch) return;
      snapshot = fresh;
      syncedAt = now().toISOString();
      await refresh(mine, { status: { kind: "idle", syncedAt }, signedOut: false });
    } catch (error) {
      if (mine !== epoch) return;
      if (isSignedOut(error)) await refresh(mine, { status: { kind: "idle", syncedAt }, signedOut: true });
      else if (isOffline(error)) await refresh(mine, { status: { kind: "offline", syncedAt } });
      else await refresh(mine, { status: { kind: "failed", message: error instanceof Error ? error.message : String(error) } });
    }
  }

  const engine = {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Starts the engine for the stored account and shows what is on the phone at once, before the first sync answers. */
    async load() {
      epoch += 1;
      stopped = false;
      const mine = epoch;
      const saved = await vault.snapshot();
      if (mine !== epoch) return;
      snapshot = saved;
      await refresh(mine);
    },
    sync(): Promise<void> {
      if (stopped) return Promise.resolve();
      if (running?.epoch === epoch) {
        again = true;
        return running.done;
      }
      const mine = epoch;
      const done = (async () => {
        do {
          again = false;
          await once(mine);
        } while (again && !state.signedOut && mine === epoch);
      })().finally(() => { if (running?.epoch === mine) running = undefined; });
      running = { epoch: mine, done };
      return done;
    },
    /** Ends the engine before sign-in or sign-out changes the vault. Waits for a vault write that already started. */
    async stop() {
      epoch += 1;
      stopped = true;
      again = false;
      snapshot = null;
      syncedAt = null;
      await writing?.catch(() => undefined);
      state = INITIAL;
      for (const listener of listeners) listener();
    },
    /** Queues a change, shows it at once, and sends it when the server can be reached. */
    async change(kitchenId: string, action: QueuedAction) {
      if (stopped) return;
      const mine = epoch;
      try {
        await vault.enqueue({ clientActionId: newId(), kitchenId, queuedAt: now().toISOString(), action: withCreateId(action, newId) });
      } catch (error) {
        if (mine === epoch) throw error;
        return;
      }
      if (mine !== epoch) return;
      await refresh(mine);
      void engine.sync();
    },
    async dismiss(clientActionId: string) {
      if (stopped) return;
      const mine = epoch;
      await vault.dismiss(clientActionId);
      await refresh(mine);
    }
  };
  return engine;
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;

/** A new item gets its ID on the phone, so later offline changes can name it and the server keeps the same ID. */
function withCreateId(action: QueuedAction, newId: () => string): QueuedAction {
  if (action.type === "plan.cook") return action.leftover && !action.leftover.createId ? { ...action, leftover: { ...action.leftover, createId: newId() } } : action;
  const creates = action.type === "plan.add" || action.type === "leftover.add" || action.type === "extra.add"
    || ((action.type === "ingredient.save" || action.type === "recipe.save") && !action.id);
  return creates && !action.createId ? { ...action, createId: newId() } as QueuedAction : action;
}

function isRejected(result: AppActionResult): result is AppActionResult & { status: "rejected"; message: string } {
  return result.status === "rejected";
}
