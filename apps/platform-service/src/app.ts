import type { IncomingHttpHeaders } from "node:http";
import type { Request as NodeRequest } from "express";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response
} from "express";
import {
  AccessDeniedError,
  type AccessActor,
  type AccessVerifier
} from "../../tools-web/src/auth.ts";
import type { Authentication, FetchHandler } from "../../field-guide-console/src/http.ts";
import {
  InvalidHeartbeatTokenError,
  type TowerHeartbeat
} from "./tower-heartbeat.ts";

const MAX_FETCH_BODY_BYTES = 512 * 1024;

export interface PlatformAccess {
  manage: AccessVerifier;
  publisher: AccessVerifier;
  review: AccessVerifier;
}

export function createPlatformApp(options: {
  access: PlatformAccess;
  artifact: RequestHandler;
  fieldGuide: FetchHandler;
  tools: FetchHandler;
  towerHeartbeat?: TowerHeartbeat;
  health: () => Promise<void>;
  componentHealth?: {
    tools: () => Promise<void>;
    publisher: () => Promise<void>;
    review: () => Promise<void>;
  };
  publicOrigin: string;
}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.get("/live", (_request, response) => {
    response.set("Cache-Control", "no-store").status(200).json({ ok: true });
  });
  app.get("/health", async (_request, response) => {
    try {
      await options.health();
      response.set("Cache-Control", "no-store").status(200).json({ ok: true });
    } catch {
      response
        .set("Cache-Control", "no-store")
        .status(503)
        .json({ ok: false, error: "dependency_unavailable" });
    }
  });
  if (options.towerHeartbeat) {
    app.post("/api/heartbeat/tower", async (request, response) => {
      try {
        await options.towerHeartbeat?.receive(request.get("authorization"));
        response.set("Cache-Control", "no-store").sendStatus(204);
      } catch (error) {
        if (error instanceof InvalidHeartbeatTokenError) {
          response
            .set("Cache-Control", "no-store")
            .status(401)
            .json({ error: "invalid_heartbeat_token" });
          return;
        }
        response
          .set("Cache-Control", "no-store")
          .status(503)
          .json({ error: "heartbeat_storage_unavailable" });
      }
    });
    app.get("/health/tower", async (_request, response) => {
      try {
        const healthy = await options.towerHeartbeat?.isHealthy();
        response
          .set("Cache-Control", "no-store")
          .status(healthy ? 200 : 503)
          .json(healthy ? { ok: true } : { ok: false, error: "heartbeat_stale" });
      } catch {
        response
          .set("Cache-Control", "no-store")
          .status(503)
          .json({ ok: false, error: "dependency_unavailable" });
      }
    });
  }
  if (options.componentHealth) {
    for (const [component, check] of Object.entries(options.componentHealth)) {
      app.get(`/health/${component}`, async (_request, response) => {
        try {
          await check();
          response.set("Cache-Control", "no-store").status(200).json({ ok: true });
        } catch {
          response
            .set("Cache-Control", "no-store")
            .status(503)
            .json({ ok: false, error: "dependency_unavailable" });
        }
      });
    }
  }

  const requireAccess = {
    manage: accessMiddleware(options.access.manage),
    publisher: accessMiddleware(options.access.publisher),
    review: accessMiddleware(options.access.review)
  };
  app.use((request, response, next) => {
    const family = accessFamily(request.path, request.method);
    if (!family) {
      next();
      return;
    }
    requireAccess[family](request, response, next);
  });
  app.use((request, response, next) => {
    const redirect = legacyBrowserRedirect(request);
    if (redirect) {
      response
        .set("Cache-Control", "private, no-store")
        .redirect(308, redirect);
      return;
    }
    if (isArtifactPath(request.path)) {
      options.artifact(request, response, next);
      return;
    }
    const handler = isFieldGuidePath(request.path)
      ? options.fieldGuide
      : options.tools;
    void dispatchFetch(handler, request, response, options.publicOrigin).catch(next);
  });

  app.use((_error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return;
    response.status(500).json({ error: "internal_error" });
  });
  return app;
}

