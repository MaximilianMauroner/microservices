import postgres from "postgres";
import type { PlatformPrincipal } from "#security";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../../../platform/database/postgres-push-guard.js";
import { type CatalogPage, kitchenCatalog, parseOpenFoodFactsPage } from "../../../products/kitchen/catalog.js";
import type { CatalogProduct } from "../../../products/kitchen/domain.js";
import { handleKitchenCatalog } from "../../../products/kitchen/sync.js";
import { requireLoopbackPostgres } from "../../harness/postgres.ts";

const databaseUrl = process.env.TEST_DATABASE_URL ? requireLoopbackPostgres(process.env.TEST_DATABASE_URL) : undefined;
const confirmed = process.env.MONEY_TEST_DATABASE_CONFIRM === "money-repository-test";
const sql = databaseUrl && confirmed ? postgres(databaseUrl, { max: 2 }) : undefined;

const friend: PlatformPrincipal = { role: "member", subject: "friend-subject", email: "friend@example.test", products: ["kitchen"] };

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
    await sql`truncate tools.kitchen_catalog_products, tools.kitchen_catalog_refresh`;
  });
});

afterAll(async () => { await sql?.end(); });

const product = (code: string, name: string, brand = "Spar"): CatalogProduct =>
  ({ code, name, brand, quantity: "400 g", unit: "g", nutrition: { kcal: 100, protein: 5, carbs: 10, fat: 1 } });

/** Pages as Open Food Facts would send them. A page in `failOn` fails once, like a 503. */
function source(pages: readonly (readonly CatalogProduct[])[], failOn: number[] = []) {
  const asked: number[] = [];
  const fetchPage = async (page: number): Promise<CatalogPage> => {
    asked.push(page);
    if (failOn.includes(page)) {
      failOn.splice(failOn.indexOf(page), 1);
      throw new Error("Open Food Facts answered 503.");
    }
    return { products: pages[page - 1] ?? [], last: page >= pages.length };
  };
  return { asked, fetchPage };
}

describe("Open Food Facts pages", () => {
  it("keeps products with a name and calories, and reads the German name, the first brand, and ml", () => {
    const page = parseOpenFoodFactsPage({
      count: 3,
      products: [
        { code: "9000295871454", product_name: "Ketchup", product_name_de: "Tomatenketchup", brands: "Felix, Felix Austria", quantity: "1kg", product_quantity_unit: "g",
          nutriments: { "energy-kcal_100g": 101, proteins_100g: 1.2, carbohydrates_100g: 22, fat_100g: 0.5 } },
        { code: "90457494", product_name: "Red Bull", brands: "Red Bull", quantity: "250 ml", product_quantity_unit: "ml",
          nutriments: { "energy-kcal_100g": 46.04, proteins_100g: 0, carbohydrates_100g: "11", fat_100g: null } },
        { code: "4000000000001", product_name: "Mystery", nutriments: {} }
      ]
    }, 1);

    expect(page).toEqual({
      last: true,
      products: [
        { code: "9000295871454", name: "Tomatenketchup", brand: "Felix", quantity: "1kg", unit: "g", nutrition: { kcal: 101, protein: 1.2, carbs: 22, fat: 0.5 } },
        { code: "90457494", name: "Red Bull", brand: "Red Bull", quantity: "250 ml", unit: "ml", nutrition: { kcal: 46, protein: 0, carbs: 11, fat: null } }
      ]
    });
    expect(() => parseOpenFoodFactsPage("<html>busy</html>", 4)).toThrow(/unexpected page 4/);
  });
});

