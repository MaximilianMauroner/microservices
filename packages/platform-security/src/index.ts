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

const verifiedActor = Symbol("tools-platform.verified-access-actor");

type RequestWithActor = Request & {
  [verifiedActor]?: AccessActor;
};

export function attachAccessActor(request: Request, actor: AccessActor): Request {
  Object.defineProperty(request, verifiedActor, {
    configurable: true,
    value: actor,
    writable: false
  });
  return request;
}

export function getAttachedAccessActor(request: Request): AccessActor | undefined {
  return (request as RequestWithActor)[verifiedActor];
}

export class AccessDeniedError extends Error {
  constructor() {
    super("Cloudflare Access authentication required");
    this.name = "AccessDeniedError";
  }
}

export function createAccessVerifier(config: {
  issuer: string;
  audience: string | string[];
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

export type AccessFamily = "manage" | "publisher" | "review";

export type RouteAccess =
  | { kind: "public" }
  | { kind: "machine"; service: "uploads" | "agent" | "heartbeat" }
  | { kind: "server-function" }
  | { kind: "access"; family: AccessFamily };

export const SERVER_FUNCTION_BASE_PATH = "/_serverFn";

const PUBLIC_PATHS = new Set([
  "/",
  "/status",
  "/favicon.ico",
  "/favicon.svg",
  "/assets/markdown-admin.js",
  "/assets/local-time.js",
  "/assets/ops.js",
  "/assets/tools.css",
  "/assets/icons/artifact-publisher.png",
  "/assets/icons/field-guide-console.png",
  "/assets/icons/tools-status-directory.png",
  "/assets/icons/network-console.png",
  "/api/public/catalog",
  "/live",
  "/health",
  "/health/tools",
  "/health/publisher",
  "/health/review",
  "/health/tower"
]);

export function classifyRoute(pathname: string, method: string): RouteAccess {
  const normalizedMethod = method.toUpperCase();
  if (PUBLIC_PATHS.has(pathname)) {
    if (
      (pathname === "/assets/markdown-admin.js" || pathname === "/assets/ops.js") &&
      normalizedMethod !== "GET" &&
      normalizedMethod !== "HEAD"
    ) {
      return { kind: "access", family: "manage" };
    }
    return { kind: "public" };
  }

  if (isMachineApiPath(pathname)) {
    return {
      kind: "machine",
      service: isAgentPath(pathname)
        ? "agent"
        : isHeartbeatPath(pathname)
          ? "heartbeat"
          : "uploads"
    };
  }

  if (isServerFunctionPath(pathname)) {
    return { kind: "server-function" };
  }

  if (isArtifactDeliveryPath(pathname) && isReadMethod(normalizedMethod)) {
    return { kind: "public" };
  }

  if (isArtifactPath(pathname)) {
    return { kind: "access", family: "publisher" };
  }
  if (isFieldGuidePath(pathname)) {
    return { kind: "access", family: "review" };
  }
  return { kind: "access", family: "manage" };
}

export function isServerFunctionPath(
  pathname: string,
  basePath = SERVER_FUNCTION_BASE_PATH
): boolean {
  const normalizedBasePath = basePath.endsWith("/")
    ? basePath.slice(0, -1)
    : basePath;
  return matchesPrefix(pathname, [normalizedBasePath]);
}

export function isArtifactPath(pathname: string): boolean {
  return matchesPrefix(pathname, [
    "/favicon.ico",
    "/favicon.svg",
    "/publish",
    "/uploads",
    "/api/uploads",
    "/api/external-uploads",
    "/artifacts",
    "/files",
    "/p",
    "/f"
  ]);
}

export function isFieldGuidePath(pathname: string): boolean {
  return matchesPrefix(pathname, [
    "/review",
    "/review.css",
    "/review-suite.css",
    "/api/review",
    "/api/agent"
  ]);
}

export function isMachineApiPath(pathname: string): boolean {
  return (
    isAgentPath(pathname) ||
    isHeartbeatPath(pathname) ||
    matchesPrefix(pathname, ["/api/uploads"])
  );
}

export function isAgentPath(pathname: string): boolean {
  return matchesPrefix(pathname, ["/api/agent"]);
}

export function isHeartbeatPath(pathname: string): boolean {
  return pathname === "/api/heartbeat/tower";
}

export function isArtifactDeliveryPath(pathname: string): boolean {
  return matchesPrefix(pathname, ["/artifacts", "/files", "/p", "/f"]);
}

export function isReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
