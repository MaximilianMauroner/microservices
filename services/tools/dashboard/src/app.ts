import { readFile } from "node:fs/promises";
import { dirname, resolve, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { suiteChromeStyles } from "@tools-platform/suite-chrome";
import {
  decodeCatalogDocument,
  validateLiteralTarget,
  type CatalogDocument,
  type PrivateSnapshotDocument,
  type PublicSnapshotDocument
} from "@tools-platform/domain";
import { BucketReadError } from "./bucket.js";
import {
  MarkdownAdminUnavailableError,
  type MarkdownAdminReader,
  type MarkdownAdminSnapshot
} from "./markdown-admin.js";
import {
  addEntry,
  addGroup,
  archiveEntry,
  deleteEntry,
  deleteGroup,
  moveEntry,
  moveGroup,
  MutationError,
  reorder,
  restoreEntry,
  setMonitorPaused
} from "./mutations.js";
import {
  CatalogConflictError,
  CatalogNotFoundError,
  type WebStorage
} from "./storage.js";
import {
  renderMarkdownAdminPage,
  renderOperationsPage,
  renderPrivateStatusPage,
  renderPublicPage,
  renderStatusPage
} from "./ui/index.js";

const STATIC_ASSETS = {
  "/assets/tools.css": {
    file: "../public/assets/tools.css",
    contentType: "text/css; charset=utf-8"
  },
  "/assets/ops.js": {
    file: "../public/assets/ops.js",
    contentType: "text/javascript; charset=utf-8"
  },
  "/assets/markdown-admin.js": {
    file: "../public/assets/markdown-admin.js",
    contentType: "text/javascript; charset=utf-8"
  },
  "/assets/local-time.js": {
    file: "../public/assets/local-time.js",
    contentType: "text/javascript; charset=utf-8"
  },
  "/assets/icons/publisher.png": {
    file: "../public/assets/icons/publisher.png",
    contentType: "image/png"
  },
  "/assets/icons/field-guide.png": {
    file: "../public/assets/icons/field-guide.png",
    contentType: "image/png"
  },
  "/assets/icons/status.png": {
    file: "../public/assets/icons/status.png",
    contentType: "image/png"
  },
  "/assets/icons/money.png": {
    file: "../public/assets/icons/money.png",
    contentType: "image/png"
  },
  "/assets/icons/markdown-share.png": {
    file: "../public/assets/icons/markdown-share.png",
    contentType: "image/png"
  },
  "/assets/icons/network-console.png": {
    file: "../public/assets/icons/network-console.png",
    contentType: "image/png"
  }
} as const;

type StaticAssetPath = keyof typeof STATIC_ASSETS;

export interface PageRenderer {
  public(snapshot: PublicSnapshotDocument, publicOrigin: string): string;
  status(snapshot: PublicSnapshotDocument, publicOrigin: string): string;
  privateStatus(
    snapshot: PrivateSnapshotDocument,
    actor: string,
    publicOrigin: string
  ): string;
  ops(snapshot: PrivateSnapshotDocument, actor: string, revision: string): string;
  markdownDocuments(
    snapshot: MarkdownAdminSnapshot,
    actor: string,
    publicOrigin: string
  ): string;
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
  markdownAdmin: MarkdownAdminReader;
  markdownSharePublicOrigin: string;
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
        options.markdownAdmin,
        options.markdownSharePublicOrigin,
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
  markdownAdmin: MarkdownAdminReader,
  markdownSharePublicOrigin: string,
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
  if (readMethod && isStaticAssetPath(url.pathname)) {
    return asset(url.pathname);
  }

  if (isProtectedPath(url.pathname)) {
    const actor = await authenticate(request);
    if (
      readMethod &&
      (url.pathname === "/manage/status" || url.pathname === "/status/private")
    ) {
      return html(
        renderer.privateStatus(
          await storage.readPrivateSnapshot(),
          actor.id,
          trustedOrigin
        ),
        true
      );
    }
    if (
      readMethod &&
      url.pathname === "/manage/documents"
    ) {
      return html(
        renderer.markdownDocuments(
          await markdownAdmin.list(),
          actor.id,
          markdownSharePublicOrigin
        ),
        true
      );
    }
    if (request.method === "GET" && url.pathname === "/api/ops/documents") {
      return json(
        {
          ...await markdownAdmin.list(),
          publicOrigin: markdownSharePublicOrigin
        },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    if (
      readMethod &&
      (url.pathname === "/manage" || url.pathname.startsWith("/manage/") ||
        url.pathname === "/ops" || url.pathname.startsWith("/ops/"))
    ) {
      const [{ catalog }, prepared] = await Promise.all([
        storage.readCatalog(),
        storage.readPrivateSnapshot()
      ]);
      const snapshot: PrivateSnapshotDocument = {
        ...prepared,
        catalogRevision: catalog.revision,
        catalog
      };
      return html(renderer.ops(snapshot, actor.id, catalog.revision), true);
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
    if (request.method === "GET" && url.pathname === "/api/ops/audit") {
      return json(
        await storage.readAuditPage(
          paginationCursor(url),
          paginationLimit(url)
        ),
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    if (request.method === "GET" && url.pathname === "/api/ops/history") {
      return json(
        await storage.readHistoryPage(
          paginationCursor(url),
          paginationLimit(url)
        ),
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    if (request.method === "GET" && url.pathname === "/api/ops/incidents") {
      const cursor = paginationCursor(url);
      return json(
        await storage.readIncidentPage(cursor, paginationLimit(url)),
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    return adminMutation(
      request,
      url,
      storage,
      actor.id,
      trustedOrigin
    );
  }

  return json({ error: "not_found" }, { status: 404 });
}

async function adminMutation(
  request: Request,
  url: URL,
  storage: WebStorage,
  actor: string,
  trustedOrigin: string
): Promise<Response> {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    return json({ error: "not_found" }, { status: 404 });
  }
  enforceMutationBoundary(request, trustedOrigin);
  if (request.method === "PUT" && url.pathname === "/api/ops/catalog") {
    if (request.headers.get("if-none-match") !== "*") {
      throw new MutationError("Catalog initialization requires If-None-Match: *");
    }
    const input = await jsonBody(request);
    const catalog = decodeAdminCatalog(input);
    return mutationResponse(await storage.initializeCatalog(catalog, actor), 201);
  }

  const expectedRevision = parseIfMatch(request);
  const body = request.method === "DELETE" ? undefined : await jsonBody(request);

  if (request.method === "POST" && url.pathname === "/api/ops/groups") {
    const inputId = identifierOrGenerated(body);
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      "group.create",
      "group",
      inputId,
      (catalog) => addGroup(catalog, parseCreatedGroup(catalog, body, inputId))
    );
  }
  if (request.method === "POST" && url.pathname === "/api/ops/entries") {
    const inputId = identifierOrGenerated(body);
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      "entry.create",
      "entry",
      inputId,
      (catalog) => addEntry(catalog, parseCreatedEntry(catalog, body, inputId))
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
    /^\/api\/ops\/(groups|entries)\/([A-Za-z0-9_-]+)(?:\/(reorder|archive|restore|pause|resume)|\/monitor\/(pause|resume))?$/
  );
  if (!match) return json({ error: "not_found" }, { status: 404 });
  const kind = match[1];
  const id = match[2];
  const command = match[4] ?? match[3];
  if (!kind || !id) return json({ error: "not_found" }, { status: 404 });

  if (
    kind === "groups" &&
    !command &&
    (request.method === "PUT" || request.method === "PATCH")
  ) {
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      "group.update",
      "group",
      id,
      (catalog) =>
        request.method === "PATCH"
          ? patchGroupFromInput(catalog, id, body)
          : replaceGroupFromInput(catalog, id, body)
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
  if (
    kind === "entries" &&
    !command &&
    (request.method === "PUT" || request.method === "PATCH")
  ) {
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      "entry.update",
      "entry",
      id,
      (catalog) =>
        request.method === "PATCH"
          ? patchEntryFromInput(catalog, id, body)
          : replaceEntryFromInput(catalog, id, body)
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
  if (kind === "entries" && request.method === "POST" && command === "restore") {
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      "entry.restore",
      "entry",
      id,
      (catalog) => restoreEntry(catalog, id)
    );
  }
  if (
    request.method === "POST" &&
    command === "reorder" &&
    (kind === "groups" || kind === "entries")
  ) {
    const direction = reorderDirection(body);
    return writeResponse(
      storage,
      expectedRevision,
      actor,
      `${kind === "groups" ? "group" : "entry"}.reorder`,
      kind === "groups" ? "group" : "entry",
      id,
      (catalog) =>
        kind === "groups"
          ? moveGroup(catalog, id, direction)
          : moveEntry(catalog, id, direction)
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
  return mutationResponse(catalog, 200, catalog.revision !== revision);
}

function parseCreatedGroup(
  catalog: CatalogDocument,
  input: unknown,
  id: string
) {
  const body = inputRecord(input);
  const decoded = decodeAdminCatalog({
    ...catalog,
    groups: [
      ...catalog.groups,
      {
        id,
        name: requiredString(body, "name"),
        ...(optionalString(body, "description") === undefined
          ? {}
          : { description: optionalString(body, "description") }),
        order: nextOrder(catalog.groups),
        visibility: body.visibility ?? "private"
      }
    ]
  });
  const group = decoded.groups.find((candidate) => candidate.id === id);
  if (!group) throw new MutationError("Invalid group");
  return group;
}

function decodeAdminCatalog(input: unknown): CatalogDocument {
  const catalog = decodeCatalogDocument(input);
  for (const entry of catalog.entries) {
    if (!entry.monitor) continue;
    try {
      validateLiteralTarget(new URL(entry.monitor.url).hostname);
    } catch {
      throw new MutationError("Monitor URL cannot target a blocked literal address");
    }
  }
  return catalog;
}

function parseCreatedEntry(
  catalog: CatalogDocument,
  input: unknown,
  id: string
) {
  const body = inputRecord(input);
  const groupId = requiredString(body, "groupId");
  const decoded = decodeAdminCatalog({
    ...catalog,
    entries: [
      ...catalog.entries,
      {
        id,
        groupId,
        name: requiredString(body, "name"),
        description: requiredString(body, "description"),
        order: nextOrder(
          catalog.entries.filter((entry) => entry.groupId === groupId)
        ),
        visibility: body.visibility ?? "private",
        lifecycle: "active",
        links: body.links ?? [],
        ...parseOptionalMonitor(body),
        ...(optionalString(body, "privateNotes") === undefined
          ? {}
          : { privateNotes: optionalString(body, "privateNotes") })
      }
    ]
  });
  const entry = decoded.entries.find((candidate) => candidate.id === id);
  if (!entry) throw new MutationError("Invalid entry");
  return entry;
}

function patchGroupFromInput(
  catalog: CatalogDocument,
  id: string,
  input: unknown
): CatalogDocument {
  const current = catalog.groups.find((group) => group.id === id);
  if (!current) {
    throw new MutationError("Group not found", 404);
  }
  const body = inputRecord(input);
  return decodeAdminCatalog({
    ...catalog,
    groups: catalog.groups.map((group) =>
      group.id === id
        ? {
            ...current,
            ...(body.name === undefined
              ? {}
              : { name: requiredString(body, "name") }),
            ...(body.description === undefined
              ? {}
              : { description: requiredString(body, "description", true) }),
            ...(body.visibility === undefined
              ? {}
              : { visibility: body.visibility })
          }
        : group
    )
  });
}

function replaceGroupFromInput(
  catalog: CatalogDocument,
  id: string,
  input: unknown
): CatalogDocument {
  if (!catalog.groups.some((group) => group.id === id)) {
    throw new MutationError("Group not found", 404);
  }
  if (requiredIdentifier(input) !== id) {
    throw new MutationError("Group ID cannot change");
  }
  return decodeAdminCatalog({
    ...catalog,
    groups: catalog.groups.map((group) => (group.id === id ? input : group))
  });
}

function patchEntryFromInput(
  catalog: CatalogDocument,
  id: string,
  input: unknown
): CatalogDocument {
  const current = catalog.entries.find((entry) => entry.id === id);
  if (!current) {
    throw new MutationError("Entry not found", 404);
  }
  const body = inputRecord(input);
  const monitorFieldsPresent =
    body.monitor !== undefined ||
    Object.keys(body).some((key) => key.startsWith("monitor."));
  const monitor = monitorFieldsPresent
    ? parsePatchedMonitor(body, current.monitor)
    : current.monitor;
  return decodeAdminCatalog({
    ...catalog,
    entries: catalog.entries.map((entry) =>
      entry.id === id
        ? {
            ...current,
            ...(body.name === undefined
              ? {}
              : { name: requiredString(body, "name") }),
            ...(body.groupId === undefined
              ? {}
              : { groupId: requiredString(body, "groupId") }),
            ...(body.description === undefined
              ? {}
              : { description: requiredString(body, "description", true) }),
            ...(body.visibility === undefined
              ? {}
              : { visibility: body.visibility }),
            ...(body.links === undefined ? {} : { links: body.links }),
            ...(body.privateNotes === undefined
              ? {}
              : { privateNotes: requiredString(body, "privateNotes", true) }),
            ...(monitor === undefined ? { monitor: undefined } : { monitor })
          }
        : entry
    )
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
  if (requiredIdentifier(input) !== id) {
    throw new MutationError("Entry ID cannot change");
  }
  return decodeAdminCatalog({
    ...catalog,
    entries: catalog.entries.map((entry) => (entry.id === id ? input : entry))
  });
}

function identifierOrGenerated(input: unknown): string {
  const body = inputRecord(input);
  if (body.id !== undefined) {
    if (typeof body.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(body.id)) {
      throw new MutationError("id must be a URL-safe identifier");
    }
    return body.id;
  }
  const base = requiredString(body, "name")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "item"}-${crypto.randomUUID().slice(0, 8)}`;
}

function requiredIdentifier(input: unknown): string {
  const body = inputRecord(input);
  if (typeof body.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(body.id)) {
    throw new MutationError("Body must contain a valid id");
  }
  return body.id;
}

function inputRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new MutationError("Request body must be a JSON object");
  }
  return Object.fromEntries(Object.entries(input));
}

function requiredString(
  body: Record<string, unknown>,
  name: string,
  allowEmpty = false
): string {
  const value = body[name];
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim().length === 0)
  ) {
    throw new MutationError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(
  body: Record<string, unknown>,
  name: string
): string | undefined {
  if (body[name] === undefined) return undefined;
  return requiredString(body, name, true);
}

function nextOrder(values: ReadonlyArray<{ order: number }>): number {
  return values.reduce((highest, value) => Math.max(highest, value.order), -1) + 1;
}

function parseOptionalMonitor(
  body: Record<string, unknown>
): { monitor?: unknown } {
  if (body.monitor === undefined) return {};
  return { monitor: body.monitor };
}

function parsePatchedMonitor(
  body: Record<string, unknown>,
  current: CatalogDocument["entries"][number]["monitor"]
): CatalogDocument["entries"][number]["monitor"] {
  const nested =
    body.monitor === undefined ? {} : inputRecord(body.monitor);
  const url =
    nested.url ?? body["monitor.url"] ?? current?.url ?? "";
  if (typeof url !== "string") {
    throw new MutationError("monitor.url must be a string");
  }
  if (url.trim() === "") return undefined;
  const enabled =
    nested.enabled ?? body["monitor.enabled"] ?? current?.enabled ?? false;
  const tracking =
    nested.tracking ?? body["monitor.tracking"] ?? current?.tracking ?? "http";
  const scope = nested.scope ?? body["monitor.scope"] ?? current?.scope ?? "public";
  if (typeof enabled !== "boolean") {
    throw new MutationError("monitor.enabled must be a boolean");
  }
  if (scope !== "public" && scope !== "tailscale") {
    throw new MutationError("monitor.scope must be public or tailscale");
  }
  if (tracking !== "http" && tracking !== "heartbeat") {
    throw new MutationError("monitor.tracking must be http or heartbeat");
  }
  return {
    tracking,
    enabled,
    paused: current?.paused ?? false,
    scope,
    url: url.trim()
  };
}

function reorderDirection(body: unknown): "up" | "down" {
  const value = inputRecord(body).direction;
  if (value !== "up" && value !== "down") {
    throw new MutationError("direction must be up or down");
  }
  return value;
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

function enforceMutationBoundary(
  request: Request,
  trustedOrigin: string
): void {
  if (request.headers.get("origin") !== trustedOrigin) {
    throw new CsrfError();
  }
  const contentType = request.headers.get("content-type");
  if (contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new MutationError("Content-Type must be application/json");
  }
}

class CsrfError extends Error {
  constructor() {
    super("Mutation origin is not trusted");
    this.name = "CsrfError";
  }
}

function paginationLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 25;
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new MutationError("limit must be an integer from 1 to 100");
  }
  return limit;
}

function paginationCursor(url: URL): string | undefined {
  const cursor = url.searchParams.get("cursor");
  if (cursor === null) return undefined;
  if (!cursor || cursor.length > 2048) {
    throw new MutationError("Invalid pagination cursor");
  }
  return cursor;
}

function isProtectedPath(path: string): boolean {
  return path === "/status/private" ||
    path === "/manage" ||
    path.startsWith("/manage/") ||
    path === "/ops" ||
    path.startsWith("/ops/") ||
    path.startsWith("/api/ops/");
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

function mutationResponse(catalog: CatalogDocument, status = 200, changed = true): Response {
  return json(
    { revision: catalog.revision, reload: changed, changed },
    {
      status,
      headers: {
        ETag: `"${catalog.revision}"`,
        "Cache-Control": "private, no-store"
      }
    }
  );
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
  if (error instanceof CatalogConflictError) {
    return json(
      {
        error: "revision_conflict",
        ...(error.currentRevision
          ? { revision: error.currentRevision }
          : {}),
        message: "The catalog changed. Reload and review the latest revision."
      },
      { status: 409 }
    );
  }
  if (error instanceof MutationError) {
    return json({ error: "invalid_request", message: error.message }, { status: error.status });
  }
  if (error instanceof CsrfError) {
    return json({ error: "untrusted_origin" }, { status: 403 });
  }
  if (error instanceof CatalogNotFoundError) {
    return json({ error: "not_initialized" }, { status: 404 });
  }
  if (error instanceof BucketReadError) {
    return json({ error: "storage_unavailable" }, { status: 503 });
  }
  if (error instanceof MarkdownAdminUnavailableError) {
    return json({ error: "markdown_admin_unavailable" }, { status: 503 });
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
  public(snapshot, publicOrigin) {
    return renderPublicPage(snapshot, publicOrigin);
  },
  status(snapshot, publicOrigin) {
    return renderStatusPage(snapshot, publicOrigin);
  },
  privateStatus(snapshot, actor, publicOrigin) {
    return renderPrivateStatusPage(snapshot, actor, publicOrigin);
  },
  ops(snapshot, actor, revision) {
    return renderOperationsPage({
      snapshot,
      actor,
      revision
    });
  },
  markdownDocuments(snapshot, actor, publicOrigin) {
    return renderMarkdownAdminPage({ snapshot, actor, publicOrigin });
  }
};

function html(body: string, privatePage = false): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": privatePage ? "private, no-store" : "public, max-age=60",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    }
  });
}

function isStaticAssetPath(pathname: string): pathname is StaticAssetPath {
  return pathname in STATIC_ASSETS;
}

async function asset(path: StaticAssetPath): Promise<Response> {
  const metadata = STATIC_ASSETS[path];
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = dirname(modulePath);
  const assetPath = metadata.file;
  const withoutParent = assetPath.replace(/^\.\.\//, "");
  const relativeWithoutLeadingPublic = withoutParent.replace(/^public\//, "");
  const candidateFiles = new Set([
    resolve(moduleDir, "..", withoutParent),
    resolve(process.cwd(), withoutParent),
    resolve(process.cwd(), "services", "tools", "dashboard", withoutParent),
    resolve(process.cwd(), "apps", "tools-web", withoutParent),
    resolve(process.cwd(), "..", "tools-web", withoutParent)
  ]);
  if (
    modulePath.includes(`${sep}.output${sep}server${sep}`) ||
    modulePath.includes(`${sep}.output${sep}server`) ||
    modulePath.includes(`${posix.sep}.output${posix.sep}server${posix.sep}`) ||
    modulePath.includes(`${posix.sep}.output${posix.sep}server`)
  ) {
    candidateFiles.add(
      resolve(moduleDir, "..", "..", "public", relativeWithoutLeadingPublic)
    );
  }

  let lastError: unknown;
  for (const filePath of candidateFiles) {
    try {
      const file = await readFile(filePath);
      return new Response(file, {
        headers: {
          "Content-Type": metadata.contentType,
          "Cache-Control": "public, max-age=3600"
        }
      });
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("Unable to resolve static asset");
}

const safeConsoleLogger: AppLogger = {
  info(event, fields) {
    console.info(JSON.stringify({ event, ...fields }));
  },
  error(event, fields) {
    console.error(JSON.stringify({ event, ...fields }));
  }
};
