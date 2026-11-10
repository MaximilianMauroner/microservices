import { beforeEach, describe, expect, it, vi } from "vitest";

const keychain = new Map<string, string>();
const gates: Array<() => void> = [];
let holdWrites = false;
const server = { refresh: async (_token: string) => ({ accessToken: "access-a2", refreshToken: "refresh-a2", issuedAt: Date.now() / 1000, expiresIn: 3600 }) };

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: { toolsOrigin: "https://tools.test" } } } }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (key: string) => keychain.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    if (holdWrites) await new Promise<void>((resolve) => gates.push(resolve));
    keychain.set(key, value);
  },
  deleteItemAsync: async (key: string) => { keychain.delete(key); }
}));
vi.mock("expo-auth-session", () => ({
  AuthRequest: class {},
  ResponseError: class extends Error {},
  TokenTypeHint: { RefreshToken: "refresh_token" },
  exchangeCodeAsync: vi.fn(),
  refreshAsync: (request: { refreshToken: string }) => server.refresh(request.refreshToken),
  revokeAsync: async () => undefined
}));

(globalThis as { __DEV__?: boolean }).__DEV__ = true;
const session = await import("./session");

async function signInAs(account: string) {
  process.env.EXPO_PUBLIC_DEV_REFRESH_TOKEN = `dev-${account}`;
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ sub: account })));
  server.refresh = async () => ({ accessToken: `access-${account}`, refreshToken: `refresh-${account}`, issuedAt: 0, expiresIn: 1 });
  const next = await session.signIn();
  await next!.install();
}

describe("session", () => {
  beforeEach(async () => {
    holdWrites = false;
    gates.length = 0;
    await session.signOut();
  });

  it("does not bring back the old account when its refresh is inside a Keychain write at sign-out", async () => {
    await signInAs("a");
    const before = session.currentSession();
    holdWrites = true;
    const refresh = session.accessToken(before).catch((error: unknown) => error);
    await vi.waitFor(() => expect(gates.length).toBe(1));
    const out = session.signOut();
    gates.shift()!();
    holdWrites = false;
    await out;
    expect(await refresh).toBeInstanceOf(session.SignedOut);
    await signInAs("b");
    expect(await session.storedAccount()).toBe("b");
  });

  it("signs out at once while a refresh waits for the network, and that refresh stores nothing", async () => {
    await signInAs("a");
    let answer: () => void = () => undefined;
    server.refresh = () => new Promise((resolve) => { answer = () => resolve({ accessToken: "late", refreshToken: "late", issuedAt: Date.now() / 1000, expiresIn: 3600 }); });
    const refresh = session.accessToken(session.currentSession()).catch((error: unknown) => error);
    await session.signOut();
    expect(await session.storedAccount()).toBeNull();
    answer();
    expect(await refresh).toBeInstanceOf(session.SignedOut);
    expect(await session.storedAccount()).toBeNull();
  });

  it("refuses a token for a session that ended, so a retry cannot carry one account's changes with another's token", async () => {
    await signInAs("a");
    const before = session.currentSession();
    await signInAs("b");
    await expect(session.accessToken(before, "access-a")).rejects.toBeInstanceOf(session.SignedOut);
  });
});
