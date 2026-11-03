import type postgres from "postgres";

/** Tables whose rows belong to one person, keyed by `owner_subject`, the person's Google subject. */
export const OWNED_TABLES = ["feedback_forms"] as const;

/**
 * Runs before the Drizzle push. Rows written before a table had an owner belong to the admin,
 * so the push can then make `owner_subject` required. A second run changes nothing.
 */
export async function assignExistingRowsToAdmin(database: postgres.Sql, adminSubject: string | undefined) {
  await database.begin(async (transaction) => {
    for (const table of OWNED_TABLES) {
      const [found] = await transaction<{ present: boolean }[]>`select to_regclass(${`tools.${table}`}) is not null present`;
      if (!found?.present) continue;
      await transaction.unsafe(`alter table tools.${table} add column if not exists owner_subject text`);
      const [{ unowned } = { unowned: 0 }] = await transaction.unsafe<{ unowned: number }[]>(
        `select count(*)::int unowned from tools.${table} where owner_subject is null`);
      if (unowned === 0) continue;
      if (!adminSubject) throw new Error(`AUTH_ALLOWED_GOOGLE_SUBJECT is required to give ${unowned} existing tools.${table} rows to the admin.`);
      await transaction.unsafe(`update tools.${table} set owner_subject = $1 where owner_subject is null`, [adminSubject]);
    }
  });
}
