import type { RequestHandler, Response } from "express";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload
} from "jose";

const DEFAULT_SHOO_ISSUER = "https://shoo.dev";

export type ShooAuthConfig = {
  allowedEmail: string;
  audience: string;
  issuer?: string;
  jwks?: JWTVerifyGetKey;
};

export function createShooAuth(config: ShooAuthConfig): RequestHandler {
  const issuer = new URL(config.issuer ?? DEFAULT_SHOO_ISSUER).origin;
  const jwks =
    config.jwks ??
    createRemoteJWKSet(new URL("/.well-known/jwks.json", issuer));
  const allowedEmail = config.allowedEmail.toLowerCase();

  return (req, res, next) => {
    const token = bearerToken(req.get("authorization"));
    if (!token) {
      sendAuthRequired(res);
      return;
    }

    void (async () => {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, jwks, {
          algorithms: ["ES256"],
          audience: config.audience,
          issuer
        }));
      } catch {
        sendAuthRequired(res);
        return;
      }

      const email =
        typeof payload.email === "string" ? payload.email.toLowerCase() : "";
      if (payload.email_verified !== true || email !== allowedEmail) {
        res
          .set("Cache-Control", "private, no-store")
          .status(403)
          .json({
            error: "shoo_email_not_allowed",
            message: "This Google account is not allowed to upload files."
          });
        return;
      }

      res.locals.shooEmail = email;
      next();
    })();
  };
}

function bearerToken(authorization: string | undefined) {
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  return match?.[1];
}

function sendAuthRequired(res: Response) {
  res
    .set("Cache-Control", "private, no-store")
    .set("WWW-Authenticate", 'Bearer realm="external-uploads"')
    .status(401)
    .json({
      error: "shoo_auth_required",
      message: "Sign in with Google to upload files."
    });
}
