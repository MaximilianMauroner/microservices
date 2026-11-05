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
 */
export function createSyncEngine({ vault, api, project, newId, isSignedOut, isOffline, now = () => new Date() }: Deps) {
  let state: SyncState = INITIAL;
  let snapshot: KitchenSync | null = null;
  let syncedAt: string | null = null;
  let running: Promise<void> | undefined;
  let again = false;
  // Sign-out raises the epoch, so a sync that started before it never writes into the new, empty vault.
  let epoch = 0;
  let writing: Promise<void> | undefined;
  const listeners = new Set<() => void>();

  async function refresh(patch: Partial<SyncState> = {}) {
    const [outbox, notices] = await Promise.all([vault.outbox(), vault.notices()]);
    state = { ...state, ...patch, view: snapshot && project(snapshot, outbox), pending: outbox.length, notices };
    for (const listener of listeners) listener();
  }

  async function once() {
    const mine = epoch;
    await refresh({ status: { kind: "syncing" } });
    try {
      const outbox = await vault.outbox();
      const results: AppActionResult[] = [];
      for (let start = 0; start < outbox.length; start += BATCH) results.push(...await api.push(outbox.slice(start, start + BATCH)));
      const fresh = await api.pull();
      if (mine !== epoch) return;
      writing = vault.commit(fresh, results.map((one) => one.clientActionId), results.filter(isRejected).map(({ clientActionId, message }) => ({ clientActionId, message })));
      await writing;
      snapshot = fresh;
      syncedAt = now().toISOString();
      await refresh({ status: { kind: "idle", syncedAt }, signedOut: false });
    } catch (error) {
      if (mine !== epoch) return;
      if (isSignedOut(error)) await refresh({ status: { kind: "idle", syncedAt }, signedOut: true });
      else if (isOffline(error)) await refresh({ status: { kind: "offline", syncedAt } });
      else await refresh({ status: { kind: "failed", message: error instanceof Error ? error.message : String(error) } });
    }
  }

  const engine = {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Shows what is on the phone at once, before the first sync answers. */
    async load() {
      snapshot = await vault.snapshot();
      await refresh();
    },
    sync(): Promise<void> {
      if (running) {
        again = true;
        return running;
      }
      running = (async () => {
        do {
          again = false;
          await once();
        } while (again && !state.signedOut);
      })().finally(() => { running = undefined; });
      return running;
    },
    /** Stops every running sync from writing, before sign-out deletes the vault. */
    async stop() {
      epoch += 1;
      again = false;
      snapshot = null;
      syncedAt = null;
      await writing?.catch(() => undefined);
      state = INITIAL;
      for (const listener of listeners) listener();
    },
    /** Queues a change, shows it at once, and sends it when the server can be reached. */
    async change(kitchenId: string, action: QueuedAction) {
      await vault.enqueue({ clientActionId: newId(), kitchenId, queuedAt: now().toISOString(), action: withCreateId(action, newId) });
      await refresh();
      void engine.sync();
    },
    async dismiss(clientActionId: string) {
      await vault.dismiss(clientActionId);
      await refresh();
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
