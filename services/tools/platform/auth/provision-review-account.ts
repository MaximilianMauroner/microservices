import { hashPassword } from "better-auth/crypto";
import type postgres from "postgres";
import { REVIEW_ACCOUNT as account } from "./review-account.js";
import { resolvePushDatabase, type PushMode } from "../database/postgres-push-guard.js";

export function reviewProvisionTarget(env: NodeJS.ProcessEnv, mode: string | undefined): { url: string; mode: PushMode } {
  if (mode !== "test" && mode !== "development" && mode !== "production") throw new Error("Choose test, development, or production explicitly.");
  if (env.APP_REVIEW_PROVISION_CONFIRM !== account.userId) throw new Error(`Requires APP_REVIEW_PROVISION_CONFIRM=${account.userId}.`);
  if (mode !== "production" && (env.TOOLS_ENVIRONMENT === "production" || env.NODE_ENV === "production" || env.RAILWAY_ENVIRONMENT_NAME === "production")) {
    throw new Error("A non-production command cannot target a production environment.");
  }
  const url = resolvePushDatabase(env, mode);
  const parsed = new URL(url);
  if (mode === "test" && (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !parsed.port || parsed.search || parsed.hash)) {
    throw new Error("Test provisioning requires a loopback PostgreSQL URL with an explicit port.");
  }
  if (mode === "production" && !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.railway\.internal$/i.test(parsed.hostname)) {
    throw new Error("Production provisioning requires the private Railway database host.");
  }
  return { url, mode };
}

export async function provisionReviewAccount(sql: postgres.Sql, operation: { kind: "provision"; password: string } | { kind: "revoke" }) {
  if (operation.kind === "provision" && (operation.password.length < 16 || operation.password.length > 128)) {
    throw new Error("The review password must have 16 to 128 characters.");
  }
  const passwordHash = operation.kind === "provision" ? await hashPassword(operation.password) : undefined;
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${account.userId}))`;
    const users = await tx<{ id: string; email: string }[]>`select id, email from tools.auth_users where id = ${account.userId} or email = ${account.email} for update`;
    const people = await tx<{ id: string; email: string; google_subject: string | null }[]>`
      select id, email, google_subject from tools.people where id = ${account.personId} or email = ${account.email} or google_subject = ${account.subject} for update`;
    if (users.some((u) => u.id !== account.userId || u.email !== account.email) ||
      people.some((p) => p.id !== account.personId || p.email !== account.email || p.google_subject !== account.subject)) {
      throw new Error("The reserved review identity conflicts with existing data.");
    }
    const providers = await tx<{ provider_id: string; account_id: string; user_id: string }[]>`
      select provider_id, account_id, user_id from tools.auth_accounts where user_id = ${account.userId}
        or (provider_id = 'credential' and account_id = ${account.userId})`;
    if (providers.some((p) => p.provider_id !== "credential" || p.account_id !== account.userId || p.user_id !== account.userId)) {
      throw new Error("The review user must have only its reserved credential account.");
    }
    await tx`delete from tools.oauth_access_tokens where user_id = ${account.userId}`;
    await tx`delete from tools.oauth_refresh_tokens where user_id = ${account.userId}`;
    await tx`delete from tools.oauth_consents where user_id = ${account.userId}`;
    await tx`delete from tools.auth_sessions where user_id = ${account.userId}`;
    if (operation.kind === "revoke") {
      await tx`update tools.auth_accounts set password = null, updated_at = now() where user_id = ${account.userId} and provider_id = 'credential'`;
      await tx`delete from tools.product_grants where person_id = ${account.personId}`;
      return;
    }
    const memberships = await tx`select 1 from tools.kitchen_members where
      (person_id = ${account.personId} and kitchen_id <> ${account.kitchenId}) or
      (kitchen_id = ${account.kitchenId} and person_id <> ${account.personId})`;
    if (memberships.length) throw new Error("The review kitchen must be separate from all other people and kitchens.");
    const [kitchen] = await tx`select id from tools.kitchens where id = ${account.kitchenId}`;
    if (kitchen && !people.length) throw new Error("The reserved sample kitchen already exists without its review owner.");
    await tx`insert into tools.auth_users (id, name, email, email_verified, created_at, updated_at)
      values (${account.userId}, 'Apple App Review', ${account.email}, true, now(), now()) on conflict (id) do nothing`;
    await tx`insert into tools.auth_accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
      values (${account.userId}, ${account.userId}, ${account.userId}, 'credential', ${passwordHash!}, now(), now())
      on conflict (provider_id, account_id) do update set password = excluded.password, updated_at = now()`;
    await tx`insert into tools.people (id, email, google_subject, invited_at, bound_at)
      values (${account.personId}, ${account.email}, ${account.subject}, now(), now()) on conflict (id) do nothing`;
    await tx`delete from tools.product_grants where person_id = ${account.personId} and product_id <> 'kitchen'`;
    await tx`insert into tools.product_grants (person_id, product_id, granted_at) values (${account.personId}, 'kitchen', now()) on conflict do nothing`;
    await tx`insert into tools.kitchens (id, name, groups, created_at)
      values (${account.kitchenId}, 'App Review Kitchen', ${["Pasta", "Vegetables"]}, now()) on conflict (id) do nothing`;
    await tx`insert into tools.kitchen_members (kitchen_id, person_id, added_at) values (${account.kitchenId}, ${account.personId}, now()) on conflict do nothing`;
    await tx`insert into tools.kitchen_person_settings (kitchen_id, subject, mcp_enabled, hidden)
      values (${account.kitchenId}, ${account.subject}, false, false) on conflict (kitchen_id, subject) do update set mcp_enabled = false, hidden = false`;
    const pastaId = "c7b0bc9c-6c5b-4fe5-af5f-3dd8b4a571de";
    const tomatoId = "a031a148-687f-4f0e-ad43-c50c505054c9";
    const recipeId = "68897430-a609-45a9-bfd4-cc916dc2d561";
    for (const ingredient of [{ id: pastaId, name: "Spaghetti", section: "Pasta" }, { id: tomatoId, name: "Tomatoes", section: "Vegetables" }]) {
      await tx`insert into tools.kitchen_ingredients (id, kitchen_id, name, unit, section, updated_at)
        values (${ingredient.id}, ${account.kitchenId}, ${ingredient.name}, 'g', ${ingredient.section}, now()) on conflict do nothing`;
    }
    await tx`insert into tools.kitchen_recipes (id, kitchen_id, name, servings, minutes, instructions, updated_at)
      values (${recipeId}, ${account.kitchenId}, 'Tomato pasta', 2, 20, 'Cook the spaghetti. Simmer the tomatoes. Mix and serve.', now()) on conflict do nothing`;
    for (const [position, ingredientId, amount] of [[0, pastaId, 200], [1, tomatoId, 400]] as const) {
      await tx`insert into tools.kitchen_recipe_lines (kitchen_id, recipe_id, ingredient_id, position, amount)
        select ${account.kitchenId}, ${recipeId}, ${ingredientId}, ${position}, ${amount}
        where exists (select 1 from tools.kitchen_recipes where id = ${recipeId} and kitchen_id = ${account.kitchenId})
          and exists (select 1 from tools.kitchen_ingredients where id = ${ingredientId} and kitchen_id = ${account.kitchenId})
        on conflict do nothing`;
    }
  });
}
