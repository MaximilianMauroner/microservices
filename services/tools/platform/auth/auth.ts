import { createHash } from "node:crypto";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  verifyGoogleIdToken,
  type GoogleProfile
} from "better-auth/social-providers";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { PlatformPrincipal } from "#security";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens
} from "../database/postgres-schema.js";
import type { PlatformAuthConfig } from "../config.js";
import { MCP_PATH } from "../access/mcp.js";
import { APP_CLIENT_IDS, APP_CLIENTS, withAppConsentPrompt, type AppClientId } from "./app-clients.js";
import { createPeopleRepository, type PeopleRepository } from "../access/people.js";
import { REVIEW_ACCOUNT, isReviewUser, reviewPrincipal } from "./review-account.js";

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const DISABLED_CREDENTIAL_PATHS = [
  "/sign-up/email", "/request-password-reset", "/reset-password", "/reset-password/:token",
  "/change-password", "/set-password", "/verify-password", "/link-social", "/unlink-account"
];

/** Owns browser sign-in: Better Auth, its session tables, and principal resolution. */
export function createPlatformIdentity(config: PlatformAuthConfig, databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 2, idle_timeout: 120 });
  const people = createPeopleRepository(sql, config.allowedGoogleEmail);
  const auth = createPlatformAuth(config, sql, people);
  const principalFor = async (identity: { subject: string; email: string }) =>
    principalFromIdentity(identity, config.allowedGoogleSubject, config.allowedGoogleEmail) ??
      memberPrincipal(identity, await people.grantsFor(identity.subject));
  return {
    auth,
    people,
    resolvePrincipal: async (request: Request): Promise<PlatformPrincipal | undefined> => {
      try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return undefined;
        if (isReviewUser(session.user)) return reviewPrincipal(sql, config.reviewAccount);
        const [account] = await sql<{ subject: string }[]>`
          select account_id subject from tools.auth_accounts
          where user_id = ${session.user.id} and provider_id = 'google'`;
        return account && principalFor({ subject: account.subject, email: session.user.email });
      } catch {
        return undefined;
      }
    },
    /** Resolves an MCP bearer token. It never reads the browser cookie, and it refuses app tokens, so each credential keeps one purpose. */
    resolveAccessToken: (request: Request) => resolveBearer(request, (clientId) => !APP_CLIENT_IDS.includes(clientId)),
    /** Resolves a bearer token that the given first-party app holds. */
    resolveAppToken: (request: Request, app: AppClientId) => resolveBearer(request, (clientId) => clientId === APP_CLIENTS[app].clientId),
    close: () => sql.end({ timeout: 5 })
  };

  async function resolveBearer(request: Request, accepts: (clientId: string) => boolean): Promise<PlatformPrincipal | undefined> {
    const token = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token) return undefined;
    const [row] = await sql<{ id: string; subject: string | null; email: string; client_id: string }[]>`
      select u.id, a.account_id subject, u.email, t.client_id
      from tools.oauth_access_tokens t
      join tools.oauth_clients c on c.client_id = t.client_id and c.disabled is not true
      join tools.auth_users u on u.id = t.user_id
      left join tools.auth_accounts a on a.user_id = u.id and a.provider_id = 'google'
      where t.token = ${createHash("sha256").update(token).digest("base64url")} and t.expires_at > now()`;
    if (!row || !accepts(row.client_id)) return undefined;
    if (isReviewUser(row)) return row.client_id === REVIEW_ACCOUNT.clientId ? reviewPrincipal(sql, config.reviewAccount) : undefined;
    return row.subject ? principalFor({ subject: row.subject, email: row.email }) : undefined;
  }
}

export type PlatformIdentity = ReturnType<typeof createPlatformIdentity>;

