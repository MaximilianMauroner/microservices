export type PlatformPrincipal =
  | Readonly<{ role: "admin"; subject: string; email: string }>
  | Readonly<{ role: "member"; subject: string; email: string; products: readonly string[] }>;

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

export type ServiceFamily = "manage" | "publisher";

/** Returns the mounted service that owns a path, independently of its auth mode. */
export function serviceForPath(pathname: string): ServiceFamily {
  if (isArtifactPath(pathname)) return "publisher";
  return "manage";
}

export type RouteAccess =
  | { kind: "public" }
  | { kind: "machine"; service: "uploads" | "heartbeat" | "mcp" | "kitchen-app" | "bodyshop-app" }
  | { kind: "server-function" }
  | { kind: "human-session" };

export const SERVER_FUNCTION_BASE_PATH = "/_serverFn";

const PUBLIC_PATHS = new Set([
  "/sign-in",
  "/favicon.ico",
  "/favicon.svg",
  "/live",
  "/health",
  "/health/tools",
  "/health/publisher",
  "/health/tower"
]);

export function classifyRoute(pathname: string, method: string): RouteAccess {
  const normalizedMethod = method.toUpperCase();
  if (PUBLIC_PATHS.has(pathname)) {
    return { kind: "public" };
  }

  if ((normalizedMethod === "GET" || normalizedMethod === "HEAD") && isHashedBrowserAssetPath(pathname)) {
    return { kind: "public" };
  }

  if (matchesPrefix(pathname, ["/api/auth"])) return { kind: "public" };

  if ((normalizedMethod === "GET" || normalizedMethod === "HEAD") && matchesPrefix(pathname, ["/.well-known"])) {
    return { kind: "public" };
  }

  if (pathname === "/api/mcp") return { kind: "machine", service: "mcp" };

  if (matchesPrefix(pathname, ["/api/kitchen"])) return { kind: "machine", service: "kitchen-app" };

  if (matchesPrefix(pathname, ["/api/bodyshop/app"])) return { kind: "machine", service: "bodyshop-app" };

  if (pathname === "/api/reports" && normalizedMethod === "POST") return { kind: "public" };

  if (/^\/feedback\/f\/[^/]+$/.test(pathname) && (normalizedMethod === "GET" || normalizedMethod === "HEAD" || normalizedMethod === "POST")) {
    return { kind: "public" };
  }

  if (pathname === "/feedback/confirmation" && (normalizedMethod === "GET" || normalizedMethod === "HEAD")) return { kind: "public" };

  if (/^\/feedback\/share\/[A-Za-z0-9_-]{43}$/.test(pathname) && (normalizedMethod === "GET" || normalizedMethod === "HEAD")) {
    return { kind: "public" };
  }

  if ((pathname === "/api/share/documents" && normalizedMethod === "POST") ||
    (/^\/api\/share\/documents\/[^/]+(?:\/(?:updates|steps|pin|checkpoints(?:\/compare)?|presence|leave))?$/.test(pathname) &&
      (normalizedMethod === "GET" || normalizedMethod === "POST"))) return { kind: "public" };

  if (isMarkdownSharePath(pathname) && (normalizedMethod === "GET" || normalizedMethod === "HEAD")) {
    return { kind: "public" };
  }

  if (/^\/drop\/[^/]+\/?$/.test(pathname) && (normalizedMethod === "GET" || normalizedMethod === "HEAD")) {
    return { kind: "public" };
  }

  if (
    /^\/api\/drop\/[^/]+\/uploads\/sessions(?:\/[0-9a-f-]{36}(?:\/(?:parts|complete))?)?$/.test(pathname) &&
    ["GET", "POST", "DELETE"].includes(normalizedMethod)
  ) {
    return { kind: "public" };
  }

  if (
    (normalizedMethod === "GET" || normalizedMethod === "HEAD") &&
    matchesPrefix(pathname, ["/artifacts", "/files"])
  ) {
    return { kind: "public" };
  }

  if (isMachineApiPath(pathname)) {
    return {
      kind: "machine",
      service: isHeartbeatPath(pathname)
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
    "/api/upload-links",
    "/api/drop",
    "/drop",
    "/artifacts",
    "/files"
  ]);
}

export function isMachineApiPath(pathname: string): boolean {
  return (
    isHeartbeatPath(pathname) ||
    matchesPrefix(pathname, ["/api/uploads"])
  );
}

export function isHeartbeatPath(pathname: string): boolean {
  return matchesPrefix(pathname, ["/api/status/heartbeats"]);
}

export function isMarkdownSharePath(pathname: string): boolean {
  return /^\/(?:markdown|share)\/?$/.test(pathname) || /^\/(?:markdown|share)\/d\/[^/]+\/?$/.test(pathname);
}

export function isHashedBrowserAssetPath(pathname: string): boolean {
  return /^\/assets\/[A-Za-z0-9_]+-[A-Za-z0-9_-]{8,}\.(?:css|js|png)$/.test(pathname);
}

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
