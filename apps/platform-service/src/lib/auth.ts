import { betterAuth } from "better-auth";
import {
  verifyGoogleIdToken,
  type GoogleProfile
} from "better-auth/social-providers";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import type { PlatformPrincipal } from "@tools-platform/security";
import type { PlatformAuthConfig } from "../config.js";

const SESSION_SECONDS = 12 * 60 * 60;

export function createPlatformAuth(config: PlatformAuthConfig) {
  return betterAuth({
    appName: "Mauroner Tools",
    baseURL: config.publicOrigin,
    basePath: "/api/auth",
    secret: config.secret,
    trustedOrigins: [config.publicOrigin],
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
      updateAge: 60 * 60,
      cookieCache: {
        enabled: true,
        maxAge: SESSION_SECONDS,
        strategy: "jwe",
        refreshCache: { updateAge: 60 * 60 }
      }
    },
    account: {
      storeStateStrategy: "cookie",
      storeAccountCookie: false
    },
    advanced: {
      cookiePrefix: "mauroner-tools",
      useSecureCookies: config.publicOrigin.startsWith("https://"),
      // The single allowed provider subject is the durable principal ID.
      database: {
        generateId: ({ model }) =>
          model === "user" ? config.allowedGoogleSubject : crypto.randomUUID()
      },
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

export type PlatformAuth = ReturnType<typeof createPlatformAuth>;

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

export async function resolvePlatformPrincipal(
  auth: PlatformAuth,
  request: Request,
  allowedSubject: string,
  allowedEmail: string
): Promise<PlatformPrincipal | undefined> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    return principalFromSession(session, allowedSubject, allowedEmail);
  } catch {
    return undefined;
  }
}

export function principalFromSession(
  session: { user: { id: string; email: string } } | null,
  allowedSubject: string,
  allowedEmail: string
): PlatformPrincipal | undefined {
  if (
    !session ||
    session.user.id !== allowedSubject ||
    session.user.email !== allowedEmail
  ) return undefined;
  return { subject: session.user.id, email: session.user.email };
}
