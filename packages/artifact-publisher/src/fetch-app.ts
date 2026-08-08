import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform, type TransformCallback } from "node:stream";
import busboy from "busboy";
import { ActivityTracker } from "./activity-tracker.js";
import {
  EXTERNAL_UPLOAD_SCRIPT,
  EXTERNAL_UPLOAD_STYLES,
  renderExternalUploadPage
} from "./external-upload-page.js";
import {
  attachmentDisposition,
  MAX_PROJECT_NAME_BYTES,
  normalizeMimeType,
  normalizeProjectName,
  safeFileName
} from "./file-metadata.js";
import {
  HtmlUpdateConflictError,
  RangeNotSatisfiableError,
  type ListUploadsOptions,
  type UploadExpiryFilter,
  type UploadListCursor,
  type UploadListSort,
  type UploadStorage
} from "./storage.js";

export const MAX_SINGLE_PUT_UPLOAD_BYTES = 5_000_000_000;
export const DEFAULT_MAX_UPLOAD_BYTES = MAX_SINGLE_PUT_UPLOAD_BYTES;
export const DEFAULT_MAX_HTML_UPLOAD_BYTES = 25_000_000;
export const DEFAULT_MAX_CONCURRENT_UPLOADS = 1;
export const DEFAULT_TEMPORARY_FILE_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_TEMPORARY_FILE_RETENTION_MS = 100 * 365 * 24 * 60 * 60 * 1000;

const PAGE_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const HTML_MIME_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const SINGLE_BYTE_RANGE_PATTERN = /^bytes=(?:\d+-\d*|-\d+)$/i;
const DEFAULT_UPLOAD_LIST_LIMIT = 25;
const MAX_UPLOAD_LIST_LIMIT = 100;
const MAX_UPLOAD_LIST_CURSOR_LENGTH = 2048;
const UPLOAD_KEY_PATTERN =
  /^(?:pages\/[A-Za-z0-9_-]{32}\.html|files\/[A-Za-z0-9_-]{32})$/;
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#f3f1e9"/>
  <path d="M16 6.5 24 11v10l-8 4.5L8 21V11l8-4.5Z" fill="none" stroke="#087451" stroke-width="3" stroke-linejoin="round"/>
  <circle cx="16" cy="6.5" r="3.4" fill="#f3f1e9" stroke="#087451" stroke-width="2.6"/>
  <circle cx="8" cy="21" r="3.4" fill="#f3f1e9" stroke="#087451" stroke-width="2.6"/>
  <circle cx="24" cy="21" r="3.4" fill="#f3f1e9" stroke="#087451" stroke-width="2.6"/>
  <circle cx="16" cy="6.5" r="1.25" fill="#18211c"/>
  <circle cx="8" cy="21" r="1.25" fill="#18211c"/>
  <circle cx="24" cy="21" r="1.25" fill="#18211c"/>
  <path d="m16 13.5 2 1.2v2.6l-2 1.2-2-1.2v-2.6l2-1.2Z" fill="#18211c"/>
