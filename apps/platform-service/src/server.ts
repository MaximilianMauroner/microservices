import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createApp as createArtifactApp } from "../../artifact-publisher/src/app.ts";
import { ActivityTracker } from "../../artifact-publisher/src/activity-tracker.ts";
import { createS3UploadStorage } from "../../artifact-publisher/src/storage.ts";
import { createApp as createFieldGuideApp } from "../../field-guide-console/src/app.ts";
import { createRepository } from "../../field-guide-console/src/repository.ts";
import { createApp as createToolsApp } from "../../tools-web/src/app.ts";
import { createAccessVerifier } from "../../tools-web/src/auth.ts";
import { createS3JsonBucket } from "../../tools-web/src/bucket.ts";
import { createMarkdownAdminClient } from "../../tools-web/src/markdown-admin.ts";
import { WebStorage } from "../../tools-web/src/storage.ts";
import { executeChecker } from "../../../jobs/tools-checker/src/index.ts";
import { createPlatformApp, accessAuthentication } from "./app.ts";
import { loadPlatformConfig } from "./config.ts";
import { startAlignedScheduler } from "./scheduler.ts";
import { createTowerHeartbeat } from "./tower-heartbeat.ts";

const config = loadPlatformConfig();
const access = {
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
const fieldGuideHandle = await createRepository(config.fieldGuide);
const stylesheet = await readFile(
  new URL("../../field-guide-console/public/review.css", import.meta.url)
);

const tools = createToolsApp({
  storage: toolsStorage,
  access: access.manage,
  markdownAdmin,
  markdownSharePublicOrigin: config.markdownShare.publicOrigin,
  trustedOrigin: config.publicOrigin
});
const fieldGuide = createFieldGuideApp({
  repository: fieldGuideHandle.repository,
  agentAuth: (await import("../../field-guide-console/src/auth.ts")).agentAuth(
    config.fieldGuide.agentApiToken
  ),
  reviewerAuth: accessAuthentication(access.review),
  publicBaseUrl: config.publicOrigin,
  stylesheet,
  decisionRecordArchiveDays: config.fieldGuide.decisionRecordArchiveDays
});
const artifact = createArtifactApp({
  activityTracker,
  storage: artifactStorage,
  uploadToken: config.artifact.uploadToken,
  externalUpload: {
    auth: (_request, _response, next) => next()
  },
  publicBaseUrl: config.publicOrigin,
  maxUploadBytes: config.artifact.maxUploadBytes,
  maxHtmlUploadBytes: config.artifact.maxHtmlUploadBytes,
  maxConcurrentUploads: config.artifact.maxConcurrentUploads,
  temporaryFileRetentionMs: config.artifact.temporaryFileRetentionMs
});

const app = createPlatformApp({
  access,
  artifact,
  fieldGuide,
  tools,
  towerHeartbeat,
  publicOrigin: config.publicOrigin,
  componentHealth: {
    tools: () => toolsStorage.readiness(),
    publisher: async () => {
      await artifactStorage.listUploads(new Date(), { limit: 1 });
    },
    review: async () => {
      await fieldGuideHandle.repository.summary(new Date());
    }
  },
  health: async () => {
    await Promise.all([
      toolsStorage.readiness(),
      artifactStorage.listUploads(new Date(), { limit: 1 }),
      fieldGuideHandle.repository.summary(new Date())
    ]);
  }
});

const checker = startAlignedScheduler({
  intervalMs: config.checkerIntervalMs,
  run: () => executeChecker({ config: config.checker }),
  logger: {
    info: (event, fields = {}) => console.info(JSON.stringify({ event, ...fields })),
    error: (event, fields = {}) => console.error(JSON.stringify({ event, ...fields }))
  }
});
const cleanup = startArtifactCleanup();
const server = app.listen(config.port, "0.0.0.0", () => {
  console.info(JSON.stringify({
    event: "platform.started",
    port: config.port,
    origin: config.publicOrigin
  }));
});

process.once("SIGINT", () => void shutdown(server, "SIGINT"));
process.once("SIGTERM", () => void shutdown(server, "SIGTERM"));

function startArtifactCleanup() {
  let current: Promise<void> | undefined;
  const run = () => {
    if (current) return;
    current = artifactStorage.deleteExpiredTemporaryFiles(new Date()).then(
      (deleted) => {
        if (deleted > 0) {
          console.info(JSON.stringify({ event: "artifact.cleanup", deleted }));
        }
      },
      (error: unknown) => {
        console.error(JSON.stringify({
          event: "artifact.cleanup.failed",
          errorType: error instanceof Error ? error.name : "UnknownError"
        }));
      }
    ).finally(() => {
      current = undefined;
    });
  };
  run();
  const timer = setInterval(run, config.artifact.temporaryFileCleanupIntervalMs);
  timer.unref();
  return {
    stop: () => clearInterval(timer),
    wait: () => current ?? Promise.resolve()
  };
}

let shuttingDown = false;
async function shutdown(serverHandle: Server, signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  checker.stop();
  cleanup.stop();
  console.info(JSON.stringify({ event: "platform.stopping", signal }));
  const force = setTimeout(() => {
    serverHandle.closeAllConnections();
    process.exit(1);
  }, 15_000);
  force.unref();
  serverHandle.close();
  await Promise.all([
    checker.wait(),
    cleanup.wait(),
    activityTracker.waitForIdle(),
    fieldGuideHandle.close()
  ]);
  artifactStorage.close?.();
  clearTimeout(force);
}
