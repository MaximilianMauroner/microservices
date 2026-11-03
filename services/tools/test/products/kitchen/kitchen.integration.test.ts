import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PlatformPrincipal } from "#security";
import { handleMcpRequest } from "../../../platform/access/mcp.js";
import { migrateKitchenPersonSettings } from "../../../products/kitchen/migrate-person-settings.js";
import { registerKitchenTools } from "../../../products/kitchen/mcp-tools.js";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../../../platform/database/postgres-push-guard.js";
import { kitchenStore, type KitchenScope, type KitchenStore } from "../../../products/kitchen/repository.js";
import { requireLoopbackPostgres } from "../../harness/postgres.ts";

const databaseUrl = process.env.TEST_DATABASE_URL ? requireLoopbackPostgres(process.env.TEST_DATABASE_URL) : undefined;
const confirmed = process.env.MONEY_TEST_DATABASE_CONFIRM === "money-repository-test";
const sql = databaseUrl && confirmed ? postgres(databaseUrl, { max: 2 }) : undefined;

const admin = { role: "admin", subject: "admin-subject" } as const;
const friend = { role: "member", subject: "friend-subject" } as const;
const stranger = { role: "member", subject: "stranger-subject" } as const;
const noNutrition = { kcal: null, protein: null, carbs: null, fat: null };

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

async function person(subject: string) {
  const id = randomUUID();
  await sql!`insert into tools.people (id, email, google_subject, invited_at) values (${id}, ${`${subject}@example.test`}, ${subject}, now())`;
  return id;
}

async function pasta(kitchen: KitchenScope) {
  const spaghetti = await kitchen.saveIngredient(undefined, { name: "Spaghetti", unit: "g", section: "Pasta", nutrition: { kcal: 350, protein: 12, carbs: 70, fat: 2 }, notes: "" });
  const tomato = await kitchen.saveIngredient(undefined, { name: "Tomato", unit: "piece", section: "Vegetables", nutrition: { kcal: 20, protein: 1, carbs: 4, fat: 0 }, notes: "" });
  const recipe = await kitchen.saveRecipe(undefined, {
    name: "Pasta al pomodoro", servings: 2, minutes: 20, instructions: "Cook.",
    lines: [{ ingredientId: spaghetti.id, amount: 200, note: "" }, { ingredientId: tomato.id, amount: 4, note: "ripe" }]
  });
  return { spaghetti, tomato, recipe };
}

