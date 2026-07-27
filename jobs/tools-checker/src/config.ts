export interface CheckerConfig {
  environment: string;
  bucket: {
    name: string;
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  discordWebhookUrl?: string;
  access?: {
    clientId: string;
    clientSecret: string;
    protectedOrigins: ReadonlySet<string>;
  };
  concurrency: number;
  probeTimeoutMs: number;
  runDeadlineMs: number;
  notificationAttemptLimit: number;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env
): CheckerConfig {
  const access = accessConfig(env);
  return {
    environment: identifier(required(env, "TOOLS_ENVIRONMENT"), "TOOLS_ENVIRONMENT"),
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
    ...(access ? { access } : {}),
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

function accessConfig(env: NodeJS.ProcessEnv): CheckerConfig["access"] {
  const clientId = env.CF_ACCESS_CLIENT_ID?.trim();
  const clientSecret = env.CF_ACCESS_CLIENT_SECRET?.trim();
  const originList = env.CF_ACCESS_PROTECTED_ORIGINS?.trim();
  if (!clientId && !clientSecret && !originList) return undefined;
  if (!clientId || !clientSecret || !originList) {
    throw new Error(
      "CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET, and CF_ACCESS_PROTECTED_ORIGINS must be set together"
    );
  }
  const protectedOrigins = new Set(
    originList.split(",").map((value) => httpsOrigin(value.trim()))
  );
  return { clientId, clientSecret, protectedOrigins };
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

function httpsOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CF_ACCESS_PROTECTED_ORIGINS must contain HTTPS origins");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("CF_ACCESS_PROTECTED_ORIGINS must contain HTTPS origins");
  }
  return url.origin;
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
