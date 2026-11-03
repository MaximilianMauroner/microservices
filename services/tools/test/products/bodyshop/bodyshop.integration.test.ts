import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PlatformPrincipal } from "#security";
import { handleMcpRequest } from "../../../platform/access/mcp.js";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../../../platform/database/postgres-push-guard.js";
import { createSealer } from "../../../platform/security/sealed.js";
import type { FoodEntry, WeightReading } from "../../../products/bodyshop/domain.js";
import { entryNutrients } from "../../../products/bodyshop/model/day.js";
import { registerBodyshopTools } from "../../../products/bodyshop/mcp-tools.js";
import { type BodyshopStore, bodyshopStore } from "../../../products/bodyshop/repository.js";
import { commitImport, correctEntry, dayView, logFood, logMeal, logWeight, previewImport, removeRecord, saveFood, updateSettings } from "../../../products/bodyshop/service.js";
import { requireLoopbackPostgres } from "../../harness/postgres.ts";
import { eatingWorkbook } from "./workbook-fixture.js";

const databaseUrl = process.env.TEST_DATABASE_URL ? requireLoopbackPostgres(process.env.TEST_DATABASE_URL) : undefined;
const confirmed = process.env.MONEY_TEST_DATABASE_CONFIRM === "money-repository-test";
const sql = databaseUrl && confirmed ? postgres(databaseUrl, { max: 2 }) : undefined;
const store = sql ? bodyshopStore(sql, createSealer(randomBytes(32), "bodyshop")) : undefined;

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
    await sql`truncate tools.bodyshop_records, tools.bodyshop_imports`;
  });
});

afterAll(async () => { await sql?.end(); });

function entry(day: string, food = "Pumpernickel", amount = 80): FoodEntry {
  return {
    id: randomUUID(), day, time: null, meal: "Breakfast", food, amount, unit: "g", source: "Saved food", notes: "",
    reference: { food, amount: 100, unit: "g", nutrients: { kcal: 200, protein: 6, carbs: 38, fat: 1, fiber: 8 }, range: 0.1, fiberRange: 0.1, notes: "" },
    range: 0.1, fiberRange: 0.1, createdAt: "2026-11-03T08:00:00.000Z", updatedAt: "2026-11-03T08:00:00.000Z"
  };
}

const weight = (day: string, kg: number): WeightReading => ({ id: randomUUID(), day, kg, time: null, notes: "", source: "Reported" });

describe.skipIf(!store)("Bodyshop store", () => {
  it("shows a person only their own records, also when the other person is the admin", async () => {
    const mine = store!.owner("owner-subject");
    const admin = store!.owner("admin-subject");
    await mine.save([{ kind: "entry", record: entry("2026-11-03") }]);
    expect(await mine.list("entry")).toHaveLength(1);
    expect(await admin.list("entry")).toEqual([]);
    const [only] = await mine.list("entry");
    expect(await admin.get("entry", only!.id)).toBeUndefined();
    await expect(admin.save([{ kind: "entry", remove: only!.id }])).rejects.toThrow("does not exist");
  });

  it("stores no food names, amounts, or weights in readable columns", async () => {
    await store!.owner("owner-subject").save([{ kind: "entry", record: entry("2026-11-03", "Secret Strudel", 321.25) }, { kind: "weight", record: weight("2026-11-03", 98.7) }]);
    const raw = JSON.stringify(await sql!`select * from tools.bodyshop_records`);
    expect(raw).not.toContain("Secret Strudel");
    expect(raw).not.toContain("321.25");
    expect(raw).not.toContain("98.7");
  });

  it("refuses a sealed payload that was moved to another owner's row", async () => {
    await store!.owner("owner-subject").save([{ kind: "weight", record: weight("2026-11-03", 80) }]);
    await store!.owner("other-subject").save([{ kind: "weight", record: weight("2026-11-03", 90) }]);
    await sql!`update tools.bodyshop_records set payload = (select payload from tools.bodyshop_records where owner_subject = 'owner-subject') where owner_subject = 'other-subject'`;
    await expect(store!.owner("other-subject").list("weight")).rejects.toThrow();
  });

  it("keeps one current revision per correction and every earlier one in the history", async () => {
    const scope = store!.owner("owner-subject");
    const first = entry("2026-11-03");
    await scope.save([{ kind: "entry", record: first }]);
    await scope.save([{ kind: "entry", record: { ...first, amount: 120 } }]);
    expect((await scope.list("entry")).map((one) => one.amount)).toEqual([120]);
    await scope.save([{ kind: "entry", remove: first.id }]);
    expect(await scope.list("entry")).toEqual([]);
    expect((await scope.history("entry", first.id)).map((one) => [one.revision, one.removed, one.record.amount])).toEqual([[1, false, 80], [2, false, 120], [3, true, 120]]);
  });

  it("lists records of a day range", async () => {
    const scope = store!.owner("owner-subject");
    await scope.save(["2026-11-01", "2026-11-02", "2026-11-03"].map((day) => ({ kind: "weight" as const, record: weight(day, 80) })));
    expect((await scope.list("weight", { from: "2026-11-02", to: "2026-11-02" })).map((one) => one.day)).toEqual(["2026-11-02"]);
  });

  it("replays a repeated import, and a new import replaces only imported records", async () => {
    const scope = store!.owner("owner-subject");
    const typed = entry("2026-11-03", "Logged in Bodyshop");
    await scope.save([{ kind: "entry", record: typed }]);
    const first = await scope.commitImport("digest-1", { rows: 1 }, { entry: [{ record: entry("2026-10-01", "From sheet"), source: "Food Log!2" }] });
    expect(first.replay).toBe(false);
    const again = await scope.commitImport("digest-1", { rows: 99 }, { entry: [{ record: entry("2026-10-01", "Twice"), source: "Food Log!2" }] });
    expect(again).toEqual({ receipt: { rows: 1 }, replay: true });
    expect((await scope.list("entry")).map((one) => one.food).sort()).toEqual(["From sheet", "Logged in Bodyshop"]);

    await scope.commitImport("digest-2", { rows: 1 }, { entry: [{ record: entry("2026-10-01", "Newer sheet"), source: "Food Log!2" }] });
    expect((await scope.list("entry")).map((one) => one.food).sort()).toEqual(["Logged in Bodyshop", "Newer sheet"]);
    expect((await scope.imports()).map((one) => one.digest)).toEqual(["digest-2", "digest-1"]);
  });
});

