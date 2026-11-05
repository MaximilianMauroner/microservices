import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PlatformPrincipal } from "#security";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../../../platform/database/postgres-push-guard.js";
import { applyAppActions } from "../../../products/kitchen/actions.js";
import { kitchenStore } from "../../../products/kitchen/repository.js";
import { handleKitchenActions, handleKitchenSync, kitchenSync, type KitchenSync } from "../../../products/kitchen/sync.js";
import { requireLoopbackPostgres } from "../../harness/postgres.ts";

const databaseUrl = process.env.TEST_DATABASE_URL ? requireLoopbackPostgres(process.env.TEST_DATABASE_URL) : undefined;
const confirmed = process.env.MONEY_TEST_DATABASE_CONFIRM === "money-repository-test";
const sql = databaseUrl && confirmed ? postgres(databaseUrl, { max: 2 }) : undefined;

const admin: PlatformPrincipal = { role: "admin", subject: "admin-subject", email: "admin@example.test" };
const friend: PlatformPrincipal = { role: "member", subject: "friend-subject", email: "friend@example.test", products: ["kitchen"] };
const noNutrition = { kcal: null, protein: null, carbs: null, fat: null };
const wednesday = new Date("2026-11-04T12:00:00Z");
const queuedAt = "2026-11-04T09:00:00Z";

beforeEach(async () => {
  if (!sql) return;
  await withVerifiedDisposableDatabase({
    readRelationKind: async () => (await sql<{ kind: string }[]>`
      select c.relkind::text kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${DISPOSABLE_DATABASE_SENTINEL.relation}`)[0]?.kind,
    readValue: async () => (await sql<{ value: string }[]>`
      select sentinel_value value from public.tools_runtime_test_sentinel
      where sentinel_key = ${DISPOSABLE_DATABASE_SENTINEL.key}`)[0]?.value,
  }, async () => {
    await sql`truncate tools.kitchens, tools.people cascade`;
  });
});

afterAll(async () => { await sql?.end(); });

async function homeWithFriend() {
  const store = kitchenStore(sql!);
  const friendId = randomUUID();
  await sql!`insert into tools.people (id, email, google_subject, invited_at) values (${friendId}, ${friend.email}, ${friend.subject}, now())`;
  const home = await store.admin(admin).create("Home");
  await store.admin(admin).addMember(home.id, friendId);
  await store.admin(admin).create("Office");
  return { store, kitchen: await store.open(friend, home.id) };
}

