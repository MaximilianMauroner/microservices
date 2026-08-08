import { loadConfig as loadArtifactConfig } from "@tools-platform/artifact-publisher";
import { loadConfig as loadFieldGuideConfig } from "@tools-platform/field-guide/config";
import { loadConfig as loadToolsConfig } from "@tools-platform/web";
import { loadConfig as loadCheckerConfig } from "@tools-platform/tools-checker/config";
import { loadMoneyTrackerConfig } from "./features/money/money-tracker.js";

type Environment = Readonly<Record<string, string | undefined>>;

export function loadPlatformConfig(env: Environment = process.env) {
  const publicOrigin = required(env, "PUBLIC_ORIGIN");
  const port = env.PORT ?? "3000";
  const audiences = routeAudiences(env);
  const readOnly = optionalBoolean(env.PLATFORM_READ_ONLY, "PLATFORM_READ_ONLY");
  const localAuth = optionalBoolean(env.PLATFORM_LOCAL_AUTH, "PLATFORM_LOCAL_AUTH");
  if (readOnly && env.NODE_ENV === "production") {
    throw new Error("PLATFORM_READ_ONLY is unavailable in production");
  }
  if (localAuth && env.NODE_ENV === "production") {
    throw new Error("PLATFORM_LOCAL_AUTH is unavailable in production");
  }

  const tools = loadToolsConfig({
    ...env,
    PORT: port,
    PUBLIC_ORIGIN: publicOrigin,
    CF_ACCESS_AUDIENCE:
      [...audiences.manage, ...audiences.publisher, ...audiences.review].join(","),
    ...bucketEnvironment(env, "TOOLS")
  });
  const artifact = loadArtifactConfig({
    ...env,
    PORT: port,
    PUBLIC_BASE_URL: publicOrigin,
    ...bucketEnvironment(env, "ARTIFACT")
  });
  const fieldGuide = loadFieldGuideConfig({
    ...env,
    PORT: port,
    PUBLIC_BASE_URL: publicOrigin,
    DATABASE_BACKEND: "postgres",
    DATABASE_URL: required(env, "FIELD_GUIDE_DATABASE_URL")
  });
  const checker = loadCheckerConfig({
    ...env,
    ...bucketEnvironment(env, "TOOLS")
  });

  return {
    port: tools.port,
    readOnly,
    localAuth,
    publicOrigin: tools.trustedOrigin,
    access: {
      issuer: tools.access.issuer,
      jwksUrl: tools.access.jwksUrl,
      audience: audiences
    },
    tools,
    artifact,
    fieldGuide,
    markdownShare: tools.markdownShare,
    checker,
    moneyTracker: loadMoneyTrackerConfig(env),
    towerHeartbeatToken: secret(
      required(env, "TOWER_HEARTBEAT_TOKEN"),
      "TOWER_HEARTBEAT_TOKEN"
    ),
    towerHeartbeatStaleAfterMs: positiveInteger(
      env.TOWER_HEARTBEAT_STALE_AFTER_MS,
      3 * 60 * 1000,
      "TOWER_HEARTBEAT_STALE_AFTER_MS"
    ),
    checkerIntervalMs: positiveInteger(
      env.CHECKER_INTERVAL_MS,
      5 * 60 * 1000,
      "CHECKER_INTERVAL_MS"
    )
  };
}

function secret(value: string, name: string): string {
  if (value.length < 32 || /\s/.test(value)) {
    throw new Error(`${name} must be at least 32 non-whitespace characters`);
  }
  return value;
}

export function routeAudiences(env: Environment) {
  const explicit = {
    manage: optionalAudience(env.CF_ACCESS_MANAGE_AUDIENCE),
    publisher: optionalAudience(env.CF_ACCESS_PUBLISHER_AUDIENCE),
    review: optionalAudience(env.CF_ACCESS_REVIEW_AUDIENCE)
  };
  for (const [family, value] of Object.entries(explicit)) {
    if (!value) {
      throw new Error(
        `CF_ACCESS_${family.toUpperCase()}_AUDIENCE is required`
      );
    }
    if (value.length !== 1) {
      throw new Error(
        `CF_ACCESS_${family.toUpperCase()}_AUDIENCE must contain exactly one audience tag`
      );
    }
  }
  const audiences = {
    manage: explicit.manage!,
    publisher: explicit.publisher!,
    review: explicit.review!
  };
  requireDistinctAudiences(audiences);
  return audiences;
}

function optionalAudience(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const audiences = [...new Set(value.split(",").map((item) => item.trim()))]
    .filter(Boolean);
  if (audiences.length === 0) {
    throw new Error("Route-family Access audience must not be empty");
  }
  return audiences;
}

function requireDistinctAudiences(audiences: {
  manage: string[];
  publisher: string[];
  review: string[];
}) {
  const owner = new Map<string, string>();
  for (const [family, values] of Object.entries(audiences)) {
    for (const value of values) {
      const existing = owner.get(value);
      if (existing) {
        throw new Error(
          `Cloudflare Access audience ${value} overlaps ${existing} and ${family}`
        );
      }
      owner.set(value, family);
    }
  }
}

function bucketEnvironment(env: Environment, prefix: "TOOLS" | "ARTIFACT") {
  return {
    S3_BUCKET: required(env, `${prefix}_S3_BUCKET`),
    S3_ENDPOINT: required(env, `${prefix}_S3_ENDPOINT`),
    S3_REGION: required(env, `${prefix}_S3_REGION`),
    S3_ACCESS_KEY_ID: required(env, `${prefix}_S3_ACCESS_KEY_ID`),
    S3_SECRET_ACCESS_KEY: required(env, `${prefix}_S3_SECRET_ACCESS_KEY`),
    S3_FORCE_PATH_STYLE: env[`${prefix}_S3_FORCE_PATH_STYLE`]
  };
}

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function optionalBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either true or false`);
}
