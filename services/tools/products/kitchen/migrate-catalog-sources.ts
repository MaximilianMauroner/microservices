import type postgres from "postgres";

/**
 * The first catalog had one source and no `source` or `match_key` column. Its rows are a copy of Open Food Facts, so the
 * copy starts again instead of a backfill. The lock and the new required columns stop a server that still runs the old
 * code from writing old rows before the schema push.
 */
export async function migrateKitchenCatalogSources(database: postgres.Sql) {
  await database.begin(async (sql) => {
    const [{ present }] = await sql<{ present: boolean }[]>`select to_regclass('tools.kitchen_catalog_products') is not null present`;
    if (!present) return;
    await sql`lock table tools.kitchen_catalog_products in access exclusive mode`;
    const [current] = await sql`select 1 from information_schema.columns
      where table_schema = 'tools' and table_name = 'kitchen_catalog_products' and column_name = 'match_key'`;
    if (current) return;
    await sql`truncate tools.kitchen_catalog_products`;
    await sql`delete from tools.kitchen_catalog_refresh`;
    await sql`alter table tools.kitchen_catalog_products add column source text not null, add column match_key text not null`;
  });
}
