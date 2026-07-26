export type Config = {
  port: number;
  databaseUrl: string;
  agentApiToken: string;
  allowedEmail: string;
  publicBaseUrl: string;
};
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const get = (name: string) => {
    const value = env[name]?.trim();
    if (!value)
      throw new Error(`Missing required environment variable: ${name}`);
    return value;
  };
  const publicBaseUrl = parsePublicBaseUrl(get("PUBLIC_BASE_URL"));
  const email = get("SHOO_ALLOWED_EMAIL").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("SHOO_ALLOWED_EMAIL must be a valid email address");
  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be a valid port");
  return {
    port,
    databaseUrl: get("DATABASE_URL"),
    agentApiToken: get("AGENT_API_TOKEN"),
    allowedEmail: email,
    publicBaseUrl,
  };
}
function parsePublicBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be an HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "PUBLIC_BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment",
    );
  return url.origin;
}
