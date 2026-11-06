import { setTimeout as sleep } from "node:timers/promises";
import postgres, { type Sql } from "postgres";
import type { CatalogProduct, Nutrition } from "./domain.js";

const SOURCE = "open-food-facts";
const PAGE_SIZE = 100;
/** Open Food Facts allows 10 searches a minute. */
const PAUSE_MS = 10_000;
/** About eight minutes of pages, so one run fits well inside its lease. The next run goes on from there. */
const PAGES_PER_RUN = 50;
const REFRESH_EVERY_MS = 7 * 86_400_000;
const SEARCH_LIMIT = 8;

export type CatalogPage = Readonly<{ products: readonly CatalogProduct[]; last: boolean }>;
export type CatalogRefresh = Readonly<{ status: "fresh" } | { status: "stopped"; nextPage: number } | { status: "finished"; products: number }>;

export interface KitchenCatalog {
  /** Products whose name or brand holds every typed word, best match first. */
  search(query: string): Promise<readonly CatalogProduct[]>;
  /**
   * Goes on with the weekly copy of the Austrian products on Open Food Facts. It stops after some pages, on an error, or when
   * `signal` aborts. The next call goes on from the page after the last one it saved. At the end, it removes products
   * that Open Food Facts no longer lists.
   */
  refresh(options: { fetchPage?: (page: number, signal: AbortSignal) => Promise<CatalogPage>; signal?: AbortSignal; pauseMs?: number; now?: () => Date }): Promise<CatalogRefresh>;
  readiness(): Promise<void>;
  close(): Promise<void>;
}

export function createPostgresKitchenCatalog(databaseUrl: string, options: { readOnly?: boolean } = {}): KitchenCatalog {
  return kitchenCatalog(postgres(databaseUrl, { max: 2, idle_timeout: 120, connection: options.readOnly ? { default_transaction_read_only: true } : undefined }));
}

type ProductRow = { code: string; name: string; brand: string; quantity: string; unit: "g" | "ml"; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null };

export function kitchenCatalog(sql: Sql): KitchenCatalog {
  async function save(products: readonly CatalogProduct[], at: Date) {
    if (!products.length) return;
    const unique = [...new Map(products.map((product) => [product.code, product])).values()];
    const rows = unique.map((product) => ({
      code: product.code, name: product.name, brand: product.brand, quantity: product.quantity, unit: product.unit,
      kcal: product.nutrition.kcal, protein: product.nutrition.protein, carbs: product.nutrition.carbs, fat: product.nutrition.fat,
      search: searchText(product), refreshed_at: at
    }));
    await sql`insert into tools.kitchen_catalog_products ${sql(rows)}
      on conflict (code) do update set name = excluded.name, brand = excluded.brand, quantity = excluded.quantity, unit = excluded.unit,
        kcal = excluded.kcal, protein = excluded.protein, carbs = excluded.carbs, fat = excluded.fat, search = excluded.search, refreshed_at = excluded.refreshed_at`;
  }

  return {
    async search(query) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5).map((word) => word.slice(0, 40));
      if (words.join("").length < 2) return [];
      const patterns = words.map((word) => `%${word.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
      const rows = await sql<ProductRow[]>`
        select code, name, brand, quantity, unit, kcal, protein, carbs, fat from tools.kitchen_catalog_products
        where search like all(${patterns}::text[])
        order by starts_with(search, ${words[0]!}) desc, length(name), name
        limit ${SEARCH_LIMIT}`;
      return rows.map(({ kcal, protein, carbs, fat, ...product }) => ({ ...product, nutrition: { kcal, protein, carbs, fat } }));
    },

    async refresh({ fetchPage = fetchOpenFoodFactsPage, signal = new AbortController().signal, pauseMs = PAUSE_MS, now = () => new Date() }) {
      const [state] = await sql<{ started_at: Date; next_page: number | null; finished_at: Date | null }[]>`
        select started_at, next_page, finished_at from tools.kitchen_catalog_refresh where source = ${SOURCE}`;
      if (state && state.next_page === null && now().getTime() - state.started_at.getTime() < REFRESH_EVERY_MS) return { status: "fresh" };
      let page = state?.next_page ?? 1;
      if (state?.next_page == null) {
        await sql`insert into tools.kitchen_catalog_refresh (source, started_at, next_page, finished_at) values (${SOURCE}, ${now()}, 1, null)
          on conflict (source) do update set started_at = excluded.started_at, next_page = 1, finished_at = null`;
      }
      for (let fetched = 0; fetched < PAGES_PER_RUN && !signal.aborted; fetched += 1) {
        if (fetched > 0 && !(await pause(pauseMs, signal))) break;
        const result = await fetchPage(page, signal);
        await save(result.products, now());
        if (result.last) {
          return sql.begin(async (tx) => {
            await tx`delete from tools.kitchen_catalog_products
              where refreshed_at < (select started_at from tools.kitchen_catalog_refresh where source = ${SOURCE})`;
            await tx`update tools.kitchen_catalog_refresh set next_page = null, finished_at = ${now()} where source = ${SOURCE}`;
            const [count] = await tx<{ products: number }[]>`select count(*)::int products from tools.kitchen_catalog_products`;
            return { status: "finished", products: count?.products ?? 0 } as const;
          });
        }
        page += 1;
        await sql`update tools.kitchen_catalog_refresh set next_page = ${page} where source = ${SOURCE}`;
      }
      return { status: "stopped", nextPage: page };
    },

    async readiness() {
      await sql`select 1 from tools.kitchen_catalog_products limit 1`;
    },
    close: () => sql.end()
  };
}

function searchText(product: CatalogProduct): string {
  return `${product.name} ${product.brand}`.toLowerCase();
}

async function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  try {
    await sleep(ms, undefined, { signal });
    return true;
  } catch {
    return false;
  }
}

const FIELDS = "code,product_name,product_name_de,brands,quantity,product_quantity_unit,nutriments";

export async function fetchOpenFoodFactsPage(page: number, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<CatalogPage> {
  const url = new URL("https://world.openfoodfacts.org/api/v2/search");
  url.search = new URLSearchParams({ countries_tags_en: "austria", sort_by: "created_t", page_size: String(PAGE_SIZE), page: String(page), fields: FIELDS }).toString();
  const response = await fetcher(url, {
    headers: { Accept: "application/json", "User-Agent": "MauronerTools-Kitchen/1.0 (https://tools.mauroner.net)" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)])
  });
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
    const product = parseProduct(item);
    return product ? [product] : [];
  });
  return { products, last: raw.length < PAGE_SIZE || page * PAGE_SIZE >= count };
}

function parseProduct(item: unknown): CatalogProduct | undefined {
  const product = object(item);
  if (!product) return undefined;
  const code = text(product.code);
  const name = (text(product.product_name_de) || text(product.product_name)).slice(0, 200);
  const nutriments = object(product.nutriments) ?? {};
  const nutrition: Nutrition = {
    kcal: amount(nutriments["energy-kcal_100g"]), protein: amount(nutriments.proteins_100g),
    carbs: amount(nutriments.carbohydrates_100g), fat: amount(nutriments.fat_100g)
  };
  if (!/^\d{4,14}$/.test(code) || !name || nutrition.kcal === null) return undefined;
  return {
    code, name,
    brand: (text(product.brands).split(",")[0] ?? "").trim().slice(0, 100),
    quantity: text(product.quantity).slice(0, 40),
    unit: text(product.product_quantity_unit) === "ml" ? "ml" : "g",
    nutrition
  };
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
