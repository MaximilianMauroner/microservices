import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { ActivityTracker } from "./activity-tracker.js";
import {
  attachmentDisposition,
  normalizeMimeType,
  safeFileName
} from "./file-metadata.js";
import {
  createMultipartStagingStorage,
  HtmlPayloadTooLargeError
} from "./multipart-staging.js";
import {
  HtmlUpdateConflictError,
  RangeNotSatisfiableError,
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
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect x=".75" y=".75" width="30.5" height="30.5" rx="7" fill="#f6f8fa" stroke="#d0d7de" stroke-width="1.5"/>
  <path d="M10 10h8a4 4 0 0 1 4 4v8" fill="none" stroke="#59636e" stroke-width="2.25" stroke-linecap="round"/>
  <path d="M10 22h12" fill="none" stroke="#0969da" stroke-width="2.25" stroke-linecap="round"/>
  <rect x="6" y="6" width="8" height="8" rx="2" fill="#ffffff" stroke="#30363d" stroke-width="1.5"/>
  <rect x="18" y="18" width="8" height="8" rx="2" fill="#ffffff" stroke="#30363d" stroke-width="1.5"/>
  <circle cx="10" cy="10" r="2.25" fill="#0969da"/>
  <rect x="21" y="21" width="4" height="4" rx="1" fill="#0969da"/>
</svg>`;
const PUBLIC_HTML_CSP =
  "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads";

export type CreateAppOptions = {
  activityTracker?: ActivityTracker;
  storage: UploadStorage;
  uploadToken: string;
  publicBaseUrl?: string;
  maxUploadBytes?: number;
  maxHtmlUploadBytes?: number;
  maxConcurrentUploads?: number;
  temporaryFileRetentionMs?: number;
  now?: () => Date;
};

type MulterOptionsWithParameterCharset = multer.Options & {
  defParamCharset: "utf8";
};

export function createApp(options: CreateAppOptions) {
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
  const uploadOptions: MulterOptionsWithParameterCharset = {
    defParamCharset: "utf8",
    storage: createMultipartStagingStorage({
      destination: os.tmpdir(),
      filename: () => `html-publisher-${crypto.randomBytes(16).toString("hex")}`,
      isHtmlUpload: (file) => classifyUpload(file).kind === "html",
      maxHtmlUploadBytes
    }),
    limits: {
      fieldNameSize: 64,
      fields: 0,
      files: 1,
      fileSize: maxUploadBytes,
      headerPairs: 100,
      parts: 2
    }
  };
  const upload = multer(uploadOptions).single("file");

  const app = express();
  const uploadToken = requireUploadToken(options.uploadToken);
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.get(["/favicon.svg", "/favicon.ico"], (_req, res) => {
    res.set("Cache-Control", "public, max-age=86400").type("image/svg+xml").send(FAVICON_SVG);
  });

  app.get("/health", (_req, res) => {
    res.set("Cache-Control", "no-store").status(200).json({ ok: true });
  });

  app.post(
    "/api/uploads",
    uploadToken,
    requireMultipartUpload,
    startUpload({ kind: "create" })
  );

  app.put(/^\/api\/uploads\//, uploadToken);
  app.delete(/^\/api\/uploads\//, uploadToken);
  app.put(
    "/api/uploads/:id",
    (req, res, next) => {
      const id = req.params.id;
      if (!PAGE_ID_PATTERN.test(id)) {
        res.status(400).json({ error: "invalid_upload_id", message: "Upload ID is invalid." });
        return;
      }
      next();
    },
    requireMultipartUpload,
    (req, res, next) => startUpload({ id: req.params.id, kind: "update" })(req, res, next)
  );

  app.delete("/api/uploads/:id", trackedAsyncHandler(activityTracker, async (req, res, next) => {
    const id = req.params.id;
    if (!PAGE_ID_PATTERN.test(id)) {
      res.status(400).json({ error: "invalid_upload_id", message: "Upload ID is invalid." });
      return;
    }

    const requestAbort = observeRequestAbort(req, res);
    try {
      await options.storage.deleteUpload(id, { signal: requestAbort.signal });
      res.sendStatus(204);
    } catch (error) {
      if (!requestAbort.signal.aborted) {
        next(error);
      }
    } finally {
      requestAbort.stop();
    }
  }));

  app.get("/p/:id", trackedAsyncHandler(activityTracker, async (req, res, next) => {
    let body: Readable | undefined;
    const requestAbort = observeRequestAbort(req, res);
    try {
      const id = req.params.id;
      if (!PAGE_ID_PATTERN.test(id)) {
        res.sendStatus(404);
        return;
      }

      const html = await options.storage.getHtml(id, {
        headOnly: req.method === "HEAD",
        signal: requestAbort.signal
      });
      if (!html) {
        res.sendStatus(404);
        return;
      }
      body = html.body;

      applySandboxHeaders(res);
      applyRepresentationHeaders(res, html.bytes, html.sha256, html.lastModified);
      res.setHeader("Cache-Control", "private, no-cache");
      res.type("html");

      if (req.fresh) {
        html.body.destroy();
        res.status(304).end();
        return;
      }

      if (req.method === "HEAD") {
        html.body.destroy();
        res.status(200).end();
        return;
      }

      await pipeline(html.body, res);
    } catch (error) {
      body?.destroy();
      if (!requestAbort.signal.aborted) {
        next(error);
      }
    } finally {
      requestAbort.stop();
    }
  }));

  app.get("/f/:id/:filename", trackedAsyncHandler(activityTracker, async (req, res, next) => {
    let body: Readable | undefined;
    const requestAbort = observeRequestAbort(req, res);
    try {
      const id = req.params.id;
      if (!PAGE_ID_PATTERN.test(id)) {
        res.sendStatus(404);
        return;
      }

      const requested = req.method === "HEAD" ? undefined : requestedRange(req);
      if (requested === null) {
        const metadata = await options.storage.getTemporaryFile(id, {
          headOnly: true,
          signal: requestAbort.signal
        });
        if (!metadata || metadata.expiresAt <= getNow(options)) {
          metadata?.body.destroy();
          res.sendStatus(404);
          return;
        }

        metadata.body.destroy();
        sendRangeNotSatisfiable(res, metadata.bytes);
        return;
      }

      let range = requested;
      const ifRange = range ? req.get("if-range") : undefined;
      if (range && ifRange) {
        const metadata = await options.storage.getTemporaryFile(id, {
          headOnly: true,
          signal: requestAbort.signal
        });
        if (!metadata || metadata.expiresAt <= getNow(options)) {
          metadata?.body.destroy();
          res.sendStatus(404);
          return;
        }

        metadata.body.destroy();
        if (!ifRangeAllowsPartialResponse(ifRange, metadata.sha256, metadata.lastModified)) {
          range = undefined;
        }
      }

      const file = await options.storage.getTemporaryFile(id, {
        headOnly: req.method === "HEAD",
        range,
        signal: requestAbort.signal
      });
      if (!file || file.expiresAt <= getNow(options)) {
        file?.body.destroy();
        res.sendStatus(404);
        return;
      }
      body = file.body;

      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", normalizeMimeType(file.contentType));
      res.setHeader("Content-Disposition", attachmentDisposition(file.originalName));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      applyRepresentationHeaders(res, file.bytes, file.sha256, file.lastModified);

      if (file.contentRange) {
        res.status(206).setHeader("Content-Range", file.contentRange);
      } else {
        res.status(200);
      }

      if (req.method === "HEAD") {
        file.body.destroy();
        res.end();
        return;
      }

      await pipeline(file.body, res);
    } catch (error) {
      body?.destroy();
      if (error instanceof RangeNotSatisfiableError && !res.headersSent) {
        if (error.expiresAt && error.expiresAt <= getNow(options)) {
          res.sendStatus(404);
          return;
        }
        sendRangeNotSatisfiable(res, error.totalBytes);
        return;
      }

      if (!requestAbort.signal.aborted) {
        next(error);
      }
    } finally {
      requestAbort.stop();
    }
  }));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found", message: "API route was not found." });
  });

  app.use(errorHandler);

  function startUpload(mode: UploadMode) {
    return (req: Request, res: Response, next: NextFunction) => {
      const release = uploadGate.tryAcquire();
      if (!release) {
        req.resume();
        res
          .set("Connection", "close")
          .set("Retry-After", "1")
          .status(503)
          .json({
            error: "upload_capacity_reached",
            message: "The service is already processing its maximum number of uploads."
          });
        return;
      }

      const requestAbort = observeRequestAbort(req, res);
      let capacityReleased = false;
      const releaseCapacity = () => {
        if (!capacityReleased) {
          capacityReleased = true;
          release();
        }
      };
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        requestAbort.stop();
        releaseCapacity();
      };

      upload(req, res, (error) => {
        if (error) {
          finish();
          if (!requestAbort.signal.aborted) {
            next(error);
          }
          return;
        }

        void activityTracker.track(
          handleUpload(req, res, next, options, mode, {
            maxHtmlUploadBytes,
            temporaryFileRetentionMs,
            signal: requestAbort.signal,
            complete: releaseCapacity
          }).finally(finish)
        );
      });
    };
  }

  return app;
}

type UploadMode = { kind: "create" } | { id: string; kind: "update" };

function trackedAsyncHandler(
  activityTracker: ActivityTracker,
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void activityTracker.track(handler(req, res, next).catch(next));
  };
}

async function handleUpload(
  req: Request,
  res: Response,
  next: NextFunction,
  options: CreateAppOptions,
  mode: UploadMode,
  operation: {
    maxHtmlUploadBytes: number;
    temporaryFileRetentionMs: number;
    signal: AbortSignal;
    complete: () => void;
  }
) {
  let file: Express.Multer.File | undefined;
  let cleanupId: string | undefined;
  let responseSent = false;

  try {
    file = req.file;
    if (!file) {
      operation.complete();
      res.status(400).json({ error: "missing_file", message: "Expected multipart field `file`." });
      return;
    }

    const uploadType = classifyUpload(file);
    if (mode.kind === "update" && uploadType.kind !== "html") {
      operation.complete();
      res.status(400).json({
        error: "html_upload_required",
        message: "Only HTML pages can be updated."
      });
      return;
    }
    if (uploadType.kind === "html" && file.size > operation.maxHtmlUploadBytes) {
      operation.complete();
      res.status(413).json({
        error: "html_payload_too_large",
        message: `HTML uploads may not exceed ${operation.maxHtmlUploadBytes} bytes.`
      });
      return;
    }

    const id = mode.kind === "update" ? mode.id : generatePageId();
    const originalName = safeFileName(
      file.originalname,
      uploadType.kind === "temporary" ? "download" : "page.html"
    );
    const baseUrl = getPublicBaseUrl(req, options.publicBaseUrl);

    let updateEtag: string | undefined;
    if (mode.kind === "update") {
      const existing = await options.storage.getHtml(id, {
        headOnly: true,
        signal: operation.signal
      });
      if (!existing) {
        operation.complete();
        res.status(404).json({
          error: "upload_not_found",
          message: "The HTML upload to update was not found."
        });
        return;
      }
      existing.body.destroy();
      if (!existing.etag) {
        throw new Error(`Stored HTML ${id} is missing an ETag`);
      }
      updateEtag = existing.etag;
    }

    const sha256 = await sha256File(file.path, operation.signal);
    throwIfAborted(operation.signal);

    if (uploadType.kind === "html") {
      if (mode.kind === "create") {
        cleanupId = id;
      }
      try {
        await options.storage.putHtml(
          id,
          file.path,
          {
            bytes: file.size,
            originalName,
            sha256
          },
          { ifMatch: updateEtag, signal: operation.signal }
        );
      } catch (error) {
        if (error instanceof HtmlUpdateConflictError) {
          operation.complete();
          res.status(409).json({
            error: "upload_conflict",
            message: "The HTML page changed or was revoked before the update completed."
          });
          return;
        }
        throw error;
      }
      throwIfAborted(operation.signal);

      operation.complete();
      res.status(mode.kind === "create" ? 201 : 200).json({
        id,
        kind: "html",
        filename: originalName,
        contentType: HTML_CONTENT_TYPE,
        url: `${baseUrl}/p/${id}`,
        bytes: file.size,
        sha256
      });
      responseSent = true;
      return;
    }

    const expiresAt = new Date(getNow(options).getTime() + operation.temporaryFileRetentionMs);
    cleanupId = id;
    await options.storage.putTemporaryFile(
      id,
      file.path,
      {
        bytes: file.size,
        contentType: uploadType.contentType,
        expiresAt,
        originalName,
        sha256
      },
      { signal: operation.signal }
    );
    throwIfAborted(operation.signal);

    operation.complete();
    res.status(201).json({
      id,
      kind: "file",
      filename: originalName,
      contentType: uploadType.contentType,
      url: `${baseUrl}/f/${id}/${encodeURIComponent(originalName)}`,
      bytes: file.size,
      expiresAt: expiresAt.toISOString(),
      sha256
    });
    responseSent = true;
  } catch (error) {
    if (cleanupId && !responseSent) {
      try {
        await options.storage.deleteUpload(cleanupId);
      } catch (cleanupError) {
        console.error("failed to clean up an interrupted upload", cleanupError);
      }
    }

    operation.complete();
    if (!operation.signal.aborted) {
      next(error);
    }
  } finally {
    if (file?.path) {
      await safeUnlink(file.path);
    }
  }
}

function requireUploadToken(uploadToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authorization = req.get("authorization");
    const expected = `Bearer ${uploadToken}`;

    if (!authorization || !constantTimeEquals(authorization, expected)) {
      res
        .set("WWW-Authenticate", 'Bearer realm="uploads"')
        .status(401)
        .json({ error: "unauthorized", message: "A valid upload bearer token is required." });
      return;
    }

    next();
  };
}

function requireMultipartUpload(req: Request, res: Response, next: NextFunction) {
  const contentType = req.get("content-type") ?? "";
  const hasBoundary = /(?:^|;)\s*boundary=(?:"[^"]+"|[^;\s]+)/i.test(contentType);

  if (!req.is("multipart/form-data") || !hasBoundary) {
    res.status(415).json({
      error: "unsupported_media_type",
      message: "Expected multipart/form-data with a boundary."
    });
    return;
  }

  next();
}

function constantTimeEquals(actual: string, expected: string) {
  const actualHash = crypto.createHash("sha256").update(actual).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

type UploadClassification =
  | {
      kind: "html";
    }
  | {
      contentType: string;
      kind: "temporary";
    };

function classifyUpload(file: Express.Multer.File): UploadClassification {
  const extension = path.extname(file.originalname).toLowerCase();
  const mimeType = normalizeMimeType(file.mimetype);

  if (HTML_EXTENSIONS.has(extension) && HTML_MIME_TYPES.has(mimeType)) {
    return { kind: "html" };
  }

  return {
    contentType: mimeType,
    kind: "temporary"
  };
}

function generatePageId() {
  return crypto.randomBytes(24).toString("base64url");
}

function getPublicBaseUrl(req: Request, configuredBaseUrl?: string) {
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  const host = req.get("host");
  if (!host || !isValidHost(host) || (req.protocol !== "http" && req.protocol !== "https")) {
    throw new Error("Unable to derive a valid public base URL");
  }

  return new URL(`${req.protocol}://${host}`).origin;
}

