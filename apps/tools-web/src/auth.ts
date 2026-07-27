import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey
} from "jose";

export interface AccessActor {
  id: string;
}

export interface AccessVerifier {
  verify(request: Request): Promise<AccessActor>;
}

export class AccessDeniedError extends Error {
  constructor() {
    super("Cloudflare Access authentication required");
    this.name = "AccessDeniedError";
  }
}

export function createAccessVerifier(config: {
  issuer: string;
  audience: string;
  jwksUrl: string;
  key?: JWTVerifyGetKey;
}): AccessVerifier {
  const key = config.key ?? createRemoteJWKSet(new URL(config.jwksUrl));
  return {
    async verify(request) {
      const token = request.headers.get("cf-access-jwt-assertion");
      if (!token) throw new AccessDeniedError();
      try {
        const { payload } = await jwtVerify(token, key, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ["RS256"]
        });
        const email = typeof payload.email === "string" ? payload.email : null;
        const actor = email ?? payload.sub;
        if (
          !actor ||
          actor.length > 320 ||
          !/^[A-Za-z0-9][A-Za-z0-9@._+%-]*$/.test(actor)
        ) {
          throw new AccessDeniedError();
        }
        return { id: actor.toLowerCase() };
      } catch {
        throw new AccessDeniedError();
      }
    }
  };
}
