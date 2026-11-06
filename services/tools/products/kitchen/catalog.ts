import { setTimeout as sleep } from "node:timers/promises";
import postgres, { type Sql } from "postgres";
import type { CatalogProduct, CatalogSource, Nutrition } from "./domain.js";

const SEARCH_LIMIT = 8;
const USER_AGENT = "MauronerTools-Kitchen/1.0 (https://tools.mauroner.net)";

export type CatalogPage = Readonly<{ products: readonly CatalogProduct[]; last: boolean }>;

/**
 * Where catalog products come from. A run reads up to `pagesPerRun` pages of each source, with `pauseMs` between
 * requests. After the last page, the source waits `refreshEveryMs` before it starts again from page 1.
 */
export type CatalogSourceReader = Readonly<{
  id: CatalogSource;
  refreshEveryMs: number;
  pagesPerRun: number;
  pauseMs: number;
  fetchPage(page: number, signal: AbortSignal, pauseMs: number): Promise<CatalogPage>;
}>;

export const CATALOG_READERS: readonly CatalogSourceReader[] = [
  /** Open Food Facts allows 10 searches a minute. 50 pages take about eight minutes. */
  { id: "open-food-facts", refreshEveryMs: 7 * 86_400_000, pagesPerRun: 50, pauseMs: 10_000, fetchPage: (page, signal) => fetchOpenFoodFactsPage(page, signal) },
  /** A copy made once. Each page asks for 50 products, one a second, so 8 pages take about seven minutes. */
  { id: "billa", refreshEveryMs: Number.POSITIVE_INFINITY, pagesPerRun: 8, pauseMs: 1_000, fetchPage: (page, signal, pauseMs) => fetchBillaPage(page, signal, pauseMs) },
];

export type CatalogRefresh = Readonly<{ status: "fresh" } | { status: "stopped"; nextPage: number } | { status: "finished"; products: number }>;

export interface KitchenCatalog {
  /** Products whose name or brand holds every typed word, best match first. */
  search(query: string): Promise<readonly CatalogProduct[]>;
  /**
   * Goes on with the copy of each source. A source stops after some pages, on an error, or when `signal` aborts. The next
   * call goes on from the page after the last one it saved. At the end of a source, it removes the products of that source
   * that the source no longer lists. An error in one source does not stop the others. It fails the call after all of them ran.
   */
  refresh(options?: { signal?: AbortSignal; now?: () => Date }): Promise<Readonly<Partial<Record<CatalogSource, CatalogRefresh>>>>;
  readiness(): Promise<void>;
  close(): Promise<void>;
}

export function createPostgresKitchenCatalog(databaseUrl: string, options: { readOnly?: boolean } = {}): KitchenCatalog {
  return kitchenCatalog(postgres(databaseUrl, { max: 2, idle_timeout: 120, connection: options.readOnly ? { default_transaction_read_only: true } : undefined }));
}

type ProductRow = { source: CatalogSource; code: string; name: string; brand: string; quantity: string; unit: "g" | "ml"; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null };