</svg>`;
const PUBLIC_HTML_CSP =
  "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads";
const EXTERNAL_UPLOAD_CSP = [
  "default-src 'none'",
  "connect-src 'self'",
  "img-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");
const EXTERNAL_UPLOAD_ASSET_VERSION = crypto
  .createHash("sha256")
  .update(EXTERNAL_UPLOAD_STYLES)
  .update("\0")
  .update(EXTERNAL_UPLOAD_SCRIPT)
  .digest("hex")
  .slice(0, 16);

export type FetchArtifactAppOptions = {
  activityTracker?: ActivityTracker;
  storage: UploadStorage;
  uploadToken: string;
  externalUpload?: boolean;
  publicBaseUrl?: string;
  maxUploadBytes?: number;
  maxHtmlUploadBytes?: number;
  maxConcurrentUploads?: number;
  temporaryFileRetentionMs?: number;
  now?: () => Date;
};

export function createFetchApp(options: FetchArtifactAppOptions) {
  const activityTracker = options.activityTracker ?? new ActivityTracker();
  const maxUploadBytes = positiveIntegerOption(
    options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
    "maxUploadBytes"
  );
  const maxHtmlUploadBytes = positiveIntegerOption(
    options.maxHtmlUploadBytes ?? Math.min(DEFAULT_MAX_HTML_UPLOAD_BYTES, maxUploadBytes),
    "maxHtmlUploadBytes"
  );
  const maxConcurrentUploads = positiveIntegerOption(
    options.maxConcurrentUploads ?? DEFAULT_MAX_CONCURRENT_UPLOADS,
    "maxConcurrentUploads"
  );
  const temporaryFileRetentionMs = positiveIntegerOption(
    options.temporaryFileRetentionMs ?? DEFAULT_TEMPORARY_FILE_RETENTION_MS,
    "temporaryFileRetentionMs"
  );
  if (maxHtmlUploadBytes > maxUploadBytes) {
    throw new Error("maxHtmlUploadBytes must be less than or equal to maxUploadBytes");
  }
  if (temporaryFileRetentionMs > MAX_TEMPORARY_FILE_RETENTION_MS) {
    throw new Error(
      `temporaryFileRetentionMs must be less than or equal to ${MAX_TEMPORARY_FILE_RETENTION_MS}`
    );
  }

  const uploadGate = createUploadGate(maxConcurrentUploads);
  const uploadToken = requireUploadToken(options.uploadToken);

  return async function artifactFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" || request.method === "HEAD") {
        const page = await readPageRoute(request, url, options, temporaryFileRetentionMs);
        if (page) return page;
        const file = await readFileRoute(request, url, options);
        if (file) return file;
      }

      if (request.method === "GET" && isExternalUploadPagePath(url.pathname)) {
        if (!options.externalUpload) return externalUploadUnavailable();
        return withExternalUploadHeaders(
          new Response(
            renderExternalUploadPage({
              assetVersion: EXTERNAL_UPLOAD_ASSET_VERSION,
              retentionLabel: formatRetention(temporaryFileRetentionMs)
            }),
            {
              headers: {
                "Cache-Control": "private, no-store",
                "Content-Type": "text/html; charset=utf-8"
              }
            }
          )
        );
      }

      if (request.method === "GET" && isExternalUploadAssetPath(url.pathname)) {
        if (!options.externalUpload) return externalUploadUnavailable();
        const asset = url.pathname.endsWith(".css")
          ? EXTERNAL_UPLOAD_STYLES
          : EXTERNAL_UPLOAD_SCRIPT;
        const contentType = url.pathname.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "text/javascript; charset=utf-8";
        return withExternalUploadHeaders(
          new Response(asset, {
            headers: {
              "Cache-Control": url.pathname.includes("/assets/")
                ? "private, max-age=31536000, immutable"
                : "private, no-store",
              "Content-Type": contentType
            }
          })
        );
      }

      if (request.method === "GET" && url.pathname === "/api/external-uploads") {
        if (!options.externalUpload) return externalUploadUnavailable();
        return tracked(
          activityTracker,
          () => listExternalUploads(request, url, options),
          request.signal
        );
      }

      if (request.method === "POST" && url.pathname === "/api/external-uploads") {
        if (!options.externalUpload) return externalUploadUnavailable();
        requireSameOrigin(request, url);
        requireMultipartUpload(request);
        return upload(
          request,
          url,
          options,
          { kind: "create", temporaryOnly: true },
          uploadGate,
          maxUploadBytes,
          maxHtmlUploadBytes,
          temporaryFileRetentionMs,
          activityTracker
        );
      }

      const externalUploadId = matchPath(url.pathname, "/api/external-uploads/");
      if (externalUploadId !== undefined && ["PUT", "PATCH", "DELETE"].includes(request.method)) {
        if (!options.externalUpload) return externalUploadUnavailable();
        requireSameOrigin(request, url);
        if (!PAGE_ID_PATTERN.test(externalUploadId)) {
          throw new ArtifactRequestError(
            400,
            "invalid_upload_id",
            "Upload ID is invalid."
          );
        }
        if (request.method === "PUT") {
          requireMultipartUpload(request);
          return upload(
            request,
            url,
            options,
            { kind: "update", id: externalUploadId },
            uploadGate,
            maxUploadBytes,
            maxHtmlUploadBytes,
            temporaryFileRetentionMs,
            activityTracker
          );
        }
        if (request.method === "PATCH") {
          const project = await readProjectUpdate(request);
          try {
            const updated = await options.storage.updateHtmlProject(
              externalUploadId,
              project,
              { signal: request.signal }
            );
            if (!updated) {
              throw new ArtifactRequestError(
                404,
                "upload_not_found",
                "The HTML upload was not found."
              );
            }
          } catch (error) {
            if (error instanceof HtmlUpdateConflictError) {
              throw new ArtifactRequestError(
                409,
                "upload_conflict",
                "The HTML page changed or was revoked before the project update completed."
              );
            }
            throw error;
          }
          return jsonResponse({ id: externalUploadId, project });
        }
        await options.storage.deleteUpload(externalUploadId, { signal: request.signal });
        return new Response(null, { status: 204 });
      }

      if (url.pathname === "/api/uploads" && request.method === "POST") {
        requireBearer(request, uploadToken);
        requireMultipartUpload(request);
        return upload(
          request,
          url,
          options,
          { kind: "create" },
          uploadGate,
          maxUploadBytes,
          maxHtmlUploadBytes,
          temporaryFileRetentionMs,
          activityTracker
        );
      }

      const uploadId = matchPath(url.pathname, "/api/uploads/");
      if (uploadId !== undefined && request.method === "PUT") {
        requireBearer(request, uploadToken);
        if (!PAGE_ID_PATTERN.test(uploadId)) {
          throw new ArtifactRequestError(
            400,
            "invalid_upload_id",
            "Upload ID is invalid."
          );
        }
        requireMultipartUpload(request);
        return upload(
          request,
          url,
          options,
          { kind: "update", id: uploadId },
          uploadGate,
          maxUploadBytes,
          maxHtmlUploadBytes,
          temporaryFileRetentionMs,
          activityTracker
        );
      }
      if (uploadId !== undefined && request.method === "DELETE") {
        requireBearer(request, uploadToken);
        if (!PAGE_ID_PATTERN.test(uploadId)) {
          throw new ArtifactRequestError(
            400,
            "invalid_upload_id",
            "Upload ID is invalid."
          );
        }
        await options.storage.deleteUpload(uploadId, { signal: request.signal });
        return new Response(null, { status: 204 });
      }

      if (url.pathname.startsWith("/api/")) {
        return jsonResponse(
          { error: "not_found", message: "API route was not found." },
          404
        );
      }
      return new Response("Route not found.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    } catch (error) {
      if (request.signal.aborted) {
        throw error;
      }
      return artifactErrorResponse(error);
    }
  };
}

async function readPageRoute(
  request: Request,
  url: URL,
  options: FetchArtifactAppOptions,
  _temporaryFileRetentionMs: number
): Promise<Response | undefined> {
  if (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") {
    return new Response(FAVICON_SVG, {
      headers: {
        "Cache-Control": "public, max-age=86400",
        "Content-Type": "image/svg+xml; charset=utf-8"
      }
    });
  }

  const match = matchCapabilityPath(url.pathname, ["/artifacts/", "/p/"]);
  if (match === undefined) return undefined;
  if (!PAGE_ID_PATTERN.test(match)) return new Response(null, { status: 404 });

  const html = await options.storage.getHtml(match, {
    headOnly: request.method === "HEAD",
    signal: request.signal
  });
  if (!html) return new Response(null, { status: 404 });

  const headers = new Headers({
    "Cache-Control": "private, no-cache",
    "Content-Security-Policy": PUBLIC_HTML_CSP,
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow"
  });
  applyRepresentationHeaders(headers, html.bytes, html.sha256, html.lastModified);
  if (isNotModified(request, headers)) {
    html.body.destroy();
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") {
    html.body.destroy();
    return new Response(null, { status: 200, headers });
  }
  return new Response(toWebStream(html.body), { headers });
}

async function readFileRoute(
  request: Request,
  url: URL,
  options: FetchArtifactAppOptions
): Promise<Response | undefined> {
  const match = matchFilePath(url.pathname);
  if (!match) return undefined;
  const { id } = match;
  if (!PAGE_ID_PATTERN.test(id)) return new Response(null, { status: 404 });

  let range = request.method === "HEAD" ? undefined : requestedRange(request);
  if (range === null) {
    const metadata = await options.storage.getTemporaryFile(id, {
      headOnly: true,
      signal: request.signal
    });
    if (!metadata || metadata.expiresAt <= getNow(options)) {
      metadata?.body.destroy();
      return new Response(null, { status: 404 });
    }
    metadata.body.destroy();
    return rangeNotSatisfiable(metadata.bytes);
  }

  const ifRange = range ? request.headers.get("if-range") : undefined;
  if (range && ifRange) {
    const metadata = await options.storage.getTemporaryFile(id, {
      headOnly: true,
      signal: request.signal
    });
    if (!metadata || metadata.expiresAt <= getNow(options)) {
      metadata?.body.destroy();
      return new Response(null, { status: 404 });
    }
    metadata.body.destroy();
    if (!ifRangeAllowsPartialResponse(ifRange, metadata.sha256, metadata.lastModified)) {
      range = undefined;
    }
  }

  try {
    const file = await options.storage.getTemporaryFile(id, {
      headOnly: request.method === "HEAD",
      range,
      signal: request.signal
    });
    if (!file || file.expiresAt <= getNow(options)) {
      file?.body.destroy();
      return new Response(null, { status: 404 });
    }

    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Disposition": attachmentDisposition(file.originalName),
      "Content-Type": normalizeMimeType(file.contentType),
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow"
    });
    applyRepresentationHeaders(headers, file.bytes, file.sha256, file.lastModified);
    if (file.contentRange) {
      headers.set("Content-Range", file.contentRange);
    }
    const status = file.contentRange ? 206 : 200;
    if (request.method === "HEAD") {
      file.body.destroy();
      return new Response(null, { status, headers });
    }
    return new Response(toWebStream(file.body), { status, headers });
  } catch (error) {
    if (error instanceof RangeNotSatisfiableError) {
      if (error.expiresAt && error.expiresAt <= getNow(options)) {
        return new Response(null, { status: 404 });
      }
      return rangeNotSatisfiable(error.totalBytes);
    }
    throw error;
  }
}

async function listExternalUploads(
  request: Request,
  url: URL,
  options: FetchArtifactAppOptions
): Promise<Response> {
  const pagination = parseUploadListOptions(url.searchParams);
  const baseUrl = getPublicBaseUrl(request, options.publicBaseUrl);
  const page = await options.storage.listUploads(getNow(options), {
    ...pagination,
    signal: request.signal
  });
  return jsonResponse(
    {
      uploads: page.uploads.map((upload) => ({
        id: upload.id,
        kind: upload.kind,
        filename: upload.originalName,
        contentType: upload.contentType,
        url:
          upload.kind === "html"
            ? `${baseUrl}/artifacts/${upload.id}`
            : `${baseUrl}/files/${upload.id}/${encodeURIComponent(upload.originalName)}`,
        bytes: upload.bytes,
        updatedAt: upload.updatedAt.toISOString(),
        ...(upload.project ? { project: upload.project } : {}),
        ...(upload.expiresAt ? { expiresAt: upload.expiresAt.toISOString() } : {})
      })),
      ...(page.nextCursor
        ? {
            nextCursor: encodeUploadListCursor(
              page.nextCursor,
              pagination.criteria ?? "legacy:newest",
              page.uploads.at(-1)?.originalName ?? page.nextCursor.key
            )
          }
        : {})
    },
    200,
    { "Cache-Control": "private, no-store" }
  );
}

async function upload(
  request: Request,
  url: URL,
  options: FetchArtifactAppOptions,
  mode: UploadMode,
  gate: ReturnType<typeof createUploadGate>,
  maxUploadBytes: number,
  maxHtmlUploadBytes: number,
  temporaryFileRetentionMs: number,
  activityTracker: ActivityTracker
): Promise<Response> {
  const release = gate.tryAcquire();
  if (!release) {
    await consumeBody(request);
    return jsonResponse(
      {
        error: "upload_capacity_reached",
        message: "The service is already processing its maximum number of uploads."
      },
      503,
      { Connection: "close", "Retry-After": "1" }
    );
  }

  return activityTracker.track(
    (async () => {
      let staged: StagedUpload | undefined;
      let cleanupId: string | undefined;
      let responseSent = false;
      try {
        staged = await stageMultipart(request, {
          maxUploadBytes,
          maxHtmlUploadBytes,
          temporaryOnly: mode.kind === "create" && mode.temporaryOnly === true,
          signal: request.signal
        });
        const uploadType = classifyUpload(
          staged.originalName,
          staged.contentType,
          mode.kind === "create" && mode.temporaryOnly === true
        );
        if (mode.kind === "update" && uploadType.kind !== "html") {
          throw new ArtifactRequestError(
            400,
            "html_upload_required",
            "Only HTML pages can be updated."
          );
        }
        const id = mode.kind === "update" ? mode.id : generatePageId();
        const originalName = safeFileName(
          staged.originalName,
          uploadType.kind === "temporary" ? "download" : "page.html"
        );
        const baseUrl = getPublicBaseUrl(request, options.publicBaseUrl);
        let project = staged.project;
        let updateEtag: string | undefined;
        if (mode.kind === "update") {
          const existing = await options.storage.getHtml(id, {
            headOnly: true,
            signal: request.signal
          });
          if (!existing) {
            throw new ArtifactRequestError(
              404,
              "upload_not_found",
              "The HTML upload to update was not found."
            );
          }
          existing.body.destroy();
          project ??= existing.project;
          if (!existing.etag) throw new Error(`Stored HTML ${id} is missing an ETag`);
          updateEtag = existing.etag;
        }

        const sha256 = await sha256File(staged.filePath, request.signal);
        throwIfAborted(request.signal);
        if (uploadType.kind === "html") {
          if (mode.kind === "create") cleanupId = id;
          try {
            await options.storage.putHtml(
              id,
              staged.filePath,
              {
                bytes: staged.bytes,
                originalName,
                sha256,
                ...(project ? { project } : {})
              },
              { ifMatch: updateEtag, signal: request.signal }
            );
          } catch (error) {
            if (error instanceof HtmlUpdateConflictError) {
              throw new ArtifactRequestError(
                409,
                "upload_conflict",
                "The HTML page changed or was revoked before the update completed."
              );
            }
            throw error;
          }
          throwIfAborted(request.signal);
          responseSent = true;
          return jsonResponse(
            {
              id,
              kind: "html",
              filename: originalName,
              contentType: HTML_CONTENT_TYPE,
              url: `${baseUrl}/artifacts/${id}`,
              bytes: staged.bytes,
              sha256,
              ...(project ? { project } : {})
            },
            mode.kind === "create" ? 201 : 200
          );
        }

        const expiresAt = new Date(
          getNow(options).getTime() + temporaryFileRetentionMs
        );
        cleanupId = id;
        await options.storage.putTemporaryFile(
          id,
          staged.filePath,
          {
            bytes: staged.bytes,
            contentType: uploadType.contentType,
            expiresAt,
            originalName,
            sha256
          },
          { signal: request.signal }
        );
        throwIfAborted(request.signal);
        responseSent = true;
        return jsonResponse(
          {
            id,
            kind: "file",
            filename: originalName,
            contentType: uploadType.contentType,
            url: `${baseUrl}/files/${id}/${encodeURIComponent(originalName)}`,
            bytes: staged.bytes,
            expiresAt: expiresAt.toISOString(),
            sha256
          },
          201
        );
      } catch (error) {
        if (cleanupId && !responseSent) {
          try {
            await options.storage.deleteUpload(cleanupId, { signal: request.signal });
          } catch (cleanupError) {
            console.error("failed to clean up an interrupted upload", cleanupError);
          }
        }
        throw error;
      } finally {
        release();
        if (staged) await safeUnlink(staged.filePath);
      }
    })()
  ).then(
    (response) => response,
    (error) => artifactErrorResponse(error)
  );
}

type UploadMode =
  | { kind: "create"; temporaryOnly?: boolean }
  | { kind: "update"; id: string };

type StagedUpload = {
  filePath: string;
  originalName: string;
  contentType: string;
  bytes: number;
  project?: string;
};

async function stageMultipart(
  request: Request,
  options: {
    maxUploadBytes: number;
    maxHtmlUploadBytes: number;
    temporaryOnly: boolean;
    signal: AbortSignal;
  }
): Promise<StagedUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!isMultipartContentType(contentType)) {
    throw new ArtifactRequestError(
      415,
      "unsupported_media_type",
      "Expected multipart/form-data with a boundary."
    );
  }
  if (!request.body) {
    throw new ArtifactRequestError(
      400,
      "invalid_multipart_upload",
      "The multipart upload could not be parsed."
    );
  }

  const parser = busboy({
    headers: { "content-type": contentType },
    defParamCharset: "utf8",
    limits: {
      fieldNameSize: 64,
      fieldSize: MAX_PROJECT_NAME_BYTES,
      fields: 1,
      files: 1,
      fileSize: options.maxUploadBytes,
      headerPairs: 100,
      parts: 3
    }
  });
  const input = Readable.fromWeb(
    request.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>
  );
  let filePromise: Promise<StagedUpload> | undefined;
  let parserError: unknown;
  let fileCount = 0;
  let project: string | undefined;

  parser.on("file", (fieldName, stream, info) => {
    fileCount += 1;
    if (fieldName !== "file" || fileCount > 1) {
      stream.resume();
      parserError ??= new ArtifactRequestError(
        400,
        "invalid_multipart_upload",
        "Expected exactly one file in multipart field `file`."
      );
      return;
    }
    const classification = classifyUpload(info.filename, info.mimeType, options.temporaryOnly);
    const maxBytes =
      classification.kind === "html" ? options.maxHtmlUploadBytes : options.maxUploadBytes;
    filePromise = stageFile(stream, info.filename, info.mimeType, maxBytes, options.signal);
    stream.on("limit", () => {
      parserError ??=
        classification.kind === "html"
          ? new HtmlPayloadTooLargeError(maxBytes, 0)
          : new ArtifactRequestError(
              413,
              "payload_too_large",
              "The uploaded file exceeds the configured size limit."
            );
    });
    filePromise.catch((error) => {
      parserError ??= error;
      parser.destroy(error instanceof Error ? error : new Error("Multipart staging failed"));
    });
  });
  parser.on("field", (fieldName, value, info) => {
    const normalized = normalizeProjectName(value);
    if (fieldName !== "project" || info.valueTruncated || !normalized || project) {
      parserError ??= new ArtifactRequestError(
        400,
        "invalid_project",
        "Project must be a single non-empty multipart field of at most 240 UTF-8 bytes."
      );
      return;
    }
    project = normalized;
  });
  parser.on("fieldsLimit", () => {
    parserError ??= new ArtifactRequestError(
      400,
      "invalid_project",
      "Only one optional multipart field named `project` is supported."
    );
  });
  parser.on("filesLimit", () => {
    parserError ??= new ArtifactRequestError(
      400,
      "invalid_multipart_upload",
      "Expected exactly one file in multipart field `file`."
    );
  });
  parser.on("partsLimit", () => {
    parserError ??= new ArtifactRequestError(
      400,
      "invalid_multipart_upload",
      "Expected exactly one file in multipart field `file`."
    );
  });
  parser.on("error", (error) => {
    parserError ??= error;
  });

  const parserDone = new Promise<void>((resolve) => parser.once("close", resolve));
  input.on("error", (error) => parser.destroy(error));
  input.pipe(parser);
  await parserDone;
  const staged = await filePromise?.catch((error) => {
    parserError ??= error;
    return undefined;
  });
  if (parserError) {
    if (staged) await safeUnlink(staged.filePath);
    throw parserError;
  }
  if (!staged || fileCount !== 1) {
    if (staged) await safeUnlink(staged.filePath);
    throw new ArtifactRequestError(
      400,
      "missing_file",
      "Expected multipart field `file`."
    );
  }
  return { ...staged, ...(project ? { project } : {}) };
}

async function stageFile(
  stream: Readable,
  originalName: string,
  contentType: string,
  maxBytes: number,
  signal: AbortSignal
): Promise<StagedUpload> {
  const filePath = path.join(
    os.tmpdir(),
    `artifact-publisher-${crypto.randomBytes(16).toString("hex")}`
  );
  const limiter = new ByteLimitTransform(maxBytes);
  const output = createWriteStream(filePath, { flags: "wx" });
  try {
    await pipeline(stream, limiter, output, { signal });
    if ((stream as Readable & { truncated?: boolean }).truncated) {
      throw new ArtifactRequestError(
        413,
        "payload_too_large",
        "The uploaded file exceeds the configured size limit."
      );
    }
    return {
      filePath,
      originalName,
      contentType: normalizeMimeType(contentType),
      bytes: limiter.bytesAccepted
    };
  } catch (error) {
    await safeUnlink(filePath);
    throw error;
  }
}

class ByteLimitTransform extends Transform {
  bytesAccepted = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(
    chunk: unknown,
    encoding: BufferEncoding,
    callback: TransformCallback
  ) {
    const buffer = typeof chunk === "string"
      ? Buffer.from(chunk, encoding)
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk)
        : undefined;
    if (!buffer) {
      callback(new TypeError("Multipart file stream emitted a non-byte chunk"));
      return;
    }
    if (this.bytesAccepted + buffer.length > this.maxBytes) {
      const error = new HtmlPayloadTooLargeError(this.maxBytes, this.bytesAccepted);
      callback(error);
      return;
    }
    this.bytesAccepted += buffer.length;
    callback(null, buffer);
  }
}

function classifyUpload(
  originalName: string,
  mimeType: string,
  temporaryOnly: boolean
): UploadClassification {
  const extension = path.extname(originalName).toLowerCase();
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (!temporaryOnly && HTML_EXTENSIONS.has(extension) && HTML_MIME_TYPES.has(normalizedMimeType)) {
    return { kind: "html" };
  }
  return { kind: "temporary", contentType: normalizedMimeType };
}

type UploadClassification =
  | { kind: "html" }
  | { kind: "temporary"; contentType: string };

function requireUploadToken(value: string) {
  if (!value) throw new Error("UPLOAD_TOKEN must not be empty");
  return value;
}

function requireBearer(request: Request, expectedToken: string) {
  const authorization = request.headers.get("authorization");
  if (!authorization || !constantTimeEquals(authorization, `Bearer ${expectedToken}`)) {
    throw new ArtifactRequestError(
      401,
      "unauthorized",
      "A valid upload bearer token is required.",
      { "WWW-Authenticate": 'Bearer realm="uploads"' }
    );
  }
}

function requireSameOrigin(request: Request, url: URL) {
  const origin = request.headers.get("origin");
  if (!origin || !isValidHost(url.host) || origin !== url.origin) {
    throw new ArtifactRequestError(
      403,
      "invalid_origin",
      "External uploads must come from the upload website."
    );
  }
}

function requireMultipartUpload(request: Request) {
  if (!isMultipartContentType(request.headers.get("content-type") ?? "")) {
    throw new ArtifactRequestError(
      415,
      "unsupported_media_type",
      "Expected multipart/form-data with a boundary."
    );
  }
}

async function readProjectUpdate(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new ArtifactRequestError(
      415,
      "unsupported_media_type",
      "Expected application/json."
    );
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 1024) {
    throw new ArtifactRequestError(413, "payload_too_large", "Project update is too large.");
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new ArtifactRequestError(400, "invalid_project", "Project update is invalid JSON.");
  }
  const project = input && typeof input === "object" && "project" in input
    ? normalizeProjectName(String(input.project))
    : undefined;
  if (!project) {
    throw new ArtifactRequestError(
      400,
      "invalid_project",
      "Project must be a non-empty string of at most 240 UTF-8 bytes."
    );
  }
  return project;
}

function isMultipartContentType(contentType: string) {
  return /^multipart\/form-data\s*;\s*boundary=(?:"[^"]+"|[^;\s]+)$/i.test(
    contentType
  );
}

function constantTimeEquals(actual: string, expected: string) {
  const actualHash = crypto.createHash("sha256").update(actual).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

function getPublicBaseUrl(request: Request, configuredBaseUrl?: string) {
  if (configuredBaseUrl) return configuredBaseUrl.replace(/\/+$/, "");
  const url = new URL(request.url);
  if (!isValidHost(url.host)) throw new Error("Unable to derive a valid public base URL");
  return url.origin;
}

function isExternalUploadPagePath(pathname: string) {
  return ["/publish", "/publish/callback", "/uploads", "/uploads/callback"].includes(pathname);
}

function isExternalUploadAssetPath(pathname: string) {
  return [
    "/publish/app.css",
    `/publish/assets/${EXTERNAL_UPLOAD_ASSET_VERSION}/app.css`,
    "/uploads/app.css",
    `/uploads/assets/${EXTERNAL_UPLOAD_ASSET_VERSION}/app.css`,
    "/publish/app.js",
    `/publish/assets/${EXTERNAL_UPLOAD_ASSET_VERSION}/app.js`,
    "/uploads/app.js",
    `/uploads/assets/${EXTERNAL_UPLOAD_ASSET_VERSION}/app.js`
  ].includes(pathname);
}

function externalUploadUnavailable() {
  return jsonResponse(
    {
      error: "external_upload_unavailable",
      message: "External uploads are not configured."
    },
    503
  );
}

function withExternalUploadHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", EXTERNAL_UPLOAD_CSP);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, {
    status: response.status,
    headers
  });
}

function matchCapabilityPath(pathname: string, prefixes: readonly string[]) {
  for (const prefix of prefixes) {
    if (pathname.startsWith(prefix)) return pathname.slice(prefix.length);
  }
  return undefined;
}

function matchFilePath(pathname: string) {
  for (const prefix of ["/files/", "/f/"]) {
    if (!pathname.startsWith(prefix)) continue;
    const rest = pathname.slice(prefix.length);
    const separator = rest.indexOf("/");
    if (separator < 1) return undefined;
    return { id: rest.slice(0, separator) };
  }
  return undefined;
}

function matchPath(pathname: string, prefix: string) {
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : undefined;
}

function applyRepresentationHeaders(
  headers: Headers,
  bytes: number,
  sha256?: string,
  lastModified?: Date
) {
  if (Number.isSafeInteger(bytes) && bytes >= 0) headers.set("Content-Length", String(bytes));
  const etag = sha256Etag(sha256);
  if (etag) headers.set("ETag", etag);
  if (lastModified && !Number.isNaN(lastModified.getTime())) {
    headers.set("Last-Modified", lastModified.toUTCString());
  }
}

function isNotModified(request: Request, headers: Headers) {
  const etag = headers.get("ETag");
  const ifNoneMatch = request.headers.get("if-none-match");
  if (etag && ifNoneMatch) {
    return ifNoneMatch.split(",").some((candidate) => candidate.trim() === etag);
  }
  const lastModified = headers.get("Last-Modified");
  const ifModifiedSince = request.headers.get("if-modified-since");
  return Boolean(
    lastModified &&
      ifModifiedSince &&
      Date.parse(lastModified) <= Date.parse(ifModifiedSince)
  );
}

function requestedRange(request: Request) {
  const range = request.headers.get("range");
  if (!range) return undefined;
  return range.length <= 100 && SINGLE_BYTE_RANGE_PATTERN.test(range) ? range : null;
}

function ifRangeAllowsPartialResponse(
  validator: string,
  sha256?: string,
  lastModified?: Date
) {
  const value = validator.trim();
  const etag = sha256Etag(sha256);
  if (value.startsWith('"') || value.startsWith("W/")) return Boolean(etag && value === etag);
  const validatorDate = parseHttpDate(value);
  return Boolean(
    validatorDate &&
      lastModified &&
      !Number.isNaN(lastModified.getTime()) &&
      Math.floor(lastModified.getTime() / 1000) <= Math.floor(validatorDate.getTime() / 1000)
  );
}

function sha256Etag(sha256: string | undefined) {
  return sha256 && /^[a-f0-9]{64}$/i.test(sha256)
    ? `"sha256-${sha256.toLowerCase()}"`
    : undefined;
}

function parseHttpDate(value: string) {
  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)
  ) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return date.toUTCString() === value ? date : null;
}

function rangeNotSatisfiable(totalBytes?: number) {
  const headers = new Headers({ "Accept-Ranges": "bytes" });
  if (totalBytes !== undefined) headers.set("Content-Range", `bytes */${totalBytes}`);
  return jsonResponse(
    {
      error: "range_not_satisfiable",
      message: "Only one satisfiable byte range is supported."
    },
    416,
    headers
  );
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: result });
}

class ArtifactRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers?: HeadersInit
  ) {
    super(message);
    this.name = "ArtifactRequestError";
  }
}

export class HtmlPayloadTooLargeError extends Error {
  readonly code = "HTML_PAYLOAD_TOO_LARGE";

  constructor(readonly limitBytes: number, readonly stagedBytes: number) {
    super(`HTML uploads may not exceed ${limitBytes} bytes.`);
    this.name = "HtmlPayloadTooLargeError";
  }
}

function artifactErrorResponse(error: unknown) {
  if (error instanceof ArtifactRequestError) {
    return jsonResponse({ error: error.code, message: error.message }, error.status, error.headers);
  }
  if (error instanceof HtmlPayloadTooLargeError) {
    return jsonResponse({ error: "html_payload_too_large", message: error.message }, 413);
  }
  if (error instanceof URIError) {
    return new Response(null, { status: 404 });
  }
  console.error(error);
  return jsonResponse(
    { error: "internal_server_error", message: "The request failed." },
    500
  );
}

function encodeUploadListCursor(
  cursor: UploadListCursor,
  criteria = cursor.criteria ?? "legacy:newest",
  originalName = cursor.originalName ?? cursor.key
) {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      criteria,
      updatedAt: cursor.updatedAt.toISOString(),
      key: cursor.key,
      originalName,
      ...(cursor.expiresAt ? { expiresAt: cursor.expiresAt.toISOString() } : {})
    }),
    "utf8"
  ).toString("base64url");
}

function parseUploadListOptions(search: URLSearchParams): Omit<ListUploadsOptions, "signal"> {
  const rawLimit = singleQuery(search, "limit");
  const rawKind = singleQuery(search, "kind");
  const rawCursor = singleQuery(search, "cursor");
  const rawQuery = singleQuery(search, "q");
  const rawExpiry = singleQuery(search, "expiry");
  const rawSort = singleQuery(search, "sort");
  const limit = rawLimit === undefined ? DEFAULT_UPLOAD_LIST_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_UPLOAD_LIST_LIMIT) {
    throw new ArtifactRequestError(
      400,
      "invalid_pagination",
      `limit must be an integer between 1 and ${MAX_UPLOAD_LIST_LIMIT}.`
    );
  }
  if (rawQuery !== undefined && rawQuery.length > 200) {
    throw new ArtifactRequestError(400, "invalid_pagination", "q must be at most 200 characters.");
  }
  const q = rawQuery?.trim().normalize("NFKC").toLowerCase() ?? "";
  const expiry: UploadExpiryFilter = rawExpiry === undefined || rawExpiry === "all"
    ? "all"
    : rawExpiry === "24h" || rawExpiry === "7d" || rawExpiry === "persistent"
      ? rawExpiry
      : (() => { throw new ArtifactRequestError(400, "invalid_pagination", "expiry must be all, 24h, 7d, or persistent."); })();
  const sort: UploadListSort = rawSort === undefined
    ? "newest"
    : rawSort === "newest" || rawSort === "oldest" || rawSort === "filename" || rawSort === "expiry"
      ? rawSort
      : (() => { throw new ArtifactRequestError(400, "invalid_pagination", "sort must be newest, oldest, filename, or expiry."); })();
  const kind = rawKind === undefined || rawKind === "all"
    ? undefined
    : rawKind === "html" || rawKind === "file"
      ? rawKind
      : (() => { throw new ArtifactRequestError(400, "invalid_pagination", "kind must be all, html, or file."); })();
  const criteria = JSON.stringify({ q, kind: kind ?? "all", expiry, sort });
  const cursor = rawCursor === undefined ? undefined : decodeUploadListCursor(rawCursor, criteria, q === "" && expiry === "all" && sort === "newest");
  return {
    limit,
    criteria,
    ...(kind ? { kind } : {}),
    ...(q ? { q } : {}),
    expiry,
    sort,
    ...(cursor ? { cursor } : {})
  };
}

function singleQuery(search: URLSearchParams, name: string) {
  const values = search.getAll(name);
  if (values.length > 1) {
    throw new ArtifactRequestError(400, "invalid_pagination", "Pagination parameters must be single values.");
  }
  return values[0];
}

function decodeUploadListCursor(value: string, criteria: string, legacyCompatible: boolean): UploadListCursor {
  if (!value || value.length > MAX_UPLOAD_LIST_CURSOR_LENGTH) {
    throw new ArtifactRequestError(400, "invalid_pagination", "cursor is invalid.");
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("invalid cursor");
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.updatedAt !== "string" ||
      typeof candidate.key !== "string" ||
      !UPLOAD_KEY_PATTERN.test(candidate.key)
    ) throw new Error("invalid cursor");
    const updatedAt = new Date(candidate.updatedAt);
    if (Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== candidate.updatedAt) throw new Error("invalid cursor");
    if (candidate.version === undefined) {
      if (!legacyCompatible || candidate.criteria !== undefined || candidate.originalName !== undefined || candidate.expiresAt !== undefined) throw new Error("invalid cursor");
      return { updatedAt, key: candidate.key };
    }
    if (candidate.version !== 1 || candidate.criteria !== criteria || typeof candidate.originalName !== "string") throw new Error("invalid cursor");
    let expiresAt: Date | undefined;
    if (candidate.expiresAt !== undefined) {
      if (typeof candidate.expiresAt !== "string") throw new Error("invalid cursor");
      expiresAt = new Date(candidate.expiresAt);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.toISOString() !== candidate.expiresAt) throw new Error("invalid cursor");
    }
    return {
      version: 1,
      criteria: candidate.criteria,
      updatedAt,
      key: candidate.key,
      originalName: candidate.originalName,
      ...(expiresAt ? { expiresAt } : {})
    };
  } catch {
    throw new ArtifactRequestError(400, "invalid_pagination", "cursor is invalid.");
  }
}

async function sha256File(filePath: string, signal: AbortSignal) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

async function safeUnlink(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") console.error(error);
  }
}

function getNow(options: FetchArtifactAppOptions) {
  return options.now?.() ?? new Date();
}

function generatePageId() {
  return crypto.randomBytes(24).toString("base64url");
}

function isValidHost(host: string) {
  return (
    /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host) ||
    /^\[[0-9A-Fa-f:]+\](?::\d{1,5})?$/.test(host)
  );
}

function toWebStream(stream: Readable) {
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Operation aborted");
}

async function consumeBody(request: Request) {
  if (request.body) await request.body.cancel();
}

function positiveIntegerOption(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function createUploadGate(maxConcurrentUploads: number) {
  let activeUploads = 0;
  return {
    tryAcquire() {
      if (activeUploads >= maxConcurrentUploads) return null;
      activeUploads += 1;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          activeUploads -= 1;
        }
      };
    }
  };
}

function tracked<T>(tracker: ActivityTracker, operation: () => Promise<T>, signal: AbortSignal) {
  return tracker.track(operation()).catch((error) => {
    if (signal.aborted) throw error;
    return artifactErrorResponse(error) as T;
  });
}

function formatRetention(retentionMs: number) {
  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  if (retentionMs % dayMs === 0) {
    const days = retentionMs / dayMs;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (retentionMs % hourMs === 0) {
    const hours = retentionMs / hourMs;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return "the configured retention period";
}
