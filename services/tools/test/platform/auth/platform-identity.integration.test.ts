import postgres from "postgres";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyGoogleIdToken } from "better-auth/social-providers";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../../../platform/database/postgres-push-guard.js";
import { REVIEW_ACCOUNT } from "../../../platform/auth/review-account.js";
import { provisionReviewAccount } from "../../../platform/auth/provision-review-account.js";
import { kitchenStore } from "../../../products/kitchen/repository.js";
import { handleKitchenSync } from "../../../products/kitchen/sync.js";
import { principalMayOpen } from "../../../platform/access/product-access.js";
import { signInFlow } from "../../../platform/auth/sign-in-flow.js";
import { createPlatformIdentity } from "../../../platform/auth/auth.js";
import { handleMcpRequest } from "../../../platform/access/mcp.js";
import { APP_CLIENTS, registerAppClients } from "../../../platform/auth/app-clients.js";
import { requireLoopbackPostgres } from "../../harness/postgres.ts";

vi.mock("better-auth/social-providers", async (original) => ({
  ...await original<typeof import("better-auth/social-providers")>(),
  verifyGoogleIdToken: vi.fn()
}));

const databaseUrl = process.env.TEST_DATABASE_URL ? requireLoopbackPostgres(process.env.TEST_DATABASE_URL) : undefined;
const confirmed = process.env.MONEY_TEST_DATABASE_CONFIRM === "money-repository-test";
const admin = databaseUrl && confirmed ? postgres(databaseUrl, { max: 1, onnotice: () => {} }) : undefined;

