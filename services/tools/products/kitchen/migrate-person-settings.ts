import type postgres from "postgres";

/** The personal-settings runtime must be live before the shared column is removed. */
export async function migrateKitchenPersonSettings(database: postgres.Sql, adminSubject: string | undefined) {
  await database.begin(async (sql) => {
    const [legacy] = await sql`select 1 from information_schema.columns
      where table_schema = 'tools' and table_name = 'kitchens' and column_name = 'mcp_enabled'`;
    if (!legacy) return;
    const [{ present }] = await sql<{ present: boolean }[]>`select to_regclass('tools.kitchen_person_settings') is not null present`;
    if (!present) {
      const [enabled] = await sql`select 1 from tools.kitchens where mcp_enabled limit 1`;
      if (enabled && !adminSubject) throw new Error("The admin subject is required to preserve kitchen MCP access.");
      await sql`create table if not exists tools.kitchen_person_settings (
        kitchen_id uuid not null references tools.kitchens(id) on delete cascade,
        subject text not null,
        mcp_enabled boolean not null default false,
        hidden boolean not null default false,
        primary key (kitchen_id, subject)
      )`;
      if (adminSubject) await sql`insert into tools.kitchen_person_settings (kitchen_id, subject, mcp_enabled)
        select id, ${adminSubject}, true from tools.kitchens where mcp_enabled
        on conflict do nothing`;
      await sql`insert into tools.kitchen_person_settings (kitchen_id, subject, mcp_enabled)
        select k.id, p.google_subject, true from tools.kitchens k
        join tools.kitchen_members m on m.kitchen_id = k.id
        join tools.people p on p.id = m.person_id
        where k.mcp_enabled and p.google_subject is not null
        on conflict do nothing`;
    }
    await sql`alter table tools.kitchens drop column mcp_enabled`;
  });
}
