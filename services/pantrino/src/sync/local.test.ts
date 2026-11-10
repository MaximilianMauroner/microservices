import { describe, expect, it } from "vitest";
import type { KitchenSync } from "./model";
import { createLocalEngine, freshLocalKitchen } from "./local";

function setup() {
  let id = 0;
  let saved: KitchenSync | null = null;
  const newId = () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`;
  const vault = {
    snapshot: async () => saved && structuredClone(saved),
    saveSnapshot: async (next: KitchenSync) => { saved = structuredClone(next); },
  };
  return { vault, newId, engine: createLocalEngine({ vault, newId }) };
}

const ingredient = { type: "ingredient.save", name: "Rice", unit: "g", section: "", notes: "", kcal: null, protein: null, carbs: null, fat: null } as const;

describe("local kitchen", () => {
  it("starts with an empty durable kitchen without a catalogue or account", async () => {
    const { engine, vault } = setup();
    await engine.load();
    expect(engine.getState()).toMatchObject({ mode: "local", pending: 0, status: { kind: "local", persistence: "saved" } });
    const stored = (await vault.snapshot())!.kitchens[0]!;
    expect(stored.kitchen).toMatchObject({ members: [], groups: [], mcpEnabled: false });
    expect([stored.ingredients, stored.recipes, stored.plan, stored.stock, stored.leftovers, stored.extras]).toEqual([[], [], [], [], [], []]);
    expect(freshLocalKitchen(() => "kitchen", "2026-11-07")).toMatchObject({ today: "2026-11-07", planFrom: "2026-11-07" });
  });

  it("compacts repeated edits and restores ingredients, stock, recipes, plans, and shopping after restart", async () => {
    const { engine, vault, newId } = setup();
    await engine.load();
    const kitchenId = engine.getState().view!.kitchens[0]!.kitchen.id;
    await engine.change(kitchenId, ingredient);
    const rice = engine.getState().view!.kitchens[0]!.ingredients[0]!;
    await engine.change(kitchenId, { type: "recipe.save", name: "Rice bowl", servings: 1, minutes: null, instructions: "Cook", lines: [{ ingredientId: rice.id, amount: 100, note: "" }] });
    const recipeId = engine.getState().view!.kitchens[0]!.recipes[0]!.id;
    await engine.change(kitchenId, { type: "plan.add", day: engine.getState().view!.today, meal: "dinner", recipeId, servings: 2 });
    const edits = Array.from({ length: 50 }, () => engine.change(kitchenId, { type: "stock.add", ingredientId: rice.id, amount: 1 }));
    await Promise.all(edits);
    await engine.change(kitchenId, { type: "extra.add", name: "Soap" });
    await engine.stop();
    const restarted = createLocalEngine({ vault, newId });
    await restarted.load();
    const home = restarted.getState().view!.kitchens[0]!;
    expect(home.ingredients[0]).toMatchObject({ name: "Rice", recipeCount: 1 });
    expect(home.stock[0]!.amount).toBe(50);
    expect(home.recipes[0]).toMatchObject({ id: recipeId, name: "Rice bowl" });
    expect(home.plan[0]).toMatchObject({ recipeId, servings: 2, lines: [{ amount: 200 }] });
    expect(home.extras[0]).toMatchObject({ name: "Soap" });
    expect(restarted.getState()).toMatchObject({ pending: 0, notices: [], status: { kind: "local", persistence: "saved" } });
    expect(await vault.snapshot()).toEqual(restarted.getState().view);
  });

  it("shows saving until storage confirms it and waits for accepted edits before a mode switch", async () => {
    const { engine, vault } = setup();
    await engine.load();
    const kitchenId = engine.getState().view!.kitchens[0]!.kitchen.id;
    let finish!: () => void;
    const save = vault.saveSnapshot;
    vault.saveSnapshot = async (next) => { await new Promise<void>((resolve) => { finish = resolve; }); await save(next); };
    const changing = engine.change(kitchenId, ingredient);
    expect(engine.getState().status).toEqual({ kind: "local", persistence: "saving" });
    await Promise.resolve();
    const stopping = engine.stop();
    expect((await vault.snapshot())!.kitchens[0]!.ingredients).toHaveLength(0);
    finish();
    await Promise.all([changing, stopping]);
    expect((await vault.snapshot())!.kitchens[0]!.ingredients[0]!.name).toBe("Rice");
    expect(engine.getState().view).toBeNull();
  });

  it("rolls back failed writes, keeps a visible failure, and saves later independent edits", async () => {
    const { engine, vault, newId } = setup();
    await engine.load();
    const kitchenId = engine.getState().view!.kitchens[0]!.kitchen.id;
    const save = vault.saveSnapshot;
    vault.saveSnapshot = async () => { throw new Error("disk full"); };
    await engine.change(kitchenId, ingredient);
    expect(engine.getState()).toMatchObject({ notices: [{ unsaved: true }], status: { kind: "local", persistence: "failed" } });
    expect(engine.getState().view!.kitchens[0]!.ingredients).toHaveLength(0);
    await engine.sync();
    expect(engine.getState().status).toEqual({ kind: "local", persistence: "failed" });
    vault.saveSnapshot = save;
    await engine.change(kitchenId, { type: "extra.add", name: "Soap" });
    await engine.stop();
    const restarted = createLocalEngine({ vault, newId });
    await restarted.load();
    expect(restarted.getState().view!.kitchens[0]!.ingredients).toHaveLength(0);
    expect(restarted.getState().view!.kitchens[0]!.extras[0]!.name).toBe("Soap");
  });

  it("does not report a saved kitchen when the first write fails", async () => {
    const { engine, vault } = setup();
    vault.saveSnapshot = async () => { throw new Error("disk full"); };
    await expect(engine.load()).rejects.toThrow("disk full");
    expect(engine.getState().view).toBeNull();
    expect(engine.getState().status.kind).not.toBe("local");
  });
});
