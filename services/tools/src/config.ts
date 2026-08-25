import { loadConfig as loadArtifactConfig } from "@tools-platform/artifact-publisher";
import { loadConfig as loadFieldGuideConfig } from "@tools-platform/field-guide/config";
import { loadConfig as loadToolsConfig } from "@tools-platform/web";

type Environment = Readonly<Record<string, string | undefined>>;

const AUTHORIZED_GOOGLE_EMAIL = "maximilian.mauroner@gmail.com";

export function loadPlatformConfig(env: Environment = process.env) {
  const publicOrigin = required(env, "PUBLIC_ORIGIN");
  const databaseUrl = required(env, "DATABASE_URL");
  const port = env.PORT ?? "3000";
  const readOnly = optionalBoolean(env.PLATFORM_READ_ONLY, "PLATFORM_READ_ONLY");
  if (readOnly && env.NODE_ENV === "production") {
    throw new Error("PLATFORM_READ_ONLY is unavailable in production");
  }

  const tools = loadToolsConfig({
    ...env,
    PORT: port,
    PUBLIC_ORIGIN: publicOrigin,
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
    DATABASE_URL: databaseUrl
  });
  return {
    port: tools.port,
    readOnly,
    publicOrigin: tools.trustedOrigin,
    databaseUrl,
    auth: loadPlatformAuthConfig(env, tools.trustedOrigin),
    tools,
    artifact,
    fieldGuide,
    markdownShare: tools.markdownShare,
    towerHeartbeatToken: secret(
      required(env, "TOWER_HEARTBEAT_TOKEN"),
      "TOWER_HEARTBEAT_TOKEN"
    ),
    towerHeartbeatStaleAfterMs: positiveInteger(
      env.TOWER_HEARTBEAT_STALE_AFTER_MS,
      40 * 60 * 1000,
      "TOWER_HEARTBEAT_STALE_AFTER_MS"
    )
  };
}

export type PlatformAuthConfig = ReturnType<typeof loadPlatformAuthConfig>;

export function loadPlatformAuthConfig(
  env: Environment,
  publicOrigin: string
) {
  return {
    publicOrigin,
    googleClientId: required(env, "GOOGLE_CLIENT_ID"),
    googleClientSecret: required(env, "GOOGLE_CLIENT_SECRET"),
    secret: secret(required(env, "BETTER_AUTH_SECRET"), "BETTER_AUTH_SECRET"),
    allowedGoogleEmail: AUTHORIZED_GOOGLE_EMAIL,
    allowedGoogleSubject: googleSubject(
      required(env, "AUTH_ALLOWED_GOOGLE_SUBJECT")
    )
  };
}

function secret(value: string, name: string): string {
  if (value.length < 32 || /\s/.test(value)) {
    throw new Error(`${name} must be at least 32 non-whitespace characters`);
  }
  return value;
}

function googleSubject(value: string): string {
  if (value.length > 255 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(
      "AUTH_ALLOWED_GOOGLE_SUBJECT must be a valid Google subject identifier"
    );
  }
  return value;
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
