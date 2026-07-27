import { describe, expect, it, vi } from "vitest";
import { CheckerDeadlineError, executeChecker } from "../src/index.js";
import {
  MemoryStore,
  NOW,
  configFixture,
  logger
} from "./helpers.js";

describe("one-shot process", () => {
  it("closes its store after a terminal run without listening", async () => {
    const store = new MemoryStore();
    await executeChecker({
      store,
      config: configFixture,
      logger,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, { status: 200 })
      ),
      now: () => new Date(NOW)
    });
    expect(store.closed).toBe(true);
  });

  it("also closes its store after failure", async () => {
    const store = new MemoryStore();
    store.readCatalog = async () => {
      throw new Error("bucket unavailable");
    };
    await expect(
      executeChecker({
        store,
        config: configFixture,
        logger,
        now: () => new Date(NOW)
      })
    ).rejects.toThrow("bucket unavailable");
    expect(store.closed).toBe(true);
  });

  it("aborts a hung run at the whole-process deadline and closes the store", async () => {
    const store = new MemoryStore();
    store.readCatalog = async () => new Promise(() => undefined);

    await expect(
      executeChecker({
        store,
        config: { ...configFixture, runDeadlineMs: 20 },
        logger,
        now: () => new Date(NOW)
      })
    ).rejects.toBeInstanceOf(CheckerDeadlineError);
    expect(store.closed).toBe(true);
  });
});
