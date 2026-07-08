import {
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_TEMPORARY_FILE_RETENTION_MS,
  MAX_SINGLE_PUT_UPLOAD_BYTES
} from "./app.js";

const DEFAULT_TEMPORARY_FILE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export type RuntimeConfig = {
  port: number;
  uploadToken: string;
  publicBaseUrl?: string;
  maxUploadBytes: number;
  temporaryFileRetentionMs: number;
  temporaryFileCleanupIntervalMs: number;
  s3: {
    bucket: string;
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    port: parsePositiveInteger(env.PORT, 3000, "PORT"),
    uploadToken: requireEnv(env, "UPLOAD_TOKEN"),
    publicBaseUrl: env.PUBLIC_BASE_URL,
    maxUploadBytes: parseMaxUploadBytes(
      env.MAX_UPLOAD_BYTES,
      DEFAULT_MAX_UPLOAD_BYTES,
      "MAX_UPLOAD_BYTES"
    ),
    temporaryFileRetentionMs: parsePositiveInteger(
      env.TEMPORARY_FILE_RETENTION_MS,
      DEFAULT_TEMPORARY_FILE_RETENTION_MS,
      "TEMPORARY_FILE_RETENTION_MS"
    ),
    temporaryFileCleanupIntervalMs: parsePositiveInteger(
      env.TEMPORARY_FILE_CLEANUP_INTERVAL_MS,
      DEFAULT_TEMPORARY_FILE_CLEANUP_INTERVAL_MS,
      "TEMPORARY_FILE_CLEANUP_INTERVAL_MS"
    ),
    s3: {
      bucket: requireEnv(env, "S3_BUCKET"),
      endpoint: requireEnv(env, "S3_ENDPOINT"),
      region: requireEnv(env, "S3_REGION"),
      accessKeyId: requireEnv(env, "S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv(env, "S3_SECRET_ACCESS_KEY"),
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true"
    }
  };
}

function requireEnv(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseMaxUploadBytes(value: string | undefined, fallback: number, name: string) {
  const parsed = parsePositiveInteger(value, fallback, name);
  if (parsed > MAX_SINGLE_PUT_UPLOAD_BYTES) {
    throw new Error(`${name} must be less than or equal to ${MAX_SINGLE_PUT_UPLOAD_BYTES}`);
  }

  return parsed;
}
