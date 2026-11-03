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
  allowedGoogleEmail: "owner@example.com",
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
    await admin`truncate tools.auth_users, tools.auth_sessions, tools.auth_accounts, tools.auth_verifications, tools.people, tools.product_grants cascade`;
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

describe.skipIf(!admin)("people and product grants", () => {
  it("binds an invitation to the Google subject at first sign-in and keeps it after an email change", async () => {
    const people = identity!.people;
    await people.invite("Friend@Example.test");
    expect(await people.admit("friend-subject", "friend@example.test")).toBe(true);
    expect(await people.admit("friend-subject", "renamed@example.test")).toBe(true);
    expect(await people.admit("stranger-subject", "friend@example.test")).toBe(false);
    expect(await people.admit("stranger-subject", "stranger@example.test")).toBe(false);
    expect((await people.list())[0]).toMatchObject({ email: "friend@example.test", bound: true, products: [] });
  });

  it("rejects the admin email, a duplicate invitation, and an invalid email", async () => {
    const people = identity!.people;
    await expect(people.invite(config.allowedGoogleEmail)).rejects.toThrow("admin account");
    await people.invite("friend@example.test");
    await expect(people.invite("friend@example.test")).rejects.toThrow("already invited");
    await expect(people.invite("not-an-email")).rejects.toThrow("valid email");
  });

  it("resolves a member with only their grants and applies a removed grant on the next request", async () => {
    const people = identity!.people;
    const person = await people.invite("friend@example.test");
    await people.admit("friend-subject", "friend@example.test");
    const { request } = await signIn("friend-subject", "friend@example.test");
    expect(await identity!.resolvePrincipal(request())).toEqual({
      role: "member", subject: "friend-subject", email: "friend@example.test", products: []
    });
    await people.setGrant(person.id, "kitchen", true);
    await people.setGrant(person.id, "kitchen", true);
    expect(await identity!.resolvePrincipal(request())).toMatchObject({ role: "member", products: ["kitchen"] });
    await people.setGrant(person.id, "kitchen", false);
    expect(await identity!.resolvePrincipal(request())).toMatchObject({ role: "member", products: [] });
  });

  it("ends every session of a removed person at once", async () => {
    const people = identity!.people;
    const person = await people.invite("friend@example.test");
    await people.admit("friend-subject", "friend@example.test");
    const { request } = await signIn("friend-subject", "friend@example.test");
    await people.setGrant(person.id, "kitchen", true);
    await people.remove(person.id);
    expect(await identity!.resolvePrincipal(request())).toBeUndefined();
    expect(await admin!`select id from tools.auth_sessions`).toHaveLength(0);
    expect(await admin!`select person_id from tools.product_grants`).toHaveLength(0);
    await expect(people.remove(person.id)).rejects.toThrow("not invited");
  });

  it("does not treat an uninvited account with a stored session as a member", async () => {
    const { request } = await signIn("stranger-subject", "stranger@example.test");
    expect(await identity!.resolvePrincipal(request())).toBeUndefined();
  });
});
