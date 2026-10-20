import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { createPostgresCheckerStore } from "../src/postgres-store.js";
import * as definitions from "../src/definitions.js";
import { catalogFixture, configFixture } from "./helpers.js";
import type { CheckerCatalogSource } from "../src/postgres-store.js";

const resources = vi.hoisted(() => {
  const sql = Object.assign(vi.fn(), { end: vi.fn().mockResolvedValue(undefined) });
  return { sql, postgres: vi.fn((_url: string, _options: postgres.Options<{}>) => sql), snapshots: vi.fn(() => ({ close: vi.fn() })) };
});
vi.mock("postgres", () => ({ default: resources.postgres }));
vi.mock("../src/bucket.js", async (original) => ({ ...await original<typeof import("../src/bucket.js")>(), createSnapshotStore: resources.snapshots }));

function sourceFixture(): CheckerCatalogSource {
  const catalog = catalogFixture();
  return {
    catalog,
    definitions: catalog.entries.map(({ id, monitor }) => ({ id, kind: "http", url: monitor!.url, scope: "public", timeoutMs: 5_000, expectedStatus: [200] })),
    productMonitorIds: ["public-a"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resources.sql.mockResolvedValue([]);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("checker catalog source", () => {
  it.each([false, true])("retains default database behavior with an explicit catalog source %s", async (explicit) => {
    vi.stubEnv("PUBLIC_ORIGIN", "https://tools.example");
    const { default: actualPostgres } = await vi.importActual<{ default: typeof postgres }>("postgres");
    const store = await createPostgresCheckerStore(configFixture, explicit ? sourceFixture() : undefined);
    const sql = actualPostgres(...resources.postgres.mock.calls[0]);
    const defaults = actualPostgres(configFixture.databaseUrl, { max: 4 });
    try {
      expect(sql.options.max).toBe(4);
      expect(sql.options.connect_timeout).toBe(defaults.options.connect_timeout);
      expect(sql.options.connection).toEqual(defaults.options.connection);
    } finally {
      await store.close();
      await sql.end();
      await defaults.end();
    }
    expect(resources.sql.end).toHaveBeenCalledExactlyOnceWith();
  });

  it("uses only an explicit source and reads canonical pause overrides on each read", async () => {
    vi.stubEnv("PUBLIC_ORIGIN", "invalid default origin");
    const defaults = vi.spyOn(definitions, "loadMonitorDefinitions");
    const source = sourceFixture();
    resources.sql.mockResolvedValueOnce([{ monitor_id: "paused-a", paused: false }, { monitor_id: "public-a", paused: true }])
      .mockResolvedValueOnce([{ monitor_id: "paused-a", paused: true }, { monitor_id: "public-a", paused: false }]);
    const store = await createPostgresCheckerStore(configFixture, source);
    try {
      const first = await store.readCatalog();
      expect(first.value.entries.find(({ id }) => id === "paused-a")?.monitor?.paused).toBe(false);
      expect(first.value.entries.find(({ id }) => id === "public-a")?.monitor?.paused).toBe(true);
      const second = await store.readCatalog();
      expect(second.value.entries.find(({ id }) => id === "paused-a")?.monitor?.paused).toBe(true);
      expect(second.value.entries.find(({ id }) => id === "public-a")?.monitor?.paused).toBe(false);
      expect(second.value.entries.map(({ id }) => id)).toEqual(source.catalog.entries.map(({ id }) => id));
      expect(defaults).not.toHaveBeenCalled();
    } finally { await store.close(); }
  });

  it.each(["catalog", "definition", "product", "literal-ip"])("rejects invalid %s input before opening resources", async (invalid) => {
    const source = sourceFixture();
    if (invalid === "catalog") source.catalog = { ...source.catalog, revision: "" };
    if (invalid === "definition") source.definitions = [...source.definitions, source.definitions[0]];
    if (invalid === "product") source.productMonitorIds = ["unknown-product"];
    if (invalid === "literal-ip") source.definitions = source.definitions.map((definition) => ({ ...definition, kind: "http", url: "http://127.0.0.1:9/", expectedStatus: [200], timeoutMs: 5_000 }));
    await expect(createPostgresCheckerStore(configFixture, source)).rejects.toThrow();
    expect(resources.postgres).not.toHaveBeenCalled();
    expect(resources.snapshots).not.toHaveBeenCalled();
  });

  it("retains production definitions and product validation when no source is supplied", async () => {
    vi.stubEnv("PUBLIC_ORIGIN", "https://tools.example");
    const store = await createPostgresCheckerStore(configFixture);
    try {
      const catalog = await store.readCatalog();
      expect(catalog.value.entries.find(({ id }) => id === "tower")?.monitor?.url).toBe("https://tools.example/health/tower");
      expect(catalog.value.entries.some(({ id }) => id === "home-assistant")).toBe(true);
    } finally { await store.close(); }
    resources.postgres.mockClear();
    resources.snapshots.mockClear();
    vi.spyOn(definitions, "loadMonitorDefinitions").mockReturnValue([] as unknown as ReturnType<typeof definitions.loadMonitorDefinitions>);
    await expect(createPostgresCheckerStore(configFixture)).rejects.toThrow("Invalid monitor identities");
    expect(resources.postgres).not.toHaveBeenCalled();
    expect(resources.snapshots).not.toHaveBeenCalled();
  });

  it("rejects invalid production settings before opening resources", async () => {
    vi.stubEnv("PUBLIC_ORIGIN", "");
    await expect(createPostgresCheckerStore(configFixture)).rejects.toThrow("PUBLIC_ORIGIN");
    expect(resources.postgres).not.toHaveBeenCalled();
    expect(resources.snapshots).not.toHaveBeenCalled();
  });
});