function applySandboxHeaders(res: Response) {
  res.setHeader("Content-Security-Policy", PUBLIC_HTML_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

function applyRepresentationHeaders(
  res: Response,
  bytes: number,
  sha256?: string,
  lastModified?: Date
) {
  if (Number.isSafeInteger(bytes) && bytes >= 0) {
    res.setHeader("Content-Length", bytes);
  }
  const etag = sha256Etag(sha256);
  if (etag) {
    res.setHeader("ETag", etag);
  }
  if (lastModified && !Number.isNaN(lastModified.getTime())) {
    res.setHeader("Last-Modified", lastModified.toUTCString());
  }
}

async function sha256File(filePath: string, signal: AbortSignal) {
  const hash = crypto.createHash("sha256");

  for await (const chunk of createReadStream(filePath, { signal })) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function safeUnlink(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    const candidate = error as { code?: string };
    if (candidate.code !== "ENOENT") {
      console.error(error);
    }
  }
}

function getNow(options: CreateAppOptions) {
  return options.now?.() ?? new Date();
}

function requestedRange(req: Request) {
  const range = req.get("range");
  if (!range) {
    return undefined;
  }

  return range.length <= 100 && SINGLE_BYTE_RANGE_PATTERN.test(range) ? range : null;
}

function ifRangeAllowsPartialResponse(
  validator: string,
  sha256?: string,
  lastModified?: Date
) {
  const value = validator.trim();
  const etag = sha256Etag(sha256);
  if (value.startsWith('"') || value.startsWith("W/")) {
    return Boolean(etag && value === etag);
  }

  const validatorDate = parseHttpDate(value);
  if (!validatorDate || !lastModified || Number.isNaN(lastModified.getTime())) {
    return false;
  }

  return Math.floor(lastModified.getTime() / 1000) <= Math.floor(validatorDate.getTime() / 1000);
}

function sha256Etag(sha256: string | undefined) {
  return sha256 && /^[a-f0-9]{64}$/i.test(sha256)
    ? `"sha256-${sha256.toLowerCase()}"`
    : undefined;
}

function parseHttpDate(value: string) {
  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value
    )
  ) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const date = new Date(timestamp);
  return date.toUTCString() === value ? date : null;
}

