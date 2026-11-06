import { describe, expect, it } from "vitest";
import type { AppActionResult } from "@tools-platform/service/kitchen-contract";
import { createSyncEngine } from "./engine";
import type { KitchenSync, Notice, OutboxItem } from "./model";

class SignedOut extends Error {}
class Offline extends Error {}

const empty: KitchenSync = { today: "2026-11-05", planFrom: "2026-10-05", kitchens: [] };

function fakeVault() {
  let seq = 0;
  const data = { snapshot: null as KitchenSync | null, outbox: [] as OutboxItem[], notices: [] as Notice[] };
  return {
    data,
    snapshot: async () => data.snapshot,
    outbox: async () => [...data.outbox],
    enqueue: async (item: Omit<OutboxItem, "seq">) => { data.outbox.push({ ...item, seq: ++seq }); },
    commit: async (snapshot: KitchenSync, answered: readonly string[], refused: readonly Notice[]) => {
      data.snapshot = snapshot;
      data.outbox = data.outbox.filter((one) => !answered.includes(one.clientActionId));
      data.notices.push(...refused);
    },
    notices: async () => [...data.notices],
    dismiss: async (id: string) => { data.notices = data.notices.filter((one) => one.clientActionId !== id); }
  };
}

function setup(server: { push?: (items: readonly OutboxItem[]) => Promise<AppActionResult[]>; pull?: () => Promise<KitchenSync> } = {}) {
  const vault = fakeVault();
  const sent: string[][] = [];
  let ids = 0;
  const engine = createSyncEngine({
    vault,
    api: {
      pull: server.pull ?? (async () => empty),
      push: async (items) => {
        sent.push(items.map((one) => one.clientActionId));
        return server.push ? server.push(items) : items.map((one) => ({ clientActionId: one.clientActionId, status: "applied" as const }));
      }
    },
    project: (snapshot, outbox) => ({ ...snapshot, today: `${snapshot.today}${"+".repeat(outbox.length)}` }),
    newId: () => `change-${++ids}`,
    isSignedOut: (error) => error instanceof SignedOut,
    isOffline: (error) => error instanceof Offline,
    now: () => new Date("2026-11-05T10:00:00Z")
  });
  return { engine, vault, sent };
}

/** An engine started for a signed-in account, as the app has it after sign-in. */
async function started(server: Parameters<typeof setup>[0] = {}) {
  const parts = setup(server);
  await parts.engine.load();
  return parts;
}

const addMilk = { type: "extra.add", name: "Milk" } as const;

