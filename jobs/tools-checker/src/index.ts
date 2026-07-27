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

export async function executeChecker(
  options: ExecuteOptions = {}
): Promise<void> {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? consoleLogger;
  const store = options.store ?? createS3CheckerStore(config.bucket);
  logger.info("checker_process_started", {
    environment: config.environment
  });
  try {
    const result = await runChecker({
      store,
      config,
      logger,
      fetcher: options.fetcher,
      now: options.now
    });
    logger.info("checker_process_terminal", {
      runId: result.runId,
      outcome: result.duplicate ? "duplicate" : "complete",
      monitorsAttempted: result.attemptedMonitorIds.length
    });
  } finally {
    store.close();
  }
}

if (import.meta.main) {
  void executeChecker().catch((error: unknown) => {
    consoleLogger.error("checker_process_terminal", {
      outcome: "failed",
      errorType: error instanceof Error ? error.name : "UnknownError"
    });
    process.exitCode = 1;
  });
}
