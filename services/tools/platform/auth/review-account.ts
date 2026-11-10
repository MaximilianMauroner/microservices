import type postgres from "postgres";
import type { PlatformPrincipal } from "#security";
import { APP_CLIENTS } from "./app-clients.js";

export const REVIEW_ACCOUNT = {
  username: "apple-review",
  email: "apple-review@pantrino.invalid",
  userId: "pantrino-apple-review",
  subject: "urn:mauroner:pantrino:apple-review",
  personId: "19d6483f-57f7-4198-91e6-b66224399e66",
  kitchenId: "954b4f65-766e-43b9-8b36-94ab4b3695d9",
  clientId: APP_CLIENTS.kitchen.clientId
} as const;

export type ReviewAccount = typeof REVIEW_ACCOUNT;

export function loadReviewAccount(env: Readonly<Record<string, string | undefined>>): ReviewAccount | undefined {
  const enabled = env.AUTH_APP_REVIEW_ENABLED;
  if (!enabled || enabled === "false") return undefined;
  if (enabled !== "true") throw new Error("AUTH_APP_REVIEW_ENABLED must be either true or false");
  return REVIEW_ACCOUNT;
}

export function isReviewUser(user: { id: string; email: string }): boolean {
  return user.id === REVIEW_ACCOUNT.userId || user.email.toLowerCase() === REVIEW_ACCOUNT.email;
}

export async function reviewPrincipal(sql: postgres.Sql, account: ReviewAccount | undefined): Promise<PlatformPrincipal | undefined> {
  if (!account) return undefined;
  const [row] = await sql`
    select 1 from tools.auth_users u
    join tools.auth_accounts a on a.user_id = u.id and a.provider_id = 'credential' and a.account_id = u.id
    join tools.people p on p.id = ${account.personId} and p.email = u.email and p.google_subject = ${account.subject}
    join tools.product_grants g on g.person_id = p.id and g.product_id = 'kitchen'
    join tools.kitchen_members m on m.person_id = p.id and m.kitchen_id = ${account.kitchenId}
    where u.id = ${account.userId} and u.email = ${account.email} and a.password is not null
      and not exists (select 1 from tools.auth_accounts other where other.user_id = u.id and other.provider_id <> 'credential')
      and not exists (select 1 from tools.kitchen_members other where other.person_id = p.id and other.kitchen_id <> ${account.kitchenId})
      and not exists (select 1 from tools.kitchen_members other where other.kitchen_id = ${account.kitchenId} and other.person_id <> p.id)`;
  return row ? { role: "member", subject: account.subject, email: account.email, products: ["kitchen"] } : undefined;
}
