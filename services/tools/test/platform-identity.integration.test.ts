import postgres from "postgres";
import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../database/postgres-push-guard.js";
import { createPlatformIdentity } from "../src/lib/auth.js";
import { requireLoopbackPostgres } from "./runtime/postgres.ts";

const databaseUrl = process.env.TEST_DATABASE_URL ? requireLoopbackPostgres(process.env.TEST_DATABASE_URL) : undefined;
const confirmed = process.env.MONEY_TEST_DATABASE_CONFIRM === "money-repository-test";
const admin = databaseUrl && confirmed ? postgres(databaseUrl, { max: 1 }) : undefined;

const config = {
  publicOrigin: "http://tools.example.test",
  googleClientId: "test-client",
  googleClientSecret: "test-client-secret",
  secret: "integration-test-secret-with-32-characters",
  allowedGoogleEmail: "maximilian.mauroner@gmail.com",
  allowedGoogleSubject: "admin-subject"
};
const identity = admin ? createPlatformIdentity(config, databaseUrl!) : undefined;

beforeEach(async () => {
  if (!admin) return;
  await withVerifiedDisposableDatabase({
    readRelationKind: async () => (await admin<{ kind: string }[]>`
      select c.relkind::text kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${DISPOSABLE_DATABASE_SENTINEL.relation}`)[0]?.kind,
    readValue: async () => (await admin<{ value: string }[]>`
      select sentinel_value value from public.tools_runtime_test_sentinel
      where sentinel_key = ${DISPOSABLE_DATABASE_SENTINEL.key}`)[0]?.value,
  }, async () => {
    await admin`truncate tools.auth_users, tools.auth_sessions, tools.auth_accounts, tools.auth_verifications cascade`;
  });
});

afterAll(async () => {
  await identity?.close();
  await admin?.end();
});

async function signIn(subject: string, email: string) {
  const context = await identity!.auth.$context;
  const { user } = await context.internalAdapter.createOAuthUser(
    { name: "Test Person", email, emailVerified: true, image: "https://example.test/a.png" },
    { providerId: "google", accountId: subject }
  );
  const session = await context.internalAdapter.createSession(user.id);
  const signature = createHmac("sha256", config.secret).update(session.token).digest("base64");
  const cookie = `mauroner-tools.session_token=${encodeURIComponent(`${session.token}.${signature}`)}`;
  return { session, request: () => new Request(`${config.publicOrigin}/money`, { headers: { cookie } }) };
}

describe.skipIf(!admin)("platform identity on PostgreSQL sessions", () => {
  it("resolves the admin from a stored session by Google subject", async () => {
    const { request } = await signIn("admin-subject", config.allowedGoogleEmail);
    expect(await identity!.resolvePrincipal(request())).toEqual({
      role: "admin",
      subject: "admin-subject",
      email: config.allowedGoogleEmail
    });
  });

  it("rejects a stored session for another Google account", async () => {
    const { request } = await signIn("other-subject", "someone@example.test");
    expect(await identity!.resolvePrincipal(request())).toBeUndefined();
  });

  it("ends access on the next request after the session row is deleted", async () => {
    const { session, request } = await signIn("admin-subject", config.allowedGoogleEmail);
    expect(await identity!.resolvePrincipal(request())).toBeDefined();
    await admin!`delete from tools.auth_sessions where id = ${session.id}`;
    expect(await identity!.resolvePrincipal(request())).toBeUndefined();
  });

  it("removes the session row on sign-out", async () => {
    const { session, request } = await signIn("admin-subject", config.allowedGoogleEmail);
    await identity!.auth.api.signOut({ headers: request().headers });
    expect(await admin!`select id from tools.auth_sessions where id = ${session.id}`).toHaveLength(0);
    expect(await identity!.resolvePrincipal(request())).toBeUndefined();
  });
});
