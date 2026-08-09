import type { ScheduledTaskLeaseRepository, ScheduledTaskResult } from "./scheduled-task-leases.js";

export interface SchedulerLogger {
  info(event: string, fields?: Readonly<Record<string, string | number>>): void;
  error(event: string, fields?: Readonly<Record<string, string | number>>): void;
}

export function startAlignedScheduler(options: {
  intervalMs: number;
  lease?: Readonly<{
    repository: ScheduledTaskLeaseRepository;
    taskId: string;
    ownerId: string;
    durationMs: number;
  }>;
  run: () => Promise<void>;
  logger: SchedulerLogger;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}) {
  const now = options.now ?? Date.now;
  const schedule = options.setTimer ?? setTimeout;
  const cancel = options.clearTimer ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let current: Promise<void> | undefined;

  const execute = async (startedAt: number) => {
    const slot = new Date(Math.floor(startedAt / options.intervalMs) * options.intervalMs);
    if (options.lease) {
      const acquired = await options.lease.repository.acquire({
        taskId: options.lease.taskId,
        slot,
        ownerId: options.lease.ownerId,
        leaseDurationMs: options.lease.durationMs
      });
      if (!acquired) {
        options.logger.info("checker.scheduled.skipped", { startedAt });
        return;
      }
    }

    let result: ScheduledTaskResult = { outcome: "complete" };
    try {
      await options.run();
      options.logger.info("checker.scheduled.complete", { startedAt });
    } catch (error) {
      result = {
        outcome: "failed",
        errorType: error instanceof Error ? error.name : "UnknownError"
      };
      options.logger.error("checker.scheduled.failed", {
        startedAt,
        errorType: result.errorType ?? "UnknownError"
      });
    } finally {
      if (options.lease) {
        await options.lease.repository.complete({
          taskId: options.lease.taskId,
          slot,
          ownerId: options.lease.ownerId,
          result
        });
      }
    }
  };

  const run = () => {
    if (stopped || current) return;
    const startedAt = now();
    current = execute(startedAt).catch((error: unknown) => {
      options.logger.error("checker.scheduled.failed", {
        startedAt,
        errorType: error instanceof Error ? error.name : "UnknownError"
      });
    }).finally(() => {
      current = undefined;
    });
  };

  const scheduleNext = () => {
    if (stopped) return;
    const delay = options.intervalMs - (now() % options.intervalMs);
    timer = schedule(() => {
      run();
      scheduleNext();
    }, delay);
    timer.unref?.();
  };

  run();
  scheduleNext();

  return {
    stop() {
      stopped = true;
      if (timer) cancel(timer);
    },
    wait() {
      return current ?? Promise.resolve();
    },
    async close() {
      stopped = true;
      if (timer) cancel(timer);
      await (current ?? Promise.resolve());
      await options.lease?.repository.close();
    }
  };
}
