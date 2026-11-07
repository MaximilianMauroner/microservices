import type { BodyshopAppSnapshot } from "@tools-platform/service/bodyshop-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bodyshopApi } from "../sync/api";
import { vault } from "../storage/vault";
import { bodyStore } from "./store";

vi.mock("../auth/session", () => ({ SignedOut: class extends Error {}, Offline: class extends Error {} }));
vi.mock("../storage/vault", () => ({ vault: { setting: vi.fn(async () => null), saveSetting: vi.fn(async () => undefined) } }));
vi.mock("../sync/api", () => ({ bodyshopApi: { today: vi.fn(), act: vi.fn() }, NoAccess: class extends Error {}, Refused: class extends Error {} }));

const day = (name: string) => ({ day: "2026-11-07", today: "2026-11-07", foods: [{ name }] }) as unknown as BodyshopAppSnapshot;

beforeEach(() => { bodyStore.reset(); vi.clearAllMocks(); });

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

  it("cancels a save answered after reset and sends no following log", async () => {
    let answer!: (result: Awaited<ReturnType<typeof bodyshopApi.act>>) => void;
    vi.mocked(bodyshopApi.act).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const act = bodyStore.actionSender();
    const saved = act({ type: "food.save", name: "Rice" });
    bodyStore.reset();
    answer({ result: {}, snapshot: day("old account") });
    expect(await saved).toEqual({ ok: false, reason: "cancelled" });
    expect(await act({ type: "food.log", day: "2026-11-07", items: [{ food: "Rice", meal: "Lunch" }] })).toEqual({ ok: false, reason: "cancelled" });
    expect(bodyshopApi.act).toHaveBeenCalledOnce();
    expect(vault.saveSetting).not.toHaveBeenCalled();
    expect(bodyStore.getState().snapshot).toBeNull();
  });

  it("cancels a following action even when the first succeeded before reset", async () => {
    vi.mocked(bodyshopApi.act).mockResolvedValueOnce({ result: {}, snapshot: day("old account") });
    const act = bodyStore.actionSender();
    expect((await act({ type: "food.save", name: "Rice" })).ok).toBe(true);
    bodyStore.reset();
    expect(await act({ type: "weight.log", day: "2026-11-07", kg: 70 })).toEqual({ ok: false, reason: "cancelled" });
    expect(bodyshopApi.act).toHaveBeenCalledOnce();
  });

  it("keeps the last requested day when reads finish in reverse order", async () => {
    let answer!: (snapshot: BodyshopAppSnapshot) => void;
    vi.mocked(bodyshopApi.today).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const first = bodyStore.refresh("2026-11-06");
    vi.mocked(bodyshopApi.today).mockResolvedValueOnce(day("newer"));
    await bodyStore.refresh("2026-11-07");
    answer(day("older"));
    await first;
    expect(bodyStore.getState().snapshot).toEqual(day("newer"));
    expect(vault.saveSetting).toHaveBeenCalledOnce();
  });

  it("keeps a successful edit when an earlier read finishes later", async () => {
    let answer!: (snapshot: BodyshopAppSnapshot) => void;
    vi.mocked(bodyshopApi.today).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const read = bodyStore.refresh();
    vi.mocked(bodyshopApi.act).mockResolvedValueOnce({ result: {}, snapshot: day("edited") });
    await bodyStore.act({ type: "weight.log", day: "2026-11-07", kg: 70 });
    answer(day("before edit"));
    await read;
    expect(bodyStore.getState().snapshot).toEqual(day("edited"));
    expect(vault.saveSetting).toHaveBeenCalledOnce();
  });
});
