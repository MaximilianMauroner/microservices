import { describe, expect, it, vi } from "vitest";
import { startAlignedScheduler } from "../src/scheduler.ts";

describe("aligned scheduler", () => {
  it("starts immediately and does not overlap runs", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const run = vi.fn(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const scheduler = startAlignedScheduler({
      intervalMs: 300_000,
      run,
      logger: { info: vi.fn(), error: vi.fn() },
      now: () => 0
    });

    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).toHaveBeenCalledTimes(1);
    finish?.();
    await scheduler.wait();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).toHaveBeenCalledTimes(2);

    scheduler.stop();
    vi.useRealTimers();
  });
});
