import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import {
  jsonResponse,
  type Authentication,
  type Authenticator,
} from "./http.js";

const bearer = (request: Request) =>
  request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];

export function agentAuth(expected: string): Authenticator {
  const expectedBytes = Buffer.from(expected);
  return (request) => {
    const token = bearer(request);
    const tokenBytes = token ? Buffer.from(token) : undefined;
    if (
      !tokenBytes ||
      tokenBytes.byteLength !== expectedBytes.byteLength ||
      !crypto.timingSafeEqual(tokenBytes, expectedBytes)
    ) {
      return authError(
        "agent_auth_required",
        "Valid agent credentials are required.",
      );
    }
    return { ok: true };
  };
}

export function shooAuth(config: {
  allowedEmail: string;
  audience: string;
  jwks?: JWTVerifyGetKey;
  issuer?: string;
}): Authenticator {
  const issuer = new URL(config.issuer ?? "https://shoo.dev").origin;
  const key =
    config.jwks ??
    createRemoteJWKSet(new URL("/.well-known/jwks.json", issuer));
  return async (request): Promise<Authentication> => {
    const token = bearer(request);
    if (!token)
      return authError("shoo_auth_required", "Sign in to review lessons.");
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ["ES256"],
        issuer,
        audience: config.audience,
      });
      const email =
        typeof payload.email === "string" ? payload.email.toLowerCase() : "";
      if (
        payload.email_verified !== true ||
        email !== config.allowedEmail.toLowerCase()
      ) {
        return {
          ok: false,
          response: jsonResponse(
            {
              error: "shoo_email_not_allowed",
              message: "This account is not allowed.",
            },
            { status: 403 },
          ),
        };
      }
      return { ok: true, email };
    } catch {
      return authError("shoo_auth_required", "Sign in to review lessons.");
    }
  };
}

function authError(error: string, message: string): Authentication {
  return {
    ok: false,
    response: jsonResponse(
      { error, message },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Bearer realm="field-guide-console"',
        },
      },
    ),
  };
}
