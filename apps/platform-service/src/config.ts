import { loadConfig as loadArtifactConfig } from "../../artifact-publisher/src/config.ts";
import { loadConfig as loadFieldGuideConfig } from "../../field-guide-console/src/config.ts";
import { loadConfig as loadToolsConfig } from "../../tools-web/src/config.ts";
import { loadConfig as loadCheckerConfig } from "../../../jobs/tools-checker/src/config.ts";

type Environment = Readonly<Record<string, string | undefined>>;

export function loadPlatformConfig(env: Environment = process.env) {
  const publicOrigin = required(env, "PUBLIC_ORIGIN");
  const port = env.PORT ?? "3000";

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
    SHOO_ALLOWED_EMAIL: undefined,
    ...bucketEnvironment(env, "ARTIFACT")
  });
  const fieldGuide = loadFieldGuideConfig({
    ...env,
    PORT: port,
    PUBLIC_BASE_URL: publicOrigin,
    DATABASE_BACKEND: "postgres",
    DATABASE_URL: required(env, "FIELD_GUIDE_DATABASE_URL"),
    SHOO_ALLOWED_EMAIL:
      env.FIELD_GUIDE_REVIEWER_EMAIL ?? "access-managed@example.invalid"
  });
  const checker = loadCheckerConfig({
    ...env,
    ...bucketEnvironment(env, "TOOLS")
  });

  return {
    port: tools.port,
    publicOrigin: tools.trustedOrigin,
    access: tools.access,
    tools,
    artifact,
    fieldGuide,
    checker,
    checkerIntervalMs: positiveInteger(
      env.CHECKER_INTERVAL_MS,
      5 * 60 * 1000,
      "CHECKER_INTERVAL_MS"
    )
  };
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
