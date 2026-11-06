import { AuthRequest, exchangeCodeAsync, refreshAsync, ResponseError, revokeAsync, TokenTypeHint, type DiscoveryDocument } from "expo-auth-session";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

export const TOOLS_ORIGIN: string = Constants.expoConfig?.extra?.toolsOrigin;

const CLIENT_ID = "com.lab4code.pantrino";
const REDIRECT_URI = "com.lab4code.pantrino:/oauth";
const SCOPES = ["openid", "profile", "email", "offline_access"];
const SESSION = "kitchen.session";
const SECURE = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const discovery: DiscoveryDocument = {
  authorizationEndpoint: `${TOOLS_ORIGIN}/api/auth/oauth2/authorize`,
  tokenEndpoint: `${TOOLS_ORIGIN}/api/auth/oauth2/token`,
  revocationEndpoint: `${TOOLS_ORIGIN}/api/auth/oauth2/revoke`
};

/** The server refused the refresh token. The person must sign in again; queued changes stay on the phone. */
export class SignedOut extends Error {}

/** The request got no answer from Tools. Queued changes wait for the next sync. */
export class Offline extends Error {}

/**
 * The refresh token and the account it belongs to, stored as one item, so they can never disagree.
 * The access token lives only in memory. The stored item is readable only while the phone is unlocked.
 */
type Stored = { account: string; refreshToken: string };
let access: { token: string; expiresAt: number } | undefined;
let refreshing: Promise<string> | undefined;
// Sign-in and sign-out raise the generation, so a refresh that started before them cannot store its old tokens.
let generation = 0;
// The last Keychain write of a refresh. A refresh checks the generation just before it starts the write, so a write that
// started before a session change must land before that change writes or deletes the session.
let writing: Promise<void> = Promise.resolve();

async function stored(): Promise<Stored | null> {
  const raw = await SecureStore.getItemAsync(SESSION, SECURE);
  return raw ? JSON.parse(raw) as Stored : null;
}

/** The account of the stored session, or null when nobody is signed in. */
export async function storedAccount(): Promise<string | null> {
  return (await stored())?.account ?? null;
}

/** A finished sign-in that is not stored yet: the app first makes sure the vault holds only this account's data. */
export type NewSession = Readonly<{ account: string; install: () => Promise<void> }>;

/** Opens the Tools sign-in page in the system browser. Returns null when the person cancels. The stored session does not change. */
export async function signIn(): Promise<NewSession | null> {
  const devToken = __DEV__ ? process.env.EXPO_PUBLIC_DEV_REFRESH_TOKEN : undefined;
  let tokens;
  if (devToken) {
    tokens = await refreshAsync({ clientId: CLIENT_ID, refreshToken: devToken }, discovery);
  } else {
    const request = new AuthRequest({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI, scopes: SCOPES, usePKCE: true });
    const result = await request.promptAsync(discovery, { preferEphemeralSession: true });
    if (result.type !== "success") {
      if (result.type === "error") throw new Error(result.error?.description ?? result.params.error ?? "Sign-in failed.");
      return null;
    }
    tokens = await exchangeCodeAsync({ clientId: CLIENT_ID, code: result.params.code!, redirectUri: REDIRECT_URI, extraParams: { code_verifier: request.codeVerifier! } }, discovery);
  }
  const { accessToken: token, refreshToken } = tokens;
  if (!refreshToken) throw new Error("The server sent no refresh token.");
  const account = await accountOf(token);
  const expiresAt = expiry(tokens.issuedAt, tokens.expiresIn);
  return {
    account,
    async install() {
      generation += 1;
      await settled();
      access = { token, expiresAt };
      await SecureStore.setItemAsync(SESSION, JSON.stringify({ account, refreshToken } satisfies Stored), SECURE);
    }
  };
}

/** The Tools account of an access token, so the app can tell whose data the vault holds. */
async function accountOf(token: string): Promise<string> {
  const response = await fetch(`${TOOLS_ORIGIN}/api/auth/oauth2/userinfo`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })
    .catch((cause: unknown) => { throw new Offline("Tools cannot be reached.", { cause }); });
  if (!response.ok) throw new Error(`Tools answered ${response.status} on the account check.`);
  const { sub } = (await response.json()) as { sub?: unknown };
  if (typeof sub !== "string" || !sub) throw new Error("Tools sent no account.");
  return sub;
}

/** Names the current session. A caller passes it to `accessToken`, so it never gets a token of a later session. */
export function currentSession(): number {
  return generation;
}

/**
 * A valid access token of `session`. It refreshes when the token is about to expire, or when `stale` names a token the server refused.
 * It throws SignedOut when another session has started since `session`.
 */
export function accessToken(session: number, stale?: string): Promise<string> {
  if (session !== generation) return Promise.reject(new SignedOut());
  if (access && access.token !== stale && access.expiresAt > Date.now() + 60_000) return Promise.resolve(access.token);
  const mine = generation;
  const refresh: Promise<string> = refreshing ??= (async () => {
    const saved = await stored();
    if (!saved) throw new SignedOut();
    let tokens;
    try {
      tokens = await refreshAsync({ clientId: CLIENT_ID, refreshToken: saved.refreshToken }, discovery);
    } catch (error) {
      if (mine !== generation) throw new SignedOut();
      if (isRefused(error)) {
        await track(SecureStore.deleteItemAsync(SESSION, SECURE));
        throw new SignedOut();
      }
      if (error instanceof ResponseError) throw error;
      throw new Offline("Tools cannot be reached.", { cause: error });
    }
    if (mine !== generation) throw new SignedOut();
    if (tokens.refreshToken) await track(SecureStore.setItemAsync(SESSION, JSON.stringify({ account: saved.account, refreshToken: tokens.refreshToken } satisfies Stored), SECURE));
    if (mine !== generation) throw new SignedOut();
    access = { token: tokens.accessToken, expiresAt: expiry(tokens.issuedAt, tokens.expiresIn) };
    return tokens.accessToken;
  })().finally(() => { if (refreshing === refresh) refreshing = undefined; });
  return refresh;
}

/** Revokes the refresh token when the server can be reached, and forgets both tokens. */
export async function signOut(): Promise<void> {
  generation += 1;
  access = undefined;
  await settled();
  const session = await stored();
  await SecureStore.deleteItemAsync(SESSION, SECURE);
  if (session) await revokeAsync({ token: session.refreshToken, tokenTypeHint: TokenTypeHint.RefreshToken, clientId: CLIENT_ID }, discovery).catch(() => undefined);
}

function track(write: Promise<void>): Promise<void> {
  writing = write.catch(() => undefined);
  return write;
}

/**
 * Lets the next token request start a new refresh, and waits for a Keychain write of an older refresh. It does not wait for
 * the older refresh's network request: after it, that refresh sees the new generation and writes nothing.
 */
async function settled(): Promise<void> {
  refreshing = undefined;
  await writing;
}

function expiry(issuedAt: number, expiresIn: number | undefined): number {
  return (issuedAt + (expiresIn ?? 3600)) * 1000;
}

function isRefused(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "invalid_grant" || code === "invalid_client" || code === "unauthorized_client";
}
