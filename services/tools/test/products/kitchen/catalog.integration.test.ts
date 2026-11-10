import postgres from "postgres";
import type { PlatformPrincipal } from "#security";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../../../platform/database/postgres-push-guard.js";
import { type CatalogSourceReader, fetchOpenFoodFactsProduct, kitchenCatalog, parseBillaList, parseBillaProduct, parseOpenFoodFactsPage } from "../../../products/kitchen/catalog.js";
import type { CatalogProduct, CatalogSource } from "../../../products/kitchen/domain.js";
import { handleKitchenCatalog } from "../../../products/kitchen/sync.js";
import { requireLoopbackPostgres } from "../../harness/postgres.ts";

const databaseUrl = process.env.TEST_DATABASE_URL ? requireLoopbackPostgres(process.env.TEST_DATABASE_URL) : undefined;
const confirmed = process.env.MONEY_TEST_DATABASE_CONFIRM === "money-repository-test";
const sql = databaseUrl && confirmed ? postgres(databaseUrl, { max: 2 }) : undefined;

const friend: PlatformPrincipal = { role: "member", subject: "friend-subject", email: "friend@example.test", products: ["kitchen"] };
const WEEK = 7 * 86_400_000;

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

const product = (code: string, name: string, brand = "Spar", source: CatalogSource = "open-food-facts"): CatalogProduct =>
  ({ source, code, name, brand, quantity: "400 g", unit: "g", nutrition: { kcal: 100, protein: 5, carbs: 10, fat: 1 } });

/** A source that sends `pages`. A page in `failOn` fails once, like a 503. */
function source(id: CatalogSource, pages: readonly (readonly CatalogProduct[])[], options: { failOn?: number[]; refreshEveryMs?: number; pauseMs?: number } = {}) {
  const failOn = [...options.failOn ?? []];
  const asked: number[] = [];
  const state = { pages };
  const reader: CatalogSourceReader = {
    id, refreshEveryMs: options.refreshEveryMs ?? WEEK, pagesPerRun: 50, pauseMs: options.pauseMs ?? 0,
    async fetchPage(page) {
      asked.push(page);
      if (failOn.includes(page)) {
        failOn.splice(failOn.indexOf(page), 1);
        throw new Error(`${id} answered 503.`);
      }
      return { products: state.pages[page - 1] ?? [], last: page >= state.pages.length };
    }
  };
  return { reader, asked, send: (next: readonly (readonly CatalogProduct[])[]) => { state.pages = next; } };
}

describe("source pages", () => {
  it("keeps Open Food Facts products with a name and calories, and reads the German name, the first brand, and ml", () => {
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
        { source: "open-food-facts", code: "9000295871454", name: "Tomatenketchup", brand: "Felix", quantity: "1kg", unit: "g", nutrition: { kcal: 101, protein: 1.2, carbs: 22, fat: 0.5 } },
        { source: "open-food-facts", code: "90457494", name: "Red Bull", brand: "Red Bull", quantity: "250 ml", unit: "ml", nutrition: { kcal: 46, protein: 0, carbs: 11, fat: null } }
      ]
    });
    expect(() => parseOpenFoodFactsPage("<html>busy</html>", 4)).toThrow(/unexpected page 4/);
  });

  it("asks Billa only for food, and reads the newest unprepared table per 100 g or 100 ml", () => {
    const category = (name: string) => [[{ name }]];
    expect(parseBillaList({ total: 120, results: [
      { sku: "00-15865", parentCategories: category("Vorratsschrank") },
      { sku: "00-1", parentCategories: category("Drogerie & Kosmetik") },
      { sku: "00-2", parentCategories: category("Haustier") }
    ] }, 1)).toEqual({ skus: ["00-15865"], last: true });

    const nutrient = (nutrientId: string, value: number, symbol: string) => ({ nutrientId, value, unit: { symbol } });
    const table = (preparationGrade: string, kcal: number) => ({ preparationGrade, relationValue: 100, unit: { symbol: "g" }, nutrients: [
      nutrient("ENER-", kcal * 4.2, "kJ"), nutrient("ENER-", kcal, "kcal"), nutrient("FAT", 1.3, "g"), nutrient("FASAT", 0.34, "g"),
      nutrient("CHOAVL", 70, "g"), nutrient("SUGAR-", 0.2, "g"), nutrient("PRO-", 12, "g")
    ] });
    const flour = {
      sku: "00-15865", name: "Rauch Weizenmehl extra für Kuchen", brand: { name: "Rauch" },
      additionalInformation: [
        { validFrom: "2022-01-01", foodInformation: { nutritionInfos: [table("Unzubereitet", 300)] } },
        { validFrom: "2024-02-20", foodInformation: { nutritionInfos: [table("Zubereitet", 200), table("Unzubereitet", 346)] } }
      ]
    };
    expect(parseBillaProduct(flour)).toEqual({
      source: "billa", code: "00-15865", name: "Rauch Weizenmehl extra für Kuchen", brand: "Rauch", quantity: "", unit: "g",
      nutrition: { kcal: 346, protein: 12, carbs: 70, fat: 1.3 }
    });
    const onlyKilojoules = { ...flour, additionalInformation: [{ foodInformation: { nutritionInfos: [{ relationValue: 100, unit: { symbol: "ml" }, nutrients: [nutrient("ENER-", 418.4, "kJ")] }] } }] };
    expect(parseBillaProduct(onlyKilojoules)).toMatchObject({ unit: "ml", nutrition: { kcal: 100, protein: null } });
    expect(parseBillaProduct({ sku: "00-402489", name: "Bananen", additionalInformation: [] }), "no nutrition, no product").toBeUndefined();
  });
});

