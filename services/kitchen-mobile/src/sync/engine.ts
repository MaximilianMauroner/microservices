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
  vault: Pick<Vault, "snapshot" | "saveSnapshot" | "outbox" | "enqueue" | "settle" | "notices" | "dismiss">;
  api: KitchenApi;
  project: (snapshot: KitchenSync, outbox: readonly OutboxItem[]) => KitchenSync;
  newId: () => string;
  isSignedOut: (error: unknown) => boolean;
  isOffline: (error: unknown) => boolean;
  now?: () => Date;
}>;

const BATCH = 200;

/**
 * Keeps the local copy and the server in step. A sync sends the outbox in order, then replaces the snapshot.
 * Only one sync runs at a time; a request during a sync runs one more sync after it.
 */
export function createSyncEngine({ vault, api, project, newId, isSignedOut, isOffline, now = () => new Date() }: Deps) {
  let state: SyncState = { view: null, pending: 0, notices: [], status: { kind: "idle", syncedAt: null }, signedOut: false };
  let snapshot: KitchenSync | null = null;
  let syncedAt: string | null = null;
  let running: Promise<void> | undefined;
  let again = false;
  const listeners = new Set<() => void>();

  async function refresh(patch: Partial<SyncState> = {}) {
    const [outbox, notices] = await Promise.all([vault.outbox(), vault.notices()]);
    state = { ...state, ...patch, view: snapshot && project(snapshot, outbox), pending: outbox.length, notices };
    for (const listener of listeners) listener();
  }

  async function once() {
    await refresh({ status: { kind: "syncing" } });
    try {
      for (let outbox = await vault.outbox(); outbox.length; outbox = await vault.outbox()) {
        const results = await api.push(outbox.slice(0, BATCH));
        await vault.settle(results.map((one) => one.clientActionId), results.filter(isRejected).map(({ clientActionId, message }) => ({ clientActionId, message })));
      }
      snapshot = await api.pull();
      await vault.saveSnapshot(snapshot);
      syncedAt = now().toISOString();
      await refresh({ status: { kind: "idle", syncedAt }, signedOut: false });
    } catch (error) {
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
    /** Queues a change, shows it at once, and sends it when the server can be reached. */
    async change(kitchenId: string, action: QueuedAction) {
      await vault.enqueue({ clientActionId: newId(), kitchenId, action: withCreateId(action, newId) });
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
  const creates = action.type === "plan.add" || action.type === "leftover.add" || action.type === "extra.add"
    || ((action.type === "ingredient.save" || action.type === "recipe.save") && !action.id);
  return creates && !action.createId ? { ...action, createId: newId() } as QueuedAction : action;
}

function isRejected(result: AppActionResult): result is AppActionResult & { status: "rejected"; message: string } {
  return result.status === "rejected";
}
