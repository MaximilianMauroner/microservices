import { describe, expect, it, vi } from "vitest";
import { runDueMaintenance } from "../src/maintenance.js";

describe("bounded maintenance", () => {
  it("coalesces an outage to current due slots, skips completed tasks, and runs the next task after a failure", async () => {
    const repository = {
      acquire: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      complete: vi.fn().mockResolvedValue(undefined),
      close: vi.fn()
    };
    const cleanup = vi.fn();
    const market = vi.fn().mockResolvedValue(undefined);
    await runDueMaintenance({
      repository, ownerId: "restart", signal: new AbortController().signal,
      now: () => Date.parse("2026-10-13T04:15:00Z"), log: vi.fn(),
      tasks: [
        { id: "cleanup", intervalMs: 3_600_000, run: cleanup },
        { id: "market", intervalMs: 86_400_000, phaseOffsetMs: 3 * 3_600_000 + 15 * 60_000, run: market }
      ]
    });
    expect(cleanup).not.toHaveBeenCalled();
    expect(market).toHaveBeenCalledOnce();
    expect(repository.acquire.mock.calls.map(([input]) => input.slot.toISOString())).toEqual([
      "2026-10-13T04:00:00.000Z", "2026-10-13T03:15:00.000Z"
    ]);
    expect(repository.complete).toHaveBeenCalledWith(expect.objectContaining({ taskId: "market", result: { outcome: "complete" } }));
  });

  it("records a known failure for retry without blocking the other product", async () => {
    const repository = { acquire: vi.fn().mockResolvedValue(true), complete: vi.fn().mockResolvedValue(undefined), close: vi.fn() };
    const second = vi.fn().mockResolvedValue(undefined);
    await expect(runDueMaintenance({
      repository, ownerId: "worker", signal: new AbortController().signal, log: vi.fn(),
      tasks: [
        { id: "first", intervalMs: 60_000, run: async () => { throw new Error("provider failed"); } },
        { id: "second", intervalMs: 60_000, run: second }
      ]
    })).rejects.toThrow("Maintenance tasks failed");
    expect(second).toHaveBeenCalledOnce();
    expect(repository.complete.mock.calls[0]?.[0].result.outcome).toBe("failed");
  });

  it("does not mark interrupted work complete or launch the next task", async () => {
    const controller = new AbortController();
    const repository = { acquire: vi.fn().mockResolvedValue(true), complete: vi.fn(), close: vi.fn() };
    const second = vi.fn();
    await expect(runDueMaintenance({
      repository, ownerId: "worker", signal: controller.signal, log: vi.fn(),
      tasks: [
        { id: "first", intervalMs: 60_000, run: async () => { controller.abort(); } },
        { id: "second", intervalMs: 60_000, run: second }
      ]
    })).rejects.toThrow();
    expect(repository.complete).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });
});
