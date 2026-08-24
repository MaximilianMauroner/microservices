import { runCheckerCli } from "./index.js";
import { consoleLogger } from "./logger.js";

void runCheckerCli().catch((error: unknown) => {
  consoleLogger.error("checker_process_terminal", {
    outcome: "failed",
    errorType: error instanceof Error ? error.name : "UnknownError"
  });
  process.exitCode = 1;
});
