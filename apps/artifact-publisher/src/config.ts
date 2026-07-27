import {
  DEFAULT_MAX_CONCURRENT_UPLOADS,
  DEFAULT_MAX_HTML_UPLOAD_BYTES,
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_TEMPORARY_FILE_RETENTION_MS,
  MAX_TEMPORARY_FILE_RETENTION_MS,
  MAX_SINGLE_PUT_UPLOAD_BYTES
} from "./app.js";

const DEFAULT_TEMPORARY_FILE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const MAX_TIMER_INTERVAL_MS = 2_147_483_647;

export type RuntimeConfig = {
  port: number;
  uploadToken: string;
  publicBaseUrl?: string;
  maxUploadBytes: number;
  maxHtmlUploadBytes: number;
  maxConcurrentUploads: number;
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
  const maxUploadBytes = parseMaxUploadBytes(
    env.MAX_UPLOAD_BYTES,
    DEFAULT_MAX_UPLOAD_BYTES,
    "MAX_UPLOAD_BYTES"
  );
  const maxHtmlUploadBytes = parseMaxHtmlUploadBytes(
    env.MAX_HTML_UPLOAD_BYTES,
    Math.min(DEFAULT_MAX_HTML_UPLOAD_BYTES, maxUploadBytes),
    maxUploadBytes
  );
  const publicBaseUrl =
    parseOptionalPublicBaseUrl(env.PUBLIC_BASE_URL) ??
    parseOptionalRailwayPublicBaseUrl(env.RAILWAY_PUBLIC_DOMAIN);

  if (env.NODE_ENV === "production" && !publicBaseUrl) {
    throw new Error("PUBLIC_BASE_URL is required when NODE_ENV=production");
  }

  return {
    port: parseBoundedPositiveInteger(env.PORT, 3000, "PORT", 65_535),
    uploadToken: requireEnv(env, "UPLOAD_TOKEN"),
    publicBaseUrl,
    maxUploadBytes,
    maxHtmlUploadBytes,
    maxConcurrentUploads: parseBoundedPositiveInteger(
      env.MAX_CONCURRENT_UPLOADS,
      DEFAULT_MAX_CONCURRENT_UPLOADS,
      "MAX_CONCURRENT_UPLOADS",
      100
    ),
    temporaryFileRetentionMs: parseBoundedPositiveInteger(
      env.TEMPORARY_FILE_RETENTION_MS,
      DEFAULT_TEMPORARY_FILE_RETENTION_MS,
      "TEMPORARY_FILE_RETENTION_MS",
      MAX_TEMPORARY_FILE_RETENTION_MS
    ),
    temporaryFileCleanupIntervalMs: parseBoundedPositiveInteger(
      env.TEMPORARY_FILE_CLEANUP_INTERVAL_MS,
      DEFAULT_TEMPORARY_FILE_CLEANUP_INTERVAL_MS,
      "TEMPORARY_FILE_CLEANUP_INTERVAL_MS",
      MAX_TIMER_INTERVAL_MS
    ),
    s3: {
      bucket: requireEnv(env, "S3_BUCKET"),
      endpoint: parseHttpUrl(requireEnv(env, "S3_ENDPOINT"), "S3_ENDPOINT", false),
      region: requireEnv(env, "S3_REGION"),
      accessKeyId: requireEnv(env, "S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv(env, "S3_SECRET_ACCESS_KEY"),
      forcePathStyle: parseBoolean(env.S3_FORCE_PATH_STYLE, "S3_FORCE_PATH_STYLE", false)
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
  if (value === undefined || value === "") {
    return fallback;
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseBoundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  maximum: number
) {
  const parsed = parsePositiveInteger(value, fallback, name);
  if (parsed > maximum) {
    throw new Error(`${name} must be less than or equal to ${maximum}`);
  }

  return parsed;
}

function parseMaxUploadBytes(value: string | undefined, fallback: number, name: string) {
  return parseBoundedPositiveInteger(value, fallback, name, MAX_SINGLE_PUT_UPLOAD_BYTES);
}

function parseMaxHtmlUploadBytes(
  value: string | undefined,
  fallback: number,
  maxUploadBytes: number
) {
  const parsed = parsePositiveInteger(value, fallback, "MAX_HTML_UPLOAD_BYTES");
  if (parsed > maxUploadBytes) {
    throw new Error("MAX_HTML_UPLOAD_BYTES must be less than or equal to MAX_UPLOAD_BYTES");
  }

  return parsed;
}

function parseBoolean(value: string | undefined, name: string, fallback: boolean) {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  throw new Error(`${name} must be either true or false`);
}

function parseOptionalPublicBaseUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  return parseHttpUrl(value, "PUBLIC_BASE_URL", true);
}

function parseOptionalRailwayPublicBaseUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const publicBaseUrl = parseHttpUrl(
    `https://${value}`,
    "RAILWAY_PUBLIC_DOMAIN",
    true
  );
  if (new URL(publicBaseUrl).host.toLowerCase() !== value.toLowerCase()) {
    throw new Error("RAILWAY_PUBLIC_DOMAIN must be a valid domain");
  }

  return publicBaseUrl;
}

function parseHttpUrl(value: string, name: string, originOnly: boolean) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (originOnly && parsed.pathname !== "/")
  ) {
    throw new Error(`${name} must be a valid HTTP(S) ${originOnly ? "origin" : "URL"}`);
  }

  return originOnly ? parsed.origin : parsed.toString().replace(/\/$/, "");
}
