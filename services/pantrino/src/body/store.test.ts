import type { BodyshopAppSnapshot } from "@tools-platform/service/bodyshop-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bodyshopApi } from "../sync/api";
import { vault } from "../storage/vault";
import { bodyStore } from "./store";

vi.mock("../auth/session", () => ({ SignedOut: class extends Error {}, Offline: class extends Error {} }));
vi.mock("../storage/vault", () => ({ vault: { setting: vi.fn(async () => null), saveSetting: vi.fn(async () => undefined) } }));
vi.mock("../sync/api", () => ({ bodyshopApi: { today: vi.fn(), act: vi.fn() }, NoAccess: class extends Error {}, Refused: class extends Error {} }));

const day = (name: string) => ({ day: "2026-11-07", today: "2026-11-07", foods: [{ name }] }) as unknown as BodyshopAppSnapshot;

beforeEach(() => { bodyStore.reset(); vi.mocked(vault.saveSetting).mockClear(); });

describe("Bodyshop across a sign-out or an account change", () => {
  it("drops a day that arrives after the reset, so the next account or local mode never sees or stores it", async () => {
    let answer!: (snapshot: BodyshopAppSnapshot) => void;
    vi.mocked(bodyshopApi.today).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const refresh = bodyStore.refresh();
    bodyStore.reset();
    answer(day("from the last account"));
    await refresh;
    expect(bodyStore.getState()).toEqual({ snapshot: null, status: "unknown" });
    expect(vault.saveSetting).not.toHaveBeenCalled();
  });

  it("keeps a day that arrives without a reset", async () => {
    vi.mocked(bodyshopApi.today).mockResolvedValueOnce(day("mine"));
    await bodyStore.refresh();
    expect(bodyStore.getState().status).toBe("ready");
    expect(vault.saveSetting).toHaveBeenCalledOnce();
  });
});
