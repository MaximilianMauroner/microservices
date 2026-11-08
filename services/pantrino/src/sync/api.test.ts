import { afterEach, describe, expect, it, vi } from "vitest";
import { allowKitchenNetwork, bodyshopApi, kitchenApi, lookupBarcode, searchCatalog } from "./api";
import { accessToken } from "../auth/session";

vi.mock("react-native", () => ({ Platform: { OS: "ios", Version: "26.1" } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.2.0" } } }));
vi.mock("../auth/session", () => ({
  TOOLS_ORIGIN: "http://127.0.0.1:3000", currentSession: () => 1,
  accessToken: vi.fn(async () => "token"), SignedOut: class extends Error {}, Offline: class extends Error {},
}));

afterEach(() => { allowKitchenNetwork(false); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Kitchen API account boundary", () => {
  it("does not refresh a token or make requests in local mode: sync, catalogue search, barcode lookup, or Bodyshop", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    allowKitchenNetwork(false);
    vi.mocked(accessToken).mockClear();
    await expect(kitchenApi.pull()).rejects.toThrow();
    await expect(kitchenApi.push([])).rejects.toThrow();
    await expect(searchCatalog("Rice")).rejects.toThrow();
    await expect(lookupBarcode("4000000000000")).rejects.toThrow();
    await expect(bodyshopApi.today()).rejects.toThrow();
    await expect(bodyshopApi.act({ type: "weight.log", day: "2026-11-07", kg: 70 })).rejects.toThrow();
    expect(accessToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send an account request whose token finished after switching to local mode", async () => {
    let token!: (value: string) => void;
    vi.mocked(accessToken).mockImplementationOnce(() => new Promise((resolve) => { token = resolve; }));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    allowKitchenNetwork(true);
    const request = searchCatalog("Rice");
    allowKitchenNetwork(false);
    token("old token");
    await expect(request).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not refresh for a late 401 after leaving account mode", async () => {
    let respond!: (response: Response) => void;
    vi.mocked(accessToken).mockClear();
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; }));
    vi.stubGlobal("fetch", fetch);
    allowKitchenNetwork(true);
    const request = kitchenApi.pull();
    await Promise.resolve();
    allowKitchenNetwork(false);
    respond(new Response(null, { status: 401 }));
    await expect(request).rejects.toThrow();
    expect(accessToken).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps authenticated account requests available after sign-in", async () => {
    const snapshot = { today: "2026-11-07", planFrom: "2026-10-05", kitchens: [] };
    const fetch = vi.fn(async () => Response.json(snapshot));
    vi.stubGlobal("fetch", fetch);
    allowKitchenNetwork(true);
    expect(await kitchenApi.pull()).toEqual(snapshot);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:3000/api/kitchen/sync", expect.objectContaining({ headers: { Authorization: "Bearer token", Accept: "application/json" } }));
  });
});
