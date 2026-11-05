import { createDocumentShare } from "../products/documents/service.js";
import { randomUUID } from "node:crypto";
import { createFetchApp, createPostgresUploadLinkRepository, createPostgresUploadStorage, ActivityTracker } from "#publisher";
import {
  createApp as createToolsApp,
  createS3JsonBucket,
  WebStorage
} from "#dashboard";
import { createHeartbeats, createPostgresHeartbeatRepository, loadMonitorDefinitions } from "#status";
import type { PublicSnapshotDocument } from "#domain";
import {
  toolsPrincipalAuthentication,
  type PlatformServices,
  type PrincipalResolver
} from "../platform/gateway.js";
import { loadPlatformConfig } from "../platform/config.js";
import { retryTransientOperation } from "../platform/response-retry.js";
import { startAlignedScheduler } from "../platform/scheduler/scheduler.js";
import { createPostgresScheduledTaskLeaseRepository } from "../platform/scheduler/leases.js";
import { PLATFORM_UI_BUILD } from "./build-identity.js";
import { favicons } from "../platform/ui/favicons.js";
import { MoneyImportService } from "../products/money/money-import-service.js";
import { createPostgresMoneyRepository } from "../products/money/money-repository.js";
import { MoneyMarketDataService } from "../products/money/money-market-data-service.js";
import { createPostgresMoneyMarketDataRepository } from "../products/money/money-market-data-repository.js";
import { createPostgresFeedbackRepository, type FeedbackRepository } from "../products/feedback/repository.js";
import { createPostgresDevFeedbackRepository, type DevFeedbackRepository } from "../platform/dev-feedback/dev-feedback.js";
import { createPostgresKitchenStore, type KitchenStore } from "../products/kitchen/repository.js";
import { type BodyshopStore, createPostgresBodyshopStore } from "../products/bodyshop/repository.js";
import { createPlatformIdentity, type PlatformIdentity } from "../platform/auth/auth.js";

export type PlatformRuntime = {
  publicOrigin: string;
  artifactUploadOrigins: readonly string[];
  readOnly: boolean;
  auth: PlatformIdentity["auth"];
  people: PlatformIdentity["people"];
  resolvePrincipal: PrincipalResolver;
  resolveAccessToken: PrincipalResolver;
  resolveAppToken: PlatformIdentity["resolveAppToken"];
  services: PlatformServices;
  publicSnapshot: () => Promise<PublicSnapshotDocument>;
  health: () => Promise<void>;
  heartbeats: ReturnType<typeof createHeartbeats>;
  moneyImports: MoneyImportService;
  moneyMarketData: MoneyMarketDataService;
  feedback: FeedbackRepository;
  devFeedback: DevFeedbackRepository;
  kitchen: KitchenStore;
  bodyshop: BodyshopStore;
  documentShare: ReturnType<typeof createDocumentShare>;
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
  const identity = createPlatformIdentity(config.auth, config.databaseUrl);
  const toolsBucket = createS3JsonBucket(config.tools.bucket);
  const toolsStorage = new WebStorage(toolsBucket);
  const heartbeatRepository = createPostgresHeartbeatRepository(config.databaseUrl);
  const heartbeats = createHeartbeats({
    definitions: loadMonitorDefinitions().filter((definition) => definition.kind === "heartbeat"),
    repository: heartbeatRepository,
    token: config.towerHeartbeatToken
  });
  const documentShare = createDocumentShare(config.databaseUrl, config.publicOrigin, config.readOnly,
    async (request) => (await identity.resolvePrincipal(request))?.subject ?? config.auth.allowedGoogleSubject);
  const artifactStorage = createPostgresUploadStorage(config.artifact.s3, config.databaseUrl);
  const uploadLinks = createPostgresUploadLinkRepository(config.databaseUrl);
  const activityTracker = new ActivityTracker();
  const moneyImports = new MoneyImportService(createPostgresMoneyRepository(config.databaseUrl, { readOnly: config.readOnly }));
  const moneyMarketData = new MoneyMarketDataService(createPostgresMoneyMarketDataRepository(config.databaseUrl, { readOnly: config.readOnly }));
  const feedback = createPostgresFeedbackRepository(config.databaseUrl, { readOnly: config.readOnly, encryptionKey: config.feedbackEncryptionKey });
  const kitchen = createPostgresKitchenStore(config.databaseUrl, { readOnly: config.readOnly });
  const bodyshop = createPostgresBodyshopStore(config.databaseUrl, { readOnly: config.readOnly, encryptionKey: config.bodyshopEncryptionKey });
  const devFeedback = createPostgresDevFeedbackRepository(config.databaseUrl, { readOnly: config.readOnly });
  try {
    const tools = createToolsApp({
      storage: toolsStorage,
      authenticate: toolsPrincipalAuthentication(),
      trustedOrigin: config.publicOrigin
    });
    const artifact = createFetchApp({
      activityTracker,
      storage: artifactStorage,
      uploadToken: config.artifact.uploadToken,
      adminSubject: config.auth.allowedGoogleSubject,
      externalUpload: true,
      browserPersistentUpload: true,
      uploadLinks,
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
        readiness: async () => {
          await Promise.all([
            artifactStorage.owner(config.auth.allowedGoogleSubject).listUploads(new Date(), { limit: 1 }),
            uploadLinks.readiness?.()
          ]);
        },
        close: async () => {
          await Promise.all([artifactStorage.close?.(), uploadLinks.close?.()]);
        }
      }
    };
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      cleanup?.stop();
      await Promise.all([
        marketDataScheduler?.close() ?? Promise.resolve(),
        cleanup?.wait() ?? Promise.resolve(),
        activityTracker.waitForIdle()
      ]);
      await Promise.all([
        ...Object.values(services).map((service) => service.close()),
        heartbeatRepository.close(),
        moneyImports.close(),
        moneyMarketData.close(),
        feedback.close(),
        devFeedback.close(),
        kitchen.close(),
        bodyshop.close(),
        documentShare.close(),
        identity.close()
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
      artifactUploadOrigins: artifactStorage.uploadOrigins ?? [],
      readOnly: config.readOnly,
      auth: identity.auth,
      people: identity.people,
      resolvePrincipal: identity.resolvePrincipal,
      resolveAccessToken: identity.resolveAccessToken,
      resolveAppToken: identity.resolveAppToken,
      services,
      publicSnapshot: () => toolsStorage.readPublicSnapshot(),
      heartbeats,
      moneyImports,
      moneyMarketData,
      feedback,
      devFeedback,
      kitchen,
      bodyshop,
      documentShare,
      health: async () => {
        await Promise.all([
          ...Object.values(services).map((service) => service.readiness()),
          moneyImports.readiness(),
          moneyMarketData.readiness(),
          feedback.readiness(),
          kitchen.readiness(),
          bodyshop.readiness(),
          documentShare.readiness()
        ]);
      },
      stop
    };
  } catch (error) {
    artifactStorage.close?.();
    uploadLinks.close?.();
    await heartbeatRepository.close();
    await moneyImports.close();
    await moneyMarketData.close();
    await feedback.close();
    await kitchen.close();
    await bodyshop.close();
    await documentShare.close();
    await identity.close();
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
    current = retryTransientOperation(() => storage.deleteExpiredTemporaryFiles(new Date())).then(
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
