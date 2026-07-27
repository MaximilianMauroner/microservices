import {
  decodeCatalogDocument,
  type CatalogDocument,
  type PublicSnapshotDocument
} from "@tools-platform/domain";
import { AccessDeniedError, type AccessVerifier } from "./auth.js";
import { BucketReadError } from "./bucket.js";
import {
  addEntry,
  addGroup,
  archiveEntry,
  deleteEntry,
  deleteGroup,
  MutationError,
  reorder,
  setMonitorPaused
} from "./mutations.js";
import {
  CatalogConflictError,
  CatalogNotFoundError,
  type WebStorage
} from "./storage.js";

export interface PageRenderer {
  public(snapshot: PublicSnapshotDocument): Response | Promise<Response>;
  ops(catalog: CatalogDocument, actor: string): Response | Promise<Response>;
}

export interface AppLogger {
  info(event: string, fields: Readonly<Record<string, string | number>>): void;
  error(event: string, fields: Readonly<Record<string, string | number>>): void;
}

export function createApp(options: {
  storage: WebStorage;
  access: AccessVerifier;
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
      const response = await route(request, url, options.storage, options.access, renderer);
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
  access: AccessVerifier,
  renderer: PageRenderer
): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/health") {
    await storage.liveness();
    return json({ ok: true });
  }
  if (request.method === "GET" && url.pathname === "/api/public/catalog") {
    return json(await storage.readPublicSnapshot(), {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=240" }
    });
  }
  if (request.method === "GET" && url.pathname === "/") {
    return renderer.public(await storage.readPublicSnapshot());
  }

  if (isProtectedPath(url.pathname)) {
    const actor = await access.verify(request);
    if (
      request.method === "GET" &&
      (url.pathname === "/ops" || url.pathname.startsWith("/ops/"))
    ) {
      return renderer.ops((await storage.readCatalog()).catalog, actor.id);
    }
    if (request.method === "GET" && url.pathname === "/api/ops/catalog") {
      const { catalog } = await storage.readCatalog();
      return catalogResponse(catalog);
    }
    if (request.method === "GET" && url.pathname === "/api/ops/snapshot") {
      return json(await storage.readPrivateSnapshot(), {
        headers: { "Cache-Control": "private, no-store" }
      });
    }
    return adminMutation(request, url, storage, actor.id);
  }

  return json({ error: "not_found" }, { status: 404 });
}

async function adminMutation(
  request: Request,
  url: URL,
  storage: WebStorage,
  actor: string
): Promise<Response> {
  if (!["POST", "PUT", "DELETE"].includes(request.method)) {
    return json({ error: "not_found" }, { status: 404 });
  }
  if (request.method === "PUT" && url.pathname === "/api/ops/catalog") {
    if (request.headers.get("if-none-match") !== "*") {
      throw new MutationError("Catalog initialization requires If-None-Match: *");
    }
    const input = await jsonBody(request);
    const catalog = decodeCatalogDocument(input);
    return catalogResponse(await storage.initializeCatalog(catalog, actor), 201);
  }

  const expectedRevision = parseIfMatch(request);
  const body = request.method === "DELETE" ? undefined : await jsonBody(request);

  if (request.method === "POST" && url.pathname === "/api/ops/groups") {
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      "group.create",
      "group",
      identifier(body),
      (catalog) => addGroup(catalog, parseAddedGroup(catalog, body))
    );
  }
  if (request.method === "POST" && url.pathname === "/api/ops/entries") {
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      "entry.create",
      "entry",
      identifier(body),
      (catalog) => addEntry(catalog, parseAddedEntry(catalog, body))
    );
  }
  if (request.method === "PUT" && url.pathname === "/api/ops/order") {
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      "catalog.reorder",
      "catalog",
      null,
      (catalog) => reorder(catalog, body)
    );
  }

  const match = url.pathname.match(
    /^\/api\/ops\/(groups|entries)\/([A-Za-z0-9_-]+)(?:\/(archive|pause|resume))?$/
  );
  if (!match) return json({ error: "not_found" }, { status: 404 });
  const kind = match[1];
  const id = match[2];
  const command = match[3];
  if (!kind || !id) return json({ error: "not_found" }, { status: 404 });

  if (kind === "groups" && !command && request.method === "PUT") {
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      "group.update",
      "group",
      id,
      (catalog) => replaceGroupFromInput(catalog, id, body)
    );
  }
  if (kind === "groups" && !command && request.method === "DELETE") {
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      "group.delete",
      "group",
      id,
      (catalog) => deleteGroup(catalog, id)
    );
  }
  if (kind === "entries" && !command && request.method === "PUT") {
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      "entry.update",
      "entry",
      id,
      (catalog) => replaceEntryFromInput(catalog, id, body)
    );
  }
  if (kind === "entries" && !command && request.method === "DELETE") {
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      "entry.delete",
      "entry",
      id,
      (catalog) => deleteEntry(catalog, id)
    );
  }
  if (kind === "entries" && request.method === "POST" && command === "archive") {
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      "entry.archive",
      "entry",
      id,
      (catalog) => archiveEntry(catalog, id)
    );
  }
  if (
    kind === "entries" &&
    request.method === "POST" &&
    (command === "pause" || command === "resume")
  ) {
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      `monitor.${command}`,
      "monitor",
      id,
      (catalog) => setMonitorPaused(catalog, id, command === "pause")
    );
  }
  return json({ error: "not_found" }, { status: 404 });
}