export function accessAuthentication(access: AccessVerifier) {
  return async (request: globalThis.Request): Promise<Authentication> => {
    try {
      const actor = await access.verify(request);
      return { ok: true, email: actor.id };
    } catch {
      return {
        ok: false,
        response: new globalThis.Response(
          JSON.stringify({
            error: "access_required",
            message: "Cloudflare Access authentication is required."
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          }
        )
      };
    }
  };
}

export function accessMiddleware(access: AccessVerifier): RequestHandler {
  return (request, response, next) => {
    const accessRequest = new globalThis.Request(
      new URL(request.originalUrl, `${request.protocol}://${request.get("host")}`).toString(),
      { method: request.method, headers: fetchHeaders(request.headers) }
    );
    void access.verify(accessRequest).then(
      (actor) => {
        response.locals.accessActor = actor;
        next();
      },
      (error: unknown) => {
        if (!(error instanceof AccessDeniedError)) {
          next(error);
          return;
        }
        response
          .set("Cache-Control", "no-store")
          .status(401)
          .json({ error: "access_required" });
      }
    );
  };
}

export function accessActor(response: Response): AccessActor | undefined {
  const value: unknown = response.locals.accessActor;
  if (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
  ) {
    return { id: value.id };
  }
  return undefined;
}

function isArtifactPath(path: string): boolean {
  return [
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
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function isPublicPath(path: string): boolean {
  return [
    "/",
    "/status",
    "/favicon.ico",
    "/favicon.svg",
    "/assets/markdown-admin.js",
    "/assets/ops.js",
    "/assets/tools.css",
    "/assets/icons/artifact-publisher.png",
    "/assets/icons/field-guide-console.png",
    "/assets/icons/tools-status-directory.png",
    "/assets/icons/network-console.png",
    "/api/public/catalog"
  ].includes(path);
}

function isMachineApiPath(path: string): boolean {
  return path === "/api/uploads" ||
    path.startsWith("/api/uploads/") ||
    path === "/api/agent" ||
    path.startsWith("/api/agent/");
}

function isArtifactDeliveryPath(path: string): boolean {
  return ["/artifacts", "/files", "/p", "/f"].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

function accessFamily(
  path: string,
  method: string
): keyof PlatformAccess | undefined {
  if (
    (isPublicPath(path) &&
      (!["/assets/markdown-admin.js", "/assets/ops.js"].includes(path) ||
        method === "GET" ||
        method === "HEAD")) ||
    isMachineApiPath(path)
  ) {
    return undefined;
  }
  if (
    isArtifactDeliveryPath(path) &&
    (method === "GET" || method === "HEAD")
  ) {
    return undefined;
  }
  if (isArtifactPath(path)) return "publisher";
  if (isFieldGuidePath(path)) return "review";
  return "manage";
}

function isFieldGuidePath(path: string): boolean {
  return ["/review", "/review.css", "/review-suite.css", "/api/review", "/api/agent"].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

function legacyBrowserRedirect(request: Request): string | undefined {
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  const path = request.path;
  let destination: string | undefined;
  if (path === "/uploads" || path === "/uploads/callback") {
    destination = "/publish";
  } else if (path === "/ops" || path.startsWith("/ops/")) {
    destination = `/manage${path.slice("/ops".length)}`;
  } else if (path === "/p" || path.startsWith("/p/")) {
    destination = `/artifacts${path.slice("/p".length)}`;
  } else if (path === "/f" || path.startsWith("/f/")) {
    destination = `/files${path.slice("/f".length)}`;
  }
  return destination === undefined
    ? undefined
    : `${destination}${request.originalUrl.slice(request.path.length)}`;
}

async function dispatchFetch(
  handler: FetchHandler,
  request: NodeRequest,
  response: Response,
  publicOrigin: string
) {
  const body = ["GET", "HEAD"].includes(request.method)
    ? undefined
    : await readBody(request);
  const fetchRequest = new globalThis.Request(
    new URL(request.originalUrl, publicOrigin),
    {
      method: request.method,
      headers: fetchHeaders(request.headers),
      ...(body ? { body } : {})
    }
  );
  const result = await handler(fetchRequest);
  response.status(result.status);
  result.headers.forEach((value, name) => response.setHeader(name, value));
  if (request.method === "HEAD" || !result.body) {
    response.end();
    return;
  }
  response.send(Buffer.from(await result.arrayBuffer()));
}

async function readBody(request: NodeRequest): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    total += chunk.byteLength;
    if (total > MAX_FETCH_BODY_BYTES) {
      throw new Error("Fetch-routed request body is too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function fetchHeaders(source: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}