function sendRangeNotSatisfiable(res: Response, totalBytes?: number) {
  res.setHeader("Accept-Ranges", "bytes");
  if (totalBytes !== undefined) {
    res.setHeader("Content-Range", `bytes */${totalBytes}`);
  }
  res.status(416).json({
    error: "range_not_satisfiable",
    message: "Only one satisfiable byte range is supported."
  });
}

function observeRequestAbort(req: Request, res: Response) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error("Client disconnected"));
    }
  };
  const abortOnEarlyClose = () => {
    if (!res.writableEnded) {
      abort();
    }
  };

  req.once("aborted", abort);
  res.once("close", abortOnEarlyClose);

  return {
    signal: controller.signal,
    stop() {
      req.off("aborted", abort);
      res.off("close", abortOnEarlyClose);
    }
  };
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Operation aborted");
  }
}

function createUploadGate(maxConcurrentUploads: number) {
  let activeUploads = 0;

  return {
    tryAcquire() {
      if (activeUploads >= maxConcurrentUploads) {
        return null;
      }

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

function positiveIntegerOption(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function isValidHost(host: string) {
  return (
    /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host) ||
    /^\[[0-9A-Fa-f:]+\](?::\d{1,5})?$/.test(host)
  );
}

function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (isMalformedPathEncoding(error)) {
    const pathname = req.originalUrl.split(/[?#]/, 1)[0] ?? "";
    if (
      (req.method === "DELETE" || req.method === "PUT") &&
      pathname.startsWith("/api/uploads/")
    ) {
      res.status(400).json({ error: "invalid_upload_id", message: "Upload ID is invalid." });
      return;
    }
    if (pathname.startsWith("/p/") || pathname.startsWith("/f/")) {
      res.sendStatus(404);
      return;
    }
  }

  if (error instanceof HtmlPayloadTooLargeError) {
    res.status(413).json({
      error: "html_payload_too_large",
      message: error.message
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "payload_too_large",
        message: "The uploaded file exceeds the configured size limit."
      });
      return;
    }

    res.status(400).json({
      error: "invalid_multipart_upload",
      reason: error.code,
      message: "Expected exactly one file in multipart field `file`."
    });
    return;
  }

  if (isMultipartParserError(error)) {
    res.status(400).json({
      error: "invalid_multipart_upload",
      message: "The multipart upload could not be parsed."
    });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "internal_server_error", message: "The request failed." });
}

function isMultipartParserError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.startsWith("Unexpected end of form") ||
    error.message.startsWith("Malformed part header") ||
    error.message.startsWith("Multipart:")
  );
}

function isMalformedPathEncoding(error: unknown) {
  if (!(error instanceof URIError)) {
    return false;
  }

  const candidate = error as { status?: number; statusCode?: number };
  return candidate.status === 400 || candidate.statusCode === 400;
}