async function writeResponse(
  storage: WebStorage,
  revision: string,
  actor: string,
  action: string,
  targetType: "catalog" | "group" | "entry" | "monitor",
  targetId: string | null,
  mutate: (catalog: CatalogDocument) => CatalogDocument
): Promise<Response> {
  const catalog = await storage.updateCatalog(
    revision,
    actor,
    action,
    targetType,
    targetId,
    mutate
  );
  return catalogResponse(catalog);
}

function parseAddedGroup(catalog: CatalogDocument, input: unknown) {
  const id = identifier(input);
  const decoded = decodeCatalogDocument({
    ...catalog,
    groups: [...catalog.groups, input]
  });
  const group = decoded.groups.find((candidate) => candidate.id === id);
  if (!group) throw new MutationError("Invalid group");
  return group;
}

function parseAddedEntry(catalog: CatalogDocument, input: unknown) {
  const id = identifier(input);
  const decoded = decodeCatalogDocument({
    ...catalog,
    entries: [...catalog.entries, input]
  });
  const entry = decoded.entries.find((candidate) => candidate.id === id);
  if (!entry) throw new MutationError("Invalid entry");
  return entry;
}

function replaceGroupFromInput(
  catalog: CatalogDocument,
  id: string,
  input: unknown
): CatalogDocument {
  if (!catalog.groups.some((group) => group.id === id)) {
    throw new MutationError("Group not found", 404);
  }
  if (identifier(input) !== id) throw new MutationError("Group ID cannot change");
  return decodeCatalogDocument({
    ...catalog,
    groups: catalog.groups.map((group) => (group.id === id ? input : group))
  });
}

function replaceEntryFromInput(
  catalog: CatalogDocument,
  id: string,
  input: unknown
): CatalogDocument {
  if (!catalog.entries.some((entry) => entry.id === id)) {
    throw new MutationError("Entry not found", 404);
  }
  if (identifier(input) !== id) throw new MutationError("Entry ID cannot change");
  return decodeCatalogDocument({
    ...catalog,
    entries: catalog.entries.map((entry) => (entry.id === id ? input : entry))
  });
}

function identifier(input: unknown): string {
  if (
    typeof input !== "object" ||
    input === null ||
    !("id" in input) ||
    typeof input.id !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(input.id)
  ) {
    throw new MutationError("Body must contain a valid id");
  }
  return input.id;
}

async function jsonBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 256_000) throw new MutationError("Request body is too large");
  const text = await request.text();
  if (text.length > 256_000) throw new MutationError("Request body is too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new MutationError("Request body must be valid JSON");
  }
}

function parseIfMatch(request: Request): string {
  const value = request.headers.get("if-match");
  const revision = value?.replace(/^W\//, "").replace(/^"|"$/g, "");
  if (!revision || !/^[A-Za-z0-9_-]+$/.test(revision)) {
    throw new MutationError("A valid If-Match catalog revision is required");
  }
  return revision;
}

function isProtectedPath(path: string): boolean {
  return path === "/ops" || path.startsWith("/ops/") || path.startsWith("/api/ops/");
}

function catalogResponse(catalog: CatalogDocument, status = 200): Response {
  return json(catalog, {
    status,
    headers: {
      ETag: `"${catalog.revision}"`,
      "Cache-Control": "private, no-store"
    }
  });
}

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AccessDeniedError) {
    return json(
      { error: "access_required" },
      {
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="cloudflare-access"' }
      }
    );
  }
  if (error instanceof CatalogConflictError) {
    return json({ error: "catalog_conflict" }, { status: 409 });
  }
  if (error instanceof MutationError) {
    return json({ error: "invalid_request", message: error.message }, { status: error.status });
  }
  if (error instanceof CatalogNotFoundError) {
    return json({ error: "not_initialized" }, { status: 404 });
  }
  if (error instanceof BucketReadError) {
    return json({ error: "storage_unavailable" }, { status: 503 });
  }
  if (error instanceof Error && error.name === "SchemaDecodeError") {
    return json({ error: "invalid_catalog" }, { status: 400 });
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
  public(snapshot) {
    return json(snapshot);
  },
  ops(catalog) {
    return json(catalog, {
      headers: { "Cache-Control": "private, no-store" }
    });
  }
};

const safeConsoleLogger: AppLogger = {
  info(event, fields) {
    console.info(JSON.stringify({ event, ...fields }));
  },
  error(event, fields) {
    console.error(JSON.stringify({ event, ...fields }));
  }
};
