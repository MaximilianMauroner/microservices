import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { isGrantableProduct, type GrantableProductId } from "../product-access.js";

export type Person = Readonly<{
  id: string;
  email: string;
  bound: boolean;
  invitedAt: string;
  products: readonly GrantableProductId[];
}>;

export class PeopleError extends Error {
  constructor(message: string) { super(message); this.name = "PeopleError"; }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PersonRow = { id: string; email: string; google_subject: string | null; invited_at: Date | string; products: string[] };

export function createPeopleRepository(sql: postgres.Sql, adminEmail: string) {
  return {
    async list(): Promise<Person[]> {
      const rows = await sql<PersonRow[]>`
        select p.id, p.email, p.google_subject, p.invited_at,
          coalesce(array_agg(g.product_id order by g.product_id) filter (where g.product_id is not null), '{}') products
        from tools.people p left join tools.product_grants g on g.person_id = p.id
        group by p.id order by p.invited_at`;
      return rows.map(toPerson);
    },

    async invite(rawEmail: string): Promise<Person> {
      const email = normalizeEmail(rawEmail);
      if (email === adminEmail) throw new PeopleError("This is the admin account.");
      const [row] = await sql<PersonRow[]>`
        insert into tools.people (id, email, invited_at) values (${randomUUID()}, ${email}, now())
        on conflict (email) do nothing
        returning id, email, google_subject, invited_at, '{}'::text[] products`;
      if (!row) throw new PeopleError("This email is already invited.");
      return toPerson(row);
    },

    async setGrant(personId: string, product: GrantableProductId, granted: boolean): Promise<void> {
      if (granted) {
        const rows = await sql`
          insert into tools.product_grants (person_id, product_id, granted_at)
          select id, ${product}, now() from tools.people where id = ${personId}
          on conflict do nothing returning person_id`;
        if (!rows.length && !(await exists(sql, personId))) throw new PeopleError("This person is not invited.");
        return;
      }
      await sql`delete from tools.product_grants where person_id = ${personId} and product_id = ${product}`;
    },

    /** Deletes the person, their grants, and their Better Auth user, which ends every session at once. */
    async remove(personId: string): Promise<void> {
      await sql.begin(async (transaction) => {
        const [person] = await transaction<{ google_subject: string | null }[]>`
          delete from tools.people where id = ${personId} returning google_subject`;
        if (!person) throw new PeopleError("This person is not invited.");
        if (person.google_subject) {
          await transaction`
            delete from tools.auth_users where id in (
              select user_id from tools.auth_accounts where provider_id = 'google' and account_id = ${person.google_subject})`;
        }
      });
    },

    /** Admits a verified Google account at sign-in. The first sign-in binds the invitation to the subject. */
    async admit(subject: string, rawEmail: string): Promise<boolean> {
      const bound = await sql`select id from tools.people where google_subject = ${subject}`;
      if (bound.length) return true;
      const claimed = await sql`
        update tools.people set google_subject = ${subject}, bound_at = now()
        where google_subject is null and email = ${normalizeEmail(rawEmail)}
        returning id`;
      return claimed.length > 0;
    },

    async grantsFor(subject: string): Promise<readonly GrantableProductId[] | undefined> {
      const [row] = await sql<{ products: string[] }[]>`
        select coalesce(array_agg(g.product_id) filter (where g.product_id is not null), '{}') products
        from tools.people p left join tools.product_grants g on g.person_id = p.id
        where p.google_subject = ${subject} group by p.id`;
      return row?.products.filter(isGrantableProduct);
    }
  };
}

export type PeopleRepository = ReturnType<typeof createPeopleRepository>;

function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) throw new PeopleError("Enter a valid email address.");
  return email;
}

async function exists(sql: postgres.Sql, personId: string) {
  return (await sql`select 1 from tools.people where id = ${personId}`).length > 0;
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    email: row.email,
    bound: row.google_subject !== null,
    invitedAt: new Date(row.invited_at).toISOString(),
    products: row.products.filter(isGrantableProduct)
  };
}