describe.skipIf(!sql)("Kitchen app sync", () => {
  it("returns each kitchen the person can open, with the plan from four weeks back and the week each extra is bought for", async () => {
    const { store, kitchen } = await homeWithFriend();
    const rice = await kitchen.saveIngredient(undefined, { name: "Rice", unit: "g", section: "Grains", nutrition: noNutrition, notes: "" });
    const bowl = await kitchen.saveRecipe(undefined, { name: "Rice bowl", servings: 2, minutes: 15, instructions: "", lines: [{ ingredientId: rice.id, amount: 150, note: "" }] });
    await kitchen.plan({ day: "2026-10-04", meal: "dinner", recipeId: bowl.id, servings: 2 });
    const kept = await kitchen.plan({ day: "2026-10-05", meal: "lunch", recipeId: bowl.id, servings: 2 });
    const future = await kitchen.plan({ day: "2027-01-10", meal: "dinner", recipeId: bowl.id, servings: 3 });
    await kitchen.setStock(rice.id, 500);
    await kitchen.addLeftover({ name: "Soup", servings: 2, useBy: "2026-11-06" });
    const milk = await kitchen.addExtra("Milk", true);
    await kitchen.markExtra(milk.id, "2026-11-02", true);

    const snapshot = await kitchenSync(store, friend, wednesday);

    expect(snapshot.today).toBe("2026-11-04");
    expect(snapshot.planFrom).toBe("2026-10-05");
    expect(snapshot.kitchens.map((one) => one.kitchen.name), "a member sees only their own kitchens").toEqual(["Home"]);
    const [home] = snapshot.kitchens;
    expect(home!.plan.map((entry) => entry.id)).toEqual([kept.id, future.id]);
    expect(home!.plan[0]!.lines).toEqual([expect.objectContaining({ ingredientId: rice.id, amount: 150 })]);
    expect(home!.recipes.map((one) => one.name)).toEqual(["Rice bowl"]);
    expect(home!.ingredients.map((one) => one.name)).toEqual(["Rice"]);
    expect(home!.stock).toEqual([expect.objectContaining({ ingredientId: rice.id, amount: 500 })]);
    expect(home!.leftovers).toEqual([expect.objectContaining({ name: "Soup", useBy: "2026-11-06" })]);
    expect(home!.extras).toEqual([{ id: milk.id, name: "Milk", everyWeek: true, boughtWeek: "2026-11-02" }]);
    expect((await kitchenSync(store, admin, wednesday)).kitchens.map((one) => one.kitchen.name)).toEqual(["Home", "Office"]);
  });

  it("answers 401 without an app token, 403 without Kitchen access, and an uncached snapshot otherwise", async () => {
    const { store } = await homeWithFriend();
    const request = new Request("https://tools.example.test/api/kitchen/sync");
    const refused = await handleKitchenSync(request, async () => undefined, store);
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toBe("Bearer");
    const noGrant = await handleKitchenSync(request, async () => ({ ...friend, products: [] }), store);
    expect(noGrant.status).toBe(403);
    const ok = await handleKitchenSync(request, async () => friend, store);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(((await ok.json()) as KitchenSync).kitchens.map((one) => one.kitchen.name)).toEqual(["Home"]);
  });

  it("applies an offline batch in order, with app-chosen IDs that later changes in the batch name", async () => {
    const { store, kitchen } = await homeWithFriend();
    const [riceId, bowlId, planId] = [randomUUID(), randomUUID(), randomUUID()];
    const batch = { actions: [
      { clientActionId: randomUUID(), kitchenId: kitchen.kitchen.id, queuedAt, action: { type: "ingredient.save", createId: riceId, name: "Rice", unit: "g", section: "Grains", kcal: null, protein: null, carbs: null, fat: null, notes: "" } },
      { clientActionId: randomUUID(), kitchenId: kitchen.kitchen.id, queuedAt, action: { type: "recipe.save", createId: bowlId, name: "Rice bowl", servings: 2, minutes: 15, instructions: "", lines: [{ ingredientId: riceId, amount: 150, note: "" }] } },
      { clientActionId: randomUUID(), kitchenId: kitchen.kitchen.id, queuedAt, action: { type: "plan.add", createId: planId, day: "2026-11-05", meal: "dinner", recipeId: bowlId, servings: 2 } },
      { clientActionId: randomUUID(), kitchenId: kitchen.kitchen.id, queuedAt, action: { type: "stock.add", ingredientId: riceId, amount: 500 } },
      { clientActionId: randomUUID(), kitchenId: kitchen.kitchen.id, queuedAt, action: { type: "plan.cook", id: planId } }
    ] };

    const first = await applyAppActions(store, friend, batch, wednesday);
    expect(first.map((one) => one.status)).toEqual(["applied", "applied", "applied", "applied", "applied"]);
    expect(first.slice(0, 3).map((one) => "id" in one && one.id)).toEqual([riceId, bowlId, planId]);
    expect(await applyAppActions(store, friend, batch, wednesday), "a resent batch returns the first outcomes").toEqual(first);

    const [home] = (await kitchenSync(store, friend, wednesday)).kitchens;
    expect(home!.plan.map((entry) => [entry.id, entry.cooked])).toEqual([[planId, true]]);
    expect(home!.stock, "stock was added once and cooking took 150 g").toEqual([expect.objectContaining({ ingredientId: riceId, amount: 350 })]);
  });

  it("rejects one change without stopping the batch and without a server error", async () => {
    const { store, kitchen } = await homeWithFriend();
    const office = (await store.list(admin)).find((one) => one.name === "Office")!;
    const takenId = (await (await store.open(admin, office.id)).addExtra("Coffee")).id;
    const results = await applyAppActions(store, friend, { actions: [
      { clientActionId: randomUUID(), kitchenId: kitchen.kitchen.id, queuedAt, action: { type: "plan.cook", id: randomUUID() } },
      { clientActionId: randomUUID(), kitchenId: kitchen.kitchen.id, queuedAt, action: { type: "nonsense" } },
      { clientActionId: randomUUID(), kitchenId: office.id, queuedAt, action: { type: "extra.add", name: "Tea" } },
      { clientActionId: randomUUID(), kitchenId: kitchen.kitchen.id, queuedAt, action: { type: "extra.add", createId: takenId, name: "Milk" } },
      { clientActionId: randomUUID(), kitchenId: kitchen.kitchen.id, queuedAt, action: { type: "recipe.copy", id: randomUUID(), toKitchenId: office.id } },
      { clientActionId: randomUUID(), kitchenId: kitchen.kitchen.id, queuedAt, action: { type: "extra.add", name: "Bread" } }
    ] }, wednesday);
    expect(results.map((one) => one.status)).toEqual(["rejected", "rejected", "rejected", "rejected", "rejected", "applied"]);
    expect(results[2]).toMatchObject({ message: "This kitchen does not exist." });
    const [home] = (await kitchenSync(store, friend, wednesday)).kitchens;
    expect(home!.extras.map((one) => one.name), "a rejected change leaves no data").toEqual(["Bread"]);
  });

  it("keeps the phone's ID for a cooked leftover, removes it when the last serving is eaten, and refuses a change queued too long ago", async () => {
    const { store, kitchen } = await homeWithFriend();
    const [riceId, bowlId, planId, soupId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const change = (action: unknown, at = queuedAt) => ({ clientActionId: randomUUID(), kitchenId: kitchen.kitchen.id, queuedAt: at, action });
    const results = await applyAppActions(store, friend, { actions: [
      change({ type: "ingredient.save", createId: riceId, name: "Rice", unit: "g", section: "", kcal: null, protein: null, carbs: null, fat: null, notes: "" }),
      change({ type: "recipe.save", createId: bowlId, name: "Rice bowl", servings: 2, minutes: null, instructions: "", lines: [{ ingredientId: riceId, amount: 150, note: "" }] }),
      change({ type: "plan.add", createId: planId, day: "2026-11-04", meal: "dinner", recipeId: bowlId, servings: 2 }),
      change({ type: "plan.cook", id: planId, leftover: { servings: 1, useBy: "2026-11-07", createId: soupId } }),
      change({ type: "leftover.eat", id: soupId, servings: 1 }),
      change({ type: "extra.add", name: "Old milk" }, "2026-09-30T09:00:00Z"),
      change({ type: "extra.add", name: "Future milk" }, "2026-11-06T09:00:00Z")
    ] }, wednesday);
    expect(results.map((one) => one.status)).toEqual(["applied", "applied", "applied", "applied", "applied", "rejected", "rejected"]);
    const [home] = (await kitchenSync(store, friend, wednesday)).kitchens;
    expect(home!.leftovers, "eating the last serving removes the leftover").toEqual([]);
    expect(home!.extras, "a change older than the answer the server keeps, or from a phone clock far ahead, is not applied").toEqual([]);
  });

  it("applies two parallel eats of the last servings, and removes the leftover once", async () => {
    const { store, kitchen } = await homeWithFriend();
    const soup = await kitchen.addLeftover({ name: "Soup", servings: 2, useBy: "2026-11-07" });
    const eat = () => applyAppActions(store, friend, { actions: [{ clientActionId: randomUUID(), kitchenId: kitchen.kitchen.id, queuedAt, action: { type: "leftover.eat", id: soup.id, servings: 1 } }] }, wednesday);
    const [one, two] = await Promise.all([eat(), eat()]);
    expect([one[0]!.status, two[0]!.status]).toEqual(["applied", "applied"]);
    const [home] = (await kitchenSync(store, friend, wednesday)).kitchens;
    expect(home!.leftovers).toEqual([]);
  });

  it("answers 400 for a malformed batch and applies a valid one over HTTP", async () => {
    const { store, kitchen } = await homeWithFriend();
    const post = (body: unknown) => handleKitchenActions(new Request("https://tools.example.test/api/kitchen/actions", { method: "POST", body: JSON.stringify(body) }), async () => friend, store);
    expect((await post({ actions: "no" })).status).toBe(400);
    expect((await post({ actions: [], padding: "x".repeat(1024 * 1024) })).status, "an oversized batch is refused before it is parsed").toBe(413);
    const ok = await post({ actions: [{ clientActionId: randomUUID(), kitchenId: kitchen.kitchen.id, queuedAt, action: { type: "leftover.add", name: "Soup", servings: 2, useBy: "2026-11-06" } }] });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ results: [expect.objectContaining({ status: "applied" })] });
  });
});