/** A fetch that answers every request with `body` and `status`, and keeps the URLs it was asked for. */
function answer(status: number, body: unknown = {}) {
  const asked: string[] = [];
  const fetcher = (async (url: URL | RequestInfo) => { asked.push(String(url)); return Response.json(body, { status }); }) as typeof fetch;
  return { fetcher, asked };
}

describe("barcode lookup on Open Food Facts", () => {
  it("reads the product with the scanned code", async () => {
    const off = answer(200, { status: 1, product: { product_name: "Haferdrink", brands: "Oatly", quantity: "1 l", product_quantity_unit: "ml", nutriments: { "energy-kcal_100g": 46, proteins_100g: 1 } } });
    expect(await fetchOpenFoodFactsProduct("7394376616501", off.fetcher)).toEqual({
      source: "open-food-facts", code: "7394376616501", name: "Haferdrink", brand: "Oatly", quantity: "1 l", unit: "ml", nutrition: { kcal: 46, protein: 1, carbs: null, fat: null }
    });
    expect(off.asked[0]).toMatch(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/7394376616501\?fields=/);
  });

  it("finds nothing for an unknown code or a product without calories, and fails on a server error", async () => {
    expect(await fetchOpenFoodFactsProduct("4000000000000", answer(404, { status: 0 }).fetcher)).toBeUndefined();
    expect(await fetchOpenFoodFactsProduct("4000000000000", answer(200, { status: 1, product: { product_name: "Wasser", nutriments: {} } }).fetcher)).toBeUndefined();
    await expect(fetchOpenFoodFactsProduct("4000000000000", answer(503).fetcher)).rejects.toThrow("503");
  });
});