function createPlatformAuth(config: PlatformAuthConfig, sql: postgres.Sql, people: PeopleRepository) {
  return betterAuth({
    appName: "Mauroner Tools",
    baseURL: config.publicOrigin,
    basePath: "/api/auth",
    secret: config.secret,
    trustedOrigins: [config.publicOrigin],
    database: drizzleAdapter(drizzle({ client: sql }), {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        oauthClient: oauthClients,
        oauthRefreshToken: oauthRefreshTokens,
        oauthAccessToken: oauthAccessTokens,
        oauthConsent: oauthConsents
      }
    }),
    emailAndPassword: { enabled: true, disableSignUp: true },
    disabledPaths: DISABLED_CREDENTIAL_PATHS,
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        accessType: "online",
        prompt: "select_account",
        getUserInfo: async (tokens) => {
          if (!tokens.idToken) return null;
          const profile = await verifyGoogleIdToken({
            token: tokens.idToken,
            audience: config.googleClientId
          });
          if (!isVerifiedGoogleProfile(profile) || profile.sub === REVIEW_ACCOUNT.subject || profile.email.toLowerCase() === REVIEW_ACCOUNT.email) return null;
          const admitted = isAllowedGoogleProfile(profile, config.allowedGoogleSubject, config.allowedGoogleEmail) ||
            await people.admit(profile.sub, profile.email);
          if (!admitted) return null;
          return {
            user: {
              id: profile.sub,
              name: profile.name,
              email: profile.email,
              image: profile.picture,
              emailVerified: profile.email_verified
            },
            data: profile
          };
        }
      }
    },
    session: {
      expiresIn: SESSION_SECONDS,
      updateAge: 60 * 60
    },
    account: {
      accountLinking: { enabled: false },
      storeStateStrategy: "cookie",
      storeAccountCookie: false,
      encryptOAuthTokens: true
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (DISABLED_CREDENTIAL_PATHS.includes(ctx.path)) throw reviewDenied();
        if (ctx.path === "/sign-in/email") {
          if (ctx.body?.email !== REVIEW_ACCOUNT.username || !await reviewPrincipal(sql, config.reviewAccount)) {
            throw new APIError("UNAUTHORIZED", { message: "Invalid username or password." });
          }
          return { context: { body: { ...ctx.body, email: REVIEW_ACCOUNT.email } } };
        }
        const session = await getSessionFromCtx(ctx);
        if (session && isReviewUser(session.user)) {
          if (ctx.path !== "/sign-out" && !await reviewPrincipal(sql, config.reviewAccount)) throw reviewDenied();
          const allowed = ["/get-session", "/sign-out", "/list-sessions", "/revoke-session", "/revoke-sessions", "/revoke-other-sessions",
            "/oauth2/authorize", "/oauth2/consent", "/oauth2/continue", "/oauth2/userinfo", "/oauth2/end-session"];
          if (!allowed.includes(ctx.path)) throw reviewDenied();
          if (["/oauth2/authorize", "/oauth2/consent", "/oauth2/continue"].includes(ctx.path)) {
            const params = ctx.path === "/oauth2/authorize" ? ctx.query : Object.fromEntries(new URLSearchParams(ctx.body?.oauth_query ?? ""));
            if (params?.client_id !== REVIEW_ACCOUNT.clientId || params?.resource) throw reviewDenied();
          }
        }
        if (ctx.path === "/oauth2/token" && ctx.body?.grant_type === "authorization_code" && typeof ctx.body.code === "string") {
          const verification = await ctx.context.internalAdapter.findVerificationValue(createHash("sha256").update(ctx.body.code).digest("base64url"));
          if (verification && (JSON.parse(verification.value) as { userId?: unknown }).userId === REVIEW_ACCOUNT.userId && (
            !await reviewPrincipal(sql, config.reviewAccount) || ctx.body.client_id !== REVIEW_ACCOUNT.clientId || ctx.body.resource
          )) throw reviewDenied();
        }
        const token = ctx.path === "/oauth2/token" && ctx.body?.grant_type === "refresh_token" ? ctx.body.refresh_token :
          ctx.path === "/oauth2/introspect" ? ctx.body?.token :
            /^Bearer (.+)$/.exec(ctx.headers?.get("authorization") ?? "")?.[1];
        if (typeof token === "string") {
          const table = ctx.path === "/oauth2/token" ? "oauth_refresh_tokens" : "oauth_access_tokens";
          const [row] = await sql<{ user_id: string; client_id: string }[]>`
            select user_id, client_id from tools.${sql(table)} where token = ${createHash("sha256").update(token).digest("base64url")}`;
          if (row?.user_id === REVIEW_ACCOUNT.userId && (
            !await reviewPrincipal(sql, config.reviewAccount) || row.client_id !== REVIEW_ACCOUNT.clientId ||
            (ctx.path === "/oauth2/token" && (ctx.body?.client_id !== REVIEW_ACCOUNT.clientId || ctx.body?.resource))
          )) throw reviewDenied();
        }
        if (!ctx.request || !new URL(ctx.request.url).pathname.endsWith("/oauth2/authorize")) return;
        const query = withAppConsentPrompt(ctx.query);
        const body = withAppConsentPrompt(ctx.body);
        if (query || body) return { context: { ...(query ? { query } : {}), ...(body ? { body } : {}) } };
      })
    },
    advanced: {
      cookiePrefix: "mauroner-tools",
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: config.publicOrigin.startsWith("https://"),
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.publicOrigin.startsWith("https://")
      }
    },
    telemetry: { enabled: false },
    plugins: [
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        disableJwtPlugin: true,
        grantTypes: ["authorization_code", "refresh_token"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        validAudiences: [`${config.publicOrigin}${MCP_PATH}`],
        customTokenResponseFields: async ({ user, verificationValue }) => {
          if (user && isReviewUser(user)) {
            if (!await reviewPrincipal(sql, config.reviewAccount)) throw reviewDenied();
            if (verificationValue && (verificationValue.query.client_id !== REVIEW_ACCOUNT.clientId || ("resource" in verificationValue.query && verificationValue.query.resource))) throw reviewDenied();
          }
          return {};
        }
      }),
      tanstackStartCookies()
    ]
  });
}

/** Checks Google's verified ID-token claims before Better Auth creates a session. */
export function isVerifiedGoogleProfile(profile: unknown): profile is GoogleProfile {
  if (!profile || typeof profile !== "object") return false;
  const claims = profile as Record<string, unknown>;
  return typeof claims.sub === "string" &&
    typeof claims.email === "string" &&
    claims.email_verified === true &&
    typeof claims.name === "string" &&
    claims.name.length > 0 &&
    typeof claims.picture === "string";
}

export function isAllowedGoogleProfile(
  profile: unknown,
  allowedSubject: string,
  allowedEmail: string
): boolean {
  return isVerifiedGoogleProfile(profile) && profile.sub === allowedSubject && profile.email === allowedEmail;
}

export function principalFromIdentity(
  identity: { subject: string | undefined; email: string },
  allowedSubject: string,
  allowedEmail: string
): PlatformPrincipal | undefined {
  if (identity.subject !== allowedSubject || identity.email !== allowedEmail) return undefined;
  return { role: "admin", subject: identity.subject, email: identity.email };
}

function memberPrincipal(
  identity: { subject: string; email: string },
  products: readonly string[] | undefined
): PlatformPrincipal | undefined {
  return products ? { role: "member", ...identity, products } : undefined;
}

function reviewDenied() {
  return new APIError("FORBIDDEN", { error: "access_denied", message: "App Review access is unavailable for this request." });
}
