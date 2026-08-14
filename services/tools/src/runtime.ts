import { randomUUID } from "node:crypto";
import { createFetchApp, createPostgresUploadStorage, ActivityTracker } from "@tools-platform/artifact-publisher";
import { createApp as createFieldGuideApp } from "@tools-platform/field-guide/app";
import { agentAuth } from "@tools-platform/field-guide/auth";
import { createRepository } from "@tools-platform/field-guide/repository";
import reviewStylesheet from "../../../services/tools/field-guide/public/review.css?raw";
import {
  createApp as createToolsApp,
  createMarkdownAdminClient,
  createS3JsonBucket,
  WebStorage
} from "@tools-platform/web";
import { createHeartbeats, createPostgresHeartbeatRepository, loadMonitorDefinitions } from "@tools-platform/tools-checker";
import type { PublicSnapshotDocument } from "@tools-platform/domain";
import {
  reviewerAuthentication,
  toolsPrincipalAuthentication,
  type PlatformServices,
  type PrincipalResolver
} from "./app.js";
import { loadPlatformConfig } from "./config.js";
import { startAlignedScheduler } from "./scheduler.js";
import { createPostgresScheduledTaskLeaseRepository } from "./scheduled-task-leases.js";
import { PLATFORM_UI_BUILD } from "./build-identity.js";
import { favicons } from "./favicons.js";
import { MoneyImportService } from "../money/money-import-service.js";
import { createPostgresMoneyRepository } from "../money/money-repository.js";
import { MoneyMarketDataService } from "../money/money-market-data-service.js";
import { createPostgresMoneyMarketDataRepository } from "../money/money-market-data-repository.js";
import {
  createPlatformAuth,
  resolvePlatformPrincipal,
  type PlatformAuth
} from "./lib/auth.js";

export type PlatformRuntime = {
  publicOrigin: string;
  readOnly: boolean;
  auth: PlatformAuth;
  resolvePrincipal: PrincipalResolver;
  services: PlatformServices;
  publicSnapshot: () => Promise<PublicSnapshotDocument>;
  health: () => Promise<void>;
  heartbeats: ReturnType<typeof createHeartbeats>;
  moneyImports: MoneyImportService;
  moneyMarketData: MoneyMarketDataService;
  stop: () => Promise<void>;
};

let runtimePromise: Promise<PlatformRuntime> | undefined;

export function getPlatformRuntime(): Promise<PlatformRuntime> {
  runtimePromise ??= createPlatformRuntime();
  return runtimePromise;
}

/** Releases every long-lived resource owned by the current server runtime. */
export async function closePlatformRuntime(): Promise<void> {
  const current = runtimePromise;
  runtimePromise = undefined;
  if (current) await (await current).stop();
}

// Vite replaces server modules during development without terminating Node.
// Dispose the previous runtime so its Postgres pools do not survive each edit.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void closePlatformRuntime().catch((error: unknown) => {
      console.error(JSON.stringify({
        event: "platform.hmr_cleanup_failed",
        errorType: error instanceof Error ? error.name : "UnknownError"
      }));
    });
  });
}

