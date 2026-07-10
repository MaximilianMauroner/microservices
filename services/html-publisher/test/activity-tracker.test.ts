import { describe, expect, it } from "vitest";
import { ActivityTracker } from "../src/activity-tracker.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

describe("ActivityTracker", () => {
  it("preserves a tracked operation's resolved value and waits for it", async () => {
    const tracker = new ActivityTracker();
    const operation = deferred<string>();
    const tracked = tracker.track(operation.promise);
    let idle = false;
    const waiting = tracker.waitForIdle().then(() => {
      idle = true;
    });

    await Promise.resolve();
    expect(idle).toBe(false);

    operation.resolve("complete");

    await expect(tracked).resolves.toBe("complete");
    await waiting;
    expect(idle).toBe(true);
  });

  it("preserves a tracked rejection while allowing waitForIdle to settle", async () => {
    const tracker = new ActivityTracker();
    const operation = deferred<void>();
    const failure = new Error("failed");
    const tracked = tracker.track(operation.promise);
    const waiting = tracker.waitForIdle();

    operation.reject(failure);

    await expect(tracked).rejects.toBe(failure);
    await expect(waiting).resolves.toBeUndefined();
  });

  it("waits for multiple active operations", async () => {
    const tracker = new ActivityTracker();
    const first = deferred<void>();
    const second = deferred<void>();
    tracker.track(first.promise);
    tracker.track(second.promise);
    let idle = false;
    const waiting = tracker.waitForIdle().then(() => {
      idle = true;
    });

    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(idle).toBe(false);

    second.resolve();
    await waiting;
    expect(idle).toBe(true);
  });

  it("includes work registered while an idle wait is draining", async () => {
    const tracker = new ActivityTracker();
    const first = deferred<void>();
    const second = deferred<void>();
    const firstTracked = tracker.track(first.promise);
    let secondTracked: Promise<void> | undefined;
    void firstTracked.then(() => {
      secondTracked = tracker.track(second.promise);
    });
    let idle = false;
    const waiting = tracker.waitForIdle().then(() => {
      idle = true;
    });

    first.resolve();
    await firstTracked;
    await Promise.resolve();
    expect(secondTracked).toBeDefined();
    expect(idle).toBe(false);

    second.resolve();
    await secondTracked;
    await waiting;
    expect(idle).toBe(true);
  });
});
