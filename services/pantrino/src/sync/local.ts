import { today, type KitchenSync } from "@tools-platform/service/kitchen-contract";
import type { LocalVault } from "../storage/vault";
import { INITIAL, type SyncEngine, type SyncState, withCreateId } from "./engine";
import type { OutboxItem } from "./model";
import { project } from "./project";

export function freshLocalKitchen(newId: () => string, day = today()): KitchenSync {
  return {
    today: day, planFrom: day,
    kitchens: [{
      kitchen: { id: newId(), name: "My kitchen", mcpEnabled: false, hidden: false, members: [], groups: [] },
      ingredients: [], recipes: [], plan: [], stock: [], leftovers: [], extras: [],
    }],
  };
}

export function createLocalEngine({ vault, newId }: { vault: Pick<LocalVault, "snapshot" | "saveSnapshot">; newId: () => string }): SyncEngine {
  let state: SyncState = INITIAL;
  let snapshot: KitchenSync | null = null;
  let pending: OutboxItem[] = [];
  let writes: Promise<void> = Promise.resolve();
  let stopped = true;
  let epoch = 0;
  const listeners = new Set<() => void>();

  function publish(patch: Partial<SyncState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async load() {
      const mine = ++epoch;
      const saved = await vault.snapshot();
      const fresh = saved ?? freshLocalKitchen(newId);
      if (!saved) await vault.saveSnapshot(fresh);
      if (mine !== epoch) return;
      snapshot = fresh;
      stopped = false;
      publish({ ...INITIAL, mode: "local", view: fresh, status: { kind: "local", persistence: "saved" } });
    },
    async stop() {
      epoch += 1;
      stopped = true;
      await writes;
      snapshot = null;
      pending = [];
      publish(INITIAL);
    },
    async sync() {
      await writes;
    },
    change(kitchenId, action) {
      if (stopped || !snapshot?.kitchens.some((one) => one.kitchen.id === kitchenId)) return Promise.resolve();
      const mine = epoch;
      const item: OutboxItem = { seq: 0, kitchenId, clientActionId: newId(), queuedAt: new Date().toISOString(), action: withCreateId(action, newId) };
      pending = [...pending, item];
      publish({ view: project(snapshot, pending), status: { kind: "local", persistence: "saving" } });
      writes = writes.then(async () => {
        const fresh = project(snapshot!, [item]);
        try {
          await vault.saveSnapshot(fresh);
          snapshot = fresh;
        } catch {
          if (mine === epoch) publish({ notices: [...state.notices, { clientActionId: item.clientActionId, unsaved: true }] });
        }
        pending = pending.filter((one) => one !== item);
        if (mine !== epoch) return;
        publish({
          view: project(snapshot!, pending),
          status: { kind: "local", persistence: pending.length ? "saving" : state.notices.length ? "failed" : "saved" },
        });
      });
      return writes;
    },
    async dismiss(clientActionId) {
      if (stopped) return;
      publish({ notices: state.notices.filter((one) => one.clientActionId !== clientActionId) });
    },
  };
}
