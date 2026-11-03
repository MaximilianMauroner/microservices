import { suiteChromeStyles } from "#suite-chrome";
import type { PublicSnapshotDocument } from "#domain";
import { BucketReadError } from "./bucket.js";
import type { WebStorage } from "./storage.js";
import {
  renderPublicPage,
  renderStatusPage
} from "./ui/index.js";

export interface PageRenderer {
  public(snapshot: PublicSnapshotDocument, publicOrigin: string): string;
  status(snapshot: PublicSnapshotDocument, publicOrigin: string): string;
}

export interface AppLogger {
  info(event: string, fields: Readonly<Record<string, string | number>>): void;
  error(event: string, fields: Readonly<Record<string, string | number>>): void;
}

export interface AuthenticatedPrincipal {
  id: string;
}

export type PrincipalAuthenticator = (
  request: Request
) => AuthenticatedPrincipal | Promise<AuthenticatedPrincipal>;

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authenticated principal required");
    this.name = "AuthenticationRequiredError";
  }
}

export function createApp(options: {
  storage: WebStorage;
  authenticate: PrincipalAuthenticator;
  trustedOrigin: string;
  renderer?: PageRenderer;
  logger?: AppLogger;
}): (request: Request) => Promise<Response> {
  const renderer = options.renderer ?? defaultRenderer;
  const logger = options.logger ?? safeConsoleLogger;

  return async (request) => {
    const started = performance.now();
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();
    try {
      const response = await route(
        request,
        url,
        options.storage,
        options.authenticate,
        renderer,
        options.trustedOrigin
      );
      logger.info("request.complete", {
        requestId,
        method: request.method,
        path: url.pathname,
        status: response.status,
        durationMs: Math.round(performance.now() - started)
      });
      return withCommonHeaders(response, requestId);
    } catch (error) {
      const response = errorResponse(error);
      logger.error("request.failed", {
        requestId,
        method: request.method,
        path: url.pathname,
        status: response.status,
        errorType: safeErrorType(error)
      });
      return withCommonHeaders(response, requestId);
    }
  };
}

async function route(
  request: Request,
  url: URL,
  storage: WebStorage,
  authenticate: PrincipalAuthenticator,
  renderer: PageRenderer,
  trustedOrigin: string
): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/health") {
    await storage.readiness();
    return json({ ok: true });
  }
  if (request.method === "GET" && url.pathname === "/live") {
    return json({ ok: true });
  }
  const readMethod = request.method === "GET" || request.method === "HEAD";
  if (readMethod && url.pathname === "/api/public/catalog") {
    return json(await storage.readPublicSnapshot(), {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=240" }
    });
  }
  if (readMethod && url.pathname === "/") {
    return html(renderer.public(await storage.readPublicSnapshot(), trustedOrigin));
  }
  if (readMethod && url.pathname === "/status") {
    return html(renderer.status(await storage.readPublicSnapshot(), trustedOrigin));
  }
  if (readMethod && url.pathname === "/assets/suite.css") {
    return new Response(suiteChromeStyles, {
      headers: {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=300"
      }
    });
  }

  if (isProtectedPath(url.pathname)) {
    await authenticate(request);
    if (request.method === "GET" && url.pathname === "/api/ops/snapshot") {
      return json(await storage.readPrivateSnapshot(), {
        headers: { "Cache-Control": "private, no-store" }
      });
    }
  }

  return json({ error: "not_found" }, { status: 404 });
}

function isProtectedPath(path: string): boolean {
  return path === "/api/ops/snapshot";
}

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AuthenticationRequiredError) {
    return json(
      { error: "authentication_required" },
      { status: 401 }
    );
  }
  if (error instanceof BucketReadError) {
    return json({ error: "storage_unavailable" }, { status: 503 });
  }
  return json({ error: "internal_error" }, { status: 500 });
}

function safeErrorType(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z]+$/.test(error.name)) return error.name;
  return "UnknownError";
}

function withCommonHeaders(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Request-Id", requestId);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, { status: response.status, headers });
}

const defaultRenderer: PageRenderer = {
  public(snapshot, publicOrigin) {
    return renderPublicPage(snapshot, publicOrigin);
  },
  status(snapshot, publicOrigin) {
    return renderStatusPage(snapshot, publicOrigin);
  }
};

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    }
  });
}

const safeConsoleLogger: AppLogger = {
  info(event, fields) {
    console.info(JSON.stringify({ event, ...fields }));
  },
  error(event, fields) {
    console.error(JSON.stringify({ event, ...fields }));
  }
};
