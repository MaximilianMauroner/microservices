import { createFetchApp, createS3UploadStorage, ActivityTracker } from "@tools-platform/artifact-publisher";
import { createApp as createFieldGuideApp } from "@tools-platform/field-guide/app";
import { agentAuth } from "@tools-platform/field-guide/auth";
import { createRepository } from "@tools-platform/field-guide/repository";
import reviewStylesheet from "../../../packages/field-guide-console/public/review.css?raw";
import {
  createApp as createToolsApp,
  createMarkdownAdminClient,
  createS3JsonBucket,
  WebStorage
} from "@tools-platform/web";
import { createAccessVerifier } from "@tools-platform/security";
import { executeChecker } from "@tools-platform/tools-checker";
import type { PublicSnapshotDocument } from "@tools-platform/domain";
import { accessAuthentication, contextAwareAccessVerifier, type PlatformAccess, type PlatformServices } from "./app.js";
import { loadPlatformConfig } from "./config.js";
import { startAlignedScheduler } from "./scheduler.js";
import { createTowerHeartbeat, type TowerHeartbeat } from "./tower-heartbeat.js";
import { PLATFORM_UI_BUILD } from "./build-identity.js";
import { createMoneyTracker } from "./features/money/money-tracker.js";

export type PlatformRuntime = {
  publicOrigin: string;
  readOnly: boolean;
  localAuth: boolean;
  access: PlatformAccess;
  services: PlatformServices;
  publicSnapshot: () => Promise<PublicSnapshotDocument>;
  health: () => Promise<void>;
  towerHeartbeat: TowerHeartbeat;
  moneyTracker: ReturnType<typeof createMoneyTracker>;
  stop: () => Promise<void>;
};

let runtimePromise: Promise<PlatformRuntime> | undefined;

export function getPlatformRuntime(): Promise<PlatformRuntime> {
  runtimePromise ??= createPlatformRuntime();
  return runtimePromise;
}

async function createPlatformRuntime(): Promise<PlatformRuntime> {
  const config = loadPlatformConfig();
  const access: PlatformAccess = {
    manage: createAccessVerifier({
      issuer: config.access.issuer,
      jwksUrl: config.access.jwksUrl,
      audience: config.access.audience.manage
    }),
    publisher: createAccessVerifier({
      issuer: config.access.issuer,
      jwksUrl: config.access.jwksUrl,
      audience: config.access.audience.publisher
    }),
    review: createAccessVerifier({
      issuer: config.access.issuer,
      jwksUrl: config.access.jwksUrl,
      audience: config.access.audience.review
    })
  };
  const toolsBucket = createS3JsonBucket(config.tools.bucket);
  const toolsStorage = new WebStorage(toolsBucket);
  const towerHeartbeat = createTowerHeartbeat({
    bucket: toolsBucket,
    token: config.towerHeartbeatToken,
    staleAfterMs: config.towerHeartbeatStaleAfterMs
  });
  const markdownAdmin = createMarkdownAdminClient({
    endpoint: config.markdownShare.adminEndpoint,
    token: config.markdownShare.adminToken
  });
  const artifactStorage = createS3UploadStorage(config.artifact.s3);
  const activityTracker = new ActivityTracker();
  const moneyTracker = createMoneyTracker(config.moneyTracker);
  const fieldGuideHandle = await createRepository(config.fieldGuide, {
    readOnly: config.readOnly
  });

  try {
    const toolsAccess = contextAwareAccessVerifier(access.manage);
    const reviewAccess = contextAwareAccessVerifier(access.review);
    const tools = createToolsApp({
      storage: toolsStorage,
      access: toolsAccess,
      markdownAdmin,
      markdownSharePublicOrigin: config.markdownShare.publicOrigin,
      trustedOrigin: config.publicOrigin
    });
    const fieldGuide = createFieldGuideApp({
      repository: fieldGuideHandle.repository,
      agentAuth: agentAuth(config.fieldGuide.agentApiToken),
      reviewerAuth: accessAuthentication(reviewAccess),
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
      maxUploadBytes: config.artifact.maxUploadBytes,
      maxHtmlUploadBytes: config.artifact.maxHtmlUploadBytes,
      maxConcurrentUploads: config.artifact.maxConcurrentUploads,
      temporaryFileRetentionMs: config.artifact.temporaryFileRetentionMs
    });

    const checker = config.readOnly
      ? undefined
      : startAlignedScheduler({
          intervalMs: config.checkerIntervalMs,
          run: () => executeChecker({ config: config.checker }),
          logger: {
            info: (event, fields = {}) => console.info(JSON.stringify({ event, ...fields })),
            error: (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }))
          }
        });
    const cleanup = config.readOnly
      ? undefined
      : startArtifactCleanup(
          artifactStorage,
          config.artifact.temporaryFileCleanupIntervalMs
        );
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
      checker?.stop();
      cleanup?.stop();
      await Promise.all([
        checker?.wait() ?? Promise.resolve(),
        cleanup?.wait() ?? Promise.resolve(),
        activityTracker.waitForIdle(),
        ...Object.values(services).map((service) => service.close())
      ]);
    };

    if (fieldGuideHandle.startupReport) {
      console.info(JSON.stringify({ event: "postgres_import", ...fieldGuideHandle.startupReport }));
    }
    console.info(JSON.stringify({
      event: "platform.runtime_ready",
      origin: config.publicOrigin,
      readOnly: config.readOnly,
      localAuth: config.localAuth,
      uiBuild: PLATFORM_UI_BUILD
    }));

    return {
      publicOrigin: config.publicOrigin,
      readOnly: config.readOnly,
      localAuth: config.localAuth,
      access,
      services,
      publicSnapshot: () => toolsStorage.readPublicSnapshot(),
      towerHeartbeat,
      moneyTracker,
      health: async () => {
        await Promise.all(Object.values(services).map((service) => service.readiness()));
      },
      stop
    };
  } catch (error) {
    await fieldGuideHandle.close();
    artifactStorage.close?.();
    throw error;
  }
}

function startArtifactCleanup(
  storage: ReturnType<typeof createS3UploadStorage>,
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