describe("sync engine", () => {
  it("shows a change at once and clears it after the server confirms it", async () => {
    const { engine, vault, sent } = await started();
    vault.data.snapshot = empty;
    await engine.load();
    await engine.change("home", addMilk);
    expect(engine.getState().pending, "queued before the sync answers").toBe(1);
    await engine.sync();
    expect(sent).toEqual([["change-1"]]);
    expect(engine.getState()).toMatchObject({ pending: 0, status: { kind: "idle", syncedAt: "2026-11-05T10:00:00.000Z" }, view: { today: "2026-11-05" } });
  });

  it("gives a new item its ID on the phone, so later changes can name it", async () => {
    const { engine, vault } = await started({ push: async () => { throw new Offline(); } });
    await engine.change("home", addMilk);
    await engine.change("home", { type: "extra.remove", id: "x" });
    await engine.sync();
    expect(vault.data.outbox.map((one) => one.action)).toEqual([{ ...addMilk, createId: "change-2" }, { type: "extra.remove", id: "x" }]);
  });

  it("keeps changes and the last snapshot when the phone is offline", async () => {
    const { engine, vault } = await started({ pull: async () => { throw new Offline(); }, push: async () => { throw new Offline(); } });
    vault.data.snapshot = empty;
    await engine.load();
    await engine.change("home", addMilk);
    await engine.sync();
    expect(engine.getState()).toMatchObject({ pending: 1, status: { kind: "offline" }, view: { today: "2026-11-05+" } });
  });

  it("drops a refused change and keeps its message as a notice", async () => {
    const { engine } = await started({ push: async (items) => items.map((one) => ({ clientActionId: one.clientActionId, status: "rejected" as const, message: "Gone." })) });
    await engine.change("home", addMilk);
    await engine.sync();
    expect(engine.getState()).toMatchObject({ pending: 0, notices: [{ clientActionId: "change-1", message: "Gone." }] });
    await engine.dismiss("change-1");
    expect(engine.getState().notices).toEqual([]);
  });

  it("keeps a sent change until a snapshot that contains it is stored, and sends it again after a failed pull", async () => {
    let reachable = false;
    const { engine, vault, sent } = await started({ pull: async () => { if (!reachable) throw new Offline(); return empty; } });
    vault.data.snapshot = empty;
    await engine.load();
    await engine.change("home", addMilk);
    await engine.sync();
    expect(engine.getState(), "the change stays visible while the old snapshot lacks it").toMatchObject({ pending: 1, status: { kind: "offline" }, view: { today: "2026-11-05+" } });
    reachable = true;
    await engine.sync();
    expect(sent.length, "the change was sent again").toBeGreaterThan(1);
    expect(new Set(sent.flat()), "the server answers each repeat with its first outcome").toEqual(new Set(["change-1"]));
    expect(engine.getState()).toMatchObject({ pending: 0, view: { today: "2026-11-05" } });
  });

  it("writes and shows nothing from a sync that was running when the person signed out", async () => {
    let release: () => void = () => undefined;
    const old: KitchenSync = { ...empty, today: "old account" };
    const { engine, vault } = await started({ pull: async () => { await new Promise<void>((resolve) => { release = resolve; }); return old; } });
    const running = engine.sync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await engine.stop();
    release();
    await running;
    expect(vault.data.snapshot).toBeNull();
    expect(engine.getState().view).toBeNull();
  });

  it("sends no further batch after a stop, so another account's token never carries these changes", async () => {
    let release: () => void = () => undefined;
    let pushes = 0;
    const { engine, vault, sent } = await started({ push: async (items) => {
      pushes += 1;
      if (pushes === 1) await new Promise<void>((resolve) => { release = resolve; });
      return items.map((one) => ({ clientActionId: one.clientActionId, status: "applied" as const }));
    } });
    for (let index = 0; index < 201; index += 1) vault.data.outbox.push({ seq: index, clientActionId: `queued-${index}`, kitchenId: "home", queuedAt: "2026-11-05T09:00:00.000Z", action: addMilk });
    const running = engine.sync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await engine.stop();
    release();
    await running;
    expect(sent.map((batch) => batch.length), "only the batch already on its way").toEqual([200]);
  });

  it("ignores changes and syncs while stopped", async () => {
    const { engine, vault, sent } = await started();
    await engine.stop();
    await engine.change("home", addMilk);
    await engine.sync();
    expect(vault.data.outbox).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("asks for sign-in again and keeps the queued changes", async () => {
    const { engine } = await started({ push: async () => { throw new SignedOut(); } });
    await engine.change("home", addMilk);
    await engine.sync();
    expect(engine.getState()).toMatchObject({ signedOut: true, pending: 1 });
  });

  it("runs one more sync for a change made during a sync, never two at once", async () => {
    let release: () => void = () => undefined;
    let calls = 0;
    const { engine, sent } = await started({ pull: async () => { calls += 1; if (calls === 1) await new Promise<void>((resolve) => { release = resolve; }); return empty; } });
    const first = engine.sync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await engine.change("home", addMilk);
    release();
    await first;
    expect(calls).toBe(2);
    expect(sent).toEqual([["change-1"]]);
  });
  it("shows a change before the vault has stored it", async () => {
    const { engine, vault } = await started();
    vault.data.snapshot = empty;
    await engine.load();
    let store: () => void = () => undefined;
    const enqueue = vault.enqueue;
    vault.enqueue = async (item) => { await new Promise<void>((resolve) => { store = resolve; }); await enqueue(item); };
    const changing = engine.change("home", addMilk);
    expect(engine.getState()).toMatchObject({ pending: 1, view: { today: "2026-11-05+" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vault.data.outbox, "the write is still waiting").toHaveLength(0);
    store();
    await changing;
    expect(vault.data.outbox).toHaveLength(1);
  });

  it("takes a change off the screen when the vault cannot store it", async () => {
    const { engine, vault, sent } = await started();
    vault.data.snapshot = empty;
    await engine.load();
    vault.enqueue = async () => { throw new Error("disk full"); };
    await engine.change("home", addMilk);
    expect(engine.getState()).toMatchObject({ pending: 0, view: { today: "2026-11-05" }, notices: [{ clientActionId: "change-1", unsaved: true }] });
    await engine.sync();
    expect(sent.flat()).toEqual([]);
    expect(engine.getState().notices, "the unsaved notice stays after a sync").toEqual([{ clientActionId: "change-1", unsaved: true }]);
    await engine.dismiss("change-1");
    expect(engine.getState().notices).toEqual([]);
  });

  it("sends a run of changes in one sync once the taps settle", async () => {
    const { engine, sent } = await started();
    for (let tap = 0; tap < 3; tap += 1) {
      await engine.change("home", addMilk);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(sent, "nothing goes out while the taps continue").toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(sent, "one push with all three changes").toEqual([["change-1", "change-3", "change-5"]]);
  });
  it("keeps a change on screen when its vault write ends while a sync reads the outbox", async () => {
    const { engine, vault } = await started();
    vault.data.snapshot = empty;
    await engine.load();
    const read = vault.outbox;
    let stale: OutboxItem[] = [];
    let answer: () => void = () => undefined;
    let reads = 0;
    vault.outbox = async () => {
      reads += 1;
      if (reads !== 2) return read();
      stale = await read();
      await new Promise<void>((resolve) => { answer = resolve; });
      return stale;
    };
    const afterReload: { pending: number; today: string | undefined }[] = [];
    engine.subscribe(() => { const state = engine.getState(); if (state.status.kind === "idle") afterReload.push({ pending: state.pending, today: state.view?.today }); });
    const syncing = engine.sync();
    while (reads < 2) await new Promise((resolve) => setTimeout(resolve, 0));
    await engine.change("home", addMilk);
    answer();
    await syncing;
    expect(afterReload[0], "the stored change is still shown after the first reload").toEqual({ pending: 1, today: "2026-11-05+" });
    expect(engine.getState(), "the follow-up sync sends it").toMatchObject({ pending: 0, view: { today: "2026-11-05" } });
  });
  it("takes a change off the screen when a failed commit rolled back its vault write", async () => {
    let commits = 0;
    const { engine, vault, sent } = await started();
    vault.data.snapshot = empty;
    await engine.load();
    const commit = vault.commit;
    vault.commit = async (...args) => {
      commits += 1;
      if (commits === 1) { vault.data.outbox = []; throw new Error("disk full"); }
      return commit(...args);
    };
    await engine.change("home", addMilk);
    await engine.sync();
    expect(engine.getState().status).toMatchObject({ kind: "failed" });
    await engine.sync();
    expect(engine.getState(), "the screen matches the vault again").toMatchObject({ pending: 0, view: { today: "2026-11-05" } });
    expect(sent.flat()).toEqual(["change-1"]);
  });
  it("stores a change made during a commit only after the commit ends", async () => {
    const { engine, vault } = await started();
    const order: string[] = [];
    let finish: () => void = () => undefined;
    const commit = vault.commit;
    vault.commit = async (...args) => { order.push("commit starts"); await new Promise<void>((resolve) => { finish = resolve; }); await commit(...args); order.push("commit ends"); };
    const enqueue = vault.enqueue;
    vault.enqueue = async (item) => { order.push("write"); await enqueue(item); };
    const syncing = engine.sync();
    while (!order.length) await new Promise((resolve) => setTimeout(resolve, 0));
    const changing = engine.change("home", addMilk);
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish();
    await Promise.all([syncing, changing]);
    expect(order).toEqual(["commit starts", "commit ends", "write"]);
  });
});
