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
    saveSnapshot: async (snapshot: KitchenSync) => { data.snapshot = snapshot; },
    outbox: async () => [...data.outbox],
    enqueue: async (item: Omit<OutboxItem, "seq">) => { data.outbox.push({ ...item, seq: ++seq }); },
    settle: async (answered: readonly string[], refused: readonly Notice[]) => {
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
    project: (snapshot, outbox) => ({ ...snapshot, today: `${snapshot.today}+${outbox.length}` }),
    newId: () => `change-${++ids}`,
    isSignedOut: (error) => error instanceof SignedOut,
    isOffline: (error) => error instanceof Offline,
    now: () => new Date("2026-11-05T10:00:00Z")
  });
  return { engine, vault, sent };
}

const addMilk = { type: "extra.add", name: "Milk" } as const;

describe("sync engine", () => {
  it("shows a change at once and clears it after the server confirms it", async () => {
    const { engine, vault, sent } = setup();
    vault.data.snapshot = empty;
    await engine.load();
    await engine.change("home", addMilk);
    expect(engine.getState().pending, "queued before the sync answers").toBe(1);
    await engine.sync();
    expect(sent).toEqual([["change-1"]]);
    expect(engine.getState()).toMatchObject({ pending: 0, status: { kind: "idle", syncedAt: "2026-11-05T10:00:00.000Z" }, view: { today: "2026-11-05+0" } });
  });

  it("gives a new item its ID on the phone, so later changes can name it", async () => {
    const { engine, vault } = setup({ push: async () => { throw new Offline(); } });
    await engine.change("home", addMilk);
    await engine.change("home", { type: "extra.remove", id: "x" });
    await engine.sync();
    expect(vault.data.outbox.map((one) => one.action)).toEqual([{ ...addMilk, createId: "change-2" }, { type: "extra.remove", id: "x" }]);
  });

  it("keeps changes and the last snapshot when the phone is offline", async () => {
    const { engine, vault } = setup({ pull: async () => { throw new Offline(); }, push: async () => { throw new Offline(); } });
    vault.data.snapshot = empty;
    await engine.load();
    await engine.change("home", addMilk);
    await engine.sync();
    expect(engine.getState()).toMatchObject({ pending: 1, status: { kind: "offline" }, view: { today: "2026-11-05+1" } });
  });

  it("drops a refused change and keeps its message as a notice", async () => {
    const { engine } = setup({ push: async (items) => items.map((one) => ({ clientActionId: one.clientActionId, status: "rejected" as const, message: "Gone." })) });
    await engine.change("home", addMilk);
    await engine.sync();
    expect(engine.getState()).toMatchObject({ pending: 0, notices: [{ clientActionId: "change-1", message: "Gone." }] });
    await engine.dismiss("change-1");
    expect(engine.getState().notices).toEqual([]);
  });

  it("asks for sign-in again and keeps the queued changes", async () => {
    const { engine } = setup({ push: async () => { throw new SignedOut(); } });
    await engine.change("home", addMilk);
    await engine.sync();
    expect(engine.getState()).toMatchObject({ signedOut: true, pending: 1 });
  });

  it("runs one more sync for a change made during a sync, never two at once", async () => {
    let release: () => void = () => undefined;
    let calls = 0;
    const { engine, sent } = setup({ pull: async () => { calls += 1; if (calls === 1) await new Promise<void>((resolve) => { release = resolve; }); return empty; } });
    const first = engine.sync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await engine.change("home", addMilk);
    release();
    await first;
    expect(calls).toBe(2);
    expect(sent).toEqual([["change-1"]]);
  });
});
