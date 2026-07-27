import { createS3CheckerStore, type CheckerStore } from "./bucket.js";
import { loadConfig, type CheckerConfig } from "./config.js";
import { consoleLogger, type SafeLogger } from "./logger.js";
import { runChecker } from "./run.js";

export interface ExecuteOptions {
  config?: CheckerConfig;
  logger?: SafeLogger;
  store?: CheckerStore;
  fetcher?: typeof fetch;
  now?: () => Date;
}

export class CheckerDeadlineError extends Error {
  constructor(deadlineMs: number) {
    super(`Checker exceeded its ${deadlineMs} ms execution deadline`);
    this.name = "CheckerDeadlineError";
  }
}

export interface CheckerCliOptions extends ExecuteOptions {
  cleanupGraceMs?: number;
  forceExit?: (code: number) => void;
  setExitCode?: (code: number) => void;
}

export async function executeChecker(
  options: ExecuteOptions = {}
): Promise<void> {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? consoleLogger;
  const store = options.store ?? createS3CheckerStore(config.bucket);
  logger.info("checker_process_started", {
    environment: config.environment
  });
  const controller = new AbortController();
  let rejectDeadline: (error: CheckerDeadlineError) => void = () => undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    controller.abort(new CheckerDeadlineError(config.runDeadlineMs));
    rejectDeadline(new CheckerDeadlineError(config.runDeadlineMs));
  }, config.runDeadlineMs);
  try {
    const result = await Promise.race([
      runChecker({
        store,
        config,
        logger,
        fetcher: options.fetcher,
        now: options.now,
        signal: controller.signal
      }),
      deadline
    ]);
    logger.info("checker_process_terminal", {
      runId: result.runId,
      outcome: result.duplicate ? "duplicate" : "complete",
      monitorsAttempted: result.attemptedMonitorIds.length
    });
  } finally {
    clearTimeout(timer);
    controller.abort();
    store.close();
  }
}

export async function runCheckerCli(
  options: CheckerCliOptions = {}
): Promise<void> {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? consoleLogger;
  const forceExit = options.forceExit ?? ((code: number) => process.exit(code));
  const setExitCode =
    options.setExitCode ?? ((code: number) => {
      process.exitCode = code;
    });
  const cleanupGraceMs = options.cleanupGraceMs ?? 1_000;
  let keepWatchdog = false;
  const watchdog = setTimeout(() => {
    logger.error("checker_process_force_exit", {
      outcome: "deadline",
      cleanupGraceMs
    });
    forceExit(1);
  }, config.runDeadlineMs + cleanupGraceMs);

  try {
    await executeChecker({
      config,
      logger,
      store: options.store,
      fetcher: options.fetcher,
      now: options.now
    });
  } catch (error) {
    logger.error("checker_process_terminal", {
      outcome: "failed",
      errorType: error instanceof Error ? error.name : "UnknownError"
    });
    setExitCode(1);
    keepWatchdog = error instanceof CheckerDeadlineError;
  } finally {
    if (!keepWatchdog) {
      clearTimeout(watchdog);
    }
  }
}

if (import.meta.main) {
  void runCheckerCli().catch((error: unknown) => {
    consoleLogger.error("checker_process_terminal", {
      outcome: "failed",
      errorType: error instanceof Error ? error.name : "UnknownError"
    });
    process.exitCode = 1;
  });
}
