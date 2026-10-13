import { randomUUID } from "node:crypto";
import { createPostgresUploadStorage, loadConfig as loadArtifactConfig } from "@tools-platform/artifact-publisher";
import { MoneyMarketDataService } from "../money/money-market-data-service.js";
import { createPostgresMoneyMarketDataRepository } from "../money/money-market-data-repository.js";
import { createPostgresScheduledTaskLeaseRepository } from "./scheduled-task-leases.js";
import { MAINTENANCE_DEADLINE_MS, runDueMaintenance } from "./maintenance.js";

// This process owns no HTTP listener, web runtime, auth client, or recurring timer.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const artifactConfig = loadArtifactConfig({
  ...process.env,
  PUBLIC_BASE_URL: process.env.PUBLIC_ORIGIN,
  S3_BUCKET: process.env.ARTIFACT_S3_BUCKET,
  S3_ENDPOINT: process.env.ARTIFACT_S3_ENDPOINT,
  S3_REGION: process.env.ARTIFACT_S3_REGION,
  S3_ACCESS_KEY_ID: process.env.ARTIFACT_S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.ARTIFACT_S3_SECRET_ACCESS_KEY,
  S3_FORCE_PATH_STYLE: process.env.ARTIFACT_S3_FORCE_PATH_STYLE
});
const storage = createPostgresUploadStorage(artifactConfig.s3, databaseUrl);
const marketData = new MoneyMarketDataService(createPostgresMoneyMarketDataRepository(databaseUrl));
const repository = createPostgresScheduledTaskLeaseRepository(databaseUrl);
const controller = new AbortController();
const log = (event: string, fields: Record<string, string> = {}) => console.info(JSON.stringify({ event, ...fields }));
let force: ReturnType<typeof setTimeout> | undefined;
const interrupt = () => {
  controller.abort();
  force ??= setTimeout(() => process.exit(1), 5_000);
};
process.once("SIGTERM", interrupt);
process.once("SIGINT", interrupt);
// A hard bound ends uncooperative storage/provider calls before the durable lease can expire.
const deadline = setTimeout(interrupt, MAINTENANCE_DEADLINE_MS);
log("maintenance.process_started");
try {
  await runDueMaintenance({
    repository,
    ownerId: randomUUID(),
    signal: controller.signal,
    log,
    tasks: [
      {
        id: "artifact-cleanup:hourly",
        intervalMs: 3_600_000,
        run: async () => {
          const deleted = await storage.deleteExpiredTemporaryFiles(new Date());
          log("artifact.cleanup", { deleted: String(deleted) });
        }
      },
      {
        id: "money-market-data:daily",
        intervalMs: 86_400_000,
        phaseOffsetMs: 3 * 3_600_000 + 15 * 60_000,
        run: async () => {
          const result = await marketData.sync();
          log("money.market_data.synced", { succeeded: String(result.succeeded), failed: String(result.failed) });
          if (result.failed > 0) throw new Error("Market data targets failed");
        }
      }
    ]
  });
  log("maintenance.process_terminal", { outcome: "complete" });
} catch (error) {
  log("maintenance.process_terminal", { outcome: "failed", errorType: error instanceof Error ? error.name : "UnknownError" });
  process.exitCode = 1;
} finally {
  force ??= setTimeout(() => process.exit(1), 5_000);
  await Promise.all([storage.close?.(), marketData.close(), repository.close()]);
  clearTimeout(deadline);
  clearTimeout(force);
}