describe.skipIf(!sql)("Kitchen catalog", () => {
  it("finds a scanned barcode in the copy first, then on Open Food Facts", async () => {
    const off = answer(200, { status: 1, product: { product_name: "Linsen rot", nutriments: { "energy-kcal_100g": 340 } } });
    const catalog = kitchenCatalog(sql!, [source("open-food-facts", [[product("90012345", "Haferflocken")]]).reader], off.fetcher);
    await catalog.refresh();
    const scan = (code: string) => handleKitchenCatalog(new Request(`https://tools.example.test/api/kitchen/products?code=${code}`), async () => friend, catalog).then((response) => response.json());

    expect(await scan("90012345")).toEqual({ products: [product("90012345", "Haferflocken")] });
    expect(off.asked, "a product in the copy needs no request").toEqual([]);
    expect((await scan("4006040123456")).products.map((one: CatalogProduct) => one.name)).toEqual(["Linsen rot"]);
    expect(await scan("12"), "too short for a barcode").toEqual({ products: [] });
    expect(off.asked).toHaveLength(1);
  });

  it("finds products by every typed word in name or brand, names that start with the first word first", async () => {
    const catalog = kitchenCatalog(sql!, [source("open-food-facts", [[
      product("1001", "Bio Kichererbsen"), product("1002", "Kichererbsen", "Billa"), product("1003", "Hummus mit Kichererbsen", "Billa"),
      product("1004", "Linsen", "Kichererbsen GmbH"), product("1005", "100% Erbsen_mix")
    ]]).reader]);
    await catalog.refresh();

    expect((await catalog.search("kichererbsen")).map((one) => one.name)).toEqual(["Kichererbsen", "Linsen", "Bio Kichererbsen", "Hummus mit Kichererbsen"]);
    expect((await catalog.search("KICHERERBSEN billa")).map((one) => one.code)).toEqual(["1002", "1003"]);
    expect(await catalog.search("k"), "one letter matches too much to help").toEqual([]);
    expect((await catalog.search("0% erbsen_")).map((one) => one.code), "% and _ are letters").toEqual(["1005"]);
    expect(await catalog.search("e%n"), "a percent sign is not a wildcard").toEqual([]);
    expect(await catalog.search("s_n"), "an underscore is not a wildcard").toEqual([]);
    expect(await catalog.search("Kichererbsen Billa")).toContainEqual(product("1002", "Kichererbsen", "Billa"));
  });

  it("goes on from the page that failed, and at the end removes products the source no longer lists", async () => {
    const off = source("open-food-facts", [[product("1", "Milch"), product("2", "Gone")]]);
    const catalog = kitchenCatalog(sql!, [off.reader]);
    let clock = new Date("2026-11-01T04:40:00Z");
    const now = () => clock;
    await catalog.refresh({ now });

    clock = new Date("2026-11-03T04:40:00Z");
    expect(await catalog.refresh({ now }), "a refresh waits a week").toEqual({ "open-food-facts": { status: "fresh" } });

    clock = new Date("2026-11-08T04:40:00Z");
    const week = source("open-food-facts", [[product("1", "Vollmilch")], [product("3", "Butter")], [product("4", "Topfen")]], { failOn: [2] });
    const weekly = kitchenCatalog(sql!, [week.reader]);
    await expect(weekly.refresh({ now })).rejects.toThrow(/failed for 1 source/);
    expect((await weekly.search("gone")).map((one) => one.code), "nothing goes away before the refresh ends").toEqual(["2"]);

    clock = new Date("2026-11-08T05:40:00Z");
    expect(await weekly.refresh({ now })).toEqual({ "open-food-facts": { status: "finished", products: 3 } });
    expect(week.asked, "page 1 is not fetched again").toEqual([1, 2, 2, 3]);
    expect(await weekly.search("gone")).toEqual([]);
    expect((await weekly.search("milch")).map((one) => one.name)).toEqual(["Vollmilch"]);
  });

  it("copies Billa once, keeps its products through the weekly Open Food Facts refresh, and goes on when the other source fails", async () => {
    const off = source("open-food-facts", [[product("9001", "Haferflocken", "Spar")]], { failOn: [1] });
    const billa = source("billa", [[product("00-1", "Haferflocken", "Clever", "billa")]], { refreshEveryMs: Number.POSITIVE_INFINITY });
    const catalog = kitchenCatalog(sql!, [off.reader, billa.reader]);
    let clock = new Date("2026-11-01T04:40:00Z");
    const now = () => clock;

    await expect(catalog.refresh({ now }), "the failure is still reported").rejects.toThrow(/failed for 1 source/);
    expect((await catalog.search("hafer")).map((one) => one.source), "Billa ran although Open Food Facts failed").toEqual(["billa"]);

    off.send([[]]);
    clock = new Date("2027-03-01T04:40:00Z");
    expect(await catalog.refresh({ now })).toEqual({ "open-food-facts": { status: "finished", products: 0 }, billa: { status: "fresh" } });
    expect(billa.asked, "Billa is copied once").toEqual([1]);
    expect(await catalog.search("haferflocken")).toEqual([product("00-1", "Haferflocken", "Clever", "billa")]);
  });

  it("shows a product that both sources list once, from Billa, and keeps other brands", async () => {
    const catalog = kitchenCatalog(sql!, [
      source("open-food-facts", [[product("9001", "Joghurt Natur 1 %", "Ja! Natürlich"), product("9002", "Joghurt Natur 1%", "Spar")]]).reader,
      source("billa", [[product("00-1", "Ja! Natürlich Joghurt Natur 1%", "Ja! Natürlich", "billa")]]).reader
    ]);
    await catalog.refresh();

    expect((await catalog.search("joghurt natur")).map((one) => `${one.source} ${one.brand}`).sort()).toEqual(["billa Ja! Natürlich", "open-food-facts Spar"]);
  });

  it("stops between pages when the server shuts down, and the next run goes on from there", async () => {
    const stop = new AbortController();
    const pages = source("open-food-facts", [[product("1", "Reis")], [product("2", "Nudeln")]], { pauseMs: 60_000 });
    const catalog = kitchenCatalog(sql!, [pages.reader]);
    const first = catalog.refresh({ signal: stop.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    stop.abort();
    expect(await first).toEqual({ "open-food-facts": { status: "stopped", nextPage: 2 } });
    expect(await kitchenCatalog(sql!, [{ ...pages.reader, pauseMs: 0 }]).refresh()).toEqual({ "open-food-facts": { status: "finished", products: 2 } });
    expect(pages.asked).toEqual([1, 2]);
  });

  it("answers the app only with a Kitchen app token", async () => {
    const catalog = kitchenCatalog(sql!, [source("open-food-facts", [[product("1", "Haferflocken")]]).reader]);
    await catalog.refresh();
    const request = new Request("https://tools.example.test/api/kitchen/products?q=hafer");

    expect((await handleKitchenCatalog(request, async () => undefined, catalog)).status).toBe(401);
    expect((await handleKitchenCatalog(request, async () => ({ ...friend, products: [] }), catalog)).status).toBe(403);
    const ok = await handleKitchenCatalog(request, async () => friend, catalog);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect(await ok.json()).toEqual({ products: [product("1", "Haferflocken")] });
  });
});
