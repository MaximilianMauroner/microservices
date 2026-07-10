import { createApp } from "./app.js";
import { ActivityTracker } from "./activity-tracker.js";
import { loadConfig } from "./config.js";
import { createS3UploadStorage, type UploadStorage } from "./storage.js";

const config = loadConfig();
const storage = createS3UploadStorage(config.s3);
const activityTracker = new ActivityTracker();
const app = createApp({
  activityTracker,
  storage,
  uploadToken: config.uploadToken,
  publicBaseUrl: config.publicBaseUrl,
  maxUploadBytes: config.maxUploadBytes,
  maxHtmlUploadBytes: config.maxHtmlUploadBytes,
  maxConcurrentUploads: config.maxConcurrentUploads,
  temporaryFileRetentionMs: config.temporaryFileRetentionMs
});
const cleanup = startTemporaryFileCleanup(storage, {
  intervalMs: config.temporaryFileCleanupIntervalMs
});

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`html-publisher listening on port ${config.port}`);
});

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

type CleanupOptions = {
  intervalMs: number;
};

function startTemporaryFileCleanup(storage: UploadStorage, options: CleanupOptions) {
  let currentRun: Promise<void> | null = null;

  const run = () => {
    if (currentRun) {
      return currentRun;
    }

    const runPromise = (async () => {
      try {
        const deleted = await storage.deleteExpiredTemporaryFiles(new Date());
        if (deleted > 0) {
          console.log(`deleted ${deleted} expired temporary upload(s)`);
        }
      } catch (error) {
        console.error("temporary upload cleanup failed", error);
      }
    })();
    currentRun = runPromise;
    void runPromise.finally(() => {
      if (currentRun === runPromise) {
        currentRun = null;
      }
    });
    return runPromise;
  };

  void run();
  const timer = setInterval(() => {
    void run();
  }, options.intervalMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
    wait() {
      return currentRun ?? Promise.resolve();
    }
  };
}

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  cleanup.stop();
  console.log(`received ${signal}; draining active requests`);

  const forceShutdown = setTimeout(() => {
    console.error("graceful shutdown timed out; closing active connections");
    server.closeAllConnections();
    storage.close?.();
    process.exit(1);
  }, 10_000);
  forceShutdown.unref();

  server.close((error) => {
    void Promise.all([activityTracker.waitForIdle(), cleanup.wait()]).then(() => {
      clearTimeout(forceShutdown);
      storage.close?.();
      if (error) {
        console.error("server shutdown failed", error);
        process.exitCode = 1;
      }
    });
  });
}
