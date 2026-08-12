export interface PlatformPrincipal {
  subject: string;
  email: string;
}

const verifiedPrincipal = Symbol("tools-platform.verified-principal");

type RequestWithPrincipal = Request & {
  [verifiedPrincipal]?: PlatformPrincipal;
};

export function attachPlatformPrincipal(
  request: Request,
  principal: PlatformPrincipal
): Request {
  Object.defineProperty(request, verifiedPrincipal, {
    configurable: true,
    value: principal,
    writable: false
  });
  return request;
}

export function getAttachedPlatformPrincipal(
  request: Request
): PlatformPrincipal | undefined {
  return (request as RequestWithPrincipal)[verifiedPrincipal];
}

export type ServiceFamily = "manage" | "publisher" | "review";

/** Returns the mounted service that owns a path, independently of its auth mode. */
export function serviceForPath(pathname: string): ServiceFamily {
  if (isArtifactPath(pathname)) return "publisher";
  if (isFieldGuidePath(pathname)) return "review";
  return "manage";
}

export type RouteAccess =
  | { kind: "public" }
  | { kind: "machine"; service: "uploads" | "agent" | "heartbeat" }
  | { kind: "server-function" }
  | { kind: "human-session" };

export const SERVER_FUNCTION_BASE_PATH = "/_serverFn";

const PUBLIC_PATHS = new Set([
  "/sign-in",
  "/favicon.ico",
  "/favicon.svg",
  "/assets/markdown-admin.js",
  "/assets/local-time.js",
  "/assets/ops.js",
  "/assets/tools.css",
  "/assets/icons/publisher.png",
  "/assets/icons/field-guide.png",
  "/assets/icons/status.png",
  "/assets/icons/money.png",
  "/assets/icons/markdown-share.png",
  "/assets/icons/network-console.png",
  "/assets/icons/tools.png",
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
      return { kind: "human-session" };
    }
    return { kind: "public" };
  }

  if (matchesPrefix(pathname, ["/api/auth"])) return { kind: "public" };

  if (
    (normalizedMethod === "GET" || normalizedMethod === "HEAD") &&
    matchesPrefix(pathname, ["/artifacts", "/files"])
  ) {
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

  if (isServerFunctionPath(pathname)) return { kind: "server-function" };

  return { kind: "human-session" };
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
    "/publisher",
    "/api/uploads",
    "/api/external-uploads",
    "/artifacts",
    "/files"
  ]);
}

export function isFieldGuidePath(pathname: string): boolean {
  return matchesPrefix(pathname, ["/field-guide", "/api/review", "/api/agent"]);
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
  return matchesPrefix(pathname, ["/api/status/heartbeats"]);
}

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
