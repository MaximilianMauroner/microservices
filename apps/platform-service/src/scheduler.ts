export interface SchedulerLogger {
  info(event: string, fields?: Readonly<Record<string, string | number>>): void;
  error(event: string, fields?: Readonly<Record<string, string | number>>): void;
}

export function startAlignedScheduler(options: {
  intervalMs: number;
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

  const run = () => {
    if (stopped || current) return;
    const startedAt = now();
    current = options.run().then(
      () => options.logger.info("checker.scheduled.complete", { startedAt }),
      (error: unknown) =>
        options.logger.error("checker.scheduled.failed", {
          startedAt,
          errorType: error instanceof Error ? error.name : "UnknownError"
        })
    ).finally(() => {
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
    }
  };
}
