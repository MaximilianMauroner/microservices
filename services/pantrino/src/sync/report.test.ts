import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tokens = { current: "token-1", refreshed: "token-2", next: undefined as undefined | (() => Promise<string>) };
vi.mock("react-native", () => ({ Platform: { OS: "ios", Version: "26.1" } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.2.0" } } }));
vi.mock("../auth/session", () => ({
  TOOLS_ORIGIN: "https://tools.test",
  currentSession: () => 1,
  accessToken: async (_session: number, stale?: string) => (tokens.next ? tokens.next() : stale ? tokens.refreshed : tokens.current),
  Offline: class extends Error {},
  SignedOut: class extends Error {}
}));

const { sendReport } = await import("./api");
const { checkReport, outcomeMessage, TEXT } = await import("../ui/report-text");

type Call = { url: string; init: RequestInit };
let calls: Call[];
function answer(...responses: (Response | Error | "hang")[]) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift()!;
    if (next === "hang") return new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("Aborted"))));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
}
const report = { kind: "bug" as const, message: "Sync hangs", page: "/kitchen", contactEmail: "guest@example.com" };

beforeEach(() => { calls = []; tokens.next = undefined; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("sending a report", () => {
  it("sends an anonymous report with the app version and no token", async () => {
    answer(new Response("{}", { status: 201 }));
    expect(await sendReport(report, false)).toEqual({ kind: "sent" });
    expect(calls[0]!.url).toBe("https://tools.test/api/reports");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ app: "pantrino", ...report, context: "Pantrino 1.2.0 · ios 26.1" });
    expect(calls[0]!.init.headers).not.toHaveProperty("Authorization");
  });

  it("retries once with a fresh token after Tools refuses a stale one", async () => {
    answer(new Response("{}", { status: 401 }), new Response("{}", { status: 201 }));
    expect(await sendReport(report, true)).toEqual({ kind: "sent" });
    expect(calls.map((call) => (call.init.headers as Record<string, string>).Authorization)).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  it("turns a refusal into a reason the app translates, never the server's text", async () => {
    answer(new Response(JSON.stringify({ error: "invalid_request", reason: "invalid_email", message: "English text" }), { status: 400 }));
    const outcome = await sendReport(report, false);
    expect(outcome).toEqual({ kind: "rejected", reason: "invalid_email" });
    expect(outcomeMessage(outcome as Exclude<typeof outcome, { kind: "sent" }>, TEXT.de)).toBe("Gib eine gültige E-Mail-Adresse ein oder lass das Feld leer.");

    answer(new Response(JSON.stringify({ reason: "something_new" }), { status: 400 }));
    expect(await sendReport(report, false)).toEqual({ kind: "rejected", reason: "unknown" });
  });

  it("tells a timeout apart from being offline", async () => {
    vi.useFakeTimers();
    answer("hang");
    const pending = sendReport(report, false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toEqual({ kind: "timeout" });

    vi.useRealTimers();
    answer(new TypeError("Network request failed"));
    expect(await sendReport(report, false)).toEqual({ kind: "offline" });
    answer(new Response("{}", { status: 429 }));
    expect(await sendReport(report, false)).toEqual({ kind: "rate-limited" });
  });
});

describe("checking a report before it is sent", () => {
  it("finds the same problems Tools would refuse", () => {
    expect(checkReport(report)).toBeNull();
    expect(checkReport({ ...report, message: "  " })).toBe("empty_message");
    expect(checkReport({ ...report, details: "x".repeat(4001) })).toBe("details_too_long");
    expect(checkReport({ ...report, contactEmail: "not-an-email" })).toBe("invalid_email");
  });
});

describe("a report with the sender's name", () => {
  const hang = () => new Promise<string>(() => undefined);

  it("is not sent at all when no token can be had, never sent anonymously instead", async () => {
    answer(new Response("{}", { status: 201 }));
    tokens.next = () => Promise.reject(new Error("refresh token revoked"));
    expect(await sendReport(report, true)).toEqual({ kind: "auth-failed" });
    expect(calls).toEqual([]);
    expect(outcomeMessage({ kind: "auth-failed" }, TEXT.de)).toBe("Deine Anmeldung ist abgelaufen. Melde dich erneut an oder sende die Meldung anonym.");
  });

  it("gives up when Tools refuses the fresh token too", async () => {
    answer(new Response("{}", { status: 401 }), new Response("{}", { status: 401 }));
    expect(await sendReport(report, true)).toEqual({ kind: "auth-failed" });
    expect(calls).toHaveLength(2);
  });

  it("times out when getting the token hangs", async () => {
    vi.useFakeTimers();
    answer(new Response("{}", { status: 201 }));
    tokens.next = hang;
    const pending = sendReport(report, true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toEqual({ kind: "timeout" });
    expect(calls).toEqual([]);
  });

  it("keeps one 15-second deadline across a refresh after a 401", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Promise((resolve) => setTimeout(() => resolve(new Response("{}", { status: 401 })), 10_000));
    });
    let refreshed: (token: string) => void = () => undefined;
    tokens.next = () => (calls.length ? new Promise<string>((resolve) => { refreshed = resolve; }) : Promise.resolve("token-1"));
    const pending = sendReport(report, true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toEqual({ kind: "timeout" });
    refreshed("token-late");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(1);
  });
});
