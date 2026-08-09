export interface CheckerConfig {
  environment: string;
  databaseUrl: string;
  bucket: {
    name: string;
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  discordWebhookUrl?: string;
  concurrency: number;
  probeTimeoutMs: number;
  runDeadlineMs: number;
  notificationAttemptLimit: number;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env
): CheckerConfig {
  return {
    environment: identifier(required(env, "TOOLS_ENVIRONMENT"), "TOOLS_ENVIRONMENT"),
    databaseUrl: required(env, "DATABASE_URL"),
    bucket: {
      name: required(env, "S3_BUCKET"),
      endpoint: httpUrl(required(env, "S3_ENDPOINT"), "S3_ENDPOINT"),
      region: required(env, "S3_REGION"),
      accessKeyId: required(env, "S3_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "S3_SECRET_ACCESS_KEY"),
      forcePathStyle: optionalBoolean(
        env.S3_FORCE_PATH_STYLE,
        "S3_FORCE_PATH_STYLE",
        false
      )
    },
    ...(env.DISCORD_WEBHOOK_URL
      ? {
          discordWebhookUrl: httpUrl(
            env.DISCORD_WEBHOOK_URL,
            "DISCORD_WEBHOOK_URL"
          )
        }
      : {}),
    concurrency: boundedInteger(env.CHECK_CONCURRENCY, 6, 1, 32, "CHECK_CONCURRENCY"),
    probeTimeoutMs: boundedInteger(
      env.PROBE_TIMEOUT_MS,
      10_000,
      1_000,
      60_000,
      "PROBE_TIMEOUT_MS"
    ),
    runDeadlineMs: boundedInteger(
      env.RUN_DEADLINE_MS,
      240_000,
      30_000,
      270_000,
      "RUN_DEADLINE_MS"
    ),
    notificationAttemptLimit: boundedInteger(
      env.NOTIFICATION_ATTEMPT_LIMIT,
      8,
      1,
      16,
      "NOTIFICATION_ATTEMPT_LIMIT"
    )
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function identifier(value: string, name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${name} must be a URL-safe identifier`);
  }
  return value;
}

function httpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error(`${name} must be a credential-free HTTP(S) URL`);
  }
  return url.toString();
}

function optionalBoolean(
  value: string | undefined,
  name: string,
  fallback: boolean
): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}
