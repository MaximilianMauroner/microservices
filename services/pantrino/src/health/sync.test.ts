import type { HealthFeed } from "@tools-platform/service/bodyshop-contract";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { healthSync } from "./sync";

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  feed: vi.fn(),
  importWeight: vi.fn(),
  importCheckIns: vi.fn(),
  stepCount: vi.fn(),
  sleepSessions: vi.fn(),
  request: vi.fn(),
  upsertNutrition: vi.fn(),
  deleteNutrition: vi.fn(),
  weightChanges: vi.fn(),
  weights: vi.fn(),
  permissions: vi.fn(),
}));

vi.mock("../storage/vault", () => ({ vault: {
  setting: async (key: string) => mocks.storage.get(key) ?? null,
  saveSetting: async (key: string, value: string) => { mocks.storage.set(key, value); },
} }));
vi.mock("../sync/api", () => ({ bodyshopApi: { healthFeed: mocks.feed, importWeight: mocks.importWeight, importHealthCheckIns: mocks.importCheckIns } }));
vi.mock("./adapter", () => ({ healthAdapter: {
  availability: async () => "available",
  permissions: mocks.permissions,
  request: mocks.request,
  stepCount: mocks.stepCount,
  sleepSessions: mocks.sleepSessions,
  weights: mocks.weights,
  weightChanges: mocks.weightChanges,
  upsertNutrition: mocks.upsertNutrition,
  deleteNutrition: mocks.deleteNutrition,
} }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.storage.clear();
  mocks.storage.set("account", "owner");
  mocks.permissions.mockResolvedValue(["weight", "nutrition"]);
  mocks.request.mockResolvedValue(true);
});

afterEach(() => healthSync.clearSession());

const nutrition = { baseline: "4", after: "4", namespace: "owner" };
const changes: HealthFeed = {
  kind: "changes", dayStartHour: 4, changes: [
    { cursor: "5", id: "food", revision: 1, food: {
      food: "Apple", day: "2026-10-25", time: null, meal: "Snack",
      nutrients: { kcal: 52, protein: null, carbs: 14, fat: null, fiber: null },
    } },
    { cursor: "6", id: "food", revision: 2, food: null },
  ],
};

const saved = () => JSON.parse(mocks.storage.get("health-connect:owner") ?? "{}");

it("retries only the unfinished nutrition operation and commits the cursor after deletion", async () => {
  mocks.storage.set("health-connect:owner", JSON.stringify({ nutrition }));
  mocks.feed.mockResolvedValueOnce(changes).mockResolvedValue({ kind: "changes", dayStartHour: 4, changes: [] });
  mocks.deleteNutrition.mockRejectedValueOnce(new Error("interrupted")).mockResolvedValue(undefined);
  await healthSync.connectSession(() => undefined);
  await vi.waitFor(() => expect(healthSync.snapshot().status).toBe("failed"));
  expect(saved().nutrition).toEqual({
    ...nutrition, pending: { cursor: "6", operations: [{ delete: "bodyshop:owner:food" }] },
  });
  await healthSync.sync();
  expect(mocks.upsertNutrition).toHaveBeenCalledTimes(1);
  expect(mocks.deleteNutrition).toHaveBeenCalledTimes(2);
  expect(saved().nutrition.after).toBe("6");
});

it("retains the weight token if the backend cannot apply a deletion", async () => {
  const weight = { since: "2026-10-26T00:00:00.000Z", token: "old" };
  mocks.storage.set("health-connect:owner", JSON.stringify({ weight }));
  mocks.weightChanges.mockResolvedValue({ changes: [{ type: "delete", externalId: "a" }], token: "new", more: false, expired: false });
  mocks.importWeight.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  await healthSync.connectSession(() => undefined);
  await vi.waitFor(() => expect(healthSync.snapshot().status).toBe("failed"));
  expect(saved().weight.token).toBe("old");
  await healthSync.sync();
  expect(saved().weight.token).toBe("new");
});

it("stops stale feed operations on account changes and requires new consent", async () => {
  mocks.storage.set("health-connect:owner", JSON.stringify({ nutrition }));
  let givePage!: (feed: HealthFeed) => void;
  mocks.feed.mockImplementation(() => new Promise<HealthFeed>((resolve) => { givePage = resolve; }));
  await healthSync.connectSession(() => undefined);
  await vi.waitFor(() => expect(mocks.feed).toHaveBeenCalled());
  healthSync.clearSession();
  mocks.storage.set("account", "another-owner");
  await healthSync.connectSession(() => undefined);
  givePage(changes);
  await vi.waitFor(() => expect(mocks.permissions).toHaveBeenCalledTimes(2));
  expect(mocks.upsertNutrition).not.toHaveBeenCalled();
  expect(healthSync.snapshot().preferences).toEqual({});
});

it("leaves pending nutrition untouched when write permission is revoked", async () => {
  mocks.storage.set("health-connect:owner", JSON.stringify({ nutrition }));
  mocks.permissions.mockResolvedValue(["weight"]);
  await healthSync.connectSession(() => undefined);
  await vi.waitFor(() => expect(healthSync.snapshot().status).toBe("permission-required"));
  expect(mocks.feed).not.toHaveBeenCalled();
  expect(saved().nutrition).toEqual(nutrition);
});

it("resumes the same changes stream after a history import is interrupted", async () => {
  const weight = { since: "2026-10-26T00:00:00.000Z" };
  mocks.storage.set("health-connect:owner", JSON.stringify({ weight }));
  const first = { changes: [], token: "before-history", more: true, expired: false };
  const deletion = { type: "delete", externalId: "deleted-during-scan" };
  mocks.weightChanges.mockResolvedValueOnce(first).mockResolvedValue({
    changes: [deletion], token: "after-deletion", more: false, expired: false,
  });
  mocks.weights.mockRejectedValueOnce(new Error("interrupted")).mockResolvedValue({ changes: [] });
  await healthSync.connectSession(() => undefined);
  await vi.waitFor(() => expect(healthSync.snapshot().status).toBe("failed"));
  expect(saved().weight).toEqual({ ...weight, bootstrap: first });
  await healthSync.sync();
  expect(mocks.weightChanges.mock.calls).toEqual([[undefined], ["before-history"]]);
  expect(mocks.importWeight).toHaveBeenCalledWith([deletion], expect.any(AbortSignal));
  expect(saved().weight).toEqual({ ...weight, token: "after-deletion" });
});

it("keeps steps disabled and explains when the backend needs an update", async () => {
  mocks.feed.mockResolvedValue({ kind: "baseline", cursor: "0", namespace: "owner" });
  await healthSync.connectSession(() => undefined);
  await healthSync.setEnabled("steps", true);
  expect(healthSync.snapshot().status).toBe("server-update-required");
  expect(healthSync.snapshot().preferences.steps).toBeUndefined();
  expect(mocks.request).not.toHaveBeenCalled();
});

it("reads and imports only the opted-in check-in metric", async () => {
  mocks.permissions.mockResolvedValue(["steps", "sleep"]);
  mocks.feed.mockResolvedValue({ kind: "baseline", cursor: "0", namespace: "owner", checkIns: true });
  mocks.stepCount.mockResolvedValue(undefined).mockResolvedValueOnce(7800);
  await healthSync.connectSession(() => undefined);
  await healthSync.setEnabled("steps", true);
  await vi.waitFor(() => expect(saved().lastSync).toBeDefined());
  expect(mocks.sleepSessions).not.toHaveBeenCalled();
  expect(mocks.importCheckIns).toHaveBeenCalledWith([{ day: expect.any(String), steps: 7800 }], expect.any(AbortSignal));
});
