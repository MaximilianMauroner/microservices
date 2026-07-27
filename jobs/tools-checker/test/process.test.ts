import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  CheckerDeadlineError,
  executeChecker
} from "../src/index.js";
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

  it("force-exits a spawned CLI after deadline cleanup despite an active handle", async () => {
    const fixture = new URL(
      "./fixtures/active-handle-cli.ts",
      import.meta.url
    ).pathname;
    const child = spawn("bun", [fixture], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = readStream(child.stdout);
    const stderr = readStream(child.stderr);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const exitCode = await Promise.race([
        new Promise<number>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", (code) => resolve(code ?? -1));
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("spawned checker did not force-exit")),
            2_000
          );
        })
      ]);
      const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
      expect(exitCode).toBe(1);
      expect(stdoutText).toContain("store.closed");
      expect(stderrText).toContain("checker_process_terminal");
      expect(stderrText).toContain("checker_process_force_exit");
    } finally {
      if (timeout) clearTimeout(timeout);
      child.kill();
    }
  });
});

async function readStream(stream: Readable | null): Promise<string> {
  if (!stream) return "";
  let text = "";
  stream.setEncoding("utf8");
  for await (const chunk of stream) {
    text += String(chunk);
  }
  return text;
}
