import type postgres from "postgres";

/**
 * First-party native apps. Each is a public OAuth client with PKCE.
 * Their tokens open only their own API, and MCP refuses them, so each credential keeps one purpose.
 */
export const APP_CLIENTS = {
  kitchen: { clientId: "com.lab4code.kitchen", name: "Kitchen", redirectUri: "com.lab4code.kitchen:/oauth" }
} as const;

export type AppClientId = keyof typeof APP_CLIENTS;

export const APP_CLIENT_IDS: readonly string[] = Object.values(APP_CLIENTS).map((app) => app.clientId);

const APP_SCOPES = ["openid", "profile", "email", "offline_access"];

/**
 * Another app on the device can claim a custom URL scheme and start its own PKCE flow (RFC 8252 section 8.6),
 * so a stored consent must not let an app authorization pass without the person.
 */
export function withAppConsentPrompt<T extends Record<string, unknown>>(params: T | undefined): T | undefined {
  if (!params || typeof params.client_id !== "string" || !APP_CLIENT_IDS.includes(params.client_id)) return undefined;
  const prompt = typeof params.prompt === "string" ? params.prompt.split(" ").filter(Boolean) : [];
  return prompt.includes("consent") ? undefined : { ...params, prompt: [...prompt, "consent"].join(" ") };
}

/** Writes each app client. A client that an operator disabled stays disabled. */
export async function registerAppClients(sql: postgres.Sql) {
  for (const app of Object.values(APP_CLIENTS)) {
    await sql`
      insert into tools.oauth_clients (id, client_id, name, redirect_uris, scopes, token_endpoint_auth_method, grant_types, response_types,
        public, type, require_pkce, skip_consent, disabled, created_at, updated_at)
      values (${app.clientId}, ${app.clientId}, ${app.name}, ${[app.redirectUri]}, ${APP_SCOPES}, 'none', ${["authorization_code", "refresh_token"]}, ${["code"]},
        true, 'native', true, false, false, now(), now())
      on conflict (client_id) do update set name = excluded.name, redirect_uris = excluded.redirect_uris, scopes = excluded.scopes,
        token_endpoint_auth_method = excluded.token_endpoint_auth_method, grant_types = excluded.grant_types, response_types = excluded.response_types,
        public = excluded.public, type = excluded.type, require_pkce = excluded.require_pkce, skip_consent = excluded.skip_consent, client_secret = null,
        updated_at = now()`;
  }
}