async function createPlatformRuntime(): Promise<PlatformRuntime> {
  const config = loadPlatformConfig();
  const auth = createPlatformAuth(config.auth);
  const resolvePrincipal: PrincipalResolver = (request) =>
    resolvePlatformPrincipal(
      auth,
      request,
      config.auth.allowedGoogleSubject,
      config.auth.allowedGoogleEmail
    );
  const toolsBucket = createS3JsonBucket(config.tools.bucket);
  const toolsStorage = new WebStorage(toolsBucket);
  const heartbeatRepository = createPostgresHeartbeatRepository(config.databaseUrl);
  const heartbeats = createHeartbeats({
    definitions: loadMonitorDefinitions().filter((definition) => definition.kind === "heartbeat"),
    repository: heartbeatRepository,
    token: config.towerHeartbeatToken
  });
  const markdownAdmin = createMarkdownAdminClient({
    endpoint: config.markdownShare.adminEndpoint,
    token: config.markdownShare.adminToken
  });
  const artifactStorage = createPostgresUploadStorage(config.artifact.s3, config.databaseUrl);
  const activityTracker = new ActivityTracker();
  const moneyImports = new MoneyImportService(createPostgresMoneyRepository(config.databaseUrl, { readOnly: config.readOnly }));
  const moneyMarketData = new MoneyMarketDataService(createPostgresMoneyMarketDataRepository(config.databaseUrl, { readOnly: config.readOnly }));
  const fieldGuideHandle = await createRepository(config.fieldGuide, {
    readOnly: config.readOnly
  });

  try {
    const tools = createToolsApp({
      storage: toolsStorage,
      authenticate: toolsPrincipalAuthentication(),
      markdownAdmin,
      markdownSharePublicOrigin: config.markdownShare.publicOrigin,
      trustedOrigin: config.publicOrigin
    });
    const fieldGuide = createFieldGuideApp({
      repository: fieldGuideHandle.repository,
      agentAuth: agentAuth(config.fieldGuide.agentApiToken),
      reviewerAuth: reviewerAuthentication,
      publicBaseUrl: config.publicOrigin,
      stylesheet: reviewStylesheet,
      decisionRecordArchiveDays: config.fieldGuide.decisionRecordArchiveDays
    });
    const artifact = createFetchApp({
      activityTracker,
      storage: artifactStorage,
      uploadToken: config.artifact.uploadToken,
      externalUpload: true,
      publicBaseUrl: config.publicOrigin,
      publisherFaviconUrl: favicons.publisher,
      maxUploadBytes: config.artifact.maxUploadBytes,
      maxHtmlUploadBytes: config.artifact.maxHtmlUploadBytes,
      maxConcurrentUploads: config.artifact.maxConcurrentUploads,
      temporaryFileRetentionMs: config.artifact.temporaryFileRetentionMs
    });

    const cleanup = config.readOnly
      ? undefined
      : startArtifactCleanup(
          artifactStorage,
          config.artifact.temporaryFileCleanupIntervalMs
        );
    const marketDataScheduler = config.readOnly
      ? undefined
      : startAlignedScheduler({
          intervalMs: 86_400_000,
          phaseOffsetMs: 3 * 3_600_000 + 15 * 60_000,
          lease: {
            repository: createPostgresScheduledTaskLeaseRepository(config.databaseUrl),
            taskId: "money-market-data:daily",
            ownerId: randomUUID(),
            durationMs: 30 * 60_000
          },
          run: async () => {
            const result = await moneyMarketData.sync();
            console.info(JSON.stringify({ event: "money.market_data.synced", ...result }));
          },
          logger: {
            info: (event, fields = {}) => console.info(JSON.stringify({ event, task: "money-market-data", ...fields })),
            error: (event, fields = {}) => console.error(JSON.stringify({ event, task: "money-market-data", ...fields }))
          }
        });
    let stopped = false;
    const services: PlatformServices = {
      manage: {
        handle: tools,
        readiness: () => toolsStorage.readiness(),
        close: () => {}
      },
      publisher: {
        handle: artifact,
        readiness: async () => { await artifactStorage.listUploads(new Date(), { limit: 1 }); },
        close: () => artifactStorage.close?.()
      },
      review: {
        handle: fieldGuide,
        readiness: async () => { await fieldGuideHandle.repository.summary(new Date()); },
        close: () => fieldGuideHandle.close()
      }
    };
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      cleanup?.stop();
      await Promise.all([
        marketDataScheduler?.close() ?? Promise.resolve(),
        cleanup?.wait() ?? Promise.resolve(),
        activityTracker.waitForIdle(),
        ...Object.values(services).map((service) => service.close()),
        heartbeatRepository.close(),
        moneyImports.close(),
        moneyMarketData.close()
      ]);
    };

    console.info(JSON.stringify({
      event: "platform.runtime_ready",
      origin: config.publicOrigin,
      readOnly: config.readOnly,
      uiBuild: PLATFORM_UI_BUILD
    }));

    return {
      publicOrigin: config.publicOrigin,
      readOnly: config.readOnly,
      auth,
      resolvePrincipal,
      services,
      publicSnapshot: () => toolsStorage.readPublicSnapshot(),
      heartbeats,
      moneyImports,
      moneyMarketData,
      health: async () => {
        await Promise.all([
          ...Object.values(services).map((service) => service.readiness()),
          moneyImports.readiness(),
          moneyMarketData.readiness()
        ]);
      },
      stop
    };
  } catch (error) {
    await fieldGuideHandle.close();
    artifactStorage.close?.();
    await heartbeatRepository.close();
    await moneyImports.close();
    await moneyMarketData.close();
    throw error;
  }
}

function startArtifactCleanup(
  storage: ReturnType<typeof createPostgresUploadStorage>,
  intervalMs: number
) {
  let current: Promise<void> | undefined;
  const run = () => {
    if (current) return;
    current = storage.deleteExpiredTemporaryFiles(new Date()).then(
      (deleted) => {
        if (deleted > 0) console.info(JSON.stringify({ event: "artifact.cleanup", deleted }));
      },
      (error: unknown) => console.error(JSON.stringify({
        event: "artifact.cleanup.failed",
        errorType: error instanceof Error ? error.name : "UnknownError"
      }))
    ).finally(() => {
      current = undefined;
    });
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return {
    stop: () => clearInterval(timer),
    wait: () => current ?? Promise.resolve()
  };
}