export function kitchenCatalog(sql: Sql, sources: readonly CatalogSourceReader[] = CATALOG_READERS): KitchenCatalog {
  async function save(source: CatalogSource, products: readonly CatalogProduct[], at: Date) {
    if (!products.length) return;
    const unique = [...new Map(products.map((product) => [product.code, product])).values()];
    const rows = unique.map((product) => ({
      source, code: product.code, name: product.name, brand: product.brand, quantity: product.quantity, unit: product.unit,
      kcal: product.nutrition.kcal, protein: product.nutrition.protein, carbs: product.nutrition.carbs, fat: product.nutrition.fat,
      search: `${product.name} ${product.brand}`.toLowerCase(), refreshed_at: at
    }));
    await sql`insert into tools.kitchen_catalog_products ${sql(rows)}
      on conflict (source, code) do update set name = excluded.name, brand = excluded.brand, quantity = excluded.quantity, unit = excluded.unit,
        kcal = excluded.kcal, protein = excluded.protein, carbs = excluded.carbs, fat = excluded.fat, search = excluded.search, refreshed_at = excluded.refreshed_at`;
  }

  async function refreshSource(source: CatalogSourceReader, signal: AbortSignal, now: () => Date): Promise<CatalogRefresh> {
    const [state] = await sql<{ started_at: Date; next_page: number | null }[]>`
      select started_at, next_page from tools.kitchen_catalog_refresh where source = ${source.id}`;
    if (state && state.next_page === null && now().getTime() - state.started_at.getTime() < source.refreshEveryMs) return { status: "fresh" };
    let page = state?.next_page ?? 1;
    if (state?.next_page == null) {
      await sql`insert into tools.kitchen_catalog_refresh (source, started_at, next_page, finished_at) values (${source.id}, ${now()}, 1, null)
        on conflict (source) do update set started_at = excluded.started_at, next_page = 1, finished_at = null`;
    }
    for (let fetched = 0; fetched < source.pagesPerRun && !signal.aborted; fetched += 1) {
      if (fetched > 0 && !(await pause(source.pauseMs, signal))) break;
      const result = await source.fetchPage(page, signal, source.pauseMs);
      await save(source.id, result.products, now());
      if (result.last) {
        return sql.begin(async (tx) => {
          await tx`delete from tools.kitchen_catalog_products where source = ${source.id}
            and refreshed_at < (select started_at from tools.kitchen_catalog_refresh where source = ${source.id})`;
          await tx`update tools.kitchen_catalog_refresh set next_page = null, finished_at = ${now()} where source = ${source.id}`;
          const [count] = await tx<{ products: number }[]>`select count(*)::int products from tools.kitchen_catalog_products where source = ${source.id}`;
          return { status: "finished", products: count?.products ?? 0 } as const;
        });
      }
      page += 1;
      await sql`update tools.kitchen_catalog_refresh set next_page = ${page} where source = ${source.id}`;
    }
    return { status: "stopped", nextPage: page };
  }

  return {
    async search(query) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5).map((word) => word.slice(0, 40));
      if (words.join("").length < 2) return [];
      const patterns = words.map((word) => `%${word.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
      const rows = await sql<ProductRow[]>`
        select source, code, name, brand, quantity, unit, kcal, protein, carbs, fat from tools.kitchen_catalog_products
        where search like all(${patterns}::text[])
        order by starts_with(search, ${words[0]!}) desc, length(name), name, source
        limit ${SEARCH_LIMIT}`;
      return rows.map(({ kcal, protein, carbs, fat, ...product }) => ({ ...product, nutrition: { kcal, protein, carbs, fat } }));
    },

    async refresh({ signal = new AbortController().signal, now = () => new Date() } = {}) {
      const results: Partial<Record<CatalogSource, CatalogRefresh>> = {};
      const failures: unknown[] = [];
      for (const source of sources) {
        if (signal.aborted) break;
        try {
          results[source.id] = await refreshSource(source, signal, now);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, `Catalog refresh failed for ${failures.length} source(s).`);
      return results;
    },

    async readiness() {
      await sql`select 1 from tools.kitchen_catalog_products limit 1`;
    },
    close: () => sql.end()
  };
}

async function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  try {
    await sleep(ms, undefined, { signal });
    return true;
  } catch {
    return false;
  }
}

async function getJson(url: URL, signal: AbortSignal, fetcher: typeof fetch): Promise<Response> {
  return fetcher(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
}

const OFF_PAGE_SIZE = 100;
const OFF_FIELDS = "code,product_name,product_name_de,brands,quantity,product_quantity_unit,nutriments";

export async function fetchOpenFoodFactsPage(page: number, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<CatalogPage> {
  const url = new URL("https://world.openfoodfacts.org/api/v2/search");
  url.search = new URLSearchParams({ countries_tags_en: "austria", sort_by: "created_t", page_size: String(OFF_PAGE_SIZE), page: String(page), fields: OFF_FIELDS }).toString();
  const response = await getJson(url, signal, fetcher);
  if (!response.ok) throw new Error(`Open Food Facts answered ${response.status} for page ${page}.`);
  return parseOpenFoodFactsPage(await response.json(), page);
}

/** Reads one search page. A product needs a code, a name, and its calories to be useful for a new ingredient. */
export function parseOpenFoodFactsPage(body: unknown, page: number): CatalogPage {
  const record = object(body);
  const raw = Array.isArray(record?.products) ? record.products : undefined;
  const count = record?.count;
  if (!raw || typeof count !== "number") throw new Error(`Open Food Facts sent an unexpected page ${page}.`);
  const products = raw.flatMap((item) => {
    const product = parseOpenFoodFactsProduct(item);
    return product ? [product] : [];
  });
  return { products, last: raw.length < OFF_PAGE_SIZE || page * OFF_PAGE_SIZE >= count };
}

function parseOpenFoodFactsProduct(item: unknown): CatalogProduct | undefined {
  const product = object(item);
  if (!product) return undefined;
  const code = text(product.code);
  const nutriments = object(product.nutriments) ?? {};
  return catalogProduct("open-food-facts", /^\d{4,14}$/.test(code) ? code : "", text(product.product_name_de) || text(product.product_name), {
    brand: text(product.brands).split(",")[0] ?? "",
    quantity: text(product.quantity),
    unit: text(product.product_quantity_unit) === "ml" ? "ml" : "g",
    nutrition: {
      kcal: amount(nutriments["energy-kcal_100g"]), protein: amount(nutriments.proteins_100g),
      carbs: amount(nutriments.carbohydrates_100g), fat: amount(nutriments.fat_100g)
    }
  });
}

const BILLA_PAGE_SIZE = 50;
/** Top categories without food. Their products have no nutrition, so asking for their details would only cost requests. */
const BILLA_NON_FOOD = new Set(["Drogerie & Kosmetik", "Küche, Haushalt & Garten", "Haustier"]);

/** One page of the Billa shop list, with the details of each food product on it. A product that is gone has no details and is left out. */
export async function fetchBillaPage(page: number, signal: AbortSignal, pauseMs: number, fetcher: typeof fetch = fetch): Promise<CatalogPage> {
  const url = new URL("https://shop.billa.at/api/product-discovery/products");
  url.search = new URLSearchParams({ page: String(page - 1), pageSize: String(BILLA_PAGE_SIZE) }).toString();
  const response = await getJson(url, signal, fetcher);
  if (!response.ok) throw new Error(`Billa answered ${response.status} for page ${page}.`);
  const list = parseBillaList(await response.json(), page);
  const products: CatalogProduct[] = [];
  for (const [index, sku] of list.skus.entries()) {
    if (index > 0 && !(await pause(pauseMs, signal))) throw new Error(`Billa page ${page} stopped before its end.`);
    const detail = await getJson(new URL(`https://shop.billa.at/api/product-discovery/products/${encodeURIComponent(sku)}`), signal, fetcher);
    if (detail.status === 404) continue;
    if (!detail.ok) throw new Error(`Billa answered ${detail.status} for product ${sku}.`);
    const product = parseBillaProduct(await detail.json());
    if (product) products.push(product);
  }
  return { products, last: list.last };
}

