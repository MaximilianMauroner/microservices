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
  let outbox: OutboxItem[] = [];
  const unwritten = new Set<string>();
  let writes: Promise<unknown> = Promise.resolve();
  let syncedAt: string | null = null;
  let running: { epoch: number; done: Promise<void> } | undefined;
  let again = false;
  let epoch = 0;
  let stopped = true;
  let writing: Promise<void> | undefined;
  const listeners = new Set<() => void>();

  function publish(patch: Partial<SyncState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  async function reload(mine: number, patch: Partial<SyncState> = {}) {
    const [stored, notices] = await Promise.all([vault.outbox(), vault.notices()]);
    if (mine !== epoch) return;
    const last = stored.at(-1)?.seq ?? 0;
    outbox = [...stored, ...outbox.filter((item) => unwritten.has(item.clientActionId)).map((item, index) => ({ ...item, seq: last + index + 1 }))];
    publish({ ...patch, view: snapshot && project(snapshot, outbox), pending: outbox.length, notices });
  }

  async function once(mine: number) {
    publish({ status: { kind: "syncing" } });
    try {
      await writes.catch(() => undefined);
      const sending = await vault.outbox();
      const results: AppActionResult[] = [];
      for (let start = 0; start < sending.length; start += BATCH) {
        if (mine !== epoch) return;
        results.push(...await api.push(sending.slice(start, start + BATCH)));
      }
      if (mine !== epoch) return;
      const fresh = await api.pull();
      if (mine !== epoch) return;
      writing = vault.commit(fresh, results.map((one) => one.clientActionId), results.filter(isRejected).map(({ clientActionId, message }) => ({ clientActionId, message })));
      await writing;
      if (mine !== epoch) return;
      snapshot = fresh;
      syncedAt = now().toISOString();
      await reload(mine, { status: { kind: "idle", syncedAt }, signedOut: false });
    } catch (error) {
      if (mine !== epoch) return;
      if (isSignedOut(error)) publish({ status: { kind: "idle", syncedAt }, signedOut: true });
      else if (isOffline(error)) publish({ status: { kind: "offline", syncedAt } });
      else publish({ status: { kind: "failed", message: error instanceof Error ? error.message : String(error) } });
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
      outbox = [];
      await reload(mine);
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
      outbox = [];
      unwritten.clear();
      syncedAt = null;
      await Promise.all([writing?.catch(() => undefined), writes.catch(() => undefined)]);
      state = INITIAL;
      for (const listener of listeners) listener();
    },
    /**
     * Queues a change and shows it at once: the change goes on top of the current view, so the screen does not wait for
     * the vault or replay the whole outbox. The vault write follows in order. If it fails, the change leaves the screen.
     */
    async change(kitchenId: string, action: QueuedAction) {
      if (stopped) return;
      const mine = epoch;
      const item: OutboxItem = { seq: (outbox.at(-1)?.seq ?? 0) + 1, clientActionId: newId(), kitchenId, queuedAt: now().toISOString(), action: withCreateId(action, newId) };
      outbox = [...outbox, item];
      unwritten.add(item.clientActionId);
      publish({ view: state.view && project(state.view, [item]), pending: outbox.length });
      const { seq: _, ...stored } = item;
      const written = writes.catch(() => undefined).then(() => vault.enqueue(stored));
      writes = written;
      try {
        await written;
      } catch (error) {
        if (mine !== epoch) return;
        unwritten.delete(item.clientActionId);
        outbox = outbox.filter((one) => one.clientActionId !== item.clientActionId);
        publish({ view: snapshot && project(snapshot, outbox), pending: outbox.length });
        throw error;
      }
      if (mine !== epoch) return;
      unwritten.delete(item.clientActionId);
      void engine.sync();
    },
    async dismiss(clientActionId: string) {
      if (stopped) return;
      const mine = epoch;
      await vault.dismiss(clientActionId);
      if (mine !== epoch) return;
      publish({ notices: state.notices.filter((one) => one.clientActionId !== clientActionId) });
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
