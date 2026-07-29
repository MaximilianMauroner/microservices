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
  access: {
    issuer: string;
    audience: string[];
    jwksUrl: string;
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
  const issuer = parseOrigin(required(env, "CF_ACCESS_ISSUER"), "CF_ACCESS_ISSUER");
  const port = env.PORT === undefined ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return {
    port,
    trustedOrigin: parseOrigin(
      required(env, "PUBLIC_ORIGIN"),
      "PUBLIC_ORIGIN"
    ),
    bucket: {
      endpoint: parseOrigin(required(env, "S3_ENDPOINT"), "S3_ENDPOINT"),
      region: required(env, "S3_REGION"),
      name: required(env, "S3_BUCKET"),
      accessKeyId: required(env, "S3_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "S3_SECRET_ACCESS_KEY"),
      forcePathStyle: optionalBoolean(env.S3_FORCE_PATH_STYLE, "S3_FORCE_PATH_STYLE")
    },
    access: {
      issuer,
      audience: parseAudience(required(env, "CF_ACCESS_AUDIENCE")),
      jwksUrl: env.CF_ACCESS_JWKS_URL
        ? parseHttpsUrl(env.CF_ACCESS_JWKS_URL, "CF_ACCESS_JWKS_URL")
        : new URL("/cdn-cgi/access/certs", issuer).toString()
    },
    markdownShare: {
      adminEndpoint: parseHttpsUrl(
        required(env, "MARKDOWN_SHARE_ADMIN_ENDPOINT"),
        "MARKDOWN_SHARE_ADMIN_ENDPOINT"
      ),
      adminToken: parseSecret(
        required(env, "MARKDOWN_SHARE_ADMIN_TOKEN"),
        "MARKDOWN_SHARE_ADMIN_TOKEN"
      ),
      publicOrigin: parseOrigin(
        required(env, "MARKDOWN_SHARE_PUBLIC_ORIGIN"),
        "MARKDOWN_SHARE_PUBLIC_ORIGIN"
      )
    }
  };
}

function parseAudience(value: string): string[] {
  const audiences = [...new Set(value.split(",").map((item) => item.trim()))]
    .filter(Boolean);
  if (audiences.length === 0) {
    throw new Error("CF_ACCESS_AUDIENCE must contain at least one audience tag");
  }
  return audiences;
}

function required(
  env: Readonly<Record<string, string | undefined>>,
  name: string
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTPS origin`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an HTTPS origin`);
  }
  if (
    name === "CF_ACCESS_ISSUER" &&
    !url.hostname.endsWith(".cloudflareaccess.com")
  ) {
    throw new Error("CF_ACCESS_ISSUER must be a Cloudflare Access team domain");
  }
  return url.origin;
}

function parseHttpsUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTPS URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(`${name} must be an HTTPS URL`);
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
