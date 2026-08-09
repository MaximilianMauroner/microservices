import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BUCKET_KEYS,
  CHECKER_STATE_SCHEMA_VERSION,
  decodeCatalogDocument,
  projectPrivateSnapshot,
  projectPublicSnapshot,
  type CatalogDocument
} from "@tools-platform/domain";
import type { CheckerStateDocument } from "@tools-platform/domain";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

interface BucketConfig {
  name: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

const PLATFORM_BROWSER_ORIGIN = env(
  "LOCAL_PLATFORM_BROWSER_ORIGIN",
  "http://localhost:3000"
);
const MARKDOWN_PUBLIC_ORIGIN = env(
  "LOCAL_MARKDOWN_PUBLIC_ORIGIN",
  "http://localhost:8787"
);
const TOOLS_HOST = "tools.mauroner.net";
const MARKDOWN_HOST = "markdown-share-alpha.mauroner.workers.dev";

const toolsBucket = loadBucketConfig("TOOLS");
const artifactBucket = loadBucketConfig("ARTIFACT");
const retryAttempts = Math.max(1, integer(process.env.SEED_RETRY_ATTEMPTS, 30));
const overwrite = process.env.SEED_OVERWRITE === "true";
const catalogPath = env(
  "SEED_CATALOG_PATH",
  path.join(
    import.meta.dirname,
    "../../dashboard/config/initial-catalog.json"
  )
);

const toolsClient = createClient(toolsBucket);
const artifactClient = createClient(artifactBucket);

await runSeed();

async function runSeed() {
  const rawCatalog = await readFile(catalogPath, "utf8");
  const catalog = localizeCatalog(
    decodeCatalogDocument(JSON.parse(rawCatalog))
  );
  const now = new Date().toISOString();

  await ensureBucket(toolsClient, toolsBucket.name);
  await ensureBucket(artifactClient, artifactBucket.name);

  await putSeedObject(
    toolsClient,
    toolsBucket.name,
    BUCKET_KEYS.catalog,
    JSON.stringify(catalog, null, 2)
  );

  const initialState: CheckerStateDocument = {
    schemaVersion: CHECKER_STATE_SCHEMA_VERSION,
    revision: "seed-local",
    updatedAt: now,
    lastRunId: null,
    monitors: {},
    incidents: [],
    notifications: [],
    historyPending: []
  };
  const publicSnapshot = projectPublicSnapshot(catalog, initialState, now);
  const privateSnapshot = projectPrivateSnapshot(catalog, initialState, now);
  await putSeedObject(
    toolsClient,
    toolsBucket.name,
    BUCKET_KEYS.publicSnapshot,
    JSON.stringify(publicSnapshot, null, 2)
  );
  await putSeedObject(
    toolsClient,
    toolsBucket.name,
    BUCKET_KEYS.privateSnapshot,
    JSON.stringify(privateSnapshot, null, 2)
  );

  console.info(JSON.stringify({ event: "local.seed_complete", catalog: catalog.revision }));
}

function localizeCatalog(catalog: CatalogDocument): CatalogDocument {
  const now = new Date().toISOString();
  return {
    ...catalog,
    revision: `${catalog.revision}-local`,
    updatedAt: now,
    entries: catalog.entries.map((entry) => {
      const monitorUrl = entry.monitor?.url ?? "";
      return {
        ...entry,
        links: entry.links.map((link) => ({
          ...link,
          url: localizeLinkUrl(link.url)
        })),
        ...(entry.monitor
          ? {
              monitor: {
                ...entry.monitor,
                url: monitorUrl,
                paused:
                  entry.monitor.paused ||
                  shouldPauseMonitor(monitorUrl)
              }
            }
          : {})
      };
    })
  };
}

function localizeLinkUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.hostname === TOOLS_HOST) {
    return new URL(parsed.pathname + parsed.search, PLATFORM_BROWSER_ORIGIN).toString();
  }
  if (parsed.hostname === MARKDOWN_HOST) {
    return new URL(
      parsed.pathname + parsed.search,
      MARKDOWN_PUBLIC_ORIGIN
    ).toString();
  }
  return value;
}

function shouldPauseMonitor(url: string | undefined): boolean {
  if (!url) return false;
  const parsed = new URL(url);
  return ![
    "platform",
    "markdown-mock",
    "localhost",
    "127.0.0.1"
  ].includes(parsed.hostname);
}

function createClient(config: BucketConfig) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}

async function ensureBucket(client: S3Client, bucket: string) {
  const exists = await bucketExists(client, bucket);
  if (exists) return;
  await withRetry(`create-bucket:${bucket}`, async () => {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      return;
    } catch (error) {
        if (error instanceof Error && error.name === "BucketAlreadyOwnedByYou") {
          return;
        }
        if (error instanceof Error && error.name === "BucketAlreadyExists") {
          return;
        }
        throw error;
      }
    });
}

async function putSeedObject(
  client: S3Client,
  bucket: string,
  key: string,
  body: string
) {
  if (!overwrite && await objectExists(client, bucket, key)) {
    return;
  }
  await withRetry(`seed-object:${bucket}/${key}`, async () => {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "application/json"
      })
    );
  });
}

async function objectExists(client: S3Client, bucket: string, key = "") {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (error instanceof Error && ["NotFound", "NoSuchKey"].includes(error.name)) {
      return false;
    }
    if (error instanceof Error && error.name === "NoSuchBucket") {
      return false;
    }
    throw error;
  }
}

async function bucketExists(client: S3Client, bucket: string) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      ["NotFound", "NoSuchBucket", "NoSuchKey", "NoSuchKeyOrBucket"].includes(error.name)
    ) {
      return false;
    }
    throw error;
  }
}

async function withRetry(message: string, task: () => Promise<void>) {
  let attempt = 0;
  let lastError: unknown;
  while (attempt < retryAttempts) {
    attempt += 1;
    try {
      await task();
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= retryAttempts) {
        throw new Error(
          `Failed to ${message} after ${retryAttempts} attempts: ${String(error)}`,
          { cause: error }
        );
      }
      await new Promise((resolve) => {
        setTimeout(resolve, Math.min(1000 * attempt, 2_000));
      });
    }
  }
  throw new Error(
    `Failed to ${message} unexpectedly: ${String(lastError)}`,
    { cause: lastError }
  );
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("SEED_RETRY_ATTEMPTS must be a positive integer");
  }
  return parsed;
}

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function loadBucketConfig(prefix: "TOOLS" | "ARTIFACT"): BucketConfig {
  return {
    name: required(`${prefix}_S3_BUCKET`),
    endpoint: required(`${prefix}_S3_ENDPOINT`),
    region: required(`${prefix}_S3_REGION`),
    accessKeyId: required(`${prefix}_S3_ACCESS_KEY_ID`),
    secretAccessKey: required(`${prefix}_S3_SECRET_ACCESS_KEY`),
    forcePathStyle: process.env[`${prefix}_S3_FORCE_PATH_STYLE`] === "true"
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
