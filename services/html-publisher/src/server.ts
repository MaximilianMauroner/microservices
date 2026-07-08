import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createS3UploadStorage, type UploadStorage } from "./storage.js";

const config = loadConfig();
const storage = createS3UploadStorage(config.s3);
const app = createApp({
  storage,
  uploadToken: config.uploadToken,
  publicBaseUrl: config.publicBaseUrl,
  maxUploadBytes: config.maxUploadBytes,
  temporaryFileRetentionMs: config.temporaryFileRetentionMs
});
const cleanup = startTemporaryFileCleanup(storage, {
  intervalMs: config.temporaryFileCleanupIntervalMs,
  retentionMs: config.temporaryFileRetentionMs
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`html-publisher listening on port ${config.port}`);
});

process.once("SIGINT", () => {
  cleanup.stop();
  process.exit(0);
});

process.once("SIGTERM", () => {
  cleanup.stop();
  process.exit(0);
});

type CleanupOptions = {
  intervalMs: number;
  retentionMs: number;
};

function startTemporaryFileCleanup(storage: UploadStorage, options: CleanupOptions) {
  const run = async () => {
    try {
      const cutoff = new Date(Date.now() - options.retentionMs);
      const deleted = await storage.deleteExpiredTemporaryFiles(cutoff);
      if (deleted > 0) {
        console.log(`deleted ${deleted} expired temporary upload(s)`);
      }
    } catch (error) {
      console.error("temporary upload cleanup failed", error);
    }
  };

  void run();
  const timer = setInterval(() => {
    void run();
  }, options.intervalMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    }
  };
}
