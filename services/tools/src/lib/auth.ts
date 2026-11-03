import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  verifyGoogleIdToken,
  type GoogleProfile
} from "better-auth/social-providers";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { PlatformPrincipal } from "@tools-platform/security";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications
} from "../../database/postgres-schema.js";
import type { PlatformAuthConfig } from "../config.js";

const SESSION_SECONDS = 7 * 24 * 60 * 60;

/** Owns browser sign-in: Better Auth, its session tables, and principal resolution. */
export function createPlatformIdentity(config: PlatformAuthConfig, databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 2, idle_timeout: 120 });
  const auth = createPlatformAuth(config, sql);
  return {
    auth,
    resolvePrincipal: async (request: Request): Promise<PlatformPrincipal | undefined> => {
      try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return undefined;
        const [account] = await sql<{ subject: string }[]>`
          select account_id subject from tools.auth_accounts
          where user_id = ${session.user.id} and provider_id = 'google'`;
        return principalFromIdentity(
          { subject: account?.subject, email: session.user.email },
          config.allowedGoogleSubject,
          config.allowedGoogleEmail
        );
      } catch {
        return undefined;
      }
    },
    close: () => sql.end({ timeout: 5 })
  };
}

export type PlatformIdentity = ReturnType<typeof createPlatformIdentity>;

function createPlatformAuth(config: PlatformAuthConfig, sql: postgres.Sql) {
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
        verification: authVerifications
      }
    }),
    emailAndPassword: { enabled: false },
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
          if (!isAllowedGoogleProfile(
            profile,
            config.allowedGoogleSubject,
            config.allowedGoogleEmail
          )) {
            return null;
          }
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
      storeStateStrategy: "cookie",
      storeAccountCookie: false,
      encryptOAuthTokens: true
    },
    advanced: {
      cookiePrefix: "mauroner-tools",
      useSecureCookies: config.publicOrigin.startsWith("https://"),
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.publicOrigin.startsWith("https://")
      }
    },
    telemetry: { enabled: false },
    plugins: [tanstackStartCookies()]
  });
}

/** Checks Google's verified ID-token claims before Better Auth creates a session. */
export function isAllowedGoogleProfile(
  profile: unknown,
  allowedSubject: string,
  allowedEmail: string
): profile is GoogleProfile {
  if (!profile || typeof profile !== "object") return false;
  const claims = profile as Record<string, unknown>;
  return claims.sub === allowedSubject &&
    claims.email === allowedEmail &&
    claims.email_verified === true &&
    typeof claims.name === "string" &&
    claims.name.length > 0 &&
    typeof claims.picture === "string";
}

export function principalFromIdentity(
  identity: { subject: string | undefined; email: string },
  allowedSubject: string,
  allowedEmail: string
): PlatformPrincipal | undefined {
  if (identity.subject !== allowedSubject || identity.email !== allowedEmail) return undefined;
  return { role: "admin", subject: identity.subject, email: identity.email };
}