describe.skipIf(!sql)("Kitchen catalog", () => {
  it("finds products by every typed word in name or brand, names that start with the first word first", async () => {
    const catalog = kitchenCatalog(sql!);
    await catalog.refresh({ pauseMs: 0, fetchPage: source([[
      product("1001", "Bio Kichererbsen"), product("1002", "Kichererbsen", "Billa"), product("1003", "Hummus mit Kichererbsen", "Billa"),
      product("1004", "Linsen", "Kichererbsen GmbH"), product("1005", "100% Erbsen_mix")
    ]]).fetchPage });

    expect((await catalog.search("kichererbsen")).map((one) => one.name)).toEqual(["Kichererbsen", "Linsen", "Bio Kichererbsen", "Hummus mit Kichererbsen"]);
    expect((await catalog.search("KICHERERBSEN billa")).map((one) => one.code)).toEqual(["1002", "1003"]);
    expect(await catalog.search("k"), "one letter matches too much to help").toEqual([]);
    expect((await catalog.search("0% erbsen_")).map((one) => one.code), "% and _ are letters").toEqual(["1005"]);
    expect(await catalog.search("e%n"), "a percent sign is not a wildcard").toEqual([]);
    expect(await catalog.search("s_n"), "an underscore is not a wildcard").toEqual([]);
    expect(await catalog.search("Kichererbsen Billa")).toContainEqual(product("1002", "Kichererbsen", "Billa"));
  });

  it("goes on from the page that failed, and at the end removes products the source no longer lists", async () => {
    const catalog = kitchenCatalog(sql!);
    let clock = new Date("2026-11-01T04:40:00Z");
    const now = () => clock;
    await catalog.refresh({ pauseMs: 0, now, fetchPage: source([[product("1", "Milch"), product("2", "Gone")]]).fetchPage });

    clock = new Date("2026-11-03T04:40:00Z");
    expect(await catalog.refresh({ pauseMs: 0, now, fetchPage: source([[product("1", "Milch")]]).fetchPage }), "a refresh waits a week").toEqual({ status: "fresh" });

    clock = new Date("2026-11-08T04:40:00Z");
    const week = source([[product("1", "Vollmilch")], [product("3", "Butter")], [product("4", "Topfen")]], [2]);
    await expect(catalog.refresh({ pauseMs: 0, now, fetchPage: week.fetchPage })).rejects.toThrow(/503/);
    expect((await catalog.search("gone")).map((one) => one.code), "nothing goes away before the refresh ends").toEqual(["2"]);

    clock = new Date("2026-11-08T05:40:00Z");
    expect(await catalog.refresh({ pauseMs: 0, now, fetchPage: week.fetchPage })).toEqual({ status: "finished", products: 3 });
    expect(week.asked, "page 1 is not fetched again").toEqual([1, 2, 2, 3]);
    expect(await catalog.search("gone")).toEqual([]);
    expect((await catalog.search("milch")).map((one) => one.name)).toEqual(["Vollmilch"]);
  });

  it("stops between pages when the server shuts down, and the next run goes on from there", async () => {
    const catalog = kitchenCatalog(sql!);
    const stop = new AbortController();
    const pages = source([[product("1", "Reis")], [product("2", "Nudeln")]]);
    const first = catalog.refresh({ pauseMs: 60_000, signal: stop.signal, fetchPage: pages.fetchPage });
    await new Promise((resolve) => setTimeout(resolve, 50));
    stop.abort();
    expect(await first).toEqual({ status: "stopped", nextPage: 2 });
    expect(await catalog.refresh({ pauseMs: 0, fetchPage: pages.fetchPage })).toEqual({ status: "finished", products: 2 });
    expect(pages.asked).toEqual([1, 2]);
  });

  it("answers the app only with a Kitchen app token", async () => {
    const catalog = kitchenCatalog(sql!);
    await catalog.refresh({ pauseMs: 0, fetchPage: source([[product("1", "Haferflocken")]]).fetchPage });
    const request = new Request("https://tools.example.test/api/kitchen/products?q=hafer");

    expect((await handleKitchenCatalog(request, async () => undefined, catalog)).status).toBe(401);
    expect((await handleKitchenCatalog(request, async () => ({ ...friend, products: [] }), catalog)).status).toBe(403);
    const ok = await handleKitchenCatalog(request, async () => friend, catalog);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect(await ok.json()).toEqual({ products: [product("1", "Haferflocken")] });
  });
});
