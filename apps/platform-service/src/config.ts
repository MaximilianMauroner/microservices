import { loadConfig as loadArtifactConfig } from "../../artifact-publisher/src/config.ts";
import { loadConfig as loadFieldGuideConfig } from "../../field-guide-console/src/config.ts";
import { loadConfig as loadToolsConfig } from "../../tools-web/src/config.ts";
import { loadConfig as loadCheckerConfig } from "../../../jobs/tools-checker/src/config.ts";

type Environment = Readonly<Record<string, string | undefined>>;

export function loadPlatformConfig(env: Environment = process.env) {
  const publicOrigin = required(env, "PUBLIC_ORIGIN");
  const port = env.PORT ?? "3000";
  const audiences = routeAudiences(
    env,
    optionalAudience(env.CF_ACCESS_AUDIENCE) ?? []
  );

  const tools = loadToolsConfig({
    ...env,
    PORT: port,
    PUBLIC_ORIGIN: publicOrigin,
    CF_ACCESS_AUDIENCE:
      env.CF_ACCESS_AUDIENCE ??
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
    publicOrigin: tools.trustedOrigin,
    access: {
      issuer: tools.access.issuer,
      jwksUrl: tools.access.jwksUrl,
      audience: audiences
    },
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

export function routeAudiences(env: Environment, fallback: string[]) {
  const explicit = {
    manage: optionalAudience(env.CF_ACCESS_MANAGE_AUDIENCE),
    publisher: optionalAudience(env.CF_ACCESS_PUBLISHER_AUDIENCE),
    review: optionalAudience(env.CF_ACCESS_REVIEW_AUDIENCE)
  };
  const configured = Object.values(explicit).filter(
    (value): value is string[] => value !== undefined
  );
  if (env.NODE_ENV === "production" || configured.length > 0) {
    for (const [family, value] of Object.entries(explicit)) {
      if (!value) {
        throw new Error(
          `CF_ACCESS_${family.toUpperCase()}_AUDIENCE is required when route-family audiences are configured`
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
  if (fallback.length === 0) {
    throw new Error("CF_ACCESS_AUDIENCE must contain at least one audience tag");
  }
  return {
    manage: [fallback[0]!],
    publisher: [fallback[1] ?? fallback[0]!],
    review: [fallback[2] ?? fallback[0]!]
  };
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
