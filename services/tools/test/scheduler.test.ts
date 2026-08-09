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

  it("runs only after acquiring the interval slot and records completion", async () => {
    const repository = {
      acquire: vi.fn().mockResolvedValue(true),
      complete: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const run = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), error: vi.fn() };
    const scheduler = startAlignedScheduler({
      intervalMs: 300_000,
      lease: {
        repository,
        taskId: "status-checker:production",
        ownerId: "instance-1",
        durationMs: 270_000
      },
      run,
      logger,
      now: () => 425_000
    });

    await scheduler.wait();

    expect(repository.acquire).toHaveBeenCalledWith({
      taskId: "status-checker:production",
      slot: new Date(300_000),
      ownerId: "instance-1",
      leaseDurationMs: 270_000
    });
    expect(run).toHaveBeenCalledOnce();
    expect(repository.complete).toHaveBeenCalledWith({
      taskId: "status-checker:production",
      slot: new Date(300_000),
      ownerId: "instance-1",
      result: { outcome: "complete" }
    });
    await scheduler.close();
    expect(repository.close).toHaveBeenCalledOnce();
  });

  it("skips work when another process owns the slot", async () => {
    const repository = {
      acquire: vi.fn().mockResolvedValue(false),
      complete: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const run = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), error: vi.fn() };
    const scheduler = startAlignedScheduler({
      intervalMs: 300_000,
      lease: { repository, taskId: "checker", ownerId: "instance-2", durationMs: 270_000 },
      run,
      logger,
      now: () => 0
    });

    await scheduler.wait();

    expect(run).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("checker.scheduled.skipped", { startedAt: 0 });
    await scheduler.close();
  });

  it("records failed runs before releasing shutdown", async () => {
    const repository = {
      acquire: vi.fn().mockResolvedValue(true),
      complete: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const scheduler = startAlignedScheduler({
      intervalMs: 300_000,
      lease: { repository, taskId: "checker", ownerId: "instance-3", durationMs: 270_000 },
      run: vi.fn().mockRejectedValue(new TypeError("broken")),
      logger: { info: vi.fn(), error: vi.fn() },
      now: () => 0
    });

    await scheduler.close();

    expect(repository.complete).toHaveBeenCalledWith(expect.objectContaining({
      result: { outcome: "failed", errorType: "TypeError" }
    }));
    expect(repository.close).toHaveBeenCalledOnce();
  });
});
