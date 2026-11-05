import postgres from "postgres";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../../../platform/database/postgres-push-guard.js";
import { createPlatformIdentity } from "../../../platform/auth/auth.js";
import { handleMcpRequest } from "../../../platform/access/mcp.js";
import { APP_CLIENTS, registerAppClients } from "../../../platform/auth/app-clients.js";
import { requireLoopbackPostgres } from "../../harness/postgres.ts";

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
    await admin`truncate tools.auth_users, tools.auth_sessions, tools.auth_accounts, tools.auth_verifications, tools.people, tools.product_grants, tools.oauth_clients, tools.oauth_refresh_tokens, tools.oauth_access_tokens, tools.oauth_consents cascade`;
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
  return { session, cookie, request: () => new Request(`${config.publicOrigin}/money`, { headers: { cookie } }) };
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

async function connectMcpClient(cookie: string) {
  const auth = identity!.auth;
  const redirectUri = "http://127.0.0.1:43123/callback";
  const registered = await auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Test MCP client", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] })
  }));
  expect(registered.status, await registered.clone().text()).toBeLessThan(300);
  const { client_id: clientId } = await registered.json() as { client_id: string };

  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URL(`${config.publicOrigin}/api/auth/oauth2/authorize`);
  for (const [key, value] of Object.entries({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "openid profile email offline_access", state: "state-1",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    resource: `${config.publicOrigin}/api/mcp`
  })) authorize.searchParams.set(key, value);
  const toConsent = await auth.handler(new Request(authorize, { headers: { cookie, accept: "text/html" } }));
  const consentLocation = new URL(toConsent.headers.get("location") ?? "", config.publicOrigin);
  expect(consentLocation.pathname, await toConsent.clone().text()).toBe("/consent");

  const consent = await auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ accept: true, oauth_query: consentLocation.search.slice(1) })
  }));
  const consentBody = await consent.json() as { url?: string; redirect_uri?: string };
  const callback = new URL(consentBody.url ?? consentBody.redirect_uri ?? "");
  const code = callback.searchParams.get("code");
  expect(code, JSON.stringify(consentBody)).toBeTruthy();

  const token = await auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: code!, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: `${config.publicOrigin}/api/mcp` })
  }));
  const tokens = await token.json() as { access_token?: string };
  expect(tokens.access_token, JSON.stringify(tokens)).toBeTruthy();
  return tokens.access_token!;
}

function callWhoami(headers: Record<string, string>) {
  return handleMcpRequest(new Request(`${config.publicOrigin}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } })
  }), config.publicOrigin, identity!.resolveAccessToken);
}

async function whoami(accessToken: string) {
  const response = await callWhoami({ authorization: `Bearer ${accessToken}` });
  expect(response.status).toBe(200);
  const body = await response.json() as { result: { content: { text: string }[] } };
  return JSON.parse(body.result.content[0]!.text) as { email: string; role: string; tools: unknown };
}

describe.skipIf(!admin)("MCP over OAuth as the signed-in person", () => {
  it("issues a token through dynamic registration, consent, and PKCE, then answers as the admin", async () => {
    const { cookie } = await signIn("admin-subject", config.allowedGoogleEmail);
    const accessToken = await connectMcpClient(cookie);
    expect(await whoami(accessToken)).toEqual({ email: config.allowedGoogleEmail, role: "admin", tools: "all" });
  });

  it("answers a member with only their granted tools and stops after the person is removed", async () => {
    const person = await identity!.people.invite("friend@example.test");
    await identity!.people.admit("friend-subject", "friend@example.test");
    await identity!.people.setGrant(person.id, "kitchen", true);
    const { cookie } = await signIn("friend-subject", "friend@example.test");
    const accessToken = await connectMcpClient(cookie);
    expect(await whoami(accessToken)).toEqual({ email: "friend@example.test", role: "member", tools: ["Kitchen"] });
    await identity!.people.remove(person.id);
    expect((await callWhoami({ authorization: `Bearer ${accessToken}` })).status).toBe(401);
  });

  it("rejects a browser cookie and a missing token with a resource metadata link", async () => {
    const { cookie } = await signIn("admin-subject", config.allowedGoogleEmail);
    for (const headers of [{ cookie }, {}, { authorization: "Bearer not-a-real-token" }] as Record<string, string>[]) {
      const response = await callWhoami(headers);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${config.publicOrigin}/.well-known/oauth-protected-resource/api/mcp"`);
    }
  });
});

function authorizeKitchenApp(cookie: string, verifier: string) {
  const { clientId, redirectUri } = APP_CLIENTS.kitchen;
  const authorize = new URL(`${config.publicOrigin}/api/auth/oauth2/authorize`);
  for (const [key, value] of Object.entries({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "openid profile email offline_access", state: "state-1",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256"
  })) authorize.searchParams.set(key, value);
  return identity!.auth.handler(new Request(authorize, { headers: { cookie, accept: "text/html" } }));
}

