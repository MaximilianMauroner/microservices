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

const MAX_FETCH_BODY_BYTES = 512 * 1024;

export function createPlatformApp(options: {
  access: AccessVerifier;
  artifact: RequestHandler;
  fieldGuide: FetchHandler;
  tools: FetchHandler;
  health: () => Promise<void>;
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

  const requireAccess = accessMiddleware(options.access);
  app.use((request, response, next) => {
    if (isPublicPath(request.path)) {
      next();
      return;
    }
    requireAccess(request, response, next);
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
    "/assets/tools.css",
    "/api/public/catalog"
  ].includes(path);
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
