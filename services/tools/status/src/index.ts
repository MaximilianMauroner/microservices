import type { CheckerStore } from "./bucket.js";
import { createPostgresCheckerStore } from "./postgres-store.js";
import { loadConfig, type CheckerConfig } from "./config.js";
import { consoleLogger, type SafeLogger } from "./logger.js";
import { runChecker } from "./run.js";
import { loadMonitorDefinitions } from "./definitions.js";
import type { MonitorDefinition } from "./definitions.js";

export { loadMonitorDefinitions } from "./definitions.js";
export { createHeartbeats, InvalidHeartbeatTokenError, UnknownHeartbeatMonitorError } from "./heartbeats.js";
export { createPostgresHeartbeatRepository } from "./heartbeat-repository.js";

export interface ExecuteOptions {
  config?: CheckerConfig;
  logger?: SafeLogger;
  store?: CheckerStore;
  fetcher?: typeof fetch;
  now?: () => Date;
  monitorDefinitions?: readonly MonitorDefinition[];
  settlementGraceMs?: number;
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
  const store = options.store ?? createPostgresCheckerStore(config);
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
  const run = runChecker({
    store,
    config,
    logger,
    fetcher: options.fetcher,
    now: options.now,
    signal: controller.signal,
    monitorDefinitions: options.monitorDefinitions ?? (options.store ? undefined : loadMonitorDefinitions())
  });
  let settled = false;
  const settlement = run.then(
    () => { settled = true; },
    () => { settled = true; }
  );
  try {
    const result = await Promise.race([
      run,
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
    if (!settled) {
      await waitForSettlement(settlement, options.settlementGraceMs ?? 1_000);
    }
    await store.close();
  }
}

async function waitForSettlement(settlement: Promise<void>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      settlement,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, milliseconds); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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
      now: options.now,
      monitorDefinitions: options.monitorDefinitions,
      settlementGraceMs: options.settlementGraceMs ?? Math.max(1, Math.floor(cleanupGraceMs / 2))
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