function refreshKitchenApp(refreshToken: string) {
  return identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: APP_CLIENTS.kitchen.clientId })
  }));
}

async function connectKitchenApp(cookie: string) {
  const auth = identity!.auth;
  const { clientId, redirectUri } = APP_CLIENTS.kitchen;
  const verifier = randomBytes(32).toString("base64url");
  const redirect = await authorizeKitchenApp(cookie, verifier);
  const callback = new URL(redirect.headers.get("location") ?? "", config.publicOrigin);
  expect(`${callback.protocol}${callback.pathname}`, "first-party app skips the consent page").toBe(redirectUri);
  const code = callback.searchParams.get("code");
  expect(code, await redirect.clone().text()).toBeTruthy();

  const token = await auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: code!, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier })
  }));
  const tokens = await token.json() as { access_token?: string; refresh_token?: string };
  expect(tokens.access_token, JSON.stringify(tokens)).toBeTruthy();
  expect(tokens.refresh_token, "the app stays signed in offline").toBeTruthy();
  return { accessToken: tokens.access_token!, refreshToken: tokens.refresh_token! };
}

const bearer = (accessToken: string) => new Request(`${config.publicOrigin}/api/kitchen/sync`, { headers: { authorization: `Bearer ${accessToken}` } });

describe.skipIf(!admin)("Kitchen app over OAuth", () => {
  beforeEach(async () => { await registerAppClients(admin!); });

  it("signs in through PKCE without consent and opens only the Kitchen app API", async () => {
    const { cookie } = await signIn("admin-subject", config.allowedGoogleEmail);
    const { accessToken } = await connectKitchenApp(cookie);
    expect(await identity!.resolveAppToken(bearer(accessToken), "kitchen")).toEqual({ role: "admin", subject: "admin-subject", email: config.allowedGoogleEmail });
    expect((await callWhoami({ authorization: `Bearer ${accessToken}` })).status, "MCP refuses an app token").toBe(401);
    const userinfo = await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/userinfo`, { headers: { authorization: `Bearer ${accessToken}` } }));
    const other = await connectKitchenApp((await signIn("friend-subject", "friend@example.test")).cookie);
    const otherInfo = await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/userinfo`, { headers: { authorization: `Bearer ${other.accessToken}` } }));
    const [mine, theirs] = [(await userinfo.json() as { sub?: string }).sub, (await otherInfo.json() as { sub?: string }).sub];
    expect(mine, "the app learns whose data it may keep").toBeTruthy();
    expect(theirs, "another account has another ID").not.toBe(mine);
  });

  it("refuses an MCP token, a cookie, and a token of a disabled app", async () => {
    const { cookie } = await signIn("admin-subject", config.allowedGoogleEmail);
    expect(await identity!.resolveAppToken(bearer(await connectMcpClient(cookie)), "kitchen")).toBeUndefined();
    expect(await identity!.resolveAppToken(new Request(`${config.publicOrigin}/api/kitchen/sync`, { headers: { cookie } }), "kitchen")).toBeUndefined();
    const { accessToken, refreshToken } = await connectKitchenApp(cookie);
    await admin!`update tools.oauth_clients set disabled = true where client_id = ${APP_CLIENTS.kitchen.clientId}`;
    expect(await identity!.resolveAppToken(bearer(accessToken), "kitchen")).toBeUndefined();
    const again = await authorizeKitchenApp(cookie, randomBytes(32).toString("base64url"));
    expect(new URL(again.headers.get("location") ?? "about:blank", config.publicOrigin).searchParams.get("code"), "a disabled app gets no new sign-in").toBeNull();
    expect((await refreshKitchenApp(refreshToken)).ok, "a disabled app cannot refresh").toBe(false);
  });

  it("refreshes an app token while the client is enabled", async () => {
    const { cookie } = await signIn("admin-subject", config.allowedGoogleEmail);
    const { refreshToken } = await connectKitchenApp(cookie);
    const refreshed = await refreshKitchenApp(refreshToken);
    expect(refreshed.status, await refreshed.clone().text()).toBe(200);
    const { access_token: accessToken } = await refreshed.json() as { access_token: string };
    expect(await identity!.resolveAppToken(bearer(accessToken), "kitchen")).toMatchObject({ subject: "admin-subject" });
  });

  it("keeps an operator's disable when the clients are registered again", async () => {
    await admin!`update tools.oauth_clients set disabled = true where client_id = ${APP_CLIENTS.kitchen.clientId}`;
    await registerAppClients(admin!);
    expect(await admin!`select client_id from tools.oauth_clients where client_id = ${APP_CLIENTS.kitchen.clientId} and disabled`).toHaveLength(1);
  });
});