export function parseBillaList(body: unknown, page: number): { skus: readonly string[]; last: boolean } {
  const record = object(body);
  const results = Array.isArray(record?.results) ? record.results : undefined;
  const total = record?.total;
  if (!results || typeof total !== "number") throw new Error(`Billa sent an unexpected page ${page}.`);
  const skus = results.flatMap((item) => {
    const product = object(item);
    const sku = text(product?.sku);
    const top = Array.isArray(product?.parentCategories) && Array.isArray(product.parentCategories[0]) ? text(object(product.parentCategories[0][0])?.name) : "";
    return sku && !BILLA_NON_FOOD.has(top) ? [sku] : [];
  });
  return { skus, last: results.length < BILLA_PAGE_SIZE || page * BILLA_PAGE_SIZE >= total };
}

/** Reads a Billa product. Its nutrition is the newest table for 100 g or 100 ml, unprepared when there is a choice. */
export function parseBillaProduct(body: unknown): CatalogProduct | undefined {
  const product = object(body);
  if (!product) return undefined;
  const information = (Array.isArray(product.additionalInformation) ? product.additionalInformation : [])
    .map(object).filter((one) => one !== undefined)
    .sort((a, b) => text(b.validFrom).localeCompare(text(a.validFrom)))[0];
  const food = object(information?.foodInformation);
  const tables = (Array.isArray(food?.nutritionInfos) ? food.nutritionInfos : []).map(object)
    .filter((one) => one !== undefined && one.relationValue === 100 && ["g", "ml"].includes(text(object(one.unit)?.symbol)));
  const table = tables.find((one) => text(one!.preparationGrade) === "Unzubereitet") ?? tables[0];
  if (!table) return undefined;
  const nutrients = (Array.isArray(table.nutrients) ? table.nutrients : []).map(object).filter((one) => one !== undefined);
  const value = (id: string, unit: string) => amount(nutrients.find((one) => text(one.nutrientId) === id && text(object(one.unit)?.symbol) === unit)?.value);
  const kilojoules = value("ENER-", "kJ");
  return catalogProduct("billa", text(product.sku), text(product.name), {
    brand: text(object(product.brand)?.name),
    quantity: "",
    unit: text(object(table.unit)?.symbol) === "ml" ? "ml" : "g",
    nutrition: {
      kcal: value("ENER-", "kcal") ?? (kilojoules === null ? null : Math.round(kilojoules / 4.184)),
      protein: value("PRO-", "g"), carbs: value("CHOAVL", "g"), fat: value("FAT", "g")
    }
  });
}

/** A product needs a code, a name, and its calories to be useful for a new ingredient. */
function catalogProduct(source: CatalogSource, code: string, name: string, rest: Omit<CatalogProduct, "source" | "code" | "name">): CatalogProduct | undefined {
  if (!code || !name || rest.nutrition.kcal === null) return undefined;
  return { source, code, name: name.slice(0, 200), ...rest, brand: rest.brand.trim().slice(0, 100), quantity: rest.quantity.slice(0, 40) };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function amount(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0 && number < 10_000 ? Math.round(number * 10) / 10 : null;
}
