import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshLocalKitchen } from "../sync/local";

const storage = vi.hoisted(() => ({
  files: new Map<string, Map<string, string>>(), keys: new Map<string, string>(),
  deleted: [] as string[], closed: [] as string[], unreadable: new Set<string>(),
}));

vi.mock("expo-crypto", () => ({ getRandomBytes: (size: number) => new Uint8Array(size).fill(1) }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  getItemAsync: async (key: string) => storage.keys.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { storage.keys.set(key, value); },
  deleteItemAsync: async (key: string) => { storage.keys.delete(key); },
}));
vi.mock("expo-sqlite", () => ({
  deleteDatabaseAsync: async (file: string) => { storage.deleted.push(file); storage.files.delete(file); },
  openDatabaseAsync: async (file: string) => {
    if (!storage.files.has(file)) storage.files.set(file, new Map());
    const settings = storage.files.get(file)!;
    return {
      getFirstAsync: async (query: string, key: string) => {
        if (query === "PRAGMA cipher_version") return { cipher_version: "4" };
        if (storage.unreadable.has(file)) throw new Error("cannot open encrypted file");
        if (query === "PRAGMA user_version") return { user_version: 1 };
        return settings.has(key) ? { value: settings.get(key) } : null;
      },
      execAsync: async () => undefined,
      runAsync: async (_query: string, key: string, value: string) => { settings.set(key, value); },
      closeAsync: async () => { storage.closed.push(file); },
    };
  },
}));

beforeEach(() => {
  vi.resetModules();
  storage.files.clear(); storage.keys.clear(); storage.deleted = []; storage.closed = []; storage.unreadable.clear();
});

describe("local vault ownership", () => {
  it("uses separate files and keys, and keeps local data and preferences through an account wipe", async () => {
    const { vault, localVault, wipeVault } = await import("./vault");
    const local = freshLocalKitchen(() => "local", "2026-11-07");
    const account = freshLocalKitchen(() => "account", "2026-11-07");
    await Promise.all([localVault.saveSnapshot(local), vault.saveSnapshot(account)]);
    await localVault.saveSetting("language", "de");
    expect(storage.keys.has("kitchen.database-key")).toBe(true);
    expect(storage.keys.has("kitchen.local-database-key")).toBe(true);
    storage.deleted = [];
    await wipeVault();
    expect(storage.deleted).toEqual(["kitchen.db"]);
    expect(storage.closed).toEqual(["kitchen.db"]);
    expect(storage.keys.has("kitchen.database-key")).toBe(false);
    expect(storage.keys.has("kitchen.local-database-key")).toBe(true);
    expect(await localVault.snapshot()).toEqual(local);
    expect(await localVault.setting("language")).toBe("de");
  });

  it("keeps an unreadable local file and reports the error instead of replacing it with an empty kitchen", async () => {
    storage.files.set("kitchen-local.db", new Map([["snapshot", "retained encrypted data"]]));
    storage.unreadable.add("kitchen-local.db");
    const { localVault } = await import("./vault");
    await expect(localVault.snapshot()).rejects.toThrow("cannot open encrypted file");
    expect(storage.files.get("kitchen-local.db")!.get("snapshot")).toBe("retained encrypted data");
    expect(storage.deleted).toEqual([]);
  });
});