const config = {
  reviewAccount: REVIEW_ACCOUNT,
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
    await admin`truncate tools.kitchens, tools.auth_users, tools.auth_sessions, tools.auth_accounts, tools.auth_verifications, tools.people, tools.product_grants, tools.oauth_clients, tools.oauth_refresh_tokens, tools.oauth_access_tokens, tools.oauth_consents cascade`;
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
  expect(consent.status, await consent.clone().text()).toBe(200);
  const consentBody = await consent.json() as { url?: string; redirect_uri?: string };
  expect(consentBody).toHaveProperty("url");
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
  const toConsent = await authorizeKitchenApp(cookie, verifier);
  const consentLocation = new URL(toConsent.headers.get("location") ?? "", config.publicOrigin);
  expect(consentLocation.pathname, await toConsent.clone().text()).toBe("/consent");
  const consent = await auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ accept: true, oauth_query: consentLocation.search.slice(1) })
  }));
  expect(consent.status, await consent.clone().text()).toBe(200);
  const consentBody = await consent.json() as { url?: string; redirect_uri?: string };
  expect(consentBody).toHaveProperty("url");
  const callback = new URL(consentBody.url ?? consentBody.redirect_uri ?? "");
  expect(`${callback.protocol}${callback.pathname}`).toBe(redirectUri);
  const code = callback.searchParams.get("code");
  expect(code, JSON.stringify(consentBody)).toBeTruthy();

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

  it("signs in through PKCE and consent and opens only the Kitchen app API", async () => {
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

  it("asks the person again after an earlier consent, so another app with the same URL scheme gets no silent code", async () => {
    const { cookie } = await signIn("admin-subject", config.allowedGoogleEmail);
    await connectKitchenApp(cookie);
    const again = await authorizeKitchenApp(cookie, randomBytes(32).toString("base64url"));
    const location = new URL(again.headers.get("location") ?? "about:blank", config.publicOrigin);
    expect(location.pathname, await again.clone().text()).toBe("/consent");
    expect(location.searchParams.get("code")).toBeNull();
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

  it("disables a client ID that an app used before, so its old tokens open nothing", async () => {
    const retired = "com.lab4code.kitchen";
    await admin!`
      insert into tools.oauth_clients (id, client_id, name, redirect_uris, public, type, disabled, created_at, updated_at)
      values (${retired}, ${retired}, 'Kitchen', ${[`${retired}:/oauth`]}, true, 'native', false, now(), now())
      on conflict (client_id) do update set disabled = false`;
    await registerAppClients(admin!);
    expect(await admin!`select client_id from tools.oauth_clients where client_id = ${retired} and disabled`).toHaveLength(1);
  });

  it("keeps an operator's disable when the clients are registered again", async () => {
    await admin!`update tools.oauth_clients set disabled = true where client_id = ${APP_CLIENTS.kitchen.clientId}`;
    await registerAppClients(admin!);
    expect(await admin!`select client_id from tools.oauth_clients where client_id = ${APP_CLIENTS.kitchen.clientId} and disabled`).toHaveLength(1);
  });
});

function reviewLogin(username: string, password: string, auth = identity!.auth, extra: Record<string, unknown> = {}) {
  return auth.handler(new Request(`${config.publicOrigin}/api/auth/sign-in/email`, {
    method: "POST", headers: { "content-type": "application/json", origin: config.publicOrigin },
    body: JSON.stringify({ email: username, password, ...extra })
  }));
}

function responseCookies(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function reviewSession() {
  const password = randomBytes(32).toString("base64url");
  await provisionReviewAccount(admin!, { kind: "provision", password });
  const login = await reviewLogin("apple-review", password);
  expect(login.status, "the built-in password handler signs in the reviewer").toBe(200);
  return { cookie: responseCookies(login), password };
}

async function pendingReviewCode(cookie: string) {
  const verifier = randomBytes(32).toString("base64url");
  const response = await authorizeKitchenApp(cookie, verifier);
  const consentLocation = new URL(response.headers.get("location")!, config.publicOrigin);
  expect(consentLocation.pathname).toBe("/consent");
  const consent = await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/consent`, {
    method: "POST", headers: { cookie, "content-type": "application/json", origin: config.publicOrigin },
    body: JSON.stringify({ accept: true, oauth_query: consentLocation.search.slice(1) })
  }));
  const body = await consent.json() as { url: string };
  return { verifier, code: new URL(body.url).searchParams.get("code")! };
}

function exchangeReviewCode(auth: NonNullable<typeof identity>["auth"], code: string, verifier: string, clientId: string = REVIEW_ACCOUNT.clientId) {
  return auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: APP_CLIENTS.kitchen.redirectUri, code, code_verifier: verifier })
  }));
}

describe.skipIf(!admin)("Apple App Review password and native OAuth", () => {
  beforeEach(async () => { await registerAppClients(admin!); });

  it("refuses review sign-in until the account is provisioned", async () => {
    expect((await reviewLogin("apple-review", randomBytes(32).toString("base64url"))).ok).toBe(false);
  });

  it("completes password sign-in from the native signed login continuation, consent, PKCE, and refresh", async () => {
    const password = randomBytes(32).toString("base64url");
    await provisionReviewAccount(admin!, { kind: "provision", password });
    const verifier = randomBytes(32).toString("base64url");
    const toLogin = await authorizeKitchenApp("", verifier);
    const loginLocation = new URL(toLogin.headers.get("location")!, config.publicOrigin);
    expect(loginLocation.pathname).toBe("/sign-in");
    const flow = signInFlow(loginLocation.search);
    const login = await reviewLogin("apple-review", password, identity!.auth, { callbackURL: flow.callbackURL, oauth_query: loginLocation.search.slice(1) });
    expect(login.status).toBe(200);
    const cookie = responseCookies(login);
    expect(cookie).toContain("session_token=");
    const continuation = await login.json() as { url: string };
    let consentLocation = new URL(continuation.url, config.publicOrigin);
    if (consentLocation.pathname === "/api/auth/oauth2/authorize") {
      const toConsent = await identity!.auth.handler(new Request(consentLocation, { headers: { cookie } }));
      expect(toConsent.status).toBe(302);
      consentLocation = new URL(toConsent.headers.get("location")!, config.publicOrigin);
    }
    expect(consentLocation.pathname).toBe("/consent");
    const consent = await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/consent`, {
      method: "POST", headers: { cookie, "content-type": "application/json", origin: config.publicOrigin },
      body: JSON.stringify({ accept: true, oauth_query: consentLocation.search.slice(1) })
    }));
    const callback = new URL((await consent.json() as { url: string }).url);
    expect(`${callback.protocol}${callback.pathname}`).toBe(APP_CLIENTS.kitchen.redirectUri);
    expect(callback.searchParams.get("state")).toBe("state-1");
    const token = await exchangeReviewCode(identity!.auth, callback.searchParams.get("code")!, verifier);
    expect(token.status).toBe(200);
    const tokens = await token.json() as { access_token: string; refresh_token: string };
    expect(tokens.refresh_token).toBeTruthy();
    const principal = await identity!.resolveAppToken(bearer(tokens.access_token), "kitchen");
    expect(principal).toEqual({ role: "member", subject: REVIEW_ACCOUNT.subject, email: REVIEW_ACCOUNT.email, products: ["kitchen"] });
    expect(await identity!.resolveAccessToken(bearer(tokens.access_token))).toBeUndefined();
    const refresh = await refreshKitchenApp(tokens.refresh_token);
    expect(refresh.status).toBe(200);
    expect(await identity!.resolveAppToken(bearer((await refresh.json() as { access_token: string }).access_token), "kitchen")).toEqual(principal);
  });

  it("rejects a wrong password, an unknown username, the internal email, and a Google user's credential", async () => {
    const { password } = await reviewSession();
    const google = await signIn("admin-subject", config.allowedGoogleEmail);
    const context = await identity!.auth.$context;
    const user = (await identity!.auth.api.getSession({ headers: google.request().headers }))!.user;
    await context.internalAdapter.createAccount({ userId: user.id, accountId: user.id, providerId: "credential", password: await context.password.hash(password) });
    for (const [username, candidate] of [["apple-review", "wrong-password"], ["unknown", password], [REVIEW_ACCOUNT.email, password], [config.allowedGoogleEmail, password]]) {
      const response = await reviewLogin(username!, candidate!);
      expect(response.ok).toBe(false);
      expect(responseCookies(response)).not.toContain("session_token=");
    }
  });

  it("rejects signup, password mutation, linking, and changes to the review identity", async () => {
    const { cookie, password } = await reviewSession();
    const before = await admin!`select email from tools.auth_users where id = ${REVIEW_ACCOUNT.userId}`;
    for (const path of ["sign-up/email", "request-password-reset", "reset-password", "change-password", "set-password", "verify-password", "link-social", "unlink-account", "update-user", "change-email", "delete-user"]) {
      const response = await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/${path}`, {
        method: "POST", headers: { cookie, origin: config.publicOrigin, "content-type": "application/json" },
        body: JSON.stringify({ email: "changed@example.test", name: "Changed", password, newPassword: password, currentPassword: password, token: "fake", provider: "google", callbackURL: "/" })
      }));
      expect(response.ok, path).toBe(false);
    }
    expect(await admin!`select email from tools.auth_users where id = ${REVIEW_ACCOUNT.userId}`).toEqual(before);
  });

  it("fails closed for existing sessions, pending codes, access tokens, refresh, and userinfo when disabled", async () => {
    const { cookie, password } = await reviewSession();
    const tokens = await connectKitchenApp(cookie);
    const pending = await pendingReviewCode(cookie);
    const enabledUserinfo = await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/userinfo`, { headers: { authorization: `Bearer ${tokens.accessToken}` } }));
    expect(enabledUserinfo.status).toBe(200);
    expect(await enabledUserinfo.json()).toMatchObject({ sub: REVIEW_ACCOUNT.userId, email: REVIEW_ACCOUNT.email });
    const disabled = createPlatformIdentity({ ...config, reviewAccount: undefined }, databaseUrl!);
    try {
      expect(await disabled.resolvePrincipal(new Request(`${config.publicOrigin}/kitchen`, { headers: { cookie } }))).toBeUndefined();
      expect(await disabled.resolveAppToken(bearer(tokens.accessToken), "kitchen")).toBeUndefined();
      expect((await reviewLogin("apple-review", password, disabled.auth)).ok).toBe(false);
      expect((await exchangeReviewCode(disabled.auth, pending.code, pending.verifier)).ok).toBe(false);
      for (const [path, init] of [
        ["get-session", { headers: { cookie } }],
        ["oauth2/userinfo", { headers: { authorization: `Bearer ${tokens.accessToken}` } }],
        ["oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: REVIEW_ACCOUNT.clientId, refresh_token: tokens.refreshToken }) }]
      ] as const) expect((await disabled.auth.handler(new Request(`${config.publicOrigin}/api/auth/${path}`, init))).ok, path).toBe(false);
      const google = await signIn("admin-subject", config.allowedGoogleEmail);
      expect(await disabled.resolvePrincipal(google.request())).toMatchObject({ role: "admin" });
    } finally { await disabled.close(); }
  });

  it("seeds only a separate sample kitchen and never grants other products, even if extra grants are stored", async () => {
    const { cookie } = await reviewSession();
    const tokens = await connectKitchenApp(cookie);
    const store = kitchenStore(admin!);
    const privateKitchen = await store.admin({ role: "admin", subject: "admin-subject" }).create("Private family kitchen");
    await admin!`insert into tools.product_grants (person_id, product_id, granted_at) values (${REVIEW_ACCOUNT.personId}, 'money', now())`;
    const principal = (await identity!.resolveAppToken(bearer(tokens.accessToken), "kitchen"))!;
    for (const path of ["/money", "/publisher", "/feedback", "/bodyshop", "/documents", "/"]) expect(principalMayOpen(principal, path), path).toBe(false);
    const response = await handleKitchenSync(bearer(tokens.accessToken), (request) => identity!.resolveAppToken(request, "kitchen"), store);
    const snapshot = await response.json() as { kitchens: { kitchen: { id: string }; recipes: { name: string }[]; ingredients: unknown[] }[] };
    expect(snapshot.kitchens.map((k) => k.kitchen.id)).toEqual([REVIEW_ACCOUNT.kitchenId]);
    expect(snapshot.kitchens[0]!.recipes.map((r) => r.name)).toEqual(["Tomato pasta"]);
    expect(snapshot.kitchens[0]!.ingredients).toHaveLength(2);
    await expect(store.open(principal, privateKitchen.id)).rejects.toMatchObject({ code: "not_found" });
    expect(() => store.admin(principal)).toThrow();
    await admin!`insert into tools.kitchen_members (kitchen_id, person_id, added_at) values (${privateKitchen.id}, ${REVIEW_ACCOUNT.personId}, now())`;
    expect(await identity!.resolveAppToken(bearer(tokens.accessToken), "kitchen")).toBeUndefined();
  });

  it("rejects MCP and other clients at authorization, consent, token exchange, refresh, and bearer resolution", async () => {
    const { cookie } = await reviewSession();
    const registered = await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Other client", redirect_uris: [APP_CLIENTS.kitchen.redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] })
    }));
    const clientId = (await registered.json() as { client_id: string }).client_id;
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: APP_CLIENTS.kitchen.redirectUri, scope: "openid profile email offline_access", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
    const denied = await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/authorize?${query}`, { headers: { cookie } }));
    expect(denied.status).toBe(403);
    const consent = await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/consent`, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ accept: true, oauth_query: query.toString() })
    }));
    expect(consent.status).toBe(403);
    const resourceRequest = new URLSearchParams(query);
    resourceRequest.set("client_id", REVIEW_ACCOUNT.clientId);
    resourceRequest.set("resource", `${config.publicOrigin}/api/mcp`);
    expect((await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/authorize?${resourceRequest}`, { headers: { cookie } }))).status).toBe(403);
    const resourceCode = await pendingReviewCode(cookie);
    const resourceToken = await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: REVIEW_ACCOUNT.clientId, code: resourceCode.code, code_verifier: resourceCode.verifier, redirect_uri: APP_CLIENTS.kitchen.redirectUri, resource: `${config.publicOrigin}/api/mcp` })
    }));
    expect(resourceToken.status).toBe(403);
    expect(await admin!`select id from tools.oauth_access_tokens where user_id = ${REVIEW_ACCOUNT.userId}`).toHaveLength(0);
    const pending = await pendingReviewCode(cookie);
    const codeHash = createHash("sha256").update(pending.code).digest("base64url");
    await admin!`update tools.auth_verifications set value = jsonb_set(value::jsonb, '{query,client_id}', to_jsonb(${clientId}::text))::text where identifier = ${codeHash}`;
    expect((await exchangeReviewCode(identity!.auth, pending.code, pending.verifier, clientId)).status).toBe(403);
    const tokens = await connectKitchenApp(cookie);
    await admin!`update tools.oauth_refresh_tokens set client_id = ${clientId} where user_id = ${REVIEW_ACCOUNT.userId}`;
    await admin!`update tools.oauth_access_tokens set client_id = ${clientId} where user_id = ${REVIEW_ACCOUNT.userId}`;
    expect(await identity!.resolveAccessToken(bearer(tokens.accessToken))).toBeUndefined();
    const refresh = await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/oauth2/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refreshToken })
    }));
    expect(refresh.status).toBe(403);
  });

  it("rotates the password and revokes access without changing sample edits or Google sessions", async () => {
    const { cookie, password } = await reviewSession();
    const tokens = await connectKitchenApp(cookie);
    const google = await signIn("admin-subject", config.allowedGoogleEmail);
    const googleTokens = await connectKitchenApp(google.cookie);
    await admin!`update tools.kitchens set name = 'Reviewer edits' where id = ${REVIEW_ACCOUNT.kitchenId}`;
    const replacement = randomBytes(32).toString("base64url");
    await provisionReviewAccount(admin!, { kind: "provision", password: replacement });
    expect(await admin!`select id from tools.kitchen_ingredients where kitchen_id = ${REVIEW_ACCOUNT.kitchenId}`).toHaveLength(2);
    expect((await admin!`select name from tools.kitchens where id = ${REVIEW_ACCOUNT.kitchenId}`)[0]!.name).toBe("Reviewer edits");
    expect(await identity!.resolvePrincipal(new Request(config.publicOrigin, { headers: { cookie } }))).toBeUndefined();
    expect(await identity!.resolveAppToken(bearer(tokens.accessToken), "kitchen")).toBeUndefined();
    expect((await refreshKitchenApp(tokens.refreshToken)).ok).toBe(false);
    expect((await reviewLogin("apple-review", password)).ok).toBe(false);
    expect((await reviewLogin("apple-review", replacement)).ok).toBe(true);
    await provisionReviewAccount(admin!, { kind: "revoke" });
    expect((await reviewLogin("apple-review", replacement)).ok).toBe(false);
    expect(await identity!.resolvePrincipal(google.request())).toMatchObject({ role: "admin" });
    expect(await identity!.resolveAppToken(bearer(googleTokens.accessToken), "kitchen")).toMatchObject({ role: "admin" });
    expect((await refreshKitchenApp(googleTokens.refreshToken)).ok).toBe(true);
  });

  it("refuses conflicting reserved identities without creating a credential or changing other data", async () => {
    await admin!`insert into tools.auth_users (id, name, email, email_verified, created_at, updated_at) values ('unrelated-user', 'Other', ${REVIEW_ACCOUNT.email}, true, now(), now())`;
    await expect(provisionReviewAccount(admin!, { kind: "provision", password: randomBytes(32).toString("base64url") })).rejects.toThrow(/conflicts/);
    expect(await admin!`select id from tools.auth_accounts`).toHaveLength(0);
    expect(await admin!`select id from tools.people`).toHaveLength(0);
    expect((await admin!`select id from tools.auth_users`)[0]!.id).toBe("unrelated-user");
  });
});


describe.skipIf(!admin)("Google sign-in handler regression", () => {
  it("keeps Google sign-in for the admin and invited members and refuses the reserved review identity", async () => {
    const context = await identity!.auth.$context;
    const provider = context.socialProviders.find((item) => item.id === "google")!;
    const validate = vi.spyOn(provider, "validateAuthorizationCode").mockResolvedValue({ accessToken: "fake-google-access", idToken: "fake-google-id-token" });
    const invited = await identity!.people.invite("invited@example.test");
    await identity!.people.setGrant(invited.id, "kitchen", true);
    try {
      for (const [sub, email, role] of [
        [config.allowedGoogleSubject, config.allowedGoogleEmail, "admin"],
        ["invited-subject", "invited@example.test", "member"],
        ["reserved-subject", REVIEW_ACCOUNT.email, undefined]
      ] as const) {
        vi.mocked(verifyGoogleIdToken).mockResolvedValue({ sub, email, email_verified: true, name: "Person", picture: "https://example.test/avatar.png" });
        const started = await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/sign-in/social`, {
          method: "POST", headers: { "content-type": "application/json", origin: config.publicOrigin },
          body: JSON.stringify({ provider: "google", callbackURL: "/kitchen", errorCallbackURL: "/sign-in" })
        }));
        const state = new URL((await started.json() as { url: string }).url).searchParams.get("state")!;
        const callback = await identity!.auth.handler(new Request(`${config.publicOrigin}/api/auth/callback/google?code=fake-code&state=${state}`, { headers: { cookie: responseCookies(started) } }));
        const principal = await identity!.resolvePrincipal(new Request(`${config.publicOrigin}/kitchen`, { headers: { cookie: responseCookies(callback) } }));
        if (role) expect(principal).toMatchObject({ role, subject: sub, email });
        else expect(principal).toBeUndefined();
      }
    } finally {
      validate.mockRestore();
      vi.mocked(verifyGoogleIdToken).mockReset();
    }
  });
});