describe.skipIf(!sql)("Kitchen", () => {
  it("opens a kitchen only for the admin and its members", async () => {
    const store = kitchenStore(sql!);
    const friendId = await person(friend.subject);
    await person(stranger.subject);
    const home = await store.admin(admin).create("Home");
    const other = await store.admin(admin).create("Office");
    await store.admin(admin).addMember(home.id, friendId);

    expect((await store.list(admin)).map((kitchen) => kitchen.name)).toEqual(["Home", "Office"]);
    expect((await store.list(friend)).map((kitchen) => kitchen.name)).toEqual(["Home"]);
    expect(await store.list(stranger)).toEqual([]);
    expect(await sql!`select product_id from tools.product_grants where person_id = ${friendId}`).toEqual([{ product_id: "kitchen" }]);

    await expect(store.open(friend, other.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(store.open(stranger, home.id)).rejects.toMatchObject({ code: "not_found" });
    expect(() => store.admin(friend)).toThrow(/Only the admin/);

    await store.admin(admin).removeMember(home.id, friendId);
    await expect(store.open(friend, home.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("buys what the plan needs minus what is at home, and cooking uses it up", async () => {
    const store = kitchenStore(sql!);
    const home = await store.open(admin, (await store.admin(admin).create("Home")).id);
    const { spaghetti, tomato, recipe } = await pasta(home);
    await home.plan({ day: "2026-11-02", meal: "dinner", recipeId: recipe.id, servings: 4 });
    const lunch = await home.plan({ day: "2026-11-04", meal: "lunch", recipeId: recipe.id, servings: 2 });
    await home.plan({ day: "2026-11-09", meal: "dinner", recipeId: recipe.id, servings: 2 });
    await home.setStock(spaghetti.id, 500);

    const before = await home.shopping("2026-11-02");
    expect(before.lines.map(({ ingredient, needed, inStock, toBuy }) => ({ ingredient, needed, inStock, toBuy }))).toEqual([
      { ingredient: "Spaghetti", needed: 600, inStock: 500, toBuy: 100 },
      { ingredient: "Tomato", needed: 12, inStock: 0, toBuy: 12 }
    ]);

    await home.addStock(tomato.id, 12);
    await home.cook(lunch.id, { servings: 1, useBy: "2026-11-06" });
    await expect(home.cook(lunch.id, undefined)).rejects.toMatchObject({ code: "not_found" });

    expect((await home.stock()).map(({ ingredient, amount }) => ({ ingredient, amount }))).toEqual([
      { ingredient: "Spaghetti", amount: 300 },
      { ingredient: "Tomato", amount: 8 }
    ]);
    expect((await home.shopping("2026-11-02")).lines.map(({ ingredient, toBuy }) => ({ ingredient, toBuy }))).toEqual([
      { ingredient: "Spaghetti", toBuy: 100 },
      { ingredient: "Tomato", toBuy: 0 }
    ]);
    expect(await home.leftovers()).toEqual([expect.objectContaining({ name: "Pasta al pomodoro", servings: 1, useBy: "2026-11-06" })]);
  });

  it("changes the ingredients of one planned meal and keeps the recipe as it is", async () => {
    const store = kitchenStore(sql!);
    const home = await store.open(admin, (await store.admin(admin).create("Home")).id);
    const { spaghetti, tomato, recipe } = await pasta(home);
    const basil = await home.saveIngredient(undefined, { name: "Basil", unit: "g", section: "Herbs", nutrition: noNutrition, notes: "" });
    const monday = await home.plan({ day: "2026-11-02", meal: "dinner", recipeId: recipe.id, servings: 4 });
    await home.plan({ day: "2026-11-03", meal: "dinner", recipeId: recipe.id, servings: 2 });
    expect(monday.lines.map((line) => [line.ingredient, line.amount])).toEqual([["Spaghetti", 400], ["Tomato", 8]]);

    const changed = await home.customizePlan(monday.id, [{ ingredientId: spaghetti.id, amount: 300, note: "" }, { ingredientId: basil.id, amount: 20, note: "fresh" }]);
    expect(changed).toMatchObject({ custom: true, servings: 4 });
    expect((await home.recipe(recipe.id)).lines.map((line) => line.ingredient)).toEqual(["Spaghetti", "Tomato"]);
    expect((await home.shopping("2026-11-02")).lines.map(({ ingredient, needed }) => [ingredient, needed])).toEqual([["Spaghetti", 500], ["Tomato", 4], ["Basil", 20]]);

    await home.updatePlan(monday.id, { day: "2026-11-02", meal: "dinner", servings: 2 });
    expect((await home.week("2026-11-02")).entries[0]?.lines.map((line) => [line.ingredient, line.amount])).toEqual([["Spaghetti", 150], ["Basil", 10]]);

    await home.setStock(tomato.id, 10);
    await home.cook(monday.id, undefined);
    expect((await home.stock()).map((item) => [item.ingredient, item.amount])).toEqual([["Tomato", 10]]);
    await expect(home.customizePlan(monday.id, [])).rejects.toThrow(/already cooked/);

    const tuesday = (await home.week("2026-11-02")).entries[1]!;
    await home.customizePlan(tuesday.id, [{ ingredientId: tomato.id, amount: 6, note: "" }]);
    expect(await home.resetPlan(tuesday.id)).toMatchObject({ custom: false, lines: [expect.objectContaining({ ingredient: "Spaghetti", amount: 200 }), expect.objectContaining({ ingredient: "Tomato", amount: 4 })] });
  });

  it("brings every-week items back each week and drops one-time items once bought", async () => {
    const store = kitchenStore(sql!);
    const home = await store.open(admin, (await store.admin(admin).create("Home")).id);
    const snacks = await home.addExtra("Snacks", true);
    const soap = await home.addExtra("Soap");
    const view = async (week: string) => (await home.shopping(week)).extras.map(({ name, everyWeek, bought }) => ({ name, everyWeek, bought }));

    await home.markExtra(snacks.id, "2026-11-02", true);
    expect(await view("2026-11-02")).toEqual([{ name: "Snacks", everyWeek: true, bought: true }, { name: "Soap", everyWeek: false, bought: false }]);
    expect(await view("2026-11-09")).toEqual([{ name: "Snacks", everyWeek: true, bought: false }, { name: "Soap", everyWeek: false, bought: false }]);

    await home.markExtra(snacks.id, "2026-11-09", false);
    expect((await view("2026-11-02"))[0]).toMatchObject({ bought: true });
    await home.markExtra(snacks.id, "2026-11-02", false);
    expect((await view("2026-11-02"))[0]).toMatchObject({ bought: false });
    await expect(home.markExtra(soap.id, "2026-11-02", true)).rejects.toMatchObject({ code: "not_found" });
  });

  it("remembers each new group and shops in the kitchen's group order", async () => {
    const store = kitchenStore(sql!);
    const created = await store.admin(admin).create("Home");
    const home = await store.open(admin, created.id);
    const { recipe } = await pasta(home);
    await home.saveIngredient(undefined, { name: "Basil", unit: "g", section: "Herbs", nutrition: noNutrition, notes: "" });
    expect((await store.open(admin, created.id)).kitchen.groups).toEqual(["Pasta", "Vegetables", "Herbs"]);

    await home.plan({ day: "2026-11-02", meal: "dinner", recipeId: recipe.id, servings: 2 });
    const sections = async () => (await (await store.open(admin, created.id)).shopping("2026-11-02")).lines.map((line) => line.section);
    expect(await sections()).toEqual(["Pasta", "Vegetables"]);

    await home.setGroups(["Vegetables"]);
    expect((await store.open(admin, created.id)).kitchen.groups).toEqual(["Vegetables"]);
    expect(await sections()).toEqual(["Vegetables", "Pasta"]);
  });

  it("keeps each kitchen's ingredients and recipes inside that kitchen", async () => {
    const store = kitchenStore(sql!);
    const home = await store.open(admin, (await store.admin(admin).create("Home")).id);
    const other = await store.open(admin, (await store.admin(admin).create("Office")).id);
    const { tomato, recipe } = await pasta(home);

    await expect(other.saveRecipe(undefined, { name: "Theft", servings: 1, minutes: null, instructions: "", lines: [{ ingredientId: tomato.id, amount: 1, note: "" }] }))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(other.recipe(recipe.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(other.plan({ day: "2026-11-02", meal: "lunch", recipeId: recipe.id, servings: 1 })).rejects.toMatchObject({ code: "not_found" });
    await expect(other.setStock(tomato.id, 3)).rejects.toMatchObject({ code: "not_found" });
    await expect(home.deleteIngredient(tomato.id)).rejects.toMatchObject({ code: "conflict" });
    await expect(home.saveIngredient(undefined, { name: "tomato", unit: "g", section: "", nutrition: noNutrition, notes: "" }))
      .rejects.toMatchObject({ code: "conflict" });
  });

  it("copies a recipe with only the ingredients it uses", async () => {
    const store = kitchenStore(sql!);
    const friendId = await person(friend.subject);
    const mine = await store.admin(admin).create("Max");
    const theirs = await store.admin(admin).create("Friend");
    await store.admin(admin).addMember(theirs.id, friendId);
    const home = await store.open(admin, mine.id);
    const { recipe } = await pasta(home);
    await home.saveIngredient(undefined, { name: "Secret spice", unit: "g", section: "", nutrition: noNutrition, notes: "" });
    const target = await store.open(admin, theirs.id);
    await target.saveIngredient(undefined, { name: "TOMATO", unit: "piece", section: "Garden", nutrition: noNutrition, notes: "" });

    const copy = await store.copyRecipe(admin, mine.id, recipe.id, theirs.id);
    const again = await store.copyRecipe(admin, mine.id, recipe.id, theirs.id);

    expect(copy.lines.map((line) => [line.ingredient, line.amount])).toEqual([["Spaghetti", 200], ["TOMATO", 4]]);
    expect(again.name).toBe("Pasta al pomodoro (2)");
    expect((await (await store.open(friend, theirs.id)).ingredients()).map((ingredient) => ingredient.name)).toEqual(["Spaghetti", "TOMATO"]);
    await expect(store.copyRecipe(friend, theirs.id, copy.id, mine.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("changes the unit of a used ingredient only together with its recipe and stock amounts", async () => {
    const store = kitchenStore(sql!);
    const home = await store.open(admin, (await store.admin(admin).create("Home")).id);
    const zucchini = await home.saveIngredient(undefined, { name: "Zucchini", unit: "g", section: "Gemüse", nutrition: { kcal: 20, protein: 1.6, carbs: 2, fat: 0.4 }, notes: "" });
    const recipe = await home.saveRecipe(undefined, { name: "Gefüllte Zucchini", servings: 2, minutes: 45, instructions: "", lines: [{ ingredientId: zucchini.id, amount: 500, note: "halbiert" }] });
    await home.setStock(zucchini.id, 750);
    const perPiece = { name: "Zucchini", unit: "piece", section: "Gemüse", nutrition: { kcal: 50, protein: 4, carbs: 5, fat: 1 }, notes: "" } as const;

    await expect(home.saveIngredient(zucchini.id, perPiece)).rejects.toMatchObject({ code: "invalid" });
    expect((await home.recipe(recipe.id)).lines.map((line) => [line.unit, line.amount])).toEqual([["g", 500]]);

    await home.saveIngredient(zucchini.id, perPiece, 250);
    expect((await home.recipe(recipe.id)).lines.map((line) => [line.unit, line.amount, line.note])).toEqual([["piece", 2, "halbiert"]]);
    expect((await home.stock()).map((item) => [item.unit, item.amount])).toEqual([["piece", 3]]);

    const unused = await home.saveIngredient(undefined, { name: "Gurke", unit: "g", section: "Gemüse", nutrition: noNutrition, notes: "" });
    expect((await home.saveIngredient(unused.id, { ...perPiece, name: "Gurke" })).unit).toBe("piece");
  });

  it("keeps an ingredient in more than one group and shops for it in its main group", async () => {
    const store = kitchenStore(sql!);
    const home = await store.open(admin, (await store.admin(admin).create("Home")).id);
    const chickpeas = await home.saveIngredient(undefined, { name: "Kichererbsen", unit: "g", section: "Proteine", otherGroups: [" Kohlenhydrate ", "proteine", "Kohlenhydrate"], nutrition: noNutrition, notes: "" });
    expect(chickpeas).toMatchObject({ section: "Proteine", otherGroups: ["Kohlenhydrate"] });
    expect((await store.list(admin)).find((kitchen) => kitchen.id === home.kitchen.id)?.groups).toEqual(["Proteine", "Kohlenhydrate"]);

    const recipe = await home.saveRecipe(undefined, { name: "Hummus", servings: 2, minutes: null, instructions: "", lines: [{ ingredientId: chickpeas.id, amount: 400, note: "" }] });
    await home.plan({ day: "2026-11-02", meal: "lunch", recipeId: recipe.id, servings: 2 });
    expect((await home.shopping("2026-11-02")).lines.map((line) => [line.ingredient, line.section])).toEqual([["Kichererbsen", "Proteine"]]);

    expect((await home.saveIngredient(chickpeas.id, { name: "Kichererbsen", unit: "g", section: "Proteine", otherGroups: [], nutrition: noNutrition, notes: "" })).otherGroups).toEqual([]);
  });

  it("counts canned food in cans", async () => {
    const store = kitchenStore(sql!);
    const home = await store.open(admin, (await store.admin(admin).create("Home")).id);
    const chickpeas = await home.saveIngredient(undefined, { name: "Kichererbsen", unit: "g", section: "Proteine", nutrition: { kcal: 120, protein: 7, carbs: 15, fat: 2 }, notes: "" });
    const recipe = await home.saveRecipe(undefined, { name: "Hummus", servings: 4, minutes: 10, instructions: "", lines: [{ ingredientId: chickpeas.id, amount: 800, note: "" }] });

    await home.saveIngredient(chickpeas.id, { name: "Kichererbsen", unit: "can", section: "Proteine", nutrition: { kcal: 480, protein: 28, carbs: 60, fat: 8 }, notes: "" }, 400);
    expect((await home.recipe(recipe.id)).lines.map((line) => [line.unit, line.amount])).toEqual([["can", 2]]);
    await home.setStock(chickpeas.id, 3);
    expect((await home.stock()).map((item) => [item.unit, item.amount])).toEqual([["can", 3]]);
  });

  it("keeps MCP permission separate for each person and kitchen", async () => {
    const store = kitchenStore(sql!);
    const friendId = await person(friend.subject);
    const home = await store.admin(admin).create("Home");
    const other = await store.admin(admin).create("Other");
    await store.admin(admin).addMember(home.id, friendId);
    await store.admin(admin).addMember(other.id, friendId);
    await store.setMcpEnabled(friend, home.id, true);
    expect((await store.open(friend, home.id)).kitchen.mcpEnabled).toBe(true);
    expect((await store.open(admin, home.id)).kitchen.mcpEnabled).toBe(false);
    expect((await store.open(friend, other.id)).kitchen.mcpEnabled).toBe(false);
    await expect(store.setMcpEnabled(stranger, home.id, true)).rejects.toMatchObject({ code: "not_found" });
    await store.setMcpEnabled(admin, home.id, true);
    await store.setMcpEnabled(friend, home.id, false);
    expect((await store.open(admin, home.id)).kitchen.mcpEnabled).toBe(true);
    await store.setMcpEnabled(friend, home.id, true);
    await store.admin(admin).removeMember(home.id, friendId);
    await store.admin(admin).addMember(home.id, friendId);
    expect((await store.open(friend, home.id)).kitchen.mcpEnabled).toBe(false);
  });

  it("hands a kitchen over without losing its data and keeps admin recovery access", async () => {
    const store = kitchenStore(sql!);
    const friendId = await person(friend.subject);
    const home = await store.admin(admin).create("Home");
    const { recipe } = await pasta(await store.open(admin, home.id));
    await store.setMcpEnabled(admin, home.id, true);
    await expect(store.admin(admin).move(home.id, randomUUID())).rejects.toMatchObject({ code: "not_found" });
    expect((await store.list(admin)).map((one) => one.id)).toEqual([home.id]);
    await store.admin(admin).move(home.id, friendId);
    expect(await store.list(admin)).toEqual([]);
    expect(await store.list(admin, { includeHidden: true })).toEqual([expect.objectContaining({ id: home.id, hidden: true, mcpEnabled: false })]);
    expect((await store.list(friend)).map((one) => one.id)).toEqual([home.id]);
    expect((await store.open(friend, home.id)).kitchen.mcpEnabled).toBe(false);
    expect((await (await store.open(friend, home.id)).recipe(recipe.id)).name).toBe(recipe.name);
    expect((await store.open(admin, home.id)).kitchen.hidden).toBe(true);
    await expect(store.setMcpEnabled(admin, home.id, true)).rejects.toMatchObject({ code: "forbidden" });
    await store.admin(admin).restore(home.id);
    expect((await store.list(admin))[0]).toMatchObject({ id: home.id, hidden: false, mcpEnabled: false });
  });

  it("lets a member leave while keeping the kitchen for its remaining members", async () => {
    const store = kitchenStore(sql!);
    const friendId = await person(friend.subject);
    const strangerId = await person(stranger.subject);
    const home = await store.admin(admin).create("Home");
    await store.admin(admin).addMember(home.id, friendId);
    await expect(store.leave(friend, home.id)).rejects.toMatchObject({ code: "conflict" });
    await store.admin(admin).addMember(home.id, strangerId);
    await store.setMcpEnabled(friend, home.id, true);
    await store.leave(friend, home.id);
    expect(await store.list(friend)).toEqual([]);
    await expect(store.open(friend, home.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await store.open(stranger, home.id)).kitchen.members.map((one) => one.personId)).toEqual([strangerId]);
    await store.admin(admin).addMember(home.id, friendId);
    expect((await store.open(friend, home.id)).kitchen).toMatchObject({ hidden: false, mcpEnabled: false });
  });

  it("preserves existing MCP access for current people when it migrates the shared flag", async () => {
    const store = kitchenStore(sql!);
    const friendId = await person(friend.subject);
    const home = await store.admin(admin).create("Home");
    await store.admin(admin).addMember(home.id, friendId);
    await sql!`alter table tools.kitchens add column if not exists mcp_enabled boolean not null default false`;
    await sql!`update tools.kitchens set mcp_enabled = true where id = ${home.id}`;
    await expect(migrateKitchenPersonSettings(sql!, undefined)).rejects.toThrow(/admin subject/);
    await migrateKitchenPersonSettings(sql!, admin.subject);
    await migrateKitchenPersonSettings(sql!, admin.subject);
    expect((await store.open(admin, home.id)).kitchen.mcpEnabled).toBe(true);
    expect((await store.open(friend, home.id)).kitchen.mcpEnabled).toBe(true);
    expect((await store.admin(admin).create("New")).mcpEnabled).toBe(false);
  });

  it("requires personal opt-in for MCP and applies changes to connected clients", async () => {
    const store = kitchenStore(sql!);
    const home = await store.admin(admin).create("Home");
    expect(home.mcpEnabled).toBe(false);
    expect(() => store.admin(friend)).toThrow(/Only the admin/);
    const principal = { ...admin, email: "admin@example.test", products: ["kitchen"] } as PlatformPrincipal;
    const client = await connect(store, principal);
    try {
      const list = async () => {
        const result = await client.callTool({ name: "kitchen_list", arguments: {} });
        return JSON.parse((result.content as { text: string }[])[0]!.text);
      };
      const read = (kitchen?: string) => client.callTool({ name: "recipe_list", arguments: kitchen ? { kitchen } : {} });
      expect(await list()).toEqual([]);
      expect(await read(home.id)).toMatchObject({ isError: true });
      expect(await read("Home")).toMatchObject({ isError: true });
      expect(await read()).toMatchObject({ isError: true });
      expect((await store.open(admin, home.id)).kitchen.name).toBe("Home");

      await store.setMcpEnabled(admin, home.id, true);
      expect(await list()).toEqual([expect.objectContaining({ id: home.id })]);
      expect((await read()).isError).not.toBe(true);

      await store.setMcpEnabled(admin, home.id, false);
      expect(await list()).toEqual([]);
      expect(await read(home.id)).toMatchObject({ isError: true });
      expect(await client.callTool({ name: "shopping_add", arguments: { kitchen: home.id, item: "Milk" } })).toMatchObject({ isError: true });
      expect((await store.open(admin, home.id)).kitchen.mcpEnabled).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("lets an MCP client manage only the kitchens its person can open", async () => {
    const store = kitchenStore(sql!);
    const friendId = await person(friend.subject);
    const shared = await store.admin(admin).create("Shared");
    await store.admin(admin).create("Private");
    await store.admin(admin).addMember(shared.id, friendId);
    await store.setMcpEnabled(friend, shared.id, true);
    const member: PlatformPrincipal = { ...friend, email: "friend@example.test", products: ["kitchen"] } as PlatformPrincipal;
    const client = await connect(store, member);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text: string }[] };
      return { error: result.isError === true, body: result.content[0]!.text };
    };

    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain("recipe_save");
    expect(tools).not.toContain("kitchen_create");

    const saved = await call("recipe_save", { name: "Shakshuka", servings: 2, ingredients: [{ name: "Eier", amount: 4, unit: "piece" }, { name: "Gewürfelte Tomaten", amount: 400 }] });
    expect(saved.error).toBe(false);
    expect(JSON.parse(saved.body).lines.map((line: { ingredient: string; unit: string }) => [line.ingredient, line.unit])).toEqual([["Eier", "piece"], ["Gewürfelte Tomaten", "g"]]);
    expect((await call("ingredient_save", { name: "eier", kcal: 155 })).error).toBe(false);
    expect(JSON.parse((await call("ingredient_list", {})).body).map((one: { name: string; unit: string; nutrition: { kcal: number | null } }) => [one.name, one.unit, one.nutrition.kcal]))
      .toEqual([["eier", "piece", 155], ["Gewürfelte Tomaten", "g", null]]);
    await call("ingredient_save", { name: "Gewürfelte Tomaten", kcal: 25, protein: 1.2 });
    expect((await call("ingredient_save", { name: "Gewürfelte Tomaten", unit: "piece" })).error).toBe(true);
    const can = JSON.parse((await call("ingredient_save", { name: "Gewürfelte Tomaten", unit: "piece", oldPerNew: 400 })).body);
    expect([can.unit, can.nutrition]).toEqual(["piece", { kcal: 100, protein: 4.8, carbs: null, fat: null }]);
    expect(JSON.parse((await call("recipe_get", { recipe: "Shakshuka" })).body).lines.map((line: { ingredient: string; amount: number }) => [line.ingredient, line.amount]))
      .toEqual([["eier", 4], ["Gewürfelte Tomaten", 1]]);
    expect(await call("recipe_list", { kitchen: "Private" })).toEqual({ error: true, body: "No kitchen named Private. You can open: Shared." });
    await client.close();
  });
});

async function connect(store: KitchenStore, principal: PlatformPrincipal) {
  const client = new Client({ name: "kitchen-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("https://tools.example.test/api/mcp"), {
    fetch: (url, init) => handleMcpRequest(new Request(url, init), "https://tools.example.test", async () => principal, (server, who) => registerKitchenTools(server, store, who))
  }));
  return client;
}
