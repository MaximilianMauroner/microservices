import { AuthRequest, exchangeCodeAsync, refreshAsync, ResponseError, revokeAsync, TokenTypeHint, type DiscoveryDocument } from "expo-auth-session";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

export const TOOLS_ORIGIN: string = Constants.expoConfig?.extra?.toolsOrigin;

const CLIENT_ID = "com.lab4code.kitchen";
const REDIRECT_URI = "com.lab4code.kitchen:/oauth";
const SCOPES = ["openid", "profile", "email", "offline_access"];
const REFRESH = "kitchen.refresh-token";
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

/** The access token lives only in memory. The refresh token is in the Keychain, readable only while the phone is unlocked. */
let access: { token: string; expiresAt: number } | undefined;
let refreshing: Promise<string> | undefined;

export async function isSignedIn(): Promise<boolean> {
  return (await SecureStore.getItemAsync(REFRESH, SECURE)) !== null;
}

/** The Tools account of the signed-in person, so the app can tell whose data the vault holds. */
export async function currentAccount(): Promise<string> {
  const token = await accessToken();
  const response = await fetch(`${TOOLS_ORIGIN}/api/auth/oauth2/userinfo`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })
    .catch((cause: unknown) => { throw new Offline("Tools cannot be reached.", { cause }); });
  if (response.status === 401 || response.status === 403) throw new SignedOut();
  if (!response.ok) throw new Error(`Tools answered ${response.status} on the account check.`);
  const { sub } = (await response.json()) as { sub?: unknown };
  if (typeof sub !== "string" || !sub) throw new Error("Tools sent no account.");
  return sub;
}

/** Opens the Tools sign-in page in the system browser. Returns false when the person cancels. */
export async function signIn(): Promise<boolean> {
  const devToken = __DEV__ ? process.env.EXPO_PUBLIC_DEV_REFRESH_TOKEN : undefined;
  if (devToken) {
    await SecureStore.setItemAsync(REFRESH, devToken, SECURE);
    return true;
  }
  const request = new AuthRequest({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI, scopes: SCOPES, usePKCE: true });
  const result = await request.promptAsync(discovery, { preferEphemeralSession: true });
  if (result.type !== "success") {
    if (result.type === "error") throw new Error(result.error?.description ?? result.params.error ?? "Sign-in failed.");
    return false;
  }
  const tokens = await exchangeCodeAsync({ clientId: CLIENT_ID, code: result.params.code!, redirectUri: REDIRECT_URI, extraParams: { code_verifier: request.codeVerifier! } }, discovery);
  if (!tokens.refreshToken) throw new Error("The server sent no refresh token.");
  await SecureStore.setItemAsync(REFRESH, tokens.refreshToken, SECURE);
  access = { token: tokens.accessToken, expiresAt: expiry(tokens.issuedAt, tokens.expiresIn) };
  return true;
}

/** A valid access token. It refreshes when the token is about to expire, or when `stale` names a token the server refused. */
export function accessToken(stale?: string): Promise<string> {
  if (access && access.token !== stale && access.expiresAt > Date.now() + 60_000) return Promise.resolve(access.token);
  refreshing ??= (async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH, SECURE);
    if (!refreshToken) throw new SignedOut();
    let tokens;
    try {
      tokens = await refreshAsync({ clientId: CLIENT_ID, refreshToken }, discovery);
    } catch (error) {
      if (isRefused(error)) {
        await SecureStore.deleteItemAsync(REFRESH, SECURE);
        throw new SignedOut();
      }
      if (error instanceof ResponseError) throw error;
      throw new Offline("Tools cannot be reached.", { cause: error });
    }
    if (tokens.refreshToken) await SecureStore.setItemAsync(REFRESH, tokens.refreshToken, SECURE);
    access = { token: tokens.accessToken, expiresAt: expiry(tokens.issuedAt, tokens.expiresIn) };
    return tokens.accessToken;
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}

/** Revokes the refresh token when the server can be reached, and forgets both tokens. */
export async function signOut(): Promise<void> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH, SECURE);
  access = undefined;
  await SecureStore.deleteItemAsync(REFRESH, SECURE);
  if (refreshToken) await revokeAsync({ token: refreshToken, tokenTypeHint: TokenTypeHint.RefreshToken, clientId: CLIENT_ID }, discovery).catch(() => undefined);
}

function expiry(issuedAt: number, expiresIn: number | undefined): number {
  return (issuedAt + (expiresIn ?? 3600)) * 1000;
}

function isRefused(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "invalid_grant" || code === "invalid_client" || code === "unauthorized_client";
}
