import { describe, expect, it, vi } from "vitest";
import { createGracefulShutdown } from "../src/lifecycle.js";
import { MemoryReviewRepository } from "../src/memory-repository.js";

const id = "11111111-1111-4111-8111-111111111111";
const start = new Date("2026-07-26T00:00:00Z");
const candidate = {
  candidateId: id,
  scope: "project" as const,
  projectKey: "repo",
  projectDisplayName: "Repo",
  lessonKey: "safe",
  title: '"><img src=x onerror=alert(1)>',
  body: "Body",
  rationale: "Why",
  evidence: [{ excerpt: "Evidence", sessionRef: "session", commitHashes: ["abc"] }],
  createdAt: start.toISOString(),
};

describe("review lifecycle", () => {
  it("gates future rounds and preserves 30-day first confirmation across defers", async () => {
    const repository = new MemoryReviewRepository();
    await repository.createCandidate("key", candidate);
    const approved = await repository.decide(
      id,
      1,
      { action: "approve" },
      start,
      "owner@example.com",
    );
    expect(approved.nextReviewAt).toBe("2026-08-02T00:00:00.000Z");
    expect(await repository.queue(undefined, start)).toHaveLength(0);
    await expect(
      repository.decide(
        id,
        2,
        { action: "confirm_valid" },
        start,
        "owner@example.com",
      ),
    ).rejects.toThrow("not due");
    const due = new Date(approved.nextReviewAt!);
    const deferred = await repository.decide(
      id,
      2,
      { action: "defer", deferUntil: "2026-08-05T00:00:00Z" },
      due,
      "owner@example.com",
    );
    const confirmed = await repository.decide(
      id,
      3,
      { action: "confirm_valid" },
      new Date(deferred.nextReviewAt!),
      "owner@example.com",
    );
    expect(confirmed.nextReviewAt).toBe("2026-09-04T00:00:00.000Z");
  });

  it("returns reviewer, evidence, scoped pagination, and a cursor on the final nonempty page", async () => {
    const repository = new MemoryReviewRepository();
    await repository.createCandidate("key", candidate);
    await repository.decide(
      id,
      1,
      { action: "approve" },
      start,
      "owner@example.com",
    );
    const page = await repository.decisions(undefined, 100, "project");
    expect(page.nextCursor).toBeTruthy();
    expect(page.decisions[0]).toMatchObject({
      reviewer: "owner@example.com",
      evidence: candidate.evidence,
    });
    expect((await repository.decisions(undefined, 100, "global")).decisions).toHaveLength(0);
  });
});

describe("Bun server shutdown", () => {
  it("drains once and closes the repository idempotently", async () => {
    const stop = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const fail = vi.fn();
    const report = vi.fn();
    const shutdown = createGracefulShutdown({ stop, close, fail, report });

    const first = shutdown();
    expect(shutdown()).toBe(first);
    await first;
    expect(stop).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith(false);
    expect(close).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("forces a stop and marks failure after the drain deadline", async () => {
    const never = new Promise<void>(() => undefined);
    const stop = vi.fn((force: boolean) => (force ? undefined : never));
    const close = vi.fn(async () => undefined);
    const fail = vi.fn();
    const shutdown = createGracefulShutdown({
      stop,
      close,
      fail,
      report: vi.fn(),
      timeoutMs: 5,
    });

    await shutdown();
    expect(stop.mock.calls).toEqual([[false], [true]]);
    expect(fail).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports repository close failures and marks the process unsuccessful", async () => {
    const error = new Error("close failed");
    const fail = vi.fn();
    const report = vi.fn();
    const shutdown = createGracefulShutdown({
      stop: vi.fn(),
      close: vi.fn(async () => Promise.reject(error)),
      fail,
      report,
    });

    await shutdown();
    expect(fail).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(error);
  });

  it("forces cleanup, reports, and closes when graceful draining rejects", async () => {
    const error = new Error("drain failed");
    const stop = vi.fn((force: boolean) =>
      force ? undefined : Promise.reject(error),
    );
    const close = vi.fn(async () => undefined);
    const fail = vi.fn();
    const report = vi.fn();
    const shutdown = createGracefulShutdown({ stop, close, fail, report });

    await shutdown();
    expect(stop.mock.calls).toEqual([[false], [true]]);
    expect(fail).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(error);
    expect(close).toHaveBeenCalledOnce();
  });
});
