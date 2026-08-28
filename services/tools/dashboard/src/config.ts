export interface ToolsWebConfig {
  port: number;
  trustedOrigin: string;
  bucket: {
    endpoint: string;
    region: string;
    name: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  markdownShare: {
    adminEndpoint: string;
    adminToken: string;
    publicOrigin: string;
  };
}

export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env
): ToolsWebConfig {
  const port = env.PORT === undefined ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const trustedOrigin = parseOrigin(
    required(env, "PUBLIC_ORIGIN"),
    "PUBLIC_ORIGIN",
    env.NODE_ENV === "development"
  );
  return {
    port,
    trustedOrigin,
    bucket: {
      endpoint: parseOrigin(
        required(env, "S3_ENDPOINT"),
        "S3_ENDPOINT",
        env.NODE_ENV === "development"
      ),
      region: required(env, "S3_REGION"),
      name: required(env, "S3_BUCKET"),
      accessKeyId: required(env, "S3_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "S3_SECRET_ACCESS_KEY"),
      forcePathStyle: optionalBoolean(env.S3_FORCE_PATH_STYLE, "S3_FORCE_PATH_STYLE")
    },
    markdownShare: {
      adminEndpoint: parseHttpsUrl(
        required(env, "MARKDOWN_SHARE_ADMIN_ENDPOINT"),
        "MARKDOWN_SHARE_ADMIN_ENDPOINT",
        env.NODE_ENV === "development"
      ),
      adminToken: parseSecret(
        required(env, "MARKDOWN_SHARE_ADMIN_TOKEN"),
        "MARKDOWN_SHARE_ADMIN_TOKEN"
      ),
      publicOrigin: trustedOrigin
    }
  };
}

function required(
  env: Readonly<Record<string, string | undefined>>,
  name: string
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseOrigin(value: string, name: string, allowHttp = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    const protocolLabel = allowHttp ? "HTTP(S)" : "HTTPS";
    throw new Error(`${name} must be an ${protocolLabel} origin`);
  }
  if (
    (!allowHttp && url.protocol !== "https:") ||
    (allowHttp && !["http:", "https:"].includes(url.protocol)) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    const protocolLabel = allowHttp ? "HTTP(S)" : "HTTPS";
    throw new Error(`${name} must be an ${protocolLabel} origin`);
  }
  return url.origin;
}

function parseHttpsUrl(value: string, name: string, allowHttp = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTPS URL`);
  }
  if ((!allowHttp && url.protocol !== "https:") ||
      (allowHttp && !["http:", "https:"].includes(url.protocol)) ||
      url.username || url.password || url.hash) {
    throw new Error(`${name} must be an HTTP(S) URL`);
  }
  return url.toString();
}

function parseSecret(value: string, name: string): string {
  if (value.length < 32 || value.length > 512) {
    throw new Error(`${name} must contain between 32 and 512 characters`);
  }
  return value;
}

function optionalBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either true or false`);
}