const at = (time: string) => new Date(`2026-11-03T${time}:00+01:00`);
const butter = { name: "Butter", amount: 100, unit: "g", nutrients: { kcal: 716, protein: 0.7, carbs: 0.6, fat: 81, fiber: 0 }, range: 0.05, fiberRange: 0.05, fullSize: { amount: 250, unit: "g" }, container: "pack" };

describe.skipIf(!store)("Bodyshop logging", () => {
  it("logs a full pack in grams and keeps one entry when the same food is sent twice within ten minutes", async () => {
    const scope = store!.owner("owner-subject");
    await saveFood(scope, butter);
    const first = await logFood(scope, { items: [{ food: "butter", meal: "Breakfast", amount: 1, unit: "pack" }] }, at("08:00"));
    expect(first.entries[0]).toMatchObject({ day: "2026-11-03", food: "Butter", amount: 250, unit: "g", notes: "1 pack = 250 g" });

    const again = await logFood(scope, { items: [{ food: "Butter", meal: "Breakfast", amount: 1, unit: "pack" }] }, at("08:05"));
    expect(again).toEqual({ entries: [first.entries[0]], repeated: [first.entries[0]!.id] });
    await logFood(scope, { items: [{ food: "Butter", meal: "Breakfast", amount: 1, unit: "pack" }], repeat: true }, at("08:06"));
    await logFood(scope, { items: [{ food: "Butter", meal: "Breakfast", amount: 1, unit: "pack" }] }, at("08:30"));
    expect(await scope.list("entry")).toHaveLength(3);
  });

  it("keeps one entry when the same food comes twice in one request or in two requests at the same time", async () => {
    const scope = store!.owner("owner-subject");
    await saveFood(scope, butter);
    const item = { food: "Butter", meal: "Breakfast" as const, amount: 14 };
    const one = await logFood(scope, { items: [item, item] }, at("08:00"));
    expect(one.repeated).toEqual([one.entries[0]!.id]);
    await Promise.all([logFood(scope, { items: [{ ...item, amount: 20 }] }, at("08:01")), logFood(scope, { items: [{ ...item, amount: 20 }] }, at("08:01"))]);
    expect((await scope.list("entry")).map((entry) => entry.amount).sort()).toEqual([14, 20]);
  });

  it("keeps one weight when it is sent twice within ten minutes, and logs the same weight again later in the day", async () => {
    const scope = store!.owner("owner-subject");
    const first = await logWeight(scope, { kg: 104.2 }, at("07:00"));
    expect(await logWeight(scope, { kg: 104.2 }, at("07:05"))).toEqual(first);
    await logWeight(scope, { kg: 104.2 }, at("21:00"));
    expect(await scope.list("weight")).toHaveLength(2);
  });

  it("changes only the nutrients a correction gives, and refuses a saved food id that does not exist", async () => {
    const scope = store!.owner("owner-subject");
    await saveFood(scope, butter);
    const { entries: [entry] } = await logFood(scope, { items: [{ food: "Butter", meal: "Breakfast", amount: 100 }] }, at("08:00"));
    const fixed = await correctEntry(scope, entry!.id, { nutrients: { kcal: 700 } }, at("09:00"));
    expect(fixed.reference?.nutrients).toMatchObject({ kcal: 700, protein: 0.7, fat: 81 });
    const doubled = await correctEntry(scope, entry!.id, { amount: 200, nutrients: { kcal: 1500 } }, at("09:10"));
    expect(entryNutrients(doubled)).toMatchObject({ kcal: 1500, protein: 1.4, fat: 162 });

    const gone = await saveFood(scope, { ...butter, name: "Ghee" });
    await removeRecord(scope, "food", gone.id);
    await expect(saveFood(scope, { id: gone.id, name: "Butter", nutrients: { kcal: 1 } })).rejects.toThrow("does not exist");
    expect((await scope.list("food")).map((food) => food.nutrients.kcal)).toEqual([716]);
  });

  it("refuses settings the model cannot use", async () => {
    const scope = store!.owner("owner-subject");
    await expect(updateSettings(scope, { trendAlpha: 0 })).rejects.toThrow("share from 0 to 1");
    await expect(updateSettings(scope, { modelWindow: 2.5 })).rejects.toThrow("whole number");
    await expect(updateSettings(scope, { dayStartHour: 13 })).rejects.toThrow("whole hour");
    await expect(updateSettings(scope, { rateTargetPercent: 200 })).rejects.toThrow("from 0 to 10 %");
    await expect(updateSettings(scope, { expenditureMin: 9000 })).rejects.toThrow("must be below");
    expect((await updateSettings(scope, { calorieTarget: 2300 })).calorieTarget).toBe(2300);
  });

  it("counts the food of the day a pooled log was split from", async () => {
    const scope = store!.owner("owner-subject");
    await saveFood(scope, butter);
    await logFood(scope, { day: "2026-10-01", items: [{ food: "Butter", meal: "Dinner", amount: 100 }] }, at("08:00"));
    await scope.save([{ kind: "allocation", record: { id: randomUUID(), day: "2026-10-20", sourceDay: "2026-10-01", fraction: 0.5, basis: "Pooled" } }]);
    const view = await dayView(scope, "2026-10-20", at("10:00"));
    expect(view.entries).toEqual([]);
    expect(view.summary?.kcal).toBeCloseTo(358);
  });

  it("puts food eaten before 04:00 on the day before", async () => {
    const scope = store!.owner("owner-subject");
    await saveFood(scope, butter);
    const late = await logFood(scope, { items: [{ food: "Butter", meal: "Snack", amount: 10 }] }, at("02:30"));
    expect(late.entries[0]!.day).toBe("2026-11-02");
  });

  it("corrects an entry in place, keeps the earlier version, and a later change to the food does not change the entry", async () => {
    const scope = store!.owner("owner-subject");
    const food = await saveFood(scope, butter);
    const { entries: [entry] } = await logFood(scope, { items: [{ food: "Butter", meal: "Breakfast", amount: 14 }] }, at("08:00"));
    await correctEntry(scope, entry!.id, { amount: 20 }, at("09:00"));
    await saveFood(scope, { id: food.id, name: "Butter", nutrients: { kcal: 500 } });
    const view = await dayView(scope, "2026-11-03", at("10:00"));
    expect(view.entries.map((one) => one.amount)).toEqual([20]);
    expect(view.entries[0]!.nutrients.kcal).toBeCloseTo(143.2);
    expect((await scope.history("entry", entry!.id)).map((one) => one.record.amount)).toEqual([14, 20]);
  });

  it("asks for the food of a variable template part, then logs the whole meal", async () => {
    const scope = store!.owner("owner-subject");
    const bytes = eatingWorkbook();
    const preview = await previewImport(scope, bytes, "Eating.xlsx", at("10:00"));
    await commitImport(scope, bytes, "Eating.xlsx", preview, at("10:00"));
    await expect(logMeal(scope, { template: "usual breakfast" }, at("08:00"))).rejects.toThrow(`Choose the food for "Bread item (variable)"`);
    const meal = await logMeal(scope, { template: "usual breakfast", choices: [{ part: "Bread item (variable)", food: "Semmel", amount: 2 }] }, at("08:00"));
    expect(meal.entries.map((one) => [one.food, one.amount, one.meal])).toEqual([["Semmel", 2, "Breakfast"], ["Butter", 14, "Breakfast"]]);
  });

  it("imports only the file the preview checked, replays the same file, and keeps what was logged in Bodyshop", async () => {
    const scope = store!.owner("owner-subject");
    await saveFood(scope, { ...butter, name: "Own butter" });
    await logFood(scope, { day: "2026-09-22", items: [{ food: "Own butter", meal: "Dinner", amount: 5 }] }, at("08:00"));
    const bytes = eatingWorkbook();
    const preview = await previewImport(scope, bytes, "Eating.xlsx", at("10:00"));
    expect(preview).toMatchObject({ errors: [], overlap: { entries: 1, weights: 0, days: ["2026-09-22"] }, previous: null });
    await expect(commitImport(scope, eatingWorkbook({ weight: 99 }), "Eating.xlsx", preview, at("10:00"))).rejects.toThrow("not the file you checked");

    expect((await commitImport(scope, bytes, "Eating.xlsx", preview, at("10:00"))).replay).toBe(false);
    expect((await commitImport(scope, bytes, "Eating.xlsx", preview, at("11:00"))).replay).toBe(true);
    expect((await scope.list("entry")).map((one) => one.food).sort()).toEqual(["Butter", "Cake", "Own butter"]);

    const [cake] = (await scope.list("entry")).filter((one) => one.food === "Cake");
    await correctEntry(scope, cake!.id, { amount: 40 }, at("11:30"));
    const newer = eatingWorkbook({ weight: 103.9 });
    const replacing = await previewImport(scope, newer, "Eating.xlsx", at("12:00"));
    expect(replacing.replacedChanges).toBe(1);
    await correctEntry(scope, cake!.id, { amount: 50 }, at("12:05"));
    await expect(commitImport(scope, newer, "Eating.xlsx", replacing, at("12:10"))).rejects.toThrow("changed after you checked");
    await commitImport(scope, newer, "Eating.xlsx", await previewImport(scope, newer, "Eating.xlsx", at("12:15")), at("12:15"));
    expect((await scope.list("weight")).map((one) => one.kg)).toEqual([103.9]);
    expect(await scope.list("food")).toHaveLength(3);
  });

  it("gives an MCP client only its own person's records, and a repeated log returns the first entry", async () => {
    const me = { role: "member", subject: "owner-subject", email: "me@example.test", products: ["bodyshop"] } as unknown as PlatformPrincipal;
    const admin = { role: "admin", subject: "admin-subject", email: "admin@example.test", products: [] } as unknown as PlatformPrincipal;
    const mine = await connect(store!, me);
    const call = async (client: Client, name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text: string }[] };
      return { error: result.isError === true, body: result.content[0]!.text };
    };
    expect((await call(mine, "bodyshop_food_save", butter)).error).toBe(false);
    const item = { food: "Butter", meal: "Breakfast", amount: 14 };
    const first = JSON.parse((await call(mine, "bodyshop_food_log", { items: [item], day: "2026-11-03" })).body);
    const second = JSON.parse((await call(mine, "bodyshop_food_log", { items: [item], day: "2026-11-03" })).body);
    expect(second.entries[0].id).toBe(first.entries[0].id);
    expect(second.alreadyLogged).toEqual([first.entries[0].id]);
    expect(await call(mine, "bodyshop_food_log", { items: [{ food: "Ghee", meal: "Lunch", amount: 5 }] })).toMatchObject({ error: true });

    const corrected = JSON.parse((await call(mine, "bodyshop_entry_correct", { id: first.entries[0].id, amount: 10 })).body);
    expect([corrected.amount, corrected.kcal]).toEqual([10, 71.6]);
    expect(JSON.parse((await call(mine, "bodyshop_today", { day: "2026-11-03" })).body).entries).toHaveLength(1);

    const theirs = await connect(store!, admin);
    expect(JSON.parse((await call(theirs, "bodyshop_today", { day: "2026-11-03" })).body).entries).toEqual([]);
    expect(await call(theirs, "bodyshop_entry_correct", { id: first.entries[0].id, amount: 99 })).toEqual({ error: true, body: "This food entry does not exist." });
    await mine.close();
    await theirs.close();
  });
});

async function connect(store: BodyshopStore, principal: PlatformPrincipal) {
  const client = new Client({ name: "bodyshop-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("https://tools.example.test/api/mcp"), {
    fetch: (url, init) => handleMcpRequest(new Request(url, init), "https://tools.example.test", async () => principal, (server, who) => registerBodyshopTools(server, store, who))
  }));
  return client;
}
